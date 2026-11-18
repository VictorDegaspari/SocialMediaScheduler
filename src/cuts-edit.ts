import { z } from 'zod';
import { AppError } from './config.js';
import type { Cue } from './cuts-media.js';

export const captionStyleSchema=z.object({
  enabled:z.boolean().default(true),
  fontSize:z.number().int().min(24).max(80).default(42),
  color:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#FFFFFF'),
  highlightColor:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#FFE600'),
  outlineColor:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#101010'),
  background:z.enum(['none','box']).default('none'),
  position:z.enum(['bottom','middle','top']).default('bottom'),
  animation:z.enum(['none','fade','pop','karaoke']).default('none')
});
export type CaptionStyle=z.infer<typeof captionStyleSchema>;
export const cutFormatSchema=z.enum(['shorts','video']);
export type CutFormat=z.infer<typeof cutFormatSchema>;
export const framingOptionsSchema=z.object({
  format:cutFormatSchema.default('shorts'),
  mode:z.enum(['fit','blur','crop']).default('fit'),
  focusX:z.number().finite().min(0).max(1).default(0.5),
  focusY:z.number().finite().min(0).max(1).default(0.5),
  zoom:z.number().finite().min(0.25).max(3).default(1)
});
export type FramingOptions=z.infer<typeof framingOptionsSchema>;
export const timeRangeSchema=z.object({start:z.number().finite().min(0),end:z.number().finite().positive()});
export type TimeRange=z.infer<typeof timeRangeSchema>;
export type TimelinePart=TimeRange&{outputStart:number;outputEnd:number};

/** Original timestamps remain the edit format; only the renderer maps to output. */
export function cutTimeline(start:number,end:number,excludedRanges:TimeRange[]=[]):TimelinePart[] {
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>7200||excludedRanges.length>20)
    throw new AppError('Escolha um intervalo válido e no máximo 20 trechos para remover.');
  const gaps=excludedRanges.map(r=>timeRangeSchema.parse(r)).sort((a,b)=>a.start-b.start);
  let cursor=start,output=0;
  const parts:TimelinePart[]=[];
  for(const gap of gaps) {
    if(gap.start<start||gap.end>end||gap.end<=gap.start||gap.start<cursor)
      throw new AppError('Os trechos removidos devem estar dentro do intervalo e não podem se sobrepor.');
    if(gap.start>cursor) {
      const duration=gap.start-cursor;
      parts.push({start:cursor,end:gap.start,outputStart:output,outputEnd:output+duration});output+=duration;
    }
    cursor=gap.end;
  }
  if(cursor<end)parts.push({start:cursor,end,outputStart:output,outputEnd:output+end-cursor});
  const duration=parts.at(-1)?.outputEnd||0;
  if(duration<0.5||duration>180.001)throw new AppError('O vídeo final precisa ter entre 0,5 e 180 segundos depois das remoções.');
  return parts;
}

export function outputTime(parts:TimelinePart[],sourceTime:number):number|null {
  const part=parts.find(p=>sourceTime>=p.start&&sourceTime<=p.end);
  return part?part.outputStart+sourceTime-part.start:null;
}

/** Rebase only speech that survives each edit; never guess timings for edits. */
export function timelineCaptions(cues:Cue[],parts:TimelinePart[]):Cue[] {
  const output:Cue[]=[];
  for(const part of parts) {
    for(const cue of cues) {
      if(cue.end<=part.start||cue.start>=part.end)continue;
      let selected:Cue;
      if(cue.start>=part.start-0.001&&cue.end<=part.end+0.001)selected=cue;
      else {
        if(!cue.words?.length)throw new AppError('Uma remoção corta uma legenda sem alinhamento de palavras. Ajuste o texto e os tempos dessa legenda ou use a transcrição original.');
        const words=cue.words.filter(w=>w.start>=part.start-0.001&&w.end<=part.end+0.001);
        if(!words.length)continue;
        selected={start:words[0].start,end:words.at(-1)!.end,text:words.map(w=>w.text).join(' '),words};
      }
      const shift=part.outputStart-part.start;
      output.push({start:Math.max(part.start,selected.start)+shift,end:Math.min(part.end,selected.end)+shift,text:selected.text,
        ...(selected.words?{words:selected.words.map(w=>({...w,start:w.start+shift,end:w.end+shift}))}:{})});
    }
  }
  return output;
}
