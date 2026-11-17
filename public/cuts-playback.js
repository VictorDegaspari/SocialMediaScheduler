/** @typedef {{start:number,end:number,outputStart:number,outputEnd?:number}} PlaybackPart */
const tolerance=1e-7;

/** Reject malformed plans instead of seeking silently to a different segment. */
function playbackPlan(parts){
  if(!Array.isArray(parts)||!parts.length)return null;
  let output=0,sourceEnd=-Infinity;
  const plan=[];
  for(const part of parts){
    if(!part||![part.start,part.end,part.outputStart].every(Number.isFinite)||part.start<0||part.end<=part.start||part.start<sourceEnd-tolerance||Math.abs(part.outputStart-output)>tolerance)return null;
    const outputEnd=part.outputStart+part.end-part.start;
    if(part.outputEnd!==undefined&&(!Number.isFinite(part.outputEnd)||Math.abs(part.outputEnd-outputEnd)>tolerance))return null;
    plan.push({...part,outputEnd});output=outputEnd;sourceEnd=part.end;
  }
  return plan;
}

/**
 * Convert the phone's edited timeline into its original video position.
 * A junction belongs to the next retained part; the final endpoint stays final.
 * @param {PlaybackPart[]} parts
 * @param {number} time
 * @returns {number} Source seconds, or NaN for an invalid plan/time.
 */
export function previewTimeToSource(parts,time){
  const plan=playbackPlan(parts);
  if(!plan||!Number.isFinite(time))return NaN;
  const last=plan.at(-1),target=Math.max(0,Math.min(last.outputEnd,time));
  if(Math.abs(target-last.outputEnd)<=tolerance)return last.end;
  // Tiny arithmetic noise at a concatenation boundary must not select its
  // preceding frame in the source. This tolerance is much less than 1 ms.
  const boundary=plan.find(part=>Math.abs(target-part.outputStart)<=tolerance);
  if(boundary)return boundary.start;
  const part=plan.find(part=>target>=part.outputStart&&target<part.outputEnd);
  return part?part.start+target-part.outputStart:NaN;
}

/**
 * Convert the original player's position to the edited phone timeline.
 * Removed gaps map to the next junction, while included reports whether the
 * original position is visible in the resulting clip.
 * @param {PlaybackPart[]} parts
 * @param {number} time
 * @returns {{time:number,included:boolean}}
 */
export function sourceTimeToPreview(parts,time){
  const plan=playbackPlan(parts);
  if(!plan||!Number.isFinite(time))return {time:NaN,included:false};
  for(const part of plan){
    if(Math.abs(time-part.start)<=tolerance)return {time:part.outputStart,included:true};
    if(time<part.start)return {time:part.outputStart,included:false};
    if(time<part.end-tolerance)return {time:part.outputStart+time-part.start,included:true};
  }
  const last=plan.at(-1);
  return {time:last.outputEnd,included:Math.abs(time-last.end)<=tolerance};
}
