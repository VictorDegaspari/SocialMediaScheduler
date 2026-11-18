import {defaultSplitLayout,splitLayoutGeometry} from './cuts-split-layout.js';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const names={webcam:'webcam',content:'vídeo'};
const percent=value=>Number((value*100).toFixed(2));
function initialLayout(value){
  const defaults=defaultSplitLayout();
  return {...defaults,...value,webcam:{...defaults.webcam,...value?.webcam,region:{...defaults.webcam.region,...value?.webcam?.region}},
    content:{...defaults.content,...value?.content,region:{...defaults.content.region,...value?.content?.region}}};
}

export function splitEditorFields(value,esc){
  const layout=initialLayout(value);
  const paneFields=key=>{
    const pane=layout[key],label=names[key],part=key==='webcam'?'da webcam':'do vídeo';
    return `<fieldset data-split-fields="${key}" ${key==='content'?'hidden disabled':''}><legend>${key==='webcam'?'Webcam / reação · parte de cima':'Vídeo / jogo · parte de baixo'}</legend><div class="cuts-split-coordinates">${[['x','Esquerda'],['y','Topo'],['width','Largura'],['height','Altura']].map(([property,title])=>`<div class="form-field"><label for="split-${key}-${property}">${title} da área de ${label} (%)</label><input id="split-${key}-${property}" name="split-${key}-${property}" data-split-region="${property}" data-pane="${key}" type="number" min="${property==='width'||property==='height'?1:0}" max="100" step="0.01" value="${percent(pane.region[property])}" required></div>`).join('')}</div><div class="form-field"><label for="split-${key}-fit">Encaixe da ${key==='webcam'?'webcam':'parte de vídeo'}</label><select id="split-${key}-fit" data-split-property="fit" data-pane="${key}"><option value="crop" ${pane.fit==='crop'?'selected':''}>Preencher espaço · recortar sobras</option><option value="fit" ${pane.fit==='fit'?'selected':''}>Encaixar imagem inteira · manter proporção</option></select></div>${[['zoom','Aproximação',0.25,3,0.05],['focusX','Posição horizontal',0,1,0.01],['focusY','Posição vertical',0,1,0.01]].map(([property,title,min,max,step])=>`<div class="form-field cuts-editor-range"><label for="split-${key}-${property}">${title} ${part} <output data-split-output="${key}-${property}"></output></label><input id="split-${key}-${property}" data-split-property="${property}" data-pane="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${esc(pane[property])}"></div>`).join('')}<button class="button ghost small" type="button" data-split-action="reset">Redefinir esta parte</button></fieldset>`;
  };
  return `<fieldset id="cut-split-controls" class="cuts-split-controls" hidden disabled><legend>Webcam em cima + vídeo embaixo</legend><p>Selecione duas regiões do mesmo vídeo. Cada parte tem seu próprio recorte e ajuste.</p><div class="form-field cuts-editor-range"><label for="cut-split-ratio">Espaço da webcam (%) <output id="cut-split-ratio-value">${percent(layout.topRatio)}</output></label><input id="cut-split-ratio" type="range" min="20" max="70" step="0.1" value="${percent(layout.topRatio)}"></div><button class="button ghost small" type="button" data-split-action="half">Metade para cada parte</button><div class="cuts-split-tabs" role="group" aria-label="Parte que deseja ajustar"><button class="button small" type="button" data-split-pane="webcam" aria-pressed="true">Webcam · cima</button><button class="button small" type="button" data-split-pane="content" aria-pressed="false">Vídeo · baixo</button></div><p id="cut-split-selection-label" class="cuts-split-selection-label">Selecione a webcam no vídeo original</p><div class="cuts-split-source"><canvas id="cut-split-source" width="640" height="360" tabindex="0" role="img" aria-label="Selecionar região da webcam no vídeo original" aria-describedby="cut-split-help"></canvas></div><p id="cut-split-help" class="tip">Arraste o retângulo para mover e os cantos para redimensionar. Arraste fora dele para selecionar outra área. As setas movem a seleção; Shift + setas ajusta o tamanho. A divisão na prévia também pode ser arrastada.</p>${paneFields('webcam')}${paneFields('content')}</fieldset>`;
}

export function paintSplitPreview(ctx,video,layout,width,height){
  const panes=splitLayoutGeometry(video.videoWidth,video.videoHeight,width,height,layout);
  for(const [pane,y] of [[panes.webcam,0],[panes.content,panes.webcam.height]]){
    const {crop,scaled,pad}=pane;
    ctx.drawImage(video,crop.x,crop.y,crop.width,crop.height,pad.x,y+pad.y,scaled.width,scaled.height);
  }
}

