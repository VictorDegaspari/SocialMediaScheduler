import {editorTabList,editorPanelAttributes} from './cuts-editor-tabs.js';
import {overlayVisible,overlayImageBox,overlayTextLayout} from './cuts-overlays-layout.js';

export function cutOverlayFields(){
  return `<section ${editorPanelAttributes('primary','cut-overlays')} class="cuts-tool-section cuts-overlays"><div class="cuts-tool-heading"><div><h3 id="cut-overlays-heading">3. Textos e imagens</h3><p>Adicione títulos, logos ou imagens sobre o vídeo.</p></div></div><div class="cuts-overlay-add"><button class="button small" type="button" data-cut-overlay-action="add-text">Adicionar texto</button><button class="button small" type="button" data-cut-overlay-action="add-image">Adicionar imagem</button><input id="cut-overlay-file" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden></div><p class="tip">Para colar uma imagem copiada, use Ctrl+V com o editor aberto. PNG, JPEG ou WebP, até 20 MB.</p><p id="cut-overlay-status" class="cuts-overlay-status" role="status"></p><div id="cut-overlay-list" class="cuts-overlay-list" aria-label="Textos e imagens do vídeo"></div><div id="cut-overlay-controls"></div></section>`;
}

export function createOverlayEditor({form,canvas,overlays=[],jobId,signal,getDuration,seek,onChange,uploadImage}){
  const root=form.querySelector('#cut-overlays'),list=root.querySelector('#cut-overlay-list'),controls=root.querySelector('#cut-overlay-controls'),status=root.querySelector('#cut-overlay-status');
  const layers=structuredClone(overlays),images=new Map();let selected=layers[0]?.id||null,pending=0,drag=null,preventClick=false;
  const imageUrl=id=>`/api/cuts/jobs/${encodeURIComponent(jobId)}/images/${encodeURIComponent(id)}`;
  const clamp=value=>Math.max(0,Math.min(1,value));
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const current=()=>layers.find(o=>o.id===selected);
  const feedback=message=>{status.textContent=message;};
  const name=o=>o.type==='text'?(o.text.trim().slice(0,55)||'Texto sem conteúdo'):'Imagem';
  function imageFor(id){
    if(images.has(id))return images.get(id);
    const item={image:new Image(),ready:false,error:false};images.set(id,item);
    item.image.onload=()=>{if(signal.aborted)return;item.ready=true;onChange();};
    item.image.onerror=()=>{if(signal.aborted)return;item.error=true;feedback('Uma imagem não pôde ser carregada. Adicione a imagem novamente.');};
    item.image.src=imageUrl(id);return item;
  }
  function renderList(){
    list.innerHTML=layers.map((o,i)=>`<button class="cuts-overlay-item" type="button" data-cut-overlay-action="select" data-id="${esc(o.id)}" aria-pressed="${o.id===selected}"><span class="cuts-overlay-kind">${o.type==='text'?'T':'▧'}</span><span>${esc(name(o))}<small>${o.end===null?'Durante todo o vídeo':`${o.start} s → ${o.end} s`}</small></span><span class="cuts-overlay-order">${i+1}</span></button>`).join('')||'<p class="cuts-overlay-empty">Nenhum texto ou imagem adicionado.</p>';
  }
  function renderControls(){
    const o=current();if(!o){controls.replaceChildren();return;}
    const range=(field,label,min,max,value,step='1')=>`<div class="form-field cuts-editor-range"><label for="cut-overlay-${field}">${label} <output data-overlay-output="${field}">${value}${field==='fontSize'?'':'%'}</output></label><input id="cut-overlay-${field}" data-overlay-field="${field}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></div>`;
    const textFields=o.type==='text'?`<div class="form-field"><label for="cut-overlay-text">Texto sobre o vídeo</label><textarea id="cut-overlay-text" data-overlay-field="text" rows="3" maxlength="1000">${esc(o.text)}</textarea></div><div class="field-row"><div class="form-field"><label for="cut-overlay-color">Cor do texto</label><input id="cut-overlay-color" data-overlay-field="color" type="color" value="${esc(o.color)}"></div><div class="form-field"><label for="cut-overlay-background">Fundo do texto</label><select id="cut-overlay-background" data-overlay-field="background"><option value="none" ${o.background==='none'?'selected':''}>Sem caixa</option><option value="box" ${o.background==='box'?'selected':''}>Caixa escura</option></select></div></div>${range('fontSize','Tamanho do texto',24,160,o.fontSize)}`:'';
    const items=[...(o.type==='text'?[['cut-overlay-content','Texto']]:[]),['cut-overlay-position','Posição e tamanho'],['cut-overlay-timing','Duração']];
    const previous=controls.querySelector('[role="tab"][aria-selected="true"]')?.dataset.editorTab;
    const active=items.some(([id])=>id===previous)?previous:items[0][0];
    controls.innerHTML=`<div class="cuts-overlay-settings">${editorTabList('overlay','Ajustes do elemento',items,{active})}
      ${o.type==='text'?`<div ${editorPanelAttributes('overlay','cut-overlay-content',active==='cut-overlay-content')}>${textFields}</div>`:''}
      <div ${editorPanelAttributes('overlay','cut-overlay-position',active==='cut-overlay-position')}>${range('width',o.type==='image'?'Tamanho da imagem':'Largura do texto',5,100,Math.round(o.width*100))}<div class="field-row">${range('x','Posição horizontal',0,100,Math.round(o.x*100))}${range('y','Posição vertical',0,100,Math.round(o.y*100))}</div><p class="tip">Você também pode arrastar o elemento na prévia para posicionar.</p></div>
      <div ${editorPanelAttributes('overlay','cut-overlay-timing',active==='cut-overlay-timing')}><label class="checkbox"><input id="cut-overlay-always" data-overlay-field="always" type="checkbox" ${o.end===null?'checked':''}><span>Durante todo o vídeo</span></label><div class="field-row cuts-overlay-times"><div class="form-field"><label for="cut-overlay-start">Aparece em (segundos)</label><input id="cut-overlay-start" data-overlay-field="start" type="number" min="0" max="180" step="0.001" value="${o.start}" ${o.end===null?'disabled':''}></div><div class="form-field"><label for="cut-overlay-end">Some em (segundos)</label><input id="cut-overlay-end" data-overlay-field="end" type="number" min="0" max="180" step="0.001" value="${o.end??Math.min(3,getDuration())}" ${o.end===null?'disabled':''}></div></div><p class="tip">Os segundos contam a partir do início do vídeo final, descontando os trechos removidos.</p></div>
      <div class="form-actions"><button class="button small" type="button" data-cut-overlay-action="preview">Ver na prévia</button><button class="button small" type="button" data-cut-overlay-action="front">Trazer para frente</button><button class="button small danger" type="button" data-cut-overlay-action="remove">Remover elemento</button></div></div>`;
  }
  function refresh(){renderList();renderControls();onChange();}
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
      o.start=0;o.end=event.target.checked?null:Math.min(3,getDuration());renderControls();
    }else if(['text','color','background'].includes(field))o[field]=event.target.value;
    else o[field]=Number(event.target.value)/(['x','y','width'].includes(field)?100:1);
    const output=root.querySelector(`[data-overlay-output="${field}"]`);if(output)output.textContent=event.target.value+(field==='fontSize'?'':'%');
    renderList();onChange();
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
    canvas.setPointerCapture(event.pointerId);event.preventDefault();event.stopPropagation();renderList();renderControls();onChange();
  },{signal});
  canvas.addEventListener('pointermove',event=>{
    if(!drag)return;const p=point(event),o=layers.find(o=>o.id===drag.id);if(!o)return;
    o.x=clamp(drag.x+(p.x-drag.point.x)/Math.max(1,canvas.width-drag.box.width));o.y=clamp(drag.y+(p.y-drag.point.y)/Math.max(1,canvas.height-drag.box.height));
    for(const field of ['x','y']){root.querySelector('#cut-overlay-'+field).value=String(Math.round(o[field]*100));root.querySelector(`[data-overlay-output="${field}"]`).textContent=Math.round(o[field]*100)+'%';}
    event.preventDefault();onChange();
  },{signal});
  canvas.addEventListener('pointerup',()=>{drag=null;},{signal});
  canvas.addEventListener('pointercancel',()=>{drag=null;preventClick=false;},{signal});
  canvas.addEventListener('click',event=>{if(preventClick){preventClick=false;event.preventDefault();event.stopImmediatePropagation();}},{capture:true,signal});
  for(const o of layers)if(o.type==='image')imageFor(o.imageId);
  renderList();renderControls();
  return {paint,read(duration){
    if(pending)throw new Error('Aguarde o envio das imagens antes de salvar.');
    for(const o of layers){
      if(o.type==='text'&&!o.text.trim())throw new Error('Escreva um texto ou remova o elemento vazio.');
      if(!Number.isFinite(o.start)||o.start<0||o.start>=duration||(o.end!==null&&(!Number.isFinite(o.end)||o.end<=o.start||o.end>duration+.001)))throw new Error('Ajuste os tempos dos textos e imagens à duração final do vídeo.');
    }
    return structuredClone(layers);
  }};
}
