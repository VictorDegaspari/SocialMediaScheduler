import {clearWorkspace,drawWorkspace} from './build/workspace-view.js';
import {bindEditorTabs} from './cuts-editor-tabs.js';
import {createOverlayEditor} from './cuts-overlays.js';
import {createSplitEditor,paintSplitPreview} from './cuts-split.js';
import {formatSourceTimecode,formatTimecode,parseTimecode} from './cuts-time.js';
import {previewTimeToSource,sourceTimeToPreview} from './cuts-playback.js';
import {projectCaptionRows,mergeCaptionRows} from './cuts-captions.js';
import {replayTimeAt,selectionFromReplay} from './cuts-replay.js';
const defaults={fontSize:42,color:'#FFFFFF',highlightColor:'#FFE600',outlineColor:'#101010',background:'none',position:'bottom',animation:'none'};
export const cutFormats=[['shorts','Shorts · vertical (9:16)'],['video','Vídeo · horizontal (16:9)']];
const layoutDefaults={format:'shorts',mode:'fit',focusX:.5,focusY:.5,zoom:1};
const seconds=value=>Number(Number(value).toFixed(3));
const clock=value=>formatTimecode(value,{precision:2});


function retainedParts(start,end,gaps){
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)throw new Error('Escolha um início e um fim válidos no vídeo original.');
  const parts=[];let cursor=start,output=0;
  for(const gap of [...gaps].sort((a,b)=>a.start-b.start)){
    if(!Number.isFinite(gap.start)||!Number.isFinite(gap.end)||gap.start<start||gap.end>end||gap.end<=gap.start||gap.start<cursor)throw new Error('Revise os tempos da remoção. Use minutos:segundos e mantenha os trechos dentro do corte, sem sobreposição.');
    if(gap.start>cursor){parts.push({start:cursor,end:gap.start,outputStart:output});output+=gap.start-cursor;}
    cursor=gap.end;
  }
  if(cursor<end){parts.push({start:cursor,end,outputStart:output});output+=end-cursor;}
  if(output<.5||output>180.001)throw new Error('A duração final deve ser entre 0,5 e 180 segundos. Remova mais trechos ou ajuste os limites.');
  return {parts,duration:output};
}

