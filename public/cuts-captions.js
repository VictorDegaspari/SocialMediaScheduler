const epsilon=1e-7,alignmentTolerance=.001;
const clone=value=>structuredClone(value);
const clean=text=>String(text??'').trim();
const wordText=words=>words.map(word=>clean(word.text)).join(' ');
const normalized=text=>clean(text).replace(/\s+/g,' ');

function captionPlan(parts){
  if(!Array.isArray(parts)||!parts.length)throw new Error('Escolha um intervalo válido para editar as legendas.');
  let output=0,lastSource=-Infinity;
  return parts.map(part=>{
    if(!part||![part.start,part.end,part.outputStart].every(Number.isFinite)||part.start<0||part.end<=part.start||part.start<lastSource-epsilon||Math.abs(part.outputStart-output)>epsilon)
      throw new Error('O plano de tempos das legendas é inválido.');
    const outputEnd=part.outputStart+part.end-part.start;
    if(part.outputEnd!==undefined&&(!Number.isFinite(part.outputEnd)||Math.abs(part.outputEnd-outputEnd)>epsilon))throw new Error('O plano de tempos das legendas é inválido.');
    output=outputEnd;lastSource=part.end;return {...part,outputEnd};
  });
}

function alignedWords(cue){
  const words=cue.words;
  if(!words?.length||normalized(wordText(words))!==normalized(cue.text))return null;
  let previous=cue.start;
  for(const word of words){
    if(![word.start,word.end].every(Number.isFinite)||word.end<=word.start||!clean(word.text)||word.start<previous-alignmentTolerance||word.start<cue.start-alignmentTolerance||word.end>cue.end+alignmentTolerance)return null;
    previous=word.end;
  }
  return words;
}

function validCue(cue){
  if(!cue||![cue.start,cue.end].every(Number.isFinite)||cue.start<0||cue.end<=cue.start||!clean(cue.text))throw new Error('Cada legenda precisa ter texto e tempos válidos.');
}

function projectTime(plan,time){
  for(const part of plan){
    if(time<part.start)return part.outputStart;
    if(time<=part.end)return part.outputStart+Math.max(0,time-part.start);
  }
  return plan.at(-1).outputEnd;
}

/** A caption ending at a junction belongs to the previous source segment. */
export function previewEndpointToSource(parts,time,edge='start'){
  const plan=captionPlan(parts),duration=plan.at(-1).outputEnd;
  if(!Number.isFinite(time)||time<0||time>duration||!['start','end'].includes(edge))throw new Error('Use um tempo dentro da duração do corte exibido no celular.');
  if(Math.abs(time)<=epsilon)return plan[0].start;
  if(Math.abs(time-duration)<=epsilon)return plan.at(-1).end;
  const part=plan.find(part=>edge==='start'?time>=part.outputStart-epsilon&&time<part.outputEnd-epsilon:time>part.outputStart+epsilon&&time<=part.outputEnd+epsilon);
  if(!part)throw new Error('O tempo da legenda não pertence a um trecho mantido.');
  return Math.max(part.start,Math.min(part.end,part.start+time-part.outputStart));
}

/** Project only real retained speech, while retaining unaligned drafts as conflicts. */
export function projectCaptionRows(cues,parts){
  const plan=captionPlan(parts),rows=[],conflicts=[];
  cues.forEach((cue,sourceCueIndex)=>{
    validCue(cue);
    const overlaps=plan.map((part,partIndex)=>({part,partIndex})).filter(({part})=>cue.end>part.start&&cue.start<part.end);
    const words=alignedWords(cue),partial=overlaps.some(({part})=>cue.start<part.start-alignmentTolerance||cue.end>part.end+alignmentTolerance);
    if(partial&&!words){
      const message='Um limite ou trecho removido atravessa esta legenda corrigida. Ajuste ou divida a linha, ou use a transcrição original.';
      conflicts.push({sourceCueIndex,message});
      rows.push({id:sourceCueIndex+':conflict',sourceCueIndex,partIndex:null,source:clone(cue),start:projectTime(plan,cue.start),end:projectTime(plan,cue.end),text:cue.text,conflict:true});return;
    }
    for(const {part,partIndex} of overlaps){
      let selected=clone(cue);
      if(cue.start<part.start-alignmentTolerance||cue.end>part.end+alignmentTolerance){
        const kept=words.filter(word=>word.start>=part.start-alignmentTolerance&&word.end<=part.end+alignmentTolerance);
        if(!kept.length)continue;
        selected={start:kept[0].start,end:kept.at(-1).end,text:wordText(kept),words:clone(kept)};
      }
      const shift=part.outputStart-part.start;
      rows.push({id:sourceCueIndex+':'+partIndex,sourceCueIndex,partIndex,source:selected,start:Math.max(part.start,selected.start)+shift,end:Math.min(part.end,selected.end)+shift,text:selected.text,
        ...(selected.words?{words:selected.words.map(word=>({...word,start:word.start+shift,end:word.end+shift}))}:{})});
    }
  });
  rows.sort((a,b)=>a.start-b.start||a.end-b.end||a.sourceCueIndex-b.sourceCueIndex);
  return {rows,conflicts};
}

