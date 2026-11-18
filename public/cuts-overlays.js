import {mountOverlayView} from './build/cuts-overlays-view.js';
import {editorPanelAttributes} from './cuts-editor-tabs.js';
import {overlayVisible,overlayImageBox,overlayTextLayout} from './cuts-overlays-layout.js';

export function cutOverlayFields(){
  return `<section ${editorPanelAttributes('primary','cut-overlays')} class="cuts-tool-section cuts-overlays"></section>`;
}

export function createOverlayEditor({form,canvas,overlays=[],jobId,signal,getDuration,seek,onChange,uploadImage}){
  const root=form.querySelector('#cut-overlays');
  const layers=structuredClone(overlays),images=new Map();let selected=layers[0]?.id||null,pending=0,drag=null,preventClick=false;
  const view=mountOverlayView(root,layers,selected,getDuration()),controls=root.querySelector('#cut-overlay-controls');
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
    layers.push({id:crypto.randomUUID(),start:0,end:null,x:.5,y:.1,...layer});selected=layers.at(-1).id;feedback('');refresh();controls.dispatchEvent(new CustomEvent('cut-editor-reveal',{bubbles:true}));
  }
  async function upload(file){
    if(layers.length+pending>=20){feedback('Use até 20 textos e imagens por vídeo.');return;}
    if(file.size>20*1024*1024){feedback('Escolha uma imagem de até 20 MB.');return;}
    pending++;feedback('Enviando imagem…');root.dispatchEvent(new CustomEvent('cut-editor-reveal',{bubbles:true}));
    try{
      const response=await (uploadImage?uploadImage(file):fetch(`/api/cuts/jobs/${encodeURIComponent(jobId)}/images`,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','X-Watcher-Request':'1'},body:file,signal}));
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível adicionar a imagem.');
      if(signal.aborted)return;
      imageFor(data.id);add({type:'image',imageId:data.id,width:.3});feedback('Imagem adicionada. Ajuste a posição e a duração.');
    }catch(error){if(error.name!=='AbortError'&&!signal.aborted)feedback(error.message);}
    finally{pending--;}
  }
  root.addEventListener('click',event=>{
    const button=event.target.closest('[data-cut-overlay-action]');if(!button)return;
    try{
      const action=button.dataset.cutOverlayAction,o=current();
      if(action==='add-text')add({type:'text',text:'Seu texto',fontSize:64,color:'#FFFFFF',background:'none',width:.8});
      if(action==='add-image')root.querySelector('#cut-overlay-file').click();
      if(action==='select'){selected=button.dataset.id;refresh();}
      if(action==='remove'&&o){layers.splice(layers.indexOf(o),1);selected=layers.at(-1)?.id||null;refresh();}
      if(action==='front'&&o){layers.splice(layers.indexOf(o),1);layers.push(o);refresh();}
      if(action==='preview'&&o)seek(o.start);
    }catch(error){feedback(error.message);}
  },{signal});
  root.querySelector('#cut-overlay-file').addEventListener('change',async event=>{
    for(const file of event.target.files)await upload(file);event.target.value='';
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
    }else if(['text','color','background'].includes(field))o[field]=event.target.value;
    else o[field]=Number(event.target.value)/(['x','y','width'].includes(field)?100:1);
    render();onChange();
  },{signal});
  const boxes=new Map();
  function paint(ctx,time,duration){
    boxes.clear();const output={width:canvas.width,height:canvas.height};ctx.save();
    for(const o of layers){
      if(!Number.isFinite(time)||!overlayVisible(o,time,duration))continue;
      if(o.type==='image'){
        const item=imageFor(o.imageId);if(!item.ready)continue;
        const box=overlayImageBox(o,output,{width:item.image.naturalWidth,height:item.image.naturalHeight});
        ctx.drawImage(item.image,box.x,box.y,box.width,box.height);boxes.set(o.id,box);
      }else{
        const layout=overlayTextLayout(o,output),scale=output.height/1280;
        ctx.font=`bold ${layout.fontSize}px "DejaVu Sans",sans-serif`;ctx.textBaseline='top';ctx.textAlign='left';
        const width=Math.max(1,...layout.lines.map(line=>ctx.measureText(line).width)),height=layout.lines.length*layout.lineHeight-layout.fontSize*.2;
        const box={x:(output.width-width)*o.x,y:(output.height-height)*o.y,width,height};boxes.set(o.id,box);
        if(o.background==='box'){ctx.fillStyle='rgba(0,0,0,.65)';ctx.fillRect(box.x-8*scale,box.y-8*scale,width+16*scale,height+16*scale);}
        ctx.lineWidth=4*scale;ctx.lineJoin='round';ctx.strokeStyle='#000';ctx.fillStyle=o.color;
        for(const [i,line] of layout.lines.entries()){ctx.strokeText(line,box.x,box.y+i*layout.lineHeight);ctx.fillText(line,box.x,box.y+i*layout.lineHeight);}
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