/** Media and caption edits use the file clock. A live range offsets only the original clock shown to users. */
export function createCutEditor({clip,job,api}){
  const form=document.querySelector('#cuts-dialog-form'),controller=new AbortController(),signal=controller.signal;
  const style={...defaults,...clip.caption_style},framing={...layoutDefaults,mode:clip.framing||'fit',...clip.framing_options};
  const state={gaps:structuredClone(clip.excluded_ranges||[]),original:null,originalLoading:false,originalError:null,parts:[],duration:0,frame:0,alive:true,seek:Number(clip.start_seconds),dragging:false,replayPointer:null,cueCache:structuredClone(clip.captions||[]),captionBase:structuredClone(clip.captions||[]),captionRows:[],captionParts:[],captionPlan:null,captionError:null,edgesApplied:false,nextCue:0,captionsDirty:false,previewPlaying:false,framePending:true,seekVersion:0,videoFrame:null};
  clearWorkspace(form);
  drawWorkspace(form,'cutEditor',{clip,job,style,framing,cutFormats});
  const tabs=bindEditorTabs(form,signal);
  const cues=form.querySelector('#cuts-cues'),removals=form.querySelector('#cut-removed-ranges'),replay=form.querySelector('#cut-editor-replay');
  const sourceRange=job.source_range;
  const sourceTime=value=>formatSourceTimecode(value,sourceRange);
  const renderReplay=data=>drawWorkspace(replay,'cutReplay',{replay:data,duration:job.duration,sourceRange,interactive:true});
  renderReplay(job.replay_data);
  let displayedRows=[];
  function showCaptionRows(rows){
    displayedRows=rows;
    drawWorkspace(cues,'captionRows',{rows});
  }
  const video=form.querySelector('#cut-source-player'),canvas=form.querySelector('#cut-phone-canvas'),ctx=canvas.getContext('2d'),caption=form.querySelector('#cut-phone-caption'),captionText=form.querySelector('#cut-phone-caption-text'),message=form.querySelector('#cut-editor-message');
  const get=name=>form.elements.namedItem(name),readStyle=()=>({enabled:get('captionsEnabled').checked,fontSize:Number(get('fontSize').value),color:get('color').value,highlightColor:get('highlightColor').value,outlineColor:get('outlineColor').value,background:get('background').value,position:get('position').value,animation:get('animation').value});
  const originalFields=new Set([get('start'),get('end'),form.querySelector('#cut-remove-start'),form.querySelector('#cut-remove-end')]);
  function readFieldTime(field){
    const value=parseTimecode(field.value);
    return sourceRange&&originalFields.has(field)?seconds(value-sourceRange.start):value;
  }
  const readTime=name=>readFieldTime(get(name));
  const playerTime=()=>video.readyState>=1&&Number.isFinite(video.currentTime)?video.currentTime:state.seek||0;
  const timeHint='Use minutos:segundos, como 09:11. Para ajuste fino, use 09:11,720.';
  function validateTimeField(field){
    const ignored=field.closest('#cuts-cues')&&get('originalCaptions').checked;
    const value=readFieldTime(field);
    const outside=sourceRange&&originalFields.has(field)&&Number.isFinite(value)&&(value<0||value>Number(job.duration));
    field.setCustomValidity(!field.name||ignored?'':outside?'Use um horário dentro do trecho selecionado da live.':Number.isFinite(value)?'':timeHint);
  }
  function setTimeField(field,value){field.value=originalFields.has(field)?sourceTime(value):formatTimecode(value);validateTimeField(field);}
  const splitEditor=createSplitEditor({form,video,layout:framing.split,onChange:refreshPlan,signal,isFrameReady:()=>!state.framePending&&!video.seeking&&video.readyState>=2});
  const readLayout=()=>({format:get('format').value,mode:get('framingMode').value,focusX:Number(get('focusX').value)/100,focusY:Number(get('focusY').value)/100,zoom:Number(get('zoom').value),
    ...(get('framingMode').value==='split'||splitEditor.used?{split:splitEditor.read()}:{})});
  const overlayEditor=createOverlayEditor({form,canvas,overlays:clip.overlays||[],jobId:job.id,signal,getDuration:()=>state.duration,onChange:paint,onAdd:previewAddedOverlay,seek:time=>{
    seekPreview(time);
    revealOverlayPreview();
  }});
  function editedCues(){
    if(!state.captionParts.length)return structuredClone(state.cueCache);
    const edits=[...form.querySelectorAll('.cuts-cue')].map(row=>({id:row.dataset.captionRow,start:parseTimecode(row.querySelector('[name="cueStart"]').value),end:parseTimecode(row.querySelector('[name="cueEnd"]').value),text:row.querySelector('[name="cueText"]').value.trim()}));
    return mergeCaptionRows(state.captionBase,state.captionRows,edits,state.captionParts);
  }
  function currentCues(){return get('originalCaptions').checked?state.original||[]:state.cueCache;}
  function cacheCues(){
    try{state.cueCache=editedCues();state.captionError=null;return true;}
    catch(error){state.captionError=error;return false;}
  }
  function renderCaptionRows(parts){
    const active=document.activeElement,row=active?.closest('.cuts-cue');
    const focus=row?{name:active.name,start:parseTimecode(row.querySelector('[name="cueStart"]').value),end:parseTimecode(row.querySelector('[name="cueEnd"]').value),text:row.querySelector('[name="cueText"]').value,selection:[active.selectionStart,active.selectionEnd]}:null;
    const projection=projectCaptionRows(state.cueCache,parts);
    state.captionBase=structuredClone(state.cueCache);state.captionRows=projection.rows;state.captionParts=structuredClone(parts);state.captionPlan=JSON.stringify(parts);
    clearWorkspace(cues);
    showCaptionRows(projection.rows);
    form.querySelector('#cuts-cues-state').textContent=projection.rows.length?'':'Nenhuma legenda nos trechos mantidos. Ajuste o intervalo ou adicione uma linha.';
    if(focus){
      const index=projection.rows.findIndex(cue=>Math.abs(cue.start-focus.start)<.001&&Math.abs(cue.end-focus.end)<.001&&cue.text===focus.text);
      const field=index>=0?form.querySelectorAll('.cuts-cue')[index].querySelector('[name="'+focus.name+'"]'):null;
      if(field){field.focus({preventScroll:true});if(focus.selection.every(value=>value!==null))field.setSelectionRange(...focus.selection);}
    }
  }
  function applyTranscriptEdges(){
    if(state.edgesApplied||!state.original||get('originalCaptions').checked||!cacheCues())return false;
    let outside=[];
    for(const [start,end] of [[0,Number(clip.start_seconds)],[Number(clip.end_seconds),Number(job.duration)]]){
      if(end>start)outside.push({start,end});
    }
    // A manual line authored while the transcript loads overrides only its
    // interval; retain the recognized words on either side of that line.
    for(const cue of state.cueCache)outside=outside.flatMap(part=>{
      if(cue.end<=part.start||cue.start>=part.end)return [part];
      return [...(cue.start>part.start?[{start:part.start,end:cue.start}]:[]),...(cue.end<part.end?[{start:cue.end,end:part.end}]:[])];
    });
    let output=0;
    const parts=outside.map(part=>{const result={...part,outputStart:output};output+=part.end-part.start;return result;});
    const projection=parts.length?projectCaptionRows(state.original,parts):{rows:[],conflicts:[]};
    if(projection.conflicts.length)throw new Error('Uma legenda corrigida impede alinhar as novas bordas. Ajuste seus tempos ou use a transcrição original.');
    state.cueCache.push(...projection.rows.map(row=>row.source));
    state.cueCache.sort((a,b)=>a.start-b.start||a.end-b.end);state.edgesApplied=true;return true;
  }
  async function loadTranscript(){
    if(state.originalLoading||!state.alive)return;
    const status=form.querySelector('#cut-transcript-status'),retry=form.querySelector('#cut-retry-transcript');
    state.originalLoading=true;state.originalError=null;retry.hidden=true;status.textContent='Carregando transcrição original…';
    try{
      const result=await api('/cuts/jobs/'+encodeURIComponent(job.id)+'/transcript');
      if(!state.alive)return;
      state.original=result.captions||[];
      refreshPlan();
      if(result.replay)renderReplay(result.replay);
      status.textContent='Transcrição original disponível.';paint();
    }catch(error){
      if(!state.alive)return;
      state.originalError=error.message;status.textContent='A transcrição original não carregou. Suas alterações foram mantidas.';retry.hidden=false;
      if(get('originalCaptions').checked)message.textContent=error.message;
    }finally{state.originalLoading=false;}
  }
  function curvePoint(svg,time){
    const x=Math.max(0,Math.min(1000,time/(Number(job.duration)||1)*1000)),points=svg.querySelector('polyline')?.points;
    if(!points?.numberOfItems)return {x,y:80};
    let previous=points.getItem(0);
    for(let i=1;i<points.numberOfItems;i++){
      const next=points.getItem(i);
      if(next.x>=x)return {x,y:previous.y+(next.y-previous.y)*(next.x===previous.x?0:(x-previous.x)/(next.x-previous.x))};
      previous=next;
    }
    return {x,y:previous.y};
  }
  function updateReplayMarker(){
    const start=readTime('start'),end=readTime('end'),range=form.querySelector('#cut-replay-position'),svg=form.querySelector('#cut-editor-replay svg');
    form.querySelector('#cut-replay-selected').textContent=Number.isFinite(start)?sourceTime(start):'Revise o início';
    if(!Number.isFinite(start)){svg?.querySelector('.cuts-replay-marker')?.setAttribute('visibility','hidden');return;}
    range.value=start;range.setAttribute('aria-valuetext',sourceTime(start));form.querySelector('#cut-replay-time').textContent=sourceTime(start);
    if(!svg)return;
    svg.setAttribute('aria-valuenow',String(start));svg.setAttribute('aria-valuetext',sourceTime(start));
    const point=curvePoint(svg,start),marker=svg.querySelector('.cuts-replay-marker'),window=svg.querySelector('.cuts-replay-window');
    marker.setAttribute('visibility','visible');marker.setAttribute('transform',`translate(${point.x},0)`);marker.querySelector('circle').setAttribute('cy',String(point.y));
    window.setAttribute('x',String(point.x));window.setAttribute('width',String(Math.max(0,Math.min(1000,Number.isFinite(end)?end/(Number(job.duration)||1)*1000:point.x)-point.x)));
  }
  function selectReplayStart(selected,{length}={}){
    if(!Number.isFinite(selected))return;
    const start=readTime('start'),end=readTime('end'),duration=Number(job.duration)||7200;
    const requested=length?Math.min(duration,selected+length):end;
    const next=selectionFromReplay(length?selected:start,requested,selected,duration,state.gaps);
    video.pause();state.previewPlaying=false;
    setTimeField(get('start'),next.start);setTimeField(get('end'),next.end);state.gaps=next.excludedRanges;
    renderGaps();seekSource(next.start);updateReplayMarker();
  }
  function refreshPlan(){
    try{
      const result=retainedParts(readTime('start'),readTime('end'),state.gaps),plan=JSON.stringify(result.parts);
      if(readTime('end')>(Number(job.duration)||7200))throw new Error('O fim do corte deve estar dentro do vídeo original.');
      const committed=cacheCues();
      if(!committed&&plan!==state.captionPlan&&!get('originalCaptions').checked)throw state.captionError;
      const edges=committed&&applyTranscriptEdges();
      state.parts=result.parts;state.duration=result.duration;
      if(plan!==state.captionPlan||edges)renderCaptionRows(result.parts);
      form.querySelector('#cut-final-duration').textContent=`${clock(result.duration)} de vídeo`;
      message.textContent=state.captionError?.message||projectCaptionRows(currentCues(),state.parts).conflicts[0]?.message||'';
    }catch(error){state.parts=[];form.querySelector('#cut-final-duration').textContent='Revise os tempos';message.textContent=error.message;}
    form.querySelector('#cut-crop-controls').hidden=get('framingMode').value!=='crop';
    splitEditor.refresh(get('framingMode').value==='split');
    form.querySelector('#cut-karaoke-note').hidden=get('animation').value!=='karaoke';
    for(const label of form.querySelectorAll('[data-cut-output]'))label.textContent=get(label.dataset.cutOutput).value+(label.dataset.cutOutput==='zoom'?'×':label.dataset.cutOutput.startsWith('focus')?'%':'');
    const original=get('originalCaptions').checked;form.querySelector('#cuts-cues').classList.toggle('cuts-cues-muted',original);for(const input of form.querySelectorAll('#cuts-cues input,#cuts-cues textarea')){input.required=!original;if(input.matches('[data-timecode]'))validateTimeField(input);}
    const landscape=get('format').value==='video',width=landscape?1920:720,height=landscape?1080:1280;
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    form.querySelector('.cuts-editor-workspace').dataset.format=landscape?'video':'shorts';
    form.querySelector('#cut-preview-format').textContent=landscape?'Vídeo · 16:9':'Shorts · 9:16';
    canvas.setAttribute('aria-label',landscape?'Reproduzir ou pausar a prévia do vídeo':'Reproduzir ou pausar a prévia no celular');
    paint();
  }
  function drawFit(sourceWidth,sourceHeight){const scale=Math.min(canvas.width/sourceWidth,canvas.height/sourceHeight);ctx.drawImage(video,(canvas.width-sourceWidth*scale)/2,(canvas.height-sourceHeight*scale)/2,sourceWidth*scale,sourceHeight*scale);}
  function updatePhoneControls(time){
    const position=sourceTimeToPreview(state.parts,time),valid=Number.isFinite(position.time),range=form.querySelector('#cut-phone-seek'),play=form.querySelector('#cut-phone-play');
    range.max=String(seconds(state.duration));range.value=valid?String(seconds(position.time)):'0';range.disabled=!state.parts.length;
    range.setAttribute('aria-valuetext',`${valid?formatTimecode(position.time):'00:00'} de ${formatTimecode(state.duration)}`);
    form.querySelector('#cut-source-time').textContent=sourceTime(time);
    form.querySelector('#cut-preview-time').textContent=valid&&position.included?`${clock(position.time)} / ${clock(state.duration)}`:'Fora do corte atual';
    form.querySelector('#cut-phone-source-time').textContent='Original '+sourceTime(time);
    const preview=get('format').value==='video'?'prévia do vídeo':'prévia no celular';
    play.setAttribute('aria-label',(video.paused?'Reproduzir ':'Pausar ')+preview);play.title=video.paused?'Reproduzir prévia':'Pausar prévia';play.querySelector('span').textContent=video.paused?'▶':'Ⅱ';
    const mute=form.querySelector('#cut-phone-mute');mute.setAttribute('aria-label',video.muted?'Ativar áudio da prévia':'Silenciar prévia');mute.setAttribute('aria-pressed',String(video.muted));mute.textContent=video.muted?'⊘':'♪';
    updateReplayMarker();
    return position;
  }
  function waitForFrame(){
    state.framePending=true;canvas.dataset.seeking='true';
    const loading=form.querySelector('#cut-phone-loading');loading.hidden=false;loading.textContent=`Buscando ${sourceTime(state.seek)}…`;
    caption.hidden=true;
  }
  function commitFrame(){
    const version=state.seekVersion;
    requestAnimationFrame(()=>{
      if(!state.alive||video.seeking||version!==state.seekVersion||video.readyState<2)return;
      state.framePending=false;paint();
    });
  }
  function paint(){
    if(!state.alive)return;
    const layout=readLayout(),textStyle=readStyle(),time=playerTime();
    const position=updatePhoneControls(time);splitEditor.drawSource();
    if(video.seeking||state.framePending||video.readyState<2){waitForFrame();return;}
    canvas.dataset.seeking='false';form.querySelector('#cut-phone-loading').hidden=true;
    const outWidth=canvas.width,outHeight=canvas.height;
    ctx.fillStyle='#000';ctx.fillRect(0,0,outWidth,outHeight);
    if(video.readyState>=2&&video.videoWidth&&video.videoHeight){
      const width=video.videoWidth,height=video.videoHeight;
      if(layout.mode==='split')paintSplitPreview(ctx,video,layout.split,outWidth,outHeight);
      else if(layout.mode==='crop'){
        const scale=Math.max(outWidth/width,outHeight/height)*layout.zoom,visibleWidth=outWidth/scale,visibleHeight=outHeight/scale;
        ctx.drawImage(video,(width-visibleWidth)*layout.focusX,(height-visibleHeight)*layout.focusY,visibleWidth,visibleHeight,0,0,outWidth,outHeight);
      }else{
        if(layout.mode==='blur'){const scale=Math.max(outWidth/width,outHeight/height)*Math.max(1,layout.zoom),visibleWidth=outWidth/scale,visibleHeight=outHeight/scale;ctx.filter='blur(20px)';ctx.drawImage(video,(width-visibleWidth)*layout.focusX,(height-visibleHeight)*layout.focusY,visibleWidth,visibleHeight,0,0,outWidth,outHeight);ctx.filter='none';}
        drawFit(width,height);
      }
      canvas.dataset.sourceTime=String(seconds(time));
    }
    // At the end marker, keep the overlays from just inside the final frame's interval.
    const overlayTime=position.included?Math.min(position.time,state.duration-.000001):NaN;
    overlayEditor.paint(ctx,overlayTime,state.duration);
    const part=state.parts.find(p=>time>=p.start&&time<p.end);let cue=part?currentCues().find(c=>c.start<=time&&c.end>time):null;
    if(cue&&(cue.start<part.start||cue.end>part.end)){
      const words=cue.words?.filter(w=>w.start>=part.start&&w.end<=part.end);
      cue=words?.length?{start:words[0].start,end:words.at(-1).end,text:words.map(w=>w.text).join(' '),words}:null;
    }
    if(cue&&(time<cue.start||time>=cue.end))cue=null;
    caption.hidden=!textStyle.enabled||!cue;
    const scale=canvas.getBoundingClientRect().height/1280;
    caption.style.fontSize=(textStyle.fontSize*scale)+'px';caption.style.color=textStyle.color;
    caption.style.textShadow=`${-2*scale}px 0 ${textStyle.outlineColor}, ${2*scale}px 0 ${textStyle.outlineColor}, 0 ${-2*scale}px ${textStyle.outlineColor}, 0 ${2*scale}px ${textStyle.outlineColor}, 0 ${2*scale}px ${2*scale}px ${textStyle.outlineColor}`;
    caption.dataset.background=textStyle.background;caption.dataset.position=textStyle.position;
    if(cue){
      const words=cue.words,aligned=words?.length&&words.map(w=>w.text.trim()).join(' ').replace(/\s+/g,' ')===cue.text.replace(/\s+/g,' ').trim();
      captionText.replaceChildren();
      if(textStyle.animation==='karaoke'&&aligned){for(const [i,word] of words.entries()){const span=document.createElement('span');span.textContent=(i?' ':'')+word.text;span.style.color=time>=word.start&&time<word.end?textStyle.highlightColor:textStyle.color;captionText.append(span);}}
      else captionText.textContent=cue.text;
      const relative=Math.max(0,time-cue.start),remaining=Math.max(0,cue.end-time);
      captionText.style.opacity=textStyle.animation==='fade'?String(Math.min(1,relative/.12,remaining/.12)):textStyle.animation==='pop'?String(Math.min(1,relative/.04,remaining/.1)):'1';
      captionText.style.transform=textStyle.animation==='pop'?`scale(${.85+.15*Math.min(1,relative/.14)})`:'none';
    }
  }
  function playbackFrame(){
    if(!state.alive)return;
    const time=playerTime(),start=readTime('start'),end=readTime('end'),gap=state.gaps.find(r=>time>=r.start&&time<r.end);
    if(!video.paused&&state.previewPlaying&&!video.seeking){
      if(time>=end){video.pause();seekSource(end);}
      else if(gap)seekSource(gap.end);
      else if(time<start)seekSource(start);
    }
    if(!video.paused&&!video.requestVideoFrameCallback)paint();
    state.frame=requestAnimationFrame(playbackFrame);
  }
  function renderGaps(){
    drawWorkspace(removals,'cutRemovals',{gaps:[...state.gaps],sourceRange});
    refreshPlan();
  }
  function seekSource(time){
    if(!Number.isFinite(Number(time)))return;
    const available=video.readyState>=1&&Number.isFinite(video.duration)?video.duration:Number(job.duration)||7200;
    state.seek=Math.max(0,Math.min(available,Number(time)));state.seekVersion++;
    if(video.readyState>=2&&!video.seeking&&Math.abs(video.currentTime-state.seek)<.0005){state.framePending=false;paint();return;}
    waitForFrame();
    if(video.readyState>=1)video.currentTime=state.seek;
    paint();
  }
  function seekPreview(time,{pause=true}={}){
    const source=previewTimeToSource(state.parts,time);if(!Number.isFinite(source))throw new Error('Escolha um intervalo válido antes de navegar na prévia.');
    if(pause||time>=state.duration)video.pause();state.previewPlaying=true;seekSource(source);
  }
  function revealOverlayPreview(){
    const box=canvas.getBoundingClientRect();
    const center=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);
    if(!canvas.parentElement.contains(center))tabs.reveal('#cut-editor-preview');
  }
  function previewAddedOverlay(){
    const position=sourceTimeToPreview(state.parts,playerTime());
    if(!position.included&&Number.isFinite(position.time))seekPreview(position.time);
    else paint();
    revealOverlayPreview();
  }
  async function togglePreview(){
    retainedParts(readTime('start'),readTime('end'),state.gaps);
    if(!video.paused){video.pause();return;}
    const position=sourceTimeToPreview(state.parts,playerTime());state.previewPlaying=true;
    if(!position.included||position.time>=state.duration)seekPreview(0);
    await video.play();
  }
  video.addEventListener('loadedmetadata',()=>seekSource(state.seek),{signal});
  video.addEventListener('loadeddata',commitFrame,{signal});
  video.addEventListener('seeking',()=>{state.seek=video.currentTime;state.seekVersion++;waitForFrame();paint();},{signal});
  video.addEventListener('seeked',commitFrame,{signal});
  video.addEventListener('pause',paint,{signal});video.addEventListener('play',paint,{signal});video.addEventListener('volumechange',paint,{signal});
  video.addEventListener('pointerdown',()=>{state.previewPlaying=false;},{signal});
  if(video.requestVideoFrameCallback){
    const presented=()=>{if(!state.alive)return;if(!video.seeking&&video.readyState>=2){state.framePending=false;paint();}state.videoFrame=video.requestVideoFrameCallback(presented);};
    state.videoFrame=video.requestVideoFrameCallback(presented);
  }
  video.addEventListener('error',()=>{message.textContent='A fonte não está disponível para a prévia ao vivo. Confira se o projeto ainda mantém o vídeo original.';},{signal});
  form.addEventListener('input',event=>{
    if(event.target.matches('[data-timecode]'))validateTimeField(event.target);
    if(event.target.closest('#cuts-cues')){get('originalCaptions').checked=false;state.captionsDirty=true;cacheCues();}
    if(event.target.id==='cut-replay-position')selectReplayStart(Number(event.target.value));
    if(event.target.id==='cut-phone-seek'){try{seekPreview(Number(event.target.value));}catch(error){message.textContent=error.message;}}
    refreshPlan();
  },{signal});
  form.addEventListener('focusin',event=>{
    if(event.target.matches('[data-timecode]'))event.target.dataset.focusTime=String(readFieldTime(event.target));
  },{signal});
  form.addEventListener('blur',event=>{
    if(!event.target.matches('[data-timecode]'))return;
    const value=readFieldTime(event.target),changed=Number(event.target.dataset.focusTime)!==value;
    if(Number.isFinite(value))setTimeField(event.target,value);
    else validateTimeField(event.target);
    if(event.target.closest('#cuts-cues'))cacheCues();refreshPlan();
    const marking=event.relatedTarget?.dataset?.cutEditorAction;
    if(changed&&Number.isFinite(value)&&(!sourceRange||value>=0&&value<=Number(job.duration))&&
      ['start','end'].includes(event.target.name)&&!['set-start','set-end'].includes(marking)){
      video.pause();state.previewPlaying=false;seekSource(value);
    }
  },{capture:true,signal});
  form.addEventListener('change',refreshPlan,{signal});
  const graphFor=event=>event.target.closest?.('#cut-editor-replay svg');
  const hideReplayHover=()=>form.querySelector('#cut-editor-replay .cuts-replay-hover')?.setAttribute('visibility','hidden');
  form.addEventListener('pointerdown',event=>{
    const svg=graphFor(event);if(!svg||event.button!==0)return;
    event.preventDefault();state.replayPointer=event.pointerId;svg.focus({preventScroll:true});hideReplayHover();
    try{svg.setPointerCapture(event.pointerId);}catch{/* Pointer may already have been released. */}
    selectReplayStart(replayTimeAt(event.clientX,svg.getBoundingClientRect(),Number(job.duration)));
  },{signal});
  form.addEventListener('pointermove',event=>{
    const svg=graphFor(event);if(!svg)return;
    const time=replayTimeAt(event.clientX,svg.getBoundingClientRect(),Number(job.duration));if(!Number.isFinite(time))return;
    if(state.replayPointer===event.pointerId){event.preventDefault();selectReplayStart(time);return;}
    const hover=svg.querySelector('.cuts-replay-hover'),point=curvePoint(svg,time);
    hover.setAttribute('visibility','visible');hover.setAttribute('transform',`translate(${point.x},0)`);hover.querySelector('circle').setAttribute('cy',String(point.y));
  },{signal});
  form.addEventListener('pointerup',event=>{
    if(state.replayPointer!==event.pointerId)return;
    const svg=graphFor(event);if(svg)selectReplayStart(replayTimeAt(event.clientX,svg.getBoundingClientRect(),Number(job.duration)));
    state.replayPointer=null;hideReplayHover();
  },{signal});
  form.addEventListener('pointercancel',()=>{state.replayPointer=null;hideReplayHover();},{signal});
  form.addEventListener('pointerleave',event=>{if(event.target.matches?.('#cut-editor-replay svg')&&state.replayPointer===null)hideReplayHover();},{capture:true,signal});
  form.addEventListener('keydown',event=>{
    if(event.target===canvas&&[' ','Enter'].includes(event.key)){event.preventDefault();void togglePreview().catch(error=>{if(error.name!=='AbortError')message.textContent=error.message;});return;}
    const svg=graphFor(event);if(!svg)return;
    const current=Number.isFinite(readTime('start'))?readTime('start'):Number(clip.start_seconds)||0,step=event.altKey?0.001:event.shiftKey?1:0.1;
    const value={ArrowLeft:current-step,ArrowRight:current+step,Home:0,End:Number(job.duration)-.5}[event.key];
    if(value===undefined)return;event.preventDefault();selectReplayStart(value);
  },{signal});
  form.addEventListener('click',async event=>{
    const button=event.target.closest('[data-cut-editor-action]');
    if(!button)return;
    event.preventDefault();const action=button.dataset.cutEditorAction,time=seconds(playerTime());
    try{
      if(action==='play-preview')await togglePreview();
      else if(action==='retry-transcript')await loadTranscript();
      else if(action==='phone-back'||action==='phone-forward'){const position=sourceTimeToPreview(state.parts,playerTime());seekPreview(position.time+(action==='phone-back'?-5:5),{pause:false});}
      else if(action==='phone-mute'){video.muted=!video.muted;paint();}
      else if(action==='set-start'||action==='set-end'){setTimeField(get(action==='set-start'?'start':'end'),time);refreshPlan();}
      else if(action==='step-time'){
        const field=get(button.dataset.field),current=readFieldTime(field);if(!Number.isFinite(current))throw new Error(timeHint);
        const next=Math.max(0,Math.min(Number(job.duration)||7200,seconds(current+Number(button.dataset.step))));setTimeField(field,next);refreshPlan();seekSource(next);
      }
      else if(action==='mark-remove-start'||action==='mark-remove-end')setTimeField(form.querySelector(action==='mark-remove-start'?'#cut-remove-start':'#cut-remove-end'),time);
      else if(action==='add-removal'){
        if(state.gaps.length>=20)throw new Error('Remova no máximo 20 trechos por vídeo.');
        const gap={start:readFieldTime(form.querySelector('#cut-remove-start')),end:readFieldTime(form.querySelector('#cut-remove-end'))},gaps=[...state.gaps,gap].sort((a,b)=>a.start-b.start);
        retainedParts(readTime('start'),readTime('end'),gaps);state.gaps=gaps;renderGaps();
      }else if(action==='restore-range'){state.gaps.splice(Number(button.dataset.index),1);renderGaps();}
      else if(action==='reset-focus'){get('focusX').value=50;get('focusY').value=50;get('zoom').value=1;refreshPlan();}
      else if(action==='preset'){
        const values=button.dataset.preset==='highlight'?{...defaults,fontSize:50,animation:'karaoke'}:button.dataset.preset==='clean'?{...defaults,fontSize:38,background:'box',animation:'fade'}:defaults;
        for(const [key,value] of Object.entries(values))get(key).value=value;refreshPlan();
      }else if(action==='remove-cue'){showCaptionRows(displayedRows.filter(row=>row.id!==button.closest('.cuts-cue').dataset.captionRow));get('originalCaptions').checked=false;state.captionsDirty=true;cacheCues();refreshPlan();}
      else if(action==='add-cue'){
        const position=sourceTimeToPreview(state.parts,time),start=Math.max(0,Math.min(position.time,state.duration-.5));
        if(!Number.isFinite(start)||!state.parts.length)throw new Error('Escolha um intervalo válido antes de adicionar uma legenda.');
        const part=state.parts.find(item=>start>=item.outputStart&&start<item.outputStart+item.end-item.start),end=Math.min(start+2,part.outputStart+part.end-part.start);
        showCaptionRows([...displayedRows,{id:'new:'+ ++state.nextCue,start,end,text:''}]);get('originalCaptions').checked=false;state.captionsDirty=true;cues.lastElementChild.querySelector('textarea').focus();cacheCues();refreshPlan();
      }else if(action==='use-replay-window'){
        selectReplayStart(readTime('start'),{length:60});
      }
    }catch(error){if(error.name!=='AbortError')message.textContent=error.message;}
  },{signal});
  const observer=new ResizeObserver(paint);observer.observe(canvas);renderGaps();state.frame=requestAnimationFrame(playbackFrame);
  form.addEventListener('cut-editor-tab-change',paint,{signal});
  void loadTranscript();
  return {
    reveal:tabs.reveal,
    seekSource,
    selectReplayStart,
    read(){
      if(get('framingMode').value==='split')splitEditor.commit();
      const start=readTime('start'),end=readTime('end'),parts=retainedParts(start,end,state.gaps).parts;
      if(end>(Number(job.duration)||7200))throw new Error('O fim do corte deve estar dentro do vídeo original.');
      const extendsWindow=start<Number(clip.start_seconds)||end>Number(clip.end_seconds);
      if(extendsWindow){
        if(state.originalLoading)throw new Error('Aguarde o carregamento da transcrição para completar as novas bordas.');
        if(state.originalError)throw new Error('Não foi possível carregar a transcrição das novas bordas. Use “Tentar carregar transcrição” e tente salvar novamente.');
      }
      if(!get('originalCaptions').checked){state.cueCache=editedCues();const conflict=projectCaptionRows(state.cueCache,parts).conflicts[0];if(conflict)throw new Error(conflict.message);}
      const layout=readLayout(),body={title:get('title').value.trim(),start,end,framing:layout.mode==='crop'?'crop':'fit',framingOptions:layout,captionStyle:readStyle(),excludedRanges:structuredClone(state.gaps),overlays:overlayEditor.read(parts.reduce((sum,p)=>sum+p.end-p.start,0)),revision:clip.revision};
      if(get('originalCaptions').checked){if(state.originalLoading)throw new Error('Aguarde o carregamento da transcrição original.');if(state.originalError)throw new Error(state.originalError);body.useOriginalCaptions=true;}
      else if((start!==Number(clip.start_seconds)||end!==Number(clip.end_seconds))&&!state.captionsDirty){body.useOriginalCaptions=false;}
      else {
        body.captions=currentCues().flatMap(cue=>{
          if(cue.end<=start||cue.start>=end)return [];
          if(cue.start>=start&&cue.end<=end)return [cue];
          const words=cue.words?.filter(w=>w.start>=start&&w.end<=end);
          if(!cue.words?.length)throw new Error('Um limite corta uma legenda corrigida. Ajuste os tempos e o texto dessa linha ou escolha a transcrição original.');
          return words?.length?[{start:words[0].start,end:words.at(-1).end,text:words.map(w=>w.text).join(' '),words}]:[];
        });if(!body.captions.length)throw new Error('Adicione uma linha de legenda ou use a transcrição original.');for(const cue of body.captions)if(cue.end<=cue.start||cue.start<start||cue.end>end||!cue.text)throw new Error('Cada legenda precisa ter texto e tempos válidos dentro do intervalo do corte.');}
      return body;
    },
    destroy(){state.alive=false;video.pause();cancelAnimationFrame(state.frame);if(state.videoFrame!==null&&video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(state.videoFrame);observer.disconnect();splitEditor.destroy();controller.abort();clearWorkspace(cues);clearWorkspace(removals);clearWorkspace(replay);}
  };
}
