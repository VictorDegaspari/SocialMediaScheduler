import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { availableParallelism } from 'node:os';
import { AppError, dataDir } from './config.js';
import {MAX_CUT_SOURCE_SECONDS as MAX_SOURCE_SECONDS, type CutSourceRange} from './cuts-source-limits.js';
import {cutSourceRangeSchema} from './cuts-source-range.js';
import { validateVideo } from './media.js';
import { captionStyleSchema, framingOptionsSchema, cutTimeline, timelineCaptions, type CaptionStyle, type FramingOptions, type TimeRange } from './cuts-edit.js';
import {cutFramingFilters} from './cuts-framing.js';
import {cutOverlayFilters,cutOverlaysSchema,type CutOverlay} from './cuts-overlays.js';
import { normalizeHeatmap, replayFromMetadata, replayInterest, type ReplayData } from './cuts-heatmap.js';

export type Cue = { start:number; end:number; text:string; words?:{start:number;end:number;text:string}[] };
export type Highlight = { start:number; end:number; title:string; reason:string; score:number };
export type SourceInfo = { title:string; duration:number; replay?:ReplayData };
const MAX_SOURCE_BYTES=2*1024*1024*1024;
const python=()=>process.env.CUTS_PYTHON || 'python3';
const transcriptionScript=resolve('scripts/transcribe-cuts.py');
export const cutParallelism=Number(process.env.CUTS_PARALLELISM)===1?1:
  Number(process.env.CUTS_PARALLELISM)===2||availableParallelism()>=4?2:1;
const automaticThreads=Math.min(4,Math.floor(availableParallelism()/cutParallelism));
const renderThreads=Math.min(8,Math.max(1,Math.floor(Number(process.env.CUTS_RENDER_THREADS)||automaticThreads)));

