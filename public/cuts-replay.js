import {formatTimecode} from './cuts-time.js';

/** Map the actual SVG viewport to source time; replay buckets do not snap it. */
export function replayTimeAt(clientX,rect,duration){
  if(!Number.isFinite(clientX)||!Number.isFinite(rect?.left)||!Number.isFinite(rect?.width)||rect.width<=0||!Number.isFinite(duration)||duration<=0)return NaN;
  return Math.round(Math.max(0,Math.min(1,(clientX-rect.left)/rect.width))*duration*1000)/1000;
}

/** Keep the clicked start fixed while making its existing edit valid. */
export function selectionFromReplay(previousStart,previousEnd,selected,duration,gaps=[]){
  if(!Number.isFinite(selected)||!Number.isFinite(duration)||duration<.5)throw new RangeError('O vídeo não tem duração suficiente para selecionar um corte.');
  const maxStart=Math.floor((duration-.5)*1000)/1000;
  const start=Math.max(0,Math.min(maxStart,Math.round(selected*1000)/1000));
  const oldStart=Number.isFinite(previousStart)?previousStart:0;
  const oldEnd=Number.isFinite(previousEnd)&&previousEnd>oldStart?previousEnd:Math.min(duration,oldStart+60);
  const valid=gaps.filter(g=>Number.isFinite(g.start)&&Number.isFinite(g.end)&&g.end>g.start).sort((a,b)=>a.start-b.start);
  const removed=valid.reduce((sum,g)=>sum+Math.max(0,Math.min(oldEnd,g.end)-Math.max(oldStart,g.start)),0);
  const preferred=Math.max(.5,Math.min(180,oldEnd-oldStart-removed));
  let end=oldEnd-start>=.5?Math.min(duration,oldEnd):Math.min(duration,start+preferred);
  // A removal covering the click would move the first frame elsewhere.
  const within=to=>valid.filter(g=>g.start>start&&g.start<to).map(g=>({start:g.start,end:Math.min(g.end,to)})).filter(g=>g.end>g.start);
  let excludedRanges=within(end);
  const kept=()=>end-start-excludedRanges.reduce((sum,g)=>sum+g.end-g.start,0);
  if(kept()>180.001||kept()<.5){end=Math.min(duration,start+preferred);excludedRanges=within(end);}
  if(kept()<.5)excludedRanges=excludedRanges.filter(g=>g.start>=start+.5);
  return {start,end:Math.round(end*1000)/1000,excludedRanges};
}

export function replayGraph(replay,duration,esc,{interactive=false}={}){
  const points=replay?.status==='available'?replay.points||[]:[];
  if(!points.length)return `<p class="cuts-replay-note">${esc(replay?.message||'Busque os momentos mais revistos para consultar os dados que o YouTube disponibiliza.')}</p>`;
  const safeDuration=Math.max(1,Number(duration)||1),shape=points.filter(p=>Number.isFinite(p.start)&&Number.isFinite(p.end)&&Number.isFinite(p.value)).map(p=>`${Math.max(0,Math.min(1000,((p.start+p.end)/2)/safeDuration*1000)).toFixed(3)},${(76-Math.max(0,Math.min(1,p.value))*68).toFixed(3)}`).join(' ');
  const accessibility=interactive?'role="slider" tabindex="0" aria-label="Selecionar início do corte no gráfico" aria-valuemin="0" aria-valuemax="'+Math.max(0,safeDuration-.5)+'" aria-valuenow="0"':'role="img" aria-label="Interesse relativo dos momentos mais revistos no YouTube"';
  return `<svg class="cuts-replay-graph${interactive?' cuts-replay-picker':''}" viewBox="0 0 1000 84" preserveAspectRatio="none" ${accessibility}>${interactive?'<rect class="cuts-replay-window" x="0" y="0" width="0" height="84"/>':''}<polyline points="0,80 ${shape} 1000,80" fill="none" stroke="currentColor" stroke-width="3" vector-effect="non-scaling-stroke"/><line x1="0" y1="80" x2="1000" y2="80" stroke="currentColor" opacity=".2"/>${interactive?'<g class="cuts-replay-marker"><line x1="0" y1="0" x2="0" y2="84"/><circle cx="0" cy="80" r="5"/></g><g class="cuts-replay-hover" visibility="hidden"><line x1="0" y1="0" x2="0" y2="84"/><circle cx="0" cy="80" r="4"/></g>':''}</svg><div class="cuts-replay-ticks" aria-hidden="true"><span>00:00</span><span>${formatTimecode(safeDuration/2,{precision:0})}</span><span>${formatTimecode(safeDuration,{precision:0})}</span></div><p class="cuts-replay-note">Mais revistos no YouTube · interesse relativo, sem contagem de cliques.</p>`;
}
