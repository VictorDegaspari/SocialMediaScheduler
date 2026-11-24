/** Map the actual SVG viewport to source time; replay buckets do not snap it. */
export function replayTimeAt(clientX,rect,duration){
  if(!Number.isFinite(clientX)||!Number.isFinite(rect?.left)||!Number.isFinite(rect?.width)||rect.width<=0||!Number.isFinite(duration)||duration<=0)return NaN;
  return Math.round(Math.max(0,Math.min(1,(clientX-rect.left)/rect.width))*duration*1000)/1000;
}

/** Keep the clicked start fixed while making its existing edit valid. */
export function selectionFromReplay(previousStart,previousEnd,selected,duration,gaps=[],maxOutputSeconds=180){
  if(!Number.isFinite(selected)||!Number.isFinite(duration)||duration<.5)throw new RangeError('O vídeo não tem duração suficiente para selecionar um corte.');
  const maxStart=Math.floor((duration-.5)*1000)/1000;
  const start=Math.max(0,Math.min(maxStart,Math.round(selected*1000)/1000));
  const oldStart=Number.isFinite(previousStart)?previousStart:0;
  const oldEnd=Number.isFinite(previousEnd)&&previousEnd>oldStart?previousEnd:Math.min(duration,oldStart+60);
  const valid=gaps.filter(g=>Number.isFinite(g.start)&&Number.isFinite(g.end)&&g.end>g.start).sort((a,b)=>a.start-b.start);
  const removed=valid.reduce((sum,g)=>sum+Math.max(0,Math.min(oldEnd,g.end)-Math.max(oldStart,g.start)),0);
  const preferred=Math.max(.5,Math.min(maxOutputSeconds,oldEnd-oldStart-removed));
  let end=oldEnd-start>=.5?Math.min(duration,oldEnd):Math.min(duration,start+preferred);
  // A removal covering the click would move the first frame elsewhere.
  const within=to=>valid.filter(g=>g.start>start&&g.start<to).map(g=>({start:g.start,end:Math.min(g.end,to)})).filter(g=>g.end>g.start);
  let excludedRanges=within(end);
  const kept=()=>end-start-excludedRanges.reduce((sum,g)=>sum+g.end-g.start,0);
  if(kept()>maxOutputSeconds+.001||kept()<.5){end=Math.min(duration,start+preferred);excludedRanges=within(end);}
  if(kept()<.5)excludedRanges=excludedRanges.filter(g=>g.start>=start+.5);
  return {start,end:Math.round(end*1000)/1000,excludedRanges};
}
