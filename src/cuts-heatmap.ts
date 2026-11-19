import { spawn } from 'node:child_process';
import { AppError } from './config.js';
import type {CutSourceRange} from './cuts-source-limits.js';

export type ReplayPoint={start:number;end:number;value:number};
export type ReplayData={
  status:'available'|'unavailable'|'failed';points:ReplayPoint[];
  source:'youtube_most_replayed';message:string;
};

/** yt-dlp exposes YouTube's normalized interest curve, not clicks or view counts. */
export function normalizeHeatmap(raw:unknown,duration:number):ReplayPoint[] {
  if(!Array.isArray(raw)||!Number.isFinite(duration)||duration<=0)return [];
  const points:ReplayPoint[]=[];
  for(const item of raw.slice(0,2000)) {
    if(!item||typeof item!=='object')continue;
    const entry=item as Record<string,unknown>;
    const start=entry.start_time??entry.start,end=entry.end_time??entry.end,value=entry.value;
    if(typeof start!=='number'||typeof end!=='number'||typeof value!=='number'||![start,end,value].every(Number.isFinite)||start<0||end<=start||start>=duration||value<0)continue;
    points.push({start,end:Math.min(duration,end),value:Math.min(1,value)});
  }
  points.sort((a,b)=>a.start-b.start||b.value-a.value||a.end-b.end);
  const disjoint:ReplayPoint[]=[];
  for(const point of points) {
    const start=Math.max(point.start,disjoint.at(-1)?.end??0);
    if(point.end>start)disjoint.push({...point,start});
  }
  // Empty and all-zero payloads have no usable replay signal.
  return disjoint.some(p=>p.value>0)?disjoint:[];
}

export function replayFromMetadata(metadata:unknown,duration?:number,sourceStart=0):ReplayData {
  const info=metadata&&typeof metadata==='object'?metadata as Record<string,unknown>:{};
  const points=normalizeHeatmap(info.heatmap,sourceStart+(duration??Number(info.duration)))
    .filter(point=>point.end>sourceStart)
    .map(point=>({...point,start:Math.max(0,point.start-sourceStart),end:point.end-sourceStart}));
  return {status:points.length?'available':'unavailable',source:'youtube_most_replayed',points,
    message:points.length?'Mapa público de momentos mais repetidos disponível. Os valores indicam interesse relativo, sem contagem de cliques.':'O YouTube não disponibilizou o mapa público de momentos mais repetidos deste vídeo. As sugestões usam a fala e os limites de frases.'};
}

function canonicalVideoUrl(value:string) {
  let url:URL;
  try {url=new URL(value);}catch {throw new AppError('Informe um link válido de um vídeo do YouTube.');}
  if(url.protocol!=='https:'||url.username||url.password||url.port)throw new AppError('Use um link HTTPS de vídeo do YouTube, sem credenciais ou porta.');
  let id:string|undefined|null;
  if(url.hostname==='youtu.be')id=url.pathname.match(/^\/([\w-]{11})\/?$/)?.[1];
  else if(['www.youtube.com','youtube.com','m.youtube.com','music.youtube.com'].includes(url.hostname))
    id=url.pathname==='/watch'?url.searchParams.get('v'):url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})\/?$/)?.[1];
  if(!id||!/^[\w-]{11}$/.test(id))throw new AppError('Cole o link de um vídeo específico do YouTube.');
  return 'https://www.youtube.com/watch?v='+id;
}

async function metadataJson(url:string):Promise<unknown> {
  return new Promise((resolve,reject)=>{
    const args=['-m','yt_dlp','--ignore-config','--no-plugin-dirs','--no-playlist','--no-warnings','--no-progress',
      '--socket-timeout','20','--retries','1','--skip-download','--dump-single-json','--no-js-runtimes','--js-runtimes',`node:${process.execPath}`,'--',url];
    const child=spawn(process.env.CUTS_PYTHON||'python3',args,{stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
    let output='',bytes=0,failure:Error|undefined;
    const stop=(reason:Error)=>{
      if(failure)return;failure=reason;
      try {if(child.pid&&process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{/* already stopped */}
    };
    const timer=setTimeout(()=>stop(new Error('Heatmap metadata timed out')),90_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',(chunk:string)=>{
      bytes+=Buffer.byteLength(chunk);
      if(bytes>8*1024*1024)stop(new Error('Heatmap metadata too large'));else output+=chunk;
    });
    // Metadata errors can contain signed media URLs. Do not expose or persist them.
    child.stderr.on('data',()=>{});
    child.on('error',error=>{clearTimeout(timer);reject(failure||error);});
    child.on('close',code=>{
      clearTimeout(timer);
      if(failure||code!==0)return reject(failure||new Error('Heatmap metadata unavailable'));
      try {resolve(JSON.parse(output));}catch {reject(new Error('Invalid heatmap metadata'));}
    });
  });
}

export async function fetchCutHeatmap(url:string,range?:CutSourceRange):Promise<ReplayData> {
  const canonical=canonicalVideoUrl(url);
  try {return replayFromMetadata(await metadataJson(canonical),range?range.end-range.start:undefined,range?.start);}
  catch {return {status:'failed',source:'youtube_most_replayed',points:[],message:'Não foi possível consultar os momentos mais repetidos agora. O vídeo e as edições foram preservados; tente atualizar o mapa novamente.'};}
}

/** Weighted by the actual overlap; uncovered or silent time earns no replay score. */
export function replayInterest(points:ReplayPoint[],start:number,end:number):{mean:number;peak:number} {
  if(end<=start)return {mean:0,peak:0};
  let total=0,peak=0;
  for(const point of points) {
    const overlap=Math.max(0,Math.min(end,point.end)-Math.max(start,point.start));
    if(overlap>0){total+=overlap*point.value;peak=Math.max(peak,point.value);}
  }
  return {mean:Math.min(1,total/(end-start)),peak};
}