const sameTime=(value,original)=>Math.abs(value-original)<=epsilon||Math.abs(value-Math.round(original*1000)/1000)<=epsilon;
const unchanged=(row,edit)=>!!edit&&sameTime(edit.start,row.start)&&sameTime(edit.end,row.end)&&clean(edit.text)===clean(row.text);
const wordKey=word=>`${word.start}:${word.end}:${word.text}`;

function sourceEdit(edit,plan,projection){
  const start=projection&&sameTime(edit.start,projection.start)?projection.start:Number(edit.start),end=projection&&sameTime(edit.end,projection.end)?projection.end:Number(edit.end),text=clean(edit.text);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||!text)throw new Error('Cada legenda precisa ter texto e tempos válidos no corte do celular.');
  const sourceStart=previewEndpointToSource(plan,start,'start'),sourceEnd=previewEndpointToSource(plan,end,'end');
  if(!plan.some(part=>sourceStart>=part.start-epsilon&&sourceEnd<=part.end+epsilon))throw new Error('A legenda atravessa uma junção do corte. Divida-a em duas linhas nos trechos mantidos.');
  return {start:sourceStart,end:sourceEnd,text};
}

/** Commit rows using the plan that produced their DOM; hidden source words survive. */
export function mergeCaptionRows(cues,projections,edits,parts){
  const plan=captionPlan(parts),known=new Map(),bySource=new Map(),edited=new Map();
  for(const row of projections){
    if(known.has(row.id)||!Number.isInteger(row.sourceCueIndex)||!cues[row.sourceCueIndex])throw new Error('A referência da legenda ficou desatualizada. Reabra o editor.');
    known.set(row.id,row);if(!bySource.has(row.sourceCueIndex))bySource.set(row.sourceCueIndex,[]);bySource.get(row.sourceCueIndex).push(row);
  }
  for(const edit of edits){
    if(typeof edit.id!=='string'||!edit.id||edited.has(edit.id))throw new Error('Cada linha de legenda precisa de uma referência única.');
    if(![edit.start,edit.end].every(Number.isFinite)||!clean(edit.text))throw new Error('Cada legenda precisa ter texto e tempos válidos no corte do celular.');
    edited.set(edit.id,edit);
  }
  const output=[];
  cues.forEach((cue,index)=>{
    validCue(cue);const rows=bySource.get(index)||[],changed=rows.filter(row=>!unchanged(row,edited.get(row.id)));
    if(!changed.length){output.push(clone(cue));return;}
    const words=alignedWords(cue);
    if(!words||rows.some(row=>row.conflict)){
      for(const row of rows){const edit=edited.get(row.id);if(edit)output.push(unchanged(row,edit)?clone(row.source):sourceEdit(edit,plan,row));}
      return;
    }
    const removed=new Set();
    for(const row of changed){
      for(const word of row.source.words||[])removed.add(wordKey(word));
      const edit=edited.get(row.id);if(edit)output.push(sourceEdit(edit,plan,row));
    }
    let group=[];
    const flush=()=>{
      if(!group.length)return;
      const kept=group.map(item=>clone(item.word));
      output.push({start:kept[0].start,end:kept.at(-1).end,text:wordText(kept),words:kept});group=[];
    };
    words.forEach((word,wordIndex)=>{if(removed.has(wordKey(word)))flush();else group.push({word,index:wordIndex});});flush();
  });
  for(const [id,edit] of edited)if(!known.has(id))output.push(sourceEdit(edit,plan));
  output.sort((a,b)=>a.start-b.start||a.end-b.end);
  for(let index=1;index<output.length;index++)if(output[index].start<output[index-1].end-alignmentTolerance)throw new Error('As legendas não podem se sobrepor. Ajuste os tempos das linhas.');
  return output;
}
