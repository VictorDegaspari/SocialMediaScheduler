import {mountOverlayView} from './build/cuts-overlays-view.js';
import {drawOverlayText,overlayVisible,overlayImageBox,overlayTextBox,overlayTextLayout} from './cuts-overlays-layout.js';

export function createOverlayEditor({form,canvas,overlays=[],jobId,signal,getDuration,seek,onChange,onAdd,uploadImage}){
  const root=form.querySelector('#cut-overlays');
  const layers=structuredClone(overlays),images=new Map();let selected=layers[0]?.id||null,pending=0,drag=null,preventClick=false;
  const view=mountOverlayView(root,layers,selected,getDuration());
  signal.addEventListener('abort',()=>view.destroy(),{once:true});
  const render=()=>view.update(layers,selected,getDuration());
  const imageUrl=id=>`/api/cuts/jobs/${encodeURIComponent(jobId)}/images/${encodeURIComponent(id)}`;
  const clamp=value=>Math.max(0,Math.min(1,value));
  const current=()=>layers.find(o=>o.id===selected);
  const feedback=message=>view.feedback(message);
  function imageFor(id){
    if(images.has(id))return images.get(id);
    const item={image:new Image(),ready:false,error:false};images.set(id,item);
    item.image.onload=()=>{if(signal.aborted)return;item.ready=true;onChange();};
    item.image.onerror=()=>{if(signal.aborted)return;item.error=true;feedback('Uma imagem não pôde ser carregada. Adicione a imagem novamente.');};
    item.image.src=imageUrl(id);return item;
  }
  function refresh(){render();onChange();}
  function add(layer){
    if(layers.length>=20)throw new Error('Use até 20 textos e imagens por vídeo.');
    layers.push({id:crypto.randomUUID(),start:0,end:null,x:.5,y:.1,...layer});
    selected=layers.at(-1).id;
    feedback('');
    render();
    onAdd();
  }
  async function upload(file,watermark=false){
    if(layers.length+pending>=20){feedback('Use até 20 textos e imagens por vídeo.');return;}
    if(file.size>20*1024*1024){feedback('Escolha uma imagem de até 20 MB.');return;}
    pending++;feedback('Enviando imagem…');
    if(root.hidden)root.dispatchEvent(new CustomEvent('cut-editor-reveal',{bubbles:true}));
    try{
      const response=await (uploadImage?uploadImage(file):fetch(`/api/cuts/jobs/${encodeURIComponent(jobId)}/images`,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','X-Watcher-Request':'1'},body:file,signal}));
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível adicionar a imagem.');
      if(signal.aborted)return;
      imageFor(data.id);
      const placement=watermark?{watermark:true,width:.16,x:.94,y:.035,opacity:.65}:{width:.3};
      add({type:'image',imageId:data.id,...placement});
      feedback(watermark?'Marca-d’água adicionada. Ajuste a posição e a opacidade.':'Imagem adicionada. Ajuste a posição e a duração.');
    }catch(error){if(error.name!=='AbortError'&&!signal.aborted)feedback(error.message);}
    finally{pending--;}
  }
  root.addEventListener('click',event=>{
    const button=event.target.closest('[data-cut-overlay-action]');if(!button)return;
    try{
      const action=button.dataset.cutOverlayAction,o=current();
      if(action==='add-text')add({type:'text',text:'Seu texto',fontSize:64,color:'#FFFFFF',background:'none',alignment:'left',width:.8});
      if(action==='add-image')root.querySelector('#cut-overlay-file').click();
      if(action==='add-watermark')root.querySelector('#cut-watermark-file').click();
      if(action==='select'){selected=button.dataset.id;refresh();}
      if(action==='remove'&&o){layers.splice(layers.indexOf(o),1);selected=layers.at(-1)?.id||null;refresh();}
      if(action==='front'&&o){layers.splice(layers.indexOf(o),1);layers.push(o);refresh();}
      if(action==='preview'&&o)seek(o.start);
    }catch(error){feedback(error.message);}
  },{signal});
  root.querySelector('#cut-overlay-file').addEventListener('change',async event=>{
    for(const file of event.target.files)await upload(file);event.target.value='';
  },{signal});
  root.querySelector('#cut-watermark-file').addEventListener('change',event=>{
    const file=event.target.files[0];event.target.value='';
    if(file)void upload(file,true);
  },{signal});
  document.addEventListener('paste',async event=>{
    if(!form.closest('dialog')?.open)return;
    const files=Array.from(event.clipboardData?.items||[]).filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);
    if(!files.length)return;
    event.preventDefault();for(const file of files)await upload(file);
  },{signal});
  root.addEventListener('input',event=>{
    const field=event.target.dataset.overlayField,o=current();if(!field||!o)return;
    if(field==='always'){
      o.start=0;o.end=event.target.checked?null:Math.min(3,getDuration());
    }else if(['text','color','background','alignment'].includes(field))o[field]=event.target.value;
    else o[field]=Number(event.target.value)/(['x','y','width','opacity'].includes(field)?100:1);
    render();onChange();
  },{signal});
  const boxes=new Map();
  const textLayouts=new WeakMap();
  function paint(ctx,time,duration){
    boxes.clear();const output={width:canvas.width,height:canvas.height};ctx.save();
    for(const o of layers){
      if(!Number.isFinite(time)||!overlayVisible(o,time,duration))continue;
      if(o.type==='image'){
        const item=imageFor(o.imageId);if(!item.ready)continue;
        const box=overlayImageBox(o,output,{width:item.image.naturalWidth,height:item.image.naturalHeight});
        ctx.save();ctx.globalAlpha=o.opacity??1;
        ctx.drawImage(item.image,box.x,box.y,box.width,box.height);
        ctx.restore();boxes.set(o.id,box);
      }else{
        const key=JSON.stringify([o.text,o.fontSize,o.width,o.alignment,output.width,output.height]);
        const cached=textLayouts.get(o);
        const layout=cached?.key===key?cached.layout:overlayTextLayout(o,output,ctx);
        if(cached?.key!==key)textLayouts.set(o,{key,layout});
        const box=overlayTextBox(o,output,layout);boxes.set(o.id,box);
        drawOverlayText(ctx,o,layout,box.x,box.y);
      }
    }
    const box=boxes.get(selected);
    if(box){ctx.strokeStyle='#93c5fd';ctx.lineWidth=2*output.height/1280;ctx.setLineDash([8*output.height/1280,5*output.height/1280]);ctx.strokeRect(box.x,box.y,box.width,box.height);}
    ctx.restore();
  }
  function point(event){const box=canvas.getBoundingClientRect();return {x:(event.clientX-box.left)*canvas.width/box.width,y:(event.clientY-box.top)*canvas.height/box.height};}
  canvas.addEventListener('pointerdown',event=>{
    const p=point(event),hit=[...layers].reverse().find(o=>{const b=boxes.get(o.id);return b&&p.x>=b.x&&p.x<=b.x+b.width&&p.y>=b.y&&p.y<=b.y+b.height;});
    if(!hit)return;
    selected=hit.id;drag={id:hit.id,point:p,x:hit.x,y:hit.y,box:boxes.get(hit.id)};preventClick=true;
    canvas.setPointerCapture(event.pointerId);event.preventDefault();event.stopPropagation();render();onChange();
  },{signal});
  canvas.addEventListener('pointermove',event=>{
    if(!drag)return;const p=point(event),o=layers.find(o=>o.id===drag.id);if(!o)return;
    o.x=clamp(drag.x+(p.x-drag.point.x)/Math.max(1,canvas.width-drag.box.width));o.y=clamp(drag.y+(p.y-drag.point.y)/Math.max(1,canvas.height-drag.box.height));
    render();
    event.preventDefault();onChange();
  },{signal});
  canvas.addEventListener('pointerup',()=>{drag=null;},{signal});
  canvas.addEventListener('pointercancel',()=>{drag=null;preventClick=false;},{signal});
  canvas.addEventListener('click',event=>{if(preventClick){preventClick=false;event.preventDefault();event.stopImmediatePropagation();}},{capture:true,signal});
  for(const o of layers)if(o.type==='image')imageFor(o.imageId);
  render();
  return {paint,read(duration){
    if(pending)throw new Error('Aguarde o envio das imagens antes de salvar.');
    for(const o of layers){
      if(o.type==='text'&&!o.text.trim())throw new Error('Escreva um texto ou remova o elemento vazio.');
      if(!Number.isFinite(o.start)||o.start<0||o.start>=duration||(o.end!==null&&(!Number.isFinite(o.end)||o.end<=o.start||o.end>duration+.001)))throw new Error('Ajuste os tempos dos textos e imagens à duração final do vídeo.');
    }
    return structuredClone(layers);
  }};
}