// Run without a shell; terminate the process group, including FFmpeg children,
// when downloads, transcription or renders exceed their resource budget.
async function command(binary:string,args:string[],options:{cwd?:string;timeout:number;maxOutput?:number;maxDirBytes?:number}) {
  return new Promise<string>((done,fail)=>{
    const child=spawn(binary,args,{cwd:options.cwd,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
    let stdout='',outputBytes=0,reason:Error|undefined,checking=false;
    const stop=(error:Error)=>{
      if(reason)return;reason=error;
      try {if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{/* already exited */}
    };
    const timer=setTimeout(()=>stop(new AppError('O processamento excedeu o tempo permitido. Tente um vídeo menor.')),options.timeout);
    const monitor=options.maxDirBytes&&options.cwd?setInterval(()=>{
      if(checking)return;checking=true;
      void readdir(options.cwd!,{withFileTypes:true}).then(async entries=>{
        const sizes=await Promise.all(entries.filter(e=>e.isFile()).map(async e=>(await stat(join(options.cwd!,e.name)).catch(()=>({size:0}))).size));
        if(sizes.reduce((a,b)=>a+b,0)>options.maxDirBytes!)stop(new AppError('O vídeo excedeu o limite de download de 2 GiB.'));
      }).catch(()=>{}).finally(()=>{checking=false;});
    },400):undefined;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',(chunk:string)=>{
      outputBytes+=Buffer.byteLength(chunk);
      if(outputBytes>(options.maxOutput||8*1024*1024))stop(new AppError('A resposta do processador excedeu o limite permitido.'));
      else stdout+=chunk;
    });
    // Always drain stderr, but never return URLs, cookies or process credentials.
    child.stderr.on('data',()=>{});
    const cleanup=()=>{clearTimeout(timer);if(monitor)clearInterval(monitor);};
    child.on('error',error=>{cleanup();fail(reason||error);});
    child.on('close',code=>{cleanup();if(reason)fail(reason);else if(code!==0)fail(new Error(`Media processor exited ${code}`));else done(stdout);});
  });
}

export async function cutsDependencies():Promise<{ready:boolean;details:string[]}> {
  const checks=await Promise.all([
    command('ffmpeg',['-hide_banner','-filters'],{timeout:15_000,maxOutput:1024*1024}).then(output=>{
      if(!/\bass\s+V->V/.test(output))throw new Error('ASS filter missing');
      return null;
    }).catch(()=>'FFmpeg com filtro ASS/libass não está disponível.'),
    command('ffprobe',['-version'],{timeout:15_000}).then(()=>null).catch(()=>'FFprobe não está disponível.'),
    command(python(),['-c','import faster_whisper, yt_dlp, yt_dlp_ejs'],{timeout:30_000}).then(()=>null).catch(()=>'Instale as dependências Python de requirements-cuts.txt ou recrie o container.'),
    readFile(transcriptionScript).then(()=>null).catch(()=>'O script de transcrição não está instalado.')
  ]);
  const details=checks.filter((v):v is string=>!!v);
  return {ready:details.length===0,details};
}

function sourceUrl(value:string) {
  let url:URL;
  try {url=new URL(value);}catch {throw new AppError('Informe um link de vídeo do YouTube.');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||!['www.youtube.com','youtube.com','m.youtube.com','youtu.be'].includes(url.hostname))throw new AppError('Informe um link HTTPS de vídeo do YouTube.');
  const id=url.hostname==='youtu.be'?url.pathname.slice(1):url.pathname==='/watch'?url.searchParams.get('v'):url.pathname.match(/^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
  if(!id||!/^[A-Za-z0-9_-]{11}$/.test(id))throw new AppError('O link precisa apontar para um vídeo específico do YouTube.');
  return 'https://www.youtube.com/watch?v='+id;
}

export async function downloadCutSource(url:string,dir:string,requestedRange?:CutSourceRange):Promise<SourceInfo> {
  const canonical=sourceUrl(url);
  const range=requestedRange?cutSourceRangeSchema.parse(requestedRange):undefined;
  await mkdir(dir,{recursive:true});
  const base=['-m','yt_dlp','--ignore-config','--no-plugin-dirs','--no-playlist','--no-warnings','--no-progress','--socket-timeout','30','--retries','2','--fragment-retries','2','--no-js-runtimes','--js-runtimes',`node:${process.execPath}`];
  try {
    const metadata=JSON.parse(await command(python(),[...base,'--dump-single-json','--skip-download','--',canonical],{cwd:dir,timeout:120_000}));
    const duration=Number(metadata.duration);
    if(metadata._type==='playlist'||metadata.entries||metadata.is_live||['is_live','is_upcoming'].includes(metadata.live_status))throw new AppError('Use um vídeo gravado. Playlists e transmissões ao vivo não são aceitas.');
    if(!Number.isFinite(duration)||duration<=0)throw new AppError('Não foi possível determinar a duração do vídeo de origem.');
    if(range&&range.end>duration)throw new AppError('O fim do trecho precisa estar dentro da duração da live.');
    if(!range&&duration>MAX_SOURCE_SECONDS)throw new AppError('O vídeo de origem precisa ter até 2 horas. Para lives longas, escolha um trecho em Canais do YouTube.');
    // Select quality before container compatibility; remuxing keeps both streams intact.
    const downloadArgs=['--concurrent-fragments','1','--format','bv+ba/b','--merge-output-format','mp4'];
    // An MP4 edit list hides the keyframe preroll without re-encoding the source streams.
    const sectionArgs=range?['--download-sections',`*${range.start}-${range.end}`,
      '--downloader-args','ffmpeg_o:-f mp4 -avoid_negative_ts disabled -use_editlist 1',
      '--output','source.download.mp4']:['--max-filesize',String(MAX_SOURCE_BYTES),'--match-filters',`duration <= ${MAX_SOURCE_SECONDS} & !is_live`,
      '--remux-video','mp4','--output','source.download.%(ext)s'];
    await command(python(),[...base,...downloadArgs,...sectionArgs,'--',canonical],{cwd:dir,timeout:45*60_000,maxDirBytes:MAX_SOURCE_BYTES});
    const downloaded=join(dir,'source.download.mp4');
    if((await stat(downloaded)).size>MAX_SOURCE_BYTES)throw new AppError('O vídeo excedeu o limite de download de 2 GiB.');
    const probe=JSON.parse(await command('ffprobe',['-v','error','-show_entries','format=duration,start_time:stream=codec_type,start_time','-of','json',downloaded],{timeout:30_000}));
    const actualDuration=Number(probe.format?.duration);
    if(!Number.isFinite(actualDuration)||actualDuration<=0||actualDuration>MAX_SOURCE_SECONDS)throw new AppError('O vídeo baixado precisa ter até 2 horas.');
    if(!probe.streams?.some((s:{codec_type:string})=>s.codec_type==='video')||!probe.streams?.some((s:{codec_type:string})=>s.codec_type==='audio'))throw new AppError('O vídeo de origem precisa conter imagem e áudio.');
    const selectedDuration=range?range.end-range.start:actualDuration;
    if(range&&(Math.abs(actualDuration-selectedDuration)>.5||!Number.isFinite(Number(probe.format.start_time))||
      Math.abs(Number(probe.format.start_time))>.05||
      probe.streams.some((stream:{codec_type:string;start_time:string})=>['video','audio'].includes(stream.codec_type)&&
        (!Number.isFinite(Number(stream.start_time))||Math.abs(Number(stream.start_time))>.15)))) {
      throw new AppError('O YouTube não entregou o trecho com os tempos esperados. Selecione outro intervalo e tente novamente.');
    }
    await rename(downloaded,join(dir,'source.mp4'));
    const usableDuration=Math.min(selectedDuration,actualDuration);
    return {title:String(metadata.title||'Vídeo do YouTube').slice(0,500),duration:usableDuration,replay:replayFromMetadata(metadata,usableDuration,range?.start)};
  }catch(error){
    if(error instanceof AppError)throw error;
    throw new AppError('Não foi possível baixar este vídeo. Confira o link e o acesso público. Se o YouTube pedir login ou bloquear o acesso, atualize o yt-dlp ou use outro vídeo.');
  }finally {
    const partials=await readdir(dir).catch(()=>[]);
    await Promise.all(partials.filter(name=>name.startsWith('source.download.')).map(name=>rm(join(dir,name),{force:true}).catch(()=>{})));
  }
}

export async function transcribeCutSource(dir:string,language:string):Promise<Cue[]> {
  if(!/^(auto|[a-z]{2,3})$/.test(language))throw new AppError('Idioma de transcrição inválido.');
  try {
    const output=await command(python(),[transcriptionScript,'--input',join(dir,'source.mp4'),'--language',language,'--cache-dir',join(dataDir,'speech-models')],{timeout:4*60*60_000,maxOutput:8*1024*1024});
    const cues:unknown=JSON.parse(output);
    if(!Array.isArray(cues)||cues.length>50000||!cues.length)throw new AppError('Não foi encontrada fala suficiente para gerar legendas.');
    let previous=-1;
    for(const cue of cues){
      if(!cue||typeof cue.text!=='string'||!cue.text.trim()||cue.text.length>500||!Number.isFinite(cue.start)||!Number.isFinite(cue.end)||cue.start<previous||cue.start<0||cue.end<=cue.start||cue.end>MAX_SOURCE_SECONDS+1)throw new AppError('A transcrição retornou timestamps inválidos. Tente novamente.');
      if(cue.words!==undefined&&(!Array.isArray(cue.words)||!cue.words.length||cue.words.length>200||cue.words.some((w:unknown)=>{
        const word=w as {start?:unknown;end?:unknown;text?:unknown}|null;
        return !word||typeof word.start!=='number'||typeof word.end!=='number'||!Number.isFinite(word.start)||!Number.isFinite(word.end)||word.start<cue.start-0.001||word.end>cue.end+0.001||word.end<=word.start||typeof word.text!=='string'||!word.text.trim();
      })))throw new AppError('A transcrição retornou timestamps de palavras inválidos. Tente novamente.');
      previous=cue.start;
    }
    return cues as Cue[];
  }catch(error){
    if(error instanceof AppError)throw error;
    throw new AppError('Não foi possível transcrever o áudio. Confira as dependências e o acesso ao download do modelo de fala; a primeira execução precisa de internet.');
  }
}

// Replay supplies a public relative-interest signal, while speech boundaries
// keep each suggestion intelligible. Missing data never becomes invented views.
export function selectHighlights(cues:Cue[],duration:number,count:number,targetSeconds:number,replay?:ReplayData,excluded:{start:number;end:number}[]=[]):Highlight[] {
  if(!Number.isFinite(duration)||duration<=0||!Number.isInteger(count)||count<1||count>10||!Number.isFinite(targetSeconds)||targetSeconds<5||targetSeconds>180)throw new AppError('Configuração de cortes inválida.');
  const valid=cues.filter(c=>Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.start>=0&&c.end>c.start&&c.start<duration&&typeof c.text==='string'&&c.text.trim()).sort((a,b)=>a.start-b.start);
  if(!valid.length)return [];
  const points=replay?.status==='available'?normalizeHeatmap(replay.points,duration):[];
  const hasReplay=points.length>0;
  const candidates:Highlight[]=[];
  const minimum=Math.min(targetSeconds*0.55,Math.max(5,duration*0.6));
  const complete=(text:string)=>/[.!?…]["'”’]?\s*$/.test(text);
  const boundaries=valid.flatMap((cue,index)=>index===0||complete(valid[index-1].text)||cue.start-valid[index-1].end>=0.7?[index]:[]);
  const starts=new Set(boundaries);
  // Explicitly consider a sentence near each local maximum with a short context
  // lead-in. Long monologues therefore do not hide a replay peak between cues.
  const peaks=points.filter((p,i)=>p.value>=(points[i-1]?.value??-1)&&p.value>=(points[i+1]?.value??-1)).sort((a,b)=>b.value-a.value).slice(0,count*8);
  for(const peak of peaks) {
    const desired=(peak.start+peak.end)/2-Math.min(12,targetSeconds*0.3);
    const before=boundaries.filter(i=>valid[i].start<=desired).at(-1);
    const after=boundaries.find(i=>valid[i].start>desired);
    if(before!==undefined)starts.add(before);
    if(after!==undefined)starts.add(after);
    // A pause or sentence edge may be far away: allow the beginning of a full
    // cue immediately before the peak rather than starting inside a word.
    if(before===undefined||desired-valid[before].start>Math.min(15,targetSeconds*0.4)) {
      const nearby=valid.findLastIndex(c=>c.start<=desired);
      if(nearby>=0)starts.add(nearby);
    }
  }
  for(const i of [...starts].sort((a,b)=>a-b)){
    const start=Math.max(0,valid[i].start-0.08);
    let endIndex=i;
    for(let j=i;j<valid.length&&valid[j].end-start<=Math.min(180,targetSeconds*1.2);j++){
      const length=valid[j].end-start;
      if(length>=minimum){
        const currentLength=valid[endIndex].end-start;
        const closeness=Math.abs(length-targetSeconds)-(complete(valid[j].text)?targetSeconds*0.15:0);
        const currentCloseness=Math.abs(currentLength-targetSeconds)-(complete(valid[endIndex].text)?targetSeconds*0.15:0);
        if(currentLength<minimum||closeness<currentCloseness)endIndex=j;
      }
    }
    const end=Math.min(duration,valid[endIndex].end+0.08,start+180);
    if(end-start<minimum)continue;
    const selected=valid.slice(i,endIndex+1);
    const text=selected.map(c=>c.text).join(' ').replace(/\s+/g,' ').trim();
    const speaking=selected.reduce((total,c)=>total+Math.max(0,Math.min(c.end,end)-Math.max(c.start,start)),0)/(end-start);
    const opening=selected.slice(0,3).map(c=>c.text).join(' ');
    const hook=/[?]|\b(como|porqu[eê]|segredo|aprend|dica|imagine|descobr|what|why|how|learn|secret)\b/i.test(opening)?1:0;
    const fullEnding=complete(valid[endIndex].text)?1:0;
    const normalized=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const requests=(normalized.match(/\b(?:deix[ae] (?:o |um )?like\w*|se inscrev\w*|inscrev\w* (?:no|aqui)|ativ[ae] (?:o )?sininho|comenta(?:m|r|e)? ai|link na descricao|cupom|patrocinad\w*|subscribe|like and subscribe)\b/g)||[]).length;
    const promotionPenalty=Math.min(36,requests*14);
    const interest=replayInterest(points,start,end);
    const speechScore=Math.min(1,speaking)*(hasReplay?10:45)+hook*(hasReplay?2:15)+fullEnding*(hasReplay?3:20)+Math.max(0,1-Math.abs(end-start-targetSeconds)/targetSeconds)*(hasReplay?5:20);
    const replayScore=hasReplay?interest.mean*20+interest.peak*60:0;
    const score=Math.round(Math.max(0,Math.min(100,speechScore+replayScore-promotionPenalty))*100)/100;
    const reason=hasReplay
      ?`Mapa público de momentos mais repetidos do YouTube combinado com continuidade da fala${fullEnding?' e encerramento de frase':''}. Interesse relativo; não é contagem de cliques${requests?'. Chamadas promocionais reduzem a pontuação':''}.`
      :`Trecho com fala contínua${hook?', pergunta ou explicação na abertura':''}${fullEnding?' e encerramento de frase':''}. Sem mapa de replay disponível; seleção pela fala${requests?'; chamadas promocionais reduzem a pontuação':''}.`;
    candidates.push({start:Math.round(start*1000)/1000,end:Math.round(end*1000)/1000,title:text.slice(0,95)+(text.length>95?'…':''),reason,score});
  }
  if(!candidates.length){
    const start=Math.max(0,valid[0].start-0.08),end=Math.min(duration,valid.at(-1)!.end+0.08,start+targetSeconds,start+180);
    if(end>start)candidates.push({start,end,title:valid.map(c=>c.text).join(' ').slice(0,100),reason:'Trecho de fala disponível; revise o início e o fim. Sem sinal de replay utilizável neste intervalo.',score:0});
  }
  const represented=excluded.filter(r=>Number.isFinite(r.start)&&Number.isFinite(r.end)&&r.start>=0&&r.end>r.start);
  // Apply existing selections before limiting the result count. Otherwise a
  // refresh requesting one suggestion can repeatedly choose and skip the same
  // highest peak while other usable moments are still available.
  const novel=candidates.filter(candidate=>represented.every(old=>{
    const overlap=Math.max(0,Math.min(old.end,candidate.end)-Math.max(old.start,candidate.start));
    return overlap/Math.min(old.end-old.start,candidate.end-candidate.start)<=0.65;
  }));
  const chosen:Highlight[]=[];
  for(const candidate of novel.sort((a,b)=>b.score-a.score||a.start-b.start)){
    if(chosen.every(old=>Math.max(0,Math.min(old.end,candidate.end)-Math.max(old.start,candidate.start))<=0.05))chosen.push(candidate);
    if(chosen.length===count)break;
  }
  return chosen.sort((a,b)=>a.start-b.start);
}

function assTime(seconds:number) {
  const ticks=Math.max(0,Math.round(seconds*100));
  return `${Math.floor(ticks/360000)}:${String(Math.floor(ticks/6000)%60).padStart(2,'0')}:${String(Math.floor(ticks/100)%60).padStart(2,'0')}.${String(ticks%100).padStart(2,'0')}`;
}

// Only the renderer writes ASS commands. User text can never introduce them.
function assText(text:string) {
  return text.replace(/\\/g,'＼').replace(/{/g,'｛').replace(/}/g,'｝').replace(/[\r\n]+/g,' ').replace(/[\u0000-\u0008\u000b-\u001f]/g,'').trim();
}
function assColor(color:string,alpha='00') {
  return `&H${alpha}${color.slice(5,7)}${color.slice(3,5)}${color.slice(1,3)}`.toUpperCase();
}
const inlineColor=(color:string)=>`${assColor(color).slice(0,2)}${assColor(color).slice(4)}&`;
const normalizedSpeech=(text:string)=>text.replace(/\s+/g,' ').trim();
function alignedWords(cue:Cue):NonNullable<Cue['words']>|undefined {
  const words=cue.words;
  if(!words?.length||normalizedSpeech(words.map(w=>w.text).join(' '))!==normalizedSpeech(cue.text))return undefined;
  let previous=cue.start;
  for(const word of words) {
    if(!Number.isFinite(word.start)||!Number.isFinite(word.end)||word.start<previous-0.001||word.start<cue.start-0.001||word.end>cue.end+0.001||word.end<=word.start||typeof word.text!=='string'||!word.text.trim())return undefined;
    previous=word.end;
  }
  return words;
}

/** Build timed dialogue from recognized words; missing alignment stays static. */
function captionAss(captions:Cue[],style:CaptionStyle,output:{width:number;height:number}):{ass:string;warnings:string[]} {
  const alignment={bottom:2,middle:5,top:8}[style.position];
  const scale=output.height/1280;
  const lines:string[]=[],warnings:string[]=[];
  const write=(start:number,end:number,text:string)=>{
    if(end-start<0.005)return;
    lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${text}`);
  };
  for(const cue of captions) {
    const text=assText(cue.text),durationMs=Math.round((cue.end-cue.start)*1000);
    if(style.animation==='karaoke') {
      const words=alignedWords(cue);
      if(words) {
        let cursor=cue.start;
        for(let i=0;i<words.length;i++) {
          const word=words[i];
          if(word.start>cursor)write(cursor,word.start,text);
          // A complete caption stays visible; only the currently spoken word
          // changes color, using actual audio timestamps rather than estimates.
          const highlighted=words.map((w,index)=>index===i?`{\\1c${inlineColor(style.highlightColor)}}${assText(w.text)}{\\1c${inlineColor(style.color)}}`:assText(w.text)).join(' ');
          write(word.start,word.end,highlighted);cursor=word.end;
        }
        if(cursor<cue.end)write(cursor,cue.end,text);
        continue;
      }
      if(!warnings.length)warnings.push('Algumas legendas não têm alinhamento de palavras; nesses grupos o destaque por palavra fica estático.');
    }
    const fadeIn=Math.min(120,Math.floor(durationMs/3)),fadeOut=Math.min(100,Math.floor(durationMs/3));
    const animation=style.animation==='fade'?`{\\fad(${fadeIn},${fadeOut})}`:
      style.animation==='pop'?`{\\fscx85\\fscy85\\t(0,${Math.min(140,Math.floor(durationMs/2))},\\fscx100\\fscy100)\\fad(${Math.min(40,fadeIn)},${fadeOut})}`:'';
    write(cue.start,cue.end,animation+text);
  }
  const ass=`[Script Info]\nScriptType: v4.00+\nPlayResX: ${output.width}\nPlayResY: ${output.height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,${style.fontSize*scale},${assColor(style.color)},${assColor(style.highlightColor)},${assColor(style.outlineColor,style.background==='box'?'50':'00')},&H70000000,-1,0,0,0,100,100,0,0,${style.background==='box'?3:1},${(style.background==='box'?8:3)*scale},${(style.background==='box'?0:1)*scale},${alignment},${48*output.width/720},${48*output.width/720},${style.position==='middle'?0:190*scale},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`+lines.join('\n')+'\n';
  return {ass,warnings};
}

function sourceFrameRate(stream:{avg_frame_rate?:string;r_frame_rate?:string}) {
  for(const rate of [stream.avg_frame_rate,stream.r_frame_rate]) {
    if(!rate||!/^\d+(\/\d+)?$/.test(rate))continue;
    const [numerator,denominator=1]=rate.split('/').map(Number),fps=numerator/denominator;
    if(Number.isFinite(fps)&&fps>0)return {rate,fps};
  }
  return {rate:'30',fps:30};
}

export type RenderCutInput={
  start:number;end:number;captions:Cue[];framing:'fit'|'crop'|'blur';
  captionStyle?:CaptionStyle;framingOptions?:FramingOptions;excludedRanges?:TimeRange[];overlays?:CutOverlay[];
};
export async function renderCut(dir:string,clipId:string,input:RenderCutInput):Promise<{path:string;warnings:string[]}> {
  if(!/^[a-fA-F0-9-]{16,80}$/.test(clipId))throw new AppError('Identificador de corte inválido.');
  const {start,end,captions}=input;
  if(!['fit','crop','blur'].includes(input.framing)||!Array.isArray(captions)||captions.length>50000)throw new AppError('Escolha um trecho válido de até 3 minutos.');
  if(end-start>180&&!input.excludedRanges?.length)throw new AppError('Escolha um trecho válido de até 3 minutos.');
  const parts=cutTimeline(start,end,input.excludedRanges),duration=parts.at(-1)!.outputEnd;
  const style=captionStyleSchema.parse(input.captionStyle||{});
  const framing=framingOptionsSchema.parse(input.framingOptions||{mode:input.framing});
  let previous=-1;
  for(const cue of captions) {
    if(!Number.isFinite(cue.start)||!Number.isFinite(cue.end)||cue.start<0||cue.end<=cue.start||typeof cue.text!=='string'||!cue.text.trim()||cue.text.length>500||cue.start<previous)throw new AppError('Revise o texto e os tempos das legendas.');
    previous=cue.start;
  }
  const relative=timelineCaptions(captions,parts);
  if(!relative.length)throw new AppError('O trecho precisa conter fala e legendas. Ajuste o início ou o fim.');
  const assName=`${clipId}.ass`,partialName=`${clipId}.rendering.mp4`,path=join(dir,`${clipId}.mp4`);
  let overlayFiles:string[]=[];
  try {
    const probe=JSON.parse(await command('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,width,height,avg_frame_rate,r_frame_rate:stream_tags=rotate:stream_side_data_list','-of','json','source.mp4'],{cwd:dir,timeout:30_000}));
    const sourceVideo=probe.streams?.find((s:{codec_type:string})=>s.codec_type==='video');
    const rotation=Math.abs(Number(sourceVideo?.side_data_list?.find((d:{rotation?:number})=>d.rotation!==undefined)?.rotation||sourceVideo?.tags?.rotate||0))%180;
    const width=rotation===90?sourceVideo?.height:sourceVideo?.width,height=rotation===90?sourceVideo?.width:sourceVideo?.height;
    if(!width||!height||!probe.streams?.some((s:{codec_type:string})=>s.codec_type==='audio')||end>Number(probe.format?.duration)+0.05)throw new AppError('O intervalo escolhido ultrapassa o vídeo ou a origem não contém imagem e áudio.');
    // Full HD is the floor; higher-resolution sources retain their shorter edge.
    // Multiples of 9 and 16 keep the canvas exact and both dimensions even.
    const unit=Math.max(120,Math.ceil(Math.min(width,height)/18)*2);
    const output=framing.format==='video'?{width:16*unit,height:9*unit}:{width:9*unit,height:16*unit};
    const {rate,fps}=sourceFrameRate(sourceVideo);
    const {ass,warnings}=style.enabled?captionAss(relative,style,output):{ass:'',warnings:[]};
    if(style.enabled)await writeFile(join(dir,assName),ass,'utf8');
    const args=['-nostdin','-hide_banner','-loglevel','error','-y'];
    const graph:string[]=[],labels:string[]=[];
    for(let i=0;i<parts.length;i++) {
      const length=parts[i].end-parts[i].start;
      const frames=Math.max(2,Math.ceil(length*fps-1e-7));
      // Separate seeks skip removed spans even when they are many minutes long.
      // Decoder/filter thread counts keep the maximum 21 inputs bounded.
      args.push('-threads','1','-ss',String(parts[i].start),'-t',String(length+Math.max(0.05,1/fps)),'-i','source.mp4');
      // concat extrapolates a video's duration from its mean frame interval.
      // Give every part its exact timeline duration before joining, otherwise
      // fractional-frame trims would pad audio and accumulate an AV offset.
      const base=`[${i}:v:0]trim=duration=${length},setpts=PTS-STARTPTS,fps=${rate},tpad=stop_mode=clone:stop_duration=${Math.max(0.1,2/fps)}`;
      graph.push(...cutFramingFilters(base,i,{width,height},output,framing));
      // Framesync filters reset EOF timing. Finalize after composition so a
      // fractional frame rate keeps the last frame and the exact part duration.
      graph.push(`[v${i}]trim=end_frame=${frames},settb=AVTB,setpts=N*${length/frames}/TB[timedv${i}]`);
      graph.push(`[${i}:a:0]atrim=duration=${length},asetpts=PTS-STARTPTS,aresample=48000:async=1:first_pts=0,aformat=channel_layouts=stereo,apad=pad_dur=0.1,atrim=end_sample=${Math.round(length*48000)},asetpts=N/SR/TB[a${i}]`);
      labels.push(`[timedv${i}][a${i}]`);
    }
    graph.push(`${labels.join('')}concat=n=${parts.length}:v=1:a=1[editedv][editeda]`);
    graph.push(`[editedv]fps=${rate}[overlaybase]`);
    const layers=await cutOverlayFilters(dir,clipId,cutOverlaysSchema.parse(input.overlays||[]),output,duration,parts.length);
    overlayFiles=layers.temporary;args.push(...layers.args);graph.push(...layers.graph);
    graph.push(`[${layers.label}]${style.enabled?`ass=${assName}`:'null'}[outv]`);
    args.push('-filter_complex_threads','1','-filter_complex',graph.join(';'),'-map','[outv]','-map','[editeda]','-t',String(duration),'-c:v','libx264','-preset','slow','-crf','16','-pix_fmt','yuv420p','-r',rate,'-threads',String(renderThreads),'-c:a','aac','-b:a','320k','-map_metadata','-1','-map_chapters','-1','-movflags','+faststart',partialName);
    await command('ffmpeg',args,{cwd:dir,timeout:60*60_000});
    const actual=await validateVideo(join(dir,partialName),framing.format);
    if(Math.abs(actual.duration-duration)>0.5)throw new AppError('A duração renderizada não corresponde aos trechos mantidos. Confira os tempos do corte.');
    await rename(join(dir,partialName),path);
    return {path,warnings};
  }catch(error){
    if(error instanceof AppError)throw error;
    throw new AppError('Não foi possível renderizar o corte. Confira o vídeo de origem e as dependências FFmpeg/libass.');
  }finally {
    await Promise.all([rm(join(dir,partialName),{force:true}),rm(join(dir,assName),{force:true}),...overlayFiles.map(path=>rm(path,{force:true}))]);
  }
}