export function createSplitEditor({form,video,layout,onChange,signal,isFrameReady=()=>!video.seeking&&video.readyState>=2}){
  const root=form.querySelector('#cut-split-controls'),canvas=root.querySelector('canvas'),ctx=canvas.getContext('2d');
  const state={layout:initialLayout(layout),active:'webcam',used:!!layout,enabled:false,drag:null,dividerDrag:null};
  const divider=document.createElement('div');divider.id='cut-split-divider';divider.className='cuts-split-divider';divider.hidden=true;divider.tabIndex=0;
  divider.setAttribute('role','separator');divider.setAttribute('aria-orientation','horizontal');divider.setAttribute('aria-label','Divisão entre webcam e vídeo');divider.setAttribute('aria-valuemin','20');divider.setAttribute('aria-valuemax','70');
  divider.innerHTML='<span aria-hidden="true">↕</span>';form.querySelector('.cuts-phone-screen').append(divider);
  const regionInputs=key=>[...root.querySelectorAll(`[data-split-fields="${key}"] [data-split-region]`)];
  function syncFields(){
    root.querySelector('#cut-split-ratio').value=percent(state.layout.topRatio);root.querySelector('#cut-split-ratio-value').textContent=percent(state.layout.topRatio);
    divider.style.top=percent(state.layout.topRatio)+'%';divider.setAttribute('aria-valuenow',String(percent(state.layout.topRatio)));
    for(const key of ['webcam','content']){
      const pane=state.layout[key],fieldset=root.querySelector(`[data-split-fields="${key}"]`);fieldset.hidden=key!==state.active;fieldset.disabled=key!==state.active;
      for(const input of regionInputs(key))input.value=percent(pane.region[input.dataset.splitRegion]);
      for(const input of fieldset.querySelectorAll('[data-split-property]'))input.value=pane[input.dataset.splitProperty];
      for(const property of ['zoom','focusX','focusY'])root.querySelector(`[data-split-output="${key}-${property}"]`).textContent=property==='zoom'?pane[property]+'×':percent(pane[property])+'%';
    }
    for(const button of root.querySelectorAll('[data-split-pane]'))button.setAttribute('aria-pressed',String(button.dataset.splitPane===state.active));
    root.querySelector('#cut-split-selection-label').textContent=state.active==='webcam'?'Selecione a webcam no vídeo original':'Selecione a região do vídeo / jogo';
    canvas.setAttribute('aria-label','Selecionar região de '+names[state.active]+' no vídeo original');
  }
  function setRegion(region){
    const width=clamp(region.width,0.01,1),height=clamp(region.height,0.01,1);
    state.layout[state.active].region={x:clamp(region.x,0,1-width),y:clamp(region.y,0,1-height),width,height};
    syncFields();onChange();
  }
  function commitRegion(key,changed){
    const fields=regionInputs(key);if(fields.some(input=>!input.checkValidity()))throw new Error('Revise as coordenadas da área de '+names[key]+'.');
    const region=Object.fromEntries(fields.map(input=>[input.dataset.splitRegion,Number(input.value)/100]));
    if(changed==='width')region.width=Math.min(region.width,1-region.x);
    if(changed==='height')region.height=Math.min(region.height,1-region.y);
    const active=state.active;state.active=key;setRegion(region);state.active=active;
  }
  function setRatio(value){state.layout.topRatio=Math.round(clamp(value,0.2,0.7)*1000)/1000;syncFields();onChange();}
  function drawSource(ready=isFrameReady()){
    ready=ready&&isFrameReady();
    if(!state.enabled)return;
    const sourceWidth=video.videoWidth||640,sourceHeight=video.videoHeight||360;
    const scale=Math.min(1,960/sourceWidth,540/sourceHeight),width=Math.max(2,Math.round(sourceWidth*scale)),height=Math.max(2,Math.round(sourceHeight*scale));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    canvas.style.width=Math.min(canvas.parentElement.clientWidth,280*sourceWidth/sourceHeight)+'px';
    canvas.style.height='auto';ctx.fillStyle='#10241c';ctx.fillRect(0,0,width,height);canvas.dataset.seeking=String(!ready);
    if(!ready||video.readyState<2){ctx.fillStyle='#fff';ctx.font='16px sans-serif';ctx.fillText('Buscando quadro…',16,30);return;}
    ctx.drawImage(video,0,0,width,height);canvas.dataset.sourceTime=String(video.currentTime);
    const region=state.layout[state.active].region,x=region.x*width,y=region.y*height,w=region.width*width,h=region.height*height;
    ctx.fillStyle='rgba(0,0,0,.5)';ctx.beginPath();ctx.rect(0,0,width,height);ctx.rect(x,y,w,h);ctx.fill('evenodd');
    for(const key of ['content','webcam']){
      const r=state.layout[key].region;ctx.strokeStyle=key==='webcam'?'#ffe36d':'#58e4c2';ctx.lineWidth=key===state.active?3:1;ctx.setLineDash(key===state.active?[]:[6,4]);ctx.strokeRect(r.x*width,r.y*height,r.width*width,r.height*height);
    }
    ctx.setLineDash([]);ctx.fillStyle='#fff';const handle=Math.max(7,width/90);
    for(const [left,top] of [[x,y],[x+w,y],[x,y+h],[x+w,y+h]])ctx.fillRect(left-handle/2,top-handle/2,handle,handle);
  }
  function point(event){const bounds=canvas.getBoundingClientRect();return {x:clamp((event.clientX-bounds.left)/bounds.width,0,1),y:clamp((event.clientY-bounds.top)/bounds.height,0,1)};}
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0||video.readyState<2)return;
    event.preventDefault();canvas.focus();const p=point(event),r=structuredClone(state.layout[state.active].region),bounds=canvas.getBoundingClientRect();
    const corners=[[r.x,r.y],[r.x+r.width,r.y],[r.x,r.y+r.height],[r.x+r.width,r.y+r.height]];
    const corner=corners.findIndex(([x,y])=>Math.hypot((p.x-x)*bounds.width,(p.y-y)*bounds.height)<=14);
    const inside=p.x>=r.x&&p.x<=r.x+r.width&&p.y>=r.y&&p.y<=r.y+r.height;
    state.drag={id:event.pointerId,point:p,region:r,mode:corner>=0?'resize':inside?'move':'new',anchor:corner>=0?corners[3-corner]:[p.x,p.y]};canvas.setPointerCapture(event.pointerId);
  },{signal});
  canvas.addEventListener('pointermove',event=>{
    const drag=state.drag;if(!drag||drag.id!==event.pointerId)return;const p=point(event);
    if(drag.mode==='move')setRegion({...drag.region,x:drag.region.x+p.x-drag.point.x,y:drag.region.y+p.y-drag.point.y});
    else{
      const [x,y]=drag.anchor,bounds=canvas.getBoundingClientRect();
      if(drag.mode==='new'&&Math.hypot((p.x-x)*bounds.width,(p.y-y)*bounds.height)<4)return;
      setRegion({x:Math.min(x,p.x),y:Math.min(y,p.y),width:Math.max(0.01,Math.abs(x-p.x)),height:Math.max(0.01,Math.abs(y-p.y))});
    }
  },{signal});
  const endDrag=event=>{if(state.drag?.id!==event.pointerId)return;if(event.type==='pointercancel')setRegion(state.drag.region);state.drag=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);};
  canvas.addEventListener('pointerup',endDrag,{signal});canvas.addEventListener('pointercancel',endDrag,{signal});
  canvas.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();
    const r={...state.layout[state.active].region},delta=event.key==='ArrowLeft'||event.key==='ArrowUp'?-0.01:0.01;
    const property=event.shiftKey?(event.key==='ArrowLeft'||event.key==='ArrowRight'?'width':'height'):(event.key==='ArrowLeft'||event.key==='ArrowRight'?'x':'y');r[property]+=delta;setRegion(r);
  },{signal});
  root.addEventListener('input',event=>{
    event.stopPropagation();const input=event.target;
    if(input.dataset.splitRegion)input.setCustomValidity('');
    if(input.id==='cut-split-ratio')setRatio(Number(input.value)/100);
    else if(input.dataset.splitProperty){state.layout[input.dataset.pane][input.dataset.splitProperty]=input.dataset.splitProperty==='fit'?input.value:Number(input.value);syncFields();onChange();}
  },{signal});
  root.addEventListener('change',event=>{
    if(!event.target.dataset.splitRegion)return;event.stopPropagation();
    try{commitRegion(event.target.dataset.pane,event.target.dataset.splitRegion);}catch(error){event.target.setCustomValidity(error.message);event.target.reportValidity();}
  },{signal});
  root.addEventListener('click',event=>{
    const button=event.target.closest('[data-split-pane],[data-split-action]');if(!button)return;
    if(button.dataset.splitPane){state.active=button.dataset.splitPane;syncFields();drawSource(!video.seeking);}
    else if(button.dataset.splitAction==='half')setRatio(0.5);
    else if(button.dataset.splitAction==='reset'){state.layout[state.active]=defaultSplitLayout()[state.active];syncFields();onChange();}
  },{signal});
  divider.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();state.dividerDrag=event.pointerId;divider.setPointerCapture(event.pointerId);},{signal});
  divider.addEventListener('pointermove',event=>{if(state.dividerDrag!==event.pointerId)return;const rect=divider.parentElement.getBoundingClientRect();setRatio((event.clientY-rect.top)/rect.height);},{signal});
  divider.addEventListener('pointerup',event=>{state.dividerDrag=null;if(divider.hasPointerCapture(event.pointerId))divider.releasePointerCapture(event.pointerId);},{signal});
  divider.addEventListener('pointercancel',()=>{state.dividerDrag=null;},{signal});
  divider.addEventListener('keydown',event=>{if(!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();setRatio(state.layout.topRatio+(event.key==='ArrowUp'?-0.01:0.01));},{signal});
  const observer=new ResizeObserver(()=>drawSource(!video.seeking));observer.observe(root.querySelector('.cuts-split-source'));
  syncFields();
  return {read:()=>structuredClone(state.layout),get used(){return state.used;},drawSource,
    refresh(enabled){state.enabled=enabled;state.used||=enabled;root.hidden=!enabled;root.disabled=!enabled;divider.hidden=!enabled;},
    commit(){for(const input of root.querySelectorAll('[data-split-region]'))input.setCustomValidity('');commitRegion(state.active);},
    destroy(){observer.disconnect();divider.remove();}};
}
