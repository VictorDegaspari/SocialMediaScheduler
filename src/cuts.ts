import { randomUUID } from 'node:crypto';
import {cutDirectory,cutJobLock,importReadyCut,recoverCutImports,requireCutProjectSlot} from './cut-projects.js';
export {cutDirectory} from './cut-projects.js';
import {cutEditorial} from './editorial.js';
import {isDeepStrictEqual} from 'node:util';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Router,raw } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AppError, errorMessage, logger } from './config.js';
import { pool } from './db.js';
import { stripVideoMetadata } from './media.js';
import { publisherEngine } from './native-auth.js';
import { cutDestinations,cutPublishSchema,publishCut } from './cut-publications.js';
import { cutParallelism, cutsDependencies, downloadCutSource, prepareImportedCutPreview, transcribeCutSource, selectHighlights, renderCut, type Cue, type CutSourceQuality, type RenderCutInput } from './cuts-media.js';
import type {CutSourceRange} from './cuts-source-limits.js';
import {cutSourceRangeSchema, suggestSourceRanges} from './cuts-source-range.js';
import { sweepCutUploadFiles } from './cuts-upload-files.js';
import { canRemovePreparedMedia,retainedDeliveryQuery, type RetainedDelivery } from './media-cleanup.js';
import { captionStyleSchema, framingOptionsSchema, timeRangeSchema, cutTimeline, timelineCaptions, type CaptionStyle, type FramingOptions, type TimeRange } from './cuts-edit.js';
import { fetchCutHeatmap, type ReplayData } from './cuts-heatmap.js';
import {cutOverlaysSchema,validateOverlayTimes,overlayImage,saveOverlayImage,type CutOverlay} from './cuts-overlays.js';
import { cursorFields, keysetClause, pageLimit, paginateRows, parsePagination, type PageOptions } from './pagination.js';

const uuid=z.string().uuid();
const stages=['queued','downloading','transcribing','selecting','rendering'];
const terminal=['posted','discarded'];
const workerSlots=Array.from({length:cutParallelism},(_,index)=>index);
const claimSlot=async(db:PoolClient,slot:number)=>(await db.query('SELECT pg_try_advisory_lock(74839129,$1::int) AS ok',[slot])).rows[0].ok;
const releaseSlot=(db:PoolClient,slot:number)=>db.query('SELECT pg_advisory_unlock(74839129,$1::int)',[slot]);

/** Reduce all accepted URLs to a single video; never pass arbitrary hosts to yt-dlp. */
export function youtubeVideoUrl(value:string):string {
  let url:URL;
  try {url=new URL(value);} catch {throw new AppError('Informe um link válido de um vídeo do YouTube.');}
  if(url.protocol!=='https:'||url.username||url.password||url.port)throw new AppError('Use um link HTTPS do YouTube, sem credenciais ou porta.');
  let id:string|null=null;
  if(url.hostname==='youtu.be')id=url.pathname.match(/^\/([\w-]{11})\/?$/)?.[1]||null;
  if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(url.hostname))
    id=url.pathname==='/watch'?url.searchParams.get('v'):url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})\/?$/)?.[1]||null;
  if(!id||! /^[\w-]{11}$/.test(id))throw new AppError('Cole o link de um vídeo específico do YouTube.');
  return 'https://www.youtube.com/watch?v='+id;
}

const wordSchema=z.object({start:z.number().finite().min(0),end:z.number().finite().positive(),text:z.string().trim().min(1).max(100)});
const cueSchema=z.object({start:z.number().finite().min(0),end:z.number().finite().positive(),text:z.string().trim().min(1).max(500),words:z.array(wordSchema).max(200).optional()});
export function clipCaptions(cues:Cue[],start:number,end:number):Cue[] {
  return cues.flatMap(c=>{
    if(c.end<=start||c.start>=end)return [];
    if(c.start>=start&&c.end<=end)return [{...c}];
    // A group may straddle a manual trim. Keep only words actually in the audio,
    // rather than retaining a complete sentence under truncated timestamps.
    const words=c.words?.filter(w=>w.start>=start&&w.end<=end);
    if(!words?.length)return [];
    return [{start:words[0].start,end:words.at(-1)!.end,text:words.map(w=>w.text).join(' '),words}];
  });
}
export function validateCutEdit(input:{start:number;end:number;captions:Cue[];excludedRanges?:TimeRange[];captionStyle?:CaptionStyle;maxOutputSeconds?:number},duration:number) {
  if(!Number.isFinite(duration)||input.start<0||input.end>duration+0.001||input.end<=input.start)
    throw new AppError('Escolha um trecho dentro do vídeo de origem.');
  const parts=cutTimeline(input.start,input.end,input.excludedRanges,input.maxOutputSeconds);
  let lastEnd=input.start;
  for(const cue of input.captions) {
    if(cue.start<input.start-0.001||cue.end>input.end+0.001||cue.end<=cue.start||cue.start<lastEnd-0.001)
      throw new AppError('As legendas precisam estar em ordem, sem sobreposição e dentro do trecho selecionado.');
    lastEnd=cue.end;
  }
  if(!timelineCaptions(input.captions,parts).length&&input.captionStyle?.enabled!==false)throw new AppError('Os trechos mantidos precisam conter fala com legenda.');
  return parts.at(-1)!.outputEnd;
}

/** Extending an edit brings back source words outside its old bounds only. */
function preserveEditedCaptions(original:Cue[],clip:Clip,start:number,end:number):Cue[] {
  const result:Cue[]=[];
  const retain=(cues:Cue[],from:number,to:number)=>{
    if(to>from)result.push(...timelineCaptions(cues,[{start:from,end:to,outputStart:from,outputEnd:to}]));
  };
  retain(original,start,Math.min(end,clip.start_seconds));
  retain(clip.captions,Math.max(start,clip.start_seconds),Math.min(end,clip.end_seconds));
  retain(original,Math.max(start,clip.end_seconds),end);
  return result;
}

/** Recover only server-owned alignment, including an exact trimmed word group. */
function captionWords(cue:Cue,sources:Cue[]):Cue['words'] {
  for(const source of sources) {
    if(!source.words?.length)continue;
    if(Math.abs(source.start-cue.start)<0.001&&Math.abs(source.end-cue.end)<0.001&&source.text===cue.text)return source.words;
    if(source.start>cue.start+0.001||source.end<cue.end-0.001)continue;
    const words=source.words.filter(word=>word.start>=cue.start-0.001&&word.end<=cue.end+0.001);
    if(words.length&&Math.abs(words[0].start-cue.start)<0.001&&Math.abs(words.at(-1)!.end-cue.end)<0.001&&words.map(word=>word.text).join(' ')===cue.text)return words;
  }
}

type Job={id:string;url:string|null;upload_sha256:string|null;status:string;title:string|null;duration:number|null;language:string;clip_count:number;target_seconds:number;transcript:Cue[]|null;error:string|null;replay_data:ReplayData|null;source_range:CutSourceRange|null;source_quality:CutSourceQuality;pending_analysis:{count:number;targetSeconds:number}|null};
type Clip={id:string;job_id:string;title:string;reason:string;score:number;edited_from_cut_id:string|null;start_seconds:number;end_seconds:number;captions:Cue[];framing:'fit'|'crop';status:string;revision:number;local_file:string|null;delivery_id:string|null;caption_style:CaptionStyle;framing_options:FramingOptions;excluded_ranges:TimeRange[];overlays:CutOverlay[];output_duration:number;max_output_seconds:number;export_status:'queued'|'rendering'|'ready'|'failed'|null};
type CutsMedia={download:typeof downloadCutSource;transcribe:typeof transcribeCutSource;select:typeof selectHighlights;render:typeof renderCut;dependencies:typeof cutsDependencies;replay?:typeof fetchCutHeatmap};

async function exists(path:string) {return stat(path).then(s=>s.isFile()).catch(()=>false);}
const playableStatuses=['review','publishing','posted','failed'];
const exportPending="export_status IN ('queued','rendering')";

async function finalCutFile(quality:CutSourceQuality,clip:Clip) {
  const dir=cutDirectory(clip.job_id);
  if(quality==='original')return join(dir,clip.id+'.mp4');
  const path=join(dir,clip.id+'.master.mp4');
  return clip.export_status==='ready'&&await exists(path)?path:null;
}

const pendingSourcePreviews=new Map<string,Promise<void>>();
async function importedCutPreview(jobId:string){
  const dir=cutDirectory(jobId),source=join(dir,'source.mp4'),preview=join(dir,'source.preview.mp4');
  if(await exists(preview))return preview;
  let pending=pendingSourcePreviews.get(jobId);
  if(!pending){
    pending=prepareImportedCutPreview(dir,source,preview).finally(()=>pendingSourcePreviews.delete(jobId));
    pendingSourcePreviews.set(jobId,pending);
  }
  await pending;
  return preview;
}

function renderInput(clip:Clip):RenderCutInput {
  return {start:clip.start_seconds,end:clip.end_seconds,maxOutputSeconds:clip.max_output_seconds,captions:clip.captions,framing:clip.framing,
    captionStyle:captionStyleSchema.parse(clip.caption_style||{}),
    framingOptions:framingOptionsSchema.parse({...clip.framing_options,mode:clip.framing_options?.mode||clip.framing}),
    excludedRanges:clip.excluded_ranges||[],overlays:cutOverlaysSchema.parse(clip.overlays||[])};
}

async function cutSourceState(job:Job){
  return {ready:!!job.transcript&&!['downloading','transcribing'].includes(job.status)&&await exists(join(cutDirectory(job.id),'source.mp4')),
    status:job.status,duration:job.duration,error:job.error};
}

/** One transaction + a job lock protects edits, uploads and filesystem retirement. */
async function withJob<T>(id:string,isClip:boolean,work:(db:PoolClient,job:Job,clip:Clip|undefined)=>Promise<T>):Promise<T> {
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const jobId=isClip?(await db.query('SELECT job_id FROM cuts WHERE id=$1',[id])).rows[0]?.job_id:id;
    if(!jobId)throw new AppError('Corte não encontrado.',404);
    const {rows:[lock]}=await db.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS ok',[cutJobLock(jobId)]);
    if(!lock.ok)throw new AppError('Este vídeo está sendo processado. Aguarde a conclusão para ajustar ou descartar.',409);
    const {rows:[job]}=await db.query<Job>('SELECT * FROM cut_jobs WHERE id=$1 FOR UPDATE',[jobId]);
    if(!job)throw new AppError('Vídeo não encontrado.',404);
    const clip=isClip?(await db.query<Clip>('SELECT * FROM cuts WHERE id=$1 FOR UPDATE',[id])).rows[0]:undefined;
    const result=await work(db,job,clip);
    await db.query('COMMIT');return result;
  } catch(error) {await db.query('ROLLBACK');throw error;}
  finally {db.release();}
}

async function ensureDiscardable(db:PoolClient,clips:Clip[]) {
  if(clips.some(clip=>clip.status==='publishing'))throw new AppError('Aguarde a confirmação dos envios antes de excluir os arquivos.',409);
  const ids=[...new Set(clips.map(clip=>clip.delivery_id).filter((id):id is string=>!!id))];
  if(!ids.length)return;
  const {rows}=await db.query<RetainedDelivery>(retainedDeliveryQuery+' WHERE d.video_id=ANY($1::uuid[]) OR d.id=ANY($2::uuid[])',[clips.map(clip=>clip.id),ids]);
  if(ids.some(id=>!rows.some(delivery=>delivery.id===id))||rows.some(delivery=>!canRemovePreparedMedia(delivery)))
    throw new AppError('Há um envio sem confirmação. Confira ou resolva o envio no histórico antes de excluir os arquivos.',409);
}

async function removeCutFiles(jobId:string,clipId:string) {
  const base=join(cutDirectory(jobId),clipId);
  for(const suffix of ['.mp4','.master.mp4','.master.rendering.mp4','.ass','.master.ass'])await rm(base+suffix,{force:true});
  await rm(base+'.export-source',{recursive:true,force:true});
}

export class CutsService {
  private workers=new Map<number,Promise<void>>();
  private maintenance:Promise<void>|undefined;
  private stopping=false;
  private timer:ReturnType<typeof setInterval>|undefined;
  private dependencyCache:{at:number;value:Awaited<ReturnType<typeof cutsDependencies>>}|undefined;
  constructor(private media:CutsMedia={download:downloadCutSource,transcribe:transcribeCutSource,select:selectHighlights,render:renderCut,dependencies:cutsDependencies,replay:fetchCutHeatmap}) {}
  async dependencies() {
    if(!this.dependencyCache||Date.now()-this.dependencyCache.at>60_000)
      this.dependencyCache={at:Date.now(),value:await this.media.dependencies()};
    return this.dependencyCache.value;
  }
  async state(page:PageOptions=parsePagination({},{scope:'cuts',defaultLimit:10})) {
    const values:unknown[]=[];
    const [dependencies,channels,result]=await Promise.all([
      this.dependencies(),cutDestinations(),pool.query(`SELECT j.id,j.url,j.upload_sha256 IS NOT NULL AS imported,j.status,j.title,j.duration,j.error,j.replay_data,j.source_range,j.source_quality,j.analysis_message,j.created_at,${cursorFields('j.created_at','j.id')}
        FROM cut_jobs j WHERE j.status NOT IN ('discarded','importing')${page.scope==='cutFolders'?" AND EXISTS(SELECT 1 FROM cuts c WHERE c.job_id=j.id AND c.local_file IS NOT NULL AND c.status IN ('review','publishing','posted','failed'))":''}${keysetClause(page,'j.created_at','j.id',values)}
        ORDER BY j.created_at DESC,j.id DESC${pageLimit(page,values)}`,values)
    ]);
    const {items:jobs,pagination}=paginateRows(result.rows,page);
    const clips=await pool.query(`SELECT c.*,d.status AS delivery_status,d.error AS delivery_error,d.release_url,d.post_id
      FROM cuts c LEFT JOIN deliveries d ON d.id=c.delivery_id
      WHERE c.job_id=ANY($1::uuid[]) ORDER BY c.created_at,c.id`,[jobs.map(j=>j.id)]);
    const {rows:publications}=await pool.query(`SELECT id,video_id,integration_id,provider,engine,status,error,post_id,release_url,payload->>'channelName' AS channel_name
      FROM deliveries WHERE video_id=ANY($1::uuid[]) ORDER BY created_at,id`,[clips.rows.map(clip=>clip.id)]);
    const sources=new Map(await Promise.all(jobs.map(async job=>[job.id,await exists(join(cutDirectory(job.id),'source.mp4'))] as const)));
    const qualities=new Map(jobs.map(job=>[job.id,job.source_quality]));
    const mapped=await Promise.all(clips.rows.map(async c=>{
      const {local_file:localFile,...rest}=c;
      const hasMedia=!!localFile&&await exists(join(cutDirectory(c.job_id),c.id+'.mp4'));
      return {...rest,publicationText:cutEditorial(c),overlays:cutOverlaysSchema.parse(c.overlays||[]),publications:publications.filter(delivery=>delivery.video_id===c.id),caption_style:captionStyleSchema.parse(c.caption_style||{}),framing_options:framingOptionsSchema.parse({mode:c.framing,...c.framing_options}),
        output_duration:c.output_duration??c.end_seconds-c.start_seconds,error:c.error||c.delivery_error,hasMedia,
        finalReady:hasMedia&&!!await finalCutFile(qualities.get(c.job_id),c),
        release_url:c.release_url||(c.post_id?'https://www.youtube.com/watch?v='+encodeURIComponent(c.post_id):null)};
    }));
    return {dependencies,channels,jobs:jobs.map(j=>({...j,hasSource:sources.get(j.id),clips:mapped.filter(c=>c.job_id===j.id)})),pagination};
  }
  async replayWindows(url:string,duration:number) {
    const replay=await this.media.replay?.(url);
    return {
      ranges:replay?suggestSourceRanges(replay,duration):[],
      status:replay?.status||'unavailable',
    };
  }
  start() {
    this.stopping=false;
    const wake=()=>{void this.tick().catch(()=>logger.error({event:'cuts_tick_failed'},'O gerador de cortes será reavaliado no próximo ciclo.'));};
    this.timer=setInterval(wake,3000);this.timer.unref();wake();
  }
  async stop() {
    this.stopping=true;
    if(this.timer)clearInterval(this.timer);
    await Promise.allSettled([...this.workers.values(),this.maintenance]);
  }
  async tick() {
    if(this.stopping)return;
    const work:Promise<void>[]=[];
    if(!this.maintenance&&!this.workers.size){
      this.maintenance=this.maintain().finally(()=>{this.maintenance=undefined;});
      work.push(this.maintenance);
    }
    for(const slot of workerSlots){
      if(this.workers.has(slot))continue;
      const task=(this.maintenance??Promise.resolve()).then(()=>this.run(slot)).finally(()=>{this.workers.delete(slot);});
      this.workers.set(slot,task);work.push(task);
    }
    for(const result of await Promise.allSettled(work))if(result.status==='rejected')throw result.reason;
  }
  private async maintain() {
    const lock=await pool.connect();
    let acquired=false;
    try {
      acquired=(await lock.query('SELECT pg_try_advisory_lock(74839129) AS ok')).rows[0].ok;
      if(!acquired)return;
      await recoverCutImports(lock);
      await sweepCutUploadFiles();
      await this.retirePublished();
    } finally {
      try{if(acquired)await lock.query('SELECT pg_advisory_unlock(74839129)');}finally{lock.release();}
    }
  }
  private async run(slot:number) {
    const lock=await pool.connect();
    let acquired=false;
    try {
      const {rows}=await lock.query<{id:string}>(`SELECT id FROM cut_jobs WHERE status=ANY($1::text[]) OR EXISTS
        (SELECT 1 FROM cuts WHERE job_id=cut_jobs.id AND ${exportPending}) ORDER BY created_at,id`,[stages]);
      for(const job of rows){
        const key=cutJobLock(job.id);
        const {rows:[claimed]}=await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS ok',[key]);
        if(!claimed.ok)continue;
        try {
          const {rows:[current]}=await lock.query<Job>('SELECT * FROM cut_jobs WHERE id=$1',[job.id]);
          if(!current||current.status==='discarded')continue;
          const generatePreview=stages.includes(current.status);
          const final=generatePreview?undefined:(await lock.query<Clip>(
            `SELECT * FROM cuts WHERE job_id=$1 AND ${exportPending} ORDER BY updated_at,id LIMIT 1`,[job.id])).rows[0];
          if(!generatePreview&&!final)continue;
          acquired=await claimSlot(lock,slot);
          if(!acquired)return;
          if(final)await this.exportFinal(current,final);
          else await this.generate(current,lock,slot);
          return;
        } finally {await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);}
      }
    } finally {
      try{if(acquired)await releaseSlot(lock,slot);}finally{lock.release();}
    }
  }
  private async exportFinal(job:Job,clip:Clip) {
    const dir=cutDirectory(job.id),scratch=join(dir,clip.id+'.export-source');
    await pool.query("UPDATE cuts SET export_status='rendering',export_error=NULL WHERE id=$1",[clip.id]);
    let failure:string|null=null;
    try {
      // A worker stopped during FFmpeg can leave temporary high-quality inputs.
      await rm(scratch,{recursive:true,force:true});
      if(!job.url||job.upload_sha256)throw new AppError('A exportação precisa do MP4 original importado.');
      const input=renderInput(clip),sourceParts=[];
      const offset=job.source_range?.start??0,limitMs=Math.floor((offset+job.duration!)*1000);
      for(const [i,part] of cutTimeline(input.start,input.end,input.excludedRanges,input.maxOutputSeconds).entries()){
        // YouTube ranges use millisecond precision and require at least half a second.
        const startMs=Math.floor((offset+part.start)*1000);
        const endMs=Math.min(limitMs,Math.max(Math.ceil((offset+part.end)*1000),startMs+500));
        const start=Math.max(offset,Math.min(startMs,endMs-500)/1000);
        const end=endMs/1000;
        const partDir=join(scratch,String(i));
        await mkdir(partDir,{recursive:true});
        const source=await this.media.download(job.url,partDir,{start,end},'original');
        const seek=Math.max(0,offset+part.start-start);
        if(source.duration+.1<seek+part.end-part.start)throw new AppError('O YouTube entregou um trecho incompleto. Tente gerar o MP4 final novamente.');
        sourceParts.push({path:join(partDir,'source.mp4'),seek});
      }
      await this.media.render(dir,clip.id,input,{sourceParts});
    } catch(error) {
      failure=errorMessage(error);
    }
    try {
      await rm(scratch,{recursive:true,force:true});
      await rm(join(dir,clip.id+'.master.rendering.mp4'),{force:true});
      await rm(join(dir,clip.id+'.master.ass'),{force:true});
    } catch(error) {
      failure??=errorMessage(error);
    }
    await pool.query('UPDATE cuts SET export_status=$2,export_error=$3 WHERE id=$1',[clip.id,failure?'failed':'ready',failure]);
  }
  private async stage(id:string,status:string) {await pool.query('UPDATE cut_jobs SET status=$2,error=NULL,updated_at=now() WHERE id=$1',[id,status]);}
  private async generate(job:Job,lock:PoolClient,slot:number) {
    const dir=cutDirectory(job.id);
    try {
      await mkdir(dir,{recursive:true});
      if(!job.title||!await exists(join(dir,'source.mp4'))) {
        if(!job.url||job.upload_sha256)throw new AppError('O MP4 original está ausente. Importe o arquivo novamente.');
        await this.stage(job.id,'downloading');
        const source=await this.media.download(job.url,dir,job.source_range??undefined,job.source_quality);job.title=source.title;job.duration=source.duration;
        job.replay_data=source.replay||null;
        await pool.query('UPDATE cut_jobs SET title=$2,duration=$3,replay_data=$4,source_removed_at=NULL WHERE id=$1',[job.id,source.title,source.duration,source.replay?JSON.stringify(source.replay):null]);
      }
      if(!job.transcript) {
        await this.stage(job.id,'transcribing');
        const transcript=await this.media.transcribe(dir,job.language);
        job.transcript=job.source_range||job.source_quality==='review'?clipCaptions(transcript,0,job.duration!):transcript;
        await pool.query('UPDATE cut_jobs SET transcript=$2 WHERE id=$1',[job.id,JSON.stringify(job.transcript)]);
      }
      let {rows:clips}=await pool.query<Clip>('SELECT * FROM cuts WHERE job_id=$1 ORDER BY created_at,id',[job.id]);
      if(!clips.length||job.pending_analysis) {
        await this.stage(job.id,'selecting');
        if(job.url&&!job.upload_sha256&&job.pending_analysis&&this.media.replay) {
          const range=job.source_range?{start:job.source_range.start,end:job.source_range.start+job.duration!}:undefined;
          const fresh=await this.media.replay(job.url,range);
          job.replay_data=fresh.status==='failed'&&job.replay_data?.status==='available'
            ?{...job.replay_data,message:'A atualização do mapa falhou. Usando o mapa de momentos mais revistos consultado anteriormente.'}:fresh;
        }
        const highlights=this.media.select(job.transcript,job.duration!,job.pending_analysis?.count||job.clip_count,job.pending_analysis?.targetSeconds||job.target_seconds,job.replay_data||undefined,
          job.pending_analysis?clips.map(c=>({start:c.start_seconds,end:c.end_seconds})):[]);
        if(!highlights.length&&!job.pending_analysis)throw new AppError('Não foi possível encontrar um trecho com fala suficiente neste vídeo.');
        const db=await pool.connect();
        try {
          await db.query('BEGIN');
          let added=0;
          for(const h of highlights) {
            if(clips.some(c=>Math.abs(c.start_seconds-h.start)<1&&Math.abs(c.end_seconds-h.end)<1&&c.status!=='discarded'))continue;
            const captions=clipCaptions(job.transcript,h.start,h.end);
            validateCutEdit({start:h.start,end:h.end,captions},job.duration!);
            await db.query(`INSERT INTO cuts(id,job_id,title,start_seconds,end_seconds,reason,score,captions,output_duration)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[randomUUID(),job.id,h.title.slice(0,100),h.start,h.end,h.reason,h.score,JSON.stringify(captions),h.end-h.start]);
            added++;
          }
          await db.query('UPDATE cut_jobs SET pending_analysis=NULL,replay_data=$2,analysis_message=$3 WHERE id=$1',[job.id,job.replay_data?JSON.stringify(job.replay_data):null,job.pending_analysis?(added?`${added} nova(s) sugestão(ões) preparada(s). Os cortes anteriores foram preservados.`:'Não há novas sugestões diferentes dos cortes já existentes para esta duração.'):null]);
          await db.query('COMMIT');
        } catch(error) {await db.query('ROLLBACK');throw error;} finally {db.release();}
        clips=(await pool.query<Clip>('SELECT * FROM cuts WHERE job_id=$1 ORDER BY created_at,id',[job.id])).rows;
      }
      await this.stage(job.id,'rendering');
      const render=async(clip:Clip)=>{
        await pool.query("UPDATE cuts SET status='rendering',error=NULL,updated_at=now() WHERE id=$1",[clip.id]);
        if(job.source_quality==='review'&&!clip.export_status){
          await rm(join(dir,clip.id+'.master.mp4'),{force:true});
          await rm(join(dir,clip.id+'.export-source'),{recursive:true,force:true});
        }
        const result=await this.media.render(dir,clip.id,renderInput(clip),job.source_quality==='review'?{preview:true}:undefined);
        await pool.query("UPDATE cuts SET status='review',local_file=$2,render_warnings=$3,error=NULL,updated_at=now() WHERE id=$1",[clip.id,clip.id+'.mp4',JSON.stringify(result.warnings||[])]);
      };
      const queued=clips.filter(c=>['queued','rendering'].includes(c.status)),otherSlot=workerSlots.find(value=>value!==slot);
      for(let index=0;index<queued.length;index++){
        const spare=otherSlot!==undefined&&queued.length>index+1&&await claimSlot(lock,otherSlot);
        try{
          const renders=[render(queued[index])];
          if(spare)renders.push(render(queued[++index]));
          // Keep the project lock until both writes finish, including on partial failure.
          for(const result of await Promise.allSettled(renders))if(result.status==='rejected')throw result.reason;
        }finally{if(spare)await releaseSlot(lock,otherSlot!);}
      }
      await this.stage(job.id,'review');
    } catch(error) {
      const message=errorMessage(error);
      await pool.query("UPDATE cuts SET status='failed',error=$2,updated_at=now() WHERE job_id=$1 AND status IN ('queued','rendering')",[job.id,message]);
      await pool.query("UPDATE cut_jobs SET status='failed',error=$2,updated_at=now() WHERE id=$1",[job.id,message]);
      // Partial downloads cannot support an adjustment and are safe to remove.
      if(!job.title)await rm(dir,{recursive:true,force:true}).catch(()=>{});
    }
  }
  /** Reconcile uploads; only explicit discards release the cut and source files. */
  async retirePublished() {
    const {rows:jobs}=await pool.query<{id:string}>(`SELECT DISTINCT j.id FROM cut_jobs j JOIN cuts c ON c.job_id=j.id
      WHERE (c.status='publishing' OR c.status='discarded' AND (c.local_file IS NOT NULL OR j.status<>'discarded'))
      OR (j.source_removed_at IS NULL AND j.status IN ('review','completed','discarded'))`);
    for(const item of jobs) {
      try {
        await withJob(item.id,false,async(db,job)=>{
          const {rows:clips}=await db.query(`SELECT c.*,d.status AS delivery_status,d.post_id FROM cuts c LEFT JOIN deliveries d ON d.id=c.delivery_id WHERE c.job_id=$1 FOR UPDATE OF c`,[job.id]);
          const {rows:deliveries}=await db.query<RetainedDelivery&{video_id:string}>(retainedDeliveryQuery+' WHERE d.video_id=ANY($1::uuid[])',[clips.map(clip=>clip.id)]);
          await ensureDiscardable(db,clips.filter(clip=>clip.status==='discarded'));
          for(const clip of clips) {
            if(clip.status==='publishing') {
              const uploads=deliveries.filter(delivery=>delivery.video_id===clip.id);
              const confirmed=uploads.some(delivery=>canRemovePreparedMedia(delivery)&&!['cancelled','duplicate'].includes(delivery.status));
              const pending=uploads.some(delivery=>!canRemovePreparedMedia(delivery)&&!['failed','cancelled','duplicate'].includes(delivery.status));
              if(confirmed&&!pending){
                await db.query("UPDATE cuts SET status='posted',error=NULL,updated_at=now() WHERE id=$1",[clip.id]);clip.status='posted';
              }else if(!pending&&uploads.length){
                await db.query("UPDATE cuts SET status='failed',error='Confira os envios no histórico. O arquivo foi mantido para reutilização.',updated_at=now() WHERE id=$1",[clip.id]);clip.status='failed';
              }
            }
            if(clip.status==='discarded') {
              await removeCutFiles(job.id,clip.id);
              await db.query('UPDATE cuts SET local_file=NULL WHERE id=$1',[clip.id]);
            }
          }
          if(clips.length&&clips.every(c=>terminal.includes(c.status))&&!job.pending_analysis&&!stages.includes(job.status)) {
            if(clips.every(c=>c.status==='discarded')) {
              await rm(cutDirectory(job.id),{recursive:true,force:true});
              await db.query("UPDATE cut_jobs SET status='discarded',source_removed_at=now(),updated_at=now() WHERE id=$1",[job.id]);
            } else if(job.status!=='completed') {
              await db.query("UPDATE cut_jobs SET status='completed',updated_at=now() WHERE id=$1",[job.id]);
            }
          }
        });
      } catch(error) {
        if(!(error instanceof AppError&&error.status===409))logger.warn({event:'cuts_cleanup_failed',jobId:item.id},'A limpeza deste vídeo será tentada novamente no próximo ciclo.');
      }
    }
  }
}

export const cutsService=new CutsService();
export function createCutsRoutes(service:CutsService=cutsService) {
const cutsRoutes=Router();
cutsRoutes.post('/api/cuts/jobs/:id/images',raw({type:['image/png','image/jpeg','image/webp','application/octet-stream'],limit:'20mb'}),async(req,res)=>{
  const id=uuid.parse(req.params.id);
  if(!Buffer.isBuffer(req.body))throw new AppError('Envie uma imagem PNG, JPEG ou WebP.');
  const image=await withJob(id,false,async(_db,job)=>{
    if(job.status==='discarded'||stages.includes(job.status))throw new AppError('Aguarde o processamento do projeto antes de adicionar uma imagem.',409);
    const dir=cutDirectory(id);await mkdir(dir,{recursive:true});return saveOverlayImage(dir,req.body);
  });
  res.status(201).json({...image,url:`/api/cuts/jobs/${id}/images/${image.id}`});
});
cutsRoutes.get('/api/cuts/jobs/:id/images/:imageId',async(req,res)=>{
  const id=uuid.parse(req.params.id),imageId=uuid.parse(req.params.imageId);
  const image=await overlayImage(cutDirectory(id),imageId);res.type(image.mime);res.sendFile(image.path);
});
cutsRoutes.get('/api/cuts',async(req,res)=>{res.json(await service.state(parsePagination(req.query,{scope:'cuts',defaultLimit:10})));});
cutsRoutes.get('/api/cuts/library',async(req,res)=>{res.json(await service.state(parsePagination(req.query,{scope:'cutFolders',defaultLimit:10})));});
cutsRoutes.get('/api/cuts/jobs/:id/source',async(req,res)=>{
  const id=uuid.parse(req.params.id);
  const {rows:[job]}=await pool.query("SELECT upload_sha256 FROM cut_jobs WHERE id=$1 AND status NOT IN ('discarded','importing')",[id]);
  const path=join(cutDirectory(id),'source.mp4');
  if(!job||!await exists(path))throw new AppError('O vídeo original não está mais disponível neste projeto.',404);
  const playback=job.upload_sha256?await importedCutPreview(id):path;
  if(!res.destroyed)res.type('video/mp4').sendFile(playback);
});
cutsRoutes.get('/api/cuts/jobs/:id/transcript',async(req,res)=>{
  const {rows:[job]}=await pool.query('SELECT transcript,duration,replay_data FROM cut_jobs WHERE id=$1',[uuid.parse(req.params.id)]);
  if(!job?.transcript)throw new AppError('A transcrição ainda não está disponível.',404);
  res.json({captions:job.transcript,duration:job.duration,replay:job.replay_data});
});
cutsRoutes.get('/api/cuts/jobs/:id/source-status',async(req,res)=>{
  const {rows:[job]}=await pool.query<Job>('SELECT * FROM cut_jobs WHERE id=$1',[uuid.parse(req.params.id)]);
  if(!job||job.status==='discarded')throw new AppError('Este projeto não está disponível para recuperar a fonte.',404);
  res.json(await cutSourceState(job));
});
cutsRoutes.post('/api/cuts/jobs/:id/prepare-source',async(req,res)=>{
  z.object({}).parse(req.body);
  const result=await withJob(uuid.parse(req.params.id),false,async(db,job)=>{
    if(job.status==='discarded')throw new AppError('Este projeto foi descartado. Crie outro projeto para gerar novos cortes.',409);
    const source=await cutSourceState(job);
    if(source.ready||stages.includes(job.status))return source;
    if(!job.url||job.upload_sha256)throw new AppError('O MP4 original está ausente. Importe o arquivo novamente.',409);
    // Restore the project's editing source without changing cuts or uploads.
    await db.query("UPDATE cut_jobs SET status='queued',error=NULL,updated_at=now() WHERE id=$1",[job.id]);
    return {...source,status:'queued',error:null};
  });
  res.status(result.ready?200:202).json(result);
});
cutsRoutes.post('/api/cuts/jobs/:id/analyze',async(req,res)=>{
  const input=z.object({count:z.number().int().min(1).max(5).default(1),targetSeconds:z.number().int().min(20).max(180).default(60)}).parse(req.body);
  await withJob(uuid.parse(req.params.id),false,async(db,job)=>{
    if(!job.url||job.upload_sha256)throw new AppError('A análise de replay requer um vídeo do YouTube. Use Ajustar para editar o corte importado.',409);
    if(!['review','failed'].includes(job.status)||!job.transcript||!await exists(join(cutDirectory(job.id),'source.mp4')))
      throw new AppError('Aguarde a geração terminar. A análise precisa do vídeo original e da transcrição disponíveis.',409);
    const {rows:[count]}=await db.query("SELECT count(*)::int AS n,(count(*) FILTER (WHERE status NOT IN ('posted','discarded')))::int AS active FROM cuts WHERE job_id=$1",[job.id]);
    if(count.active+input.count>10)throw new AppError('Este projeto já tem muitas sugestões pendentes. Poste ou exclua algumas sugestões antes de gerar outras.',409);
    if(count.n+input.count>50)throw new AppError('Este projeto já atingiu o limite de sugestões. Use os cortes existentes ou crie outro projeto.',409);
    await db.query("UPDATE cut_jobs SET pending_analysis=$2,status='selecting',error=NULL,analysis_message=NULL,updated_at=now() WHERE id=$1",[job.id,JSON.stringify(input)]);
  });
  res.status(202).json({ok:true});
});
cutsRoutes.post('/api/cuts/replay-windows',async(req,res)=>{
  const input=z.object({url:z.string().trim().max(2000),duration:z.number().min(.5).max(Number.MAX_SAFE_INTEGER/1000)}).strict().parse(req.body);
  res.json(await service.replayWindows(youtubeVideoUrl(input.url),input.duration));
});
cutsRoutes.post('/api/cuts/import',async(req,res)=>{
  const title=z.string().trim().min(1).max(100).parse(req.query.title);
  const result=await importReadyCut(req,title);
  res.status(result.reused?200:201).json(result);
});
cutsRoutes.post('/api/cuts',async(req,res)=>{
  const input=z.object({url:z.string().trim().max(2000),count:z.number().int().min(1).max(5).default(1),targetSeconds:z.number().int().min(20).max(180).default(60),language:z.enum(['pt','auto','en','es']).default('pt'),sourceRange:cutSourceRangeSchema.optional()}).parse(req.body);
  const url=youtubeVideoUrl(input.url);
  const dependencies=await service.dependencies();
  if(!dependencies.ready)throw new AppError('Instale as dependências do gerador: '+dependencies.details.join(' '),503);
  const db=await pool.connect(),id=randomUUID();
  try {
    await db.query('BEGIN');await requireCutProjectSlot(db);
    await db.query("INSERT INTO cut_jobs(id,url,language,clip_count,target_seconds,source_range,source_quality) VALUES($1,$2,$3,$4,$5,$6,'review')",[id,url,input.language,input.count,input.targetSeconds,input.sourceRange??null]);
    await db.query('COMMIT');
  } catch(error) {await db.query('ROLLBACK');throw error;} finally {db.release();}
  res.status(202).json({id,status:'queued'});
});

cutsRoutes.get('/api/cuts/:id/media',async(req,res)=>{
  const id=uuid.parse(req.params.id);
  const {rows:[clip]}=await pool.query<Clip&{source_quality:CutSourceQuality;imported:boolean}>(
    'SELECT c.*,j.source_quality,j.upload_sha256 IS NOT NULL AS imported FROM cuts c JOIN cut_jobs j ON j.id=c.job_id WHERE c.id=$1',[id]);
  if(!clip?.local_file||!playableStatuses.includes(clip.status))throw new AppError('O arquivo não está disponível. Ele pode ter sido excluído manualmente.',404);
  if(req.query.download==='1'||req.query.final==='1'){
    if(req.query.v!==undefined&&String(clip.revision)!==req.query.v)throw new AppError('O corte mudou. Atualize a página para baixar a versão atual.',409);
    const final=await finalCutFile(clip.source_quality,clip);
    if(!final)throw new AppError('Gere o MP4 final para baixar em alta qualidade.',409);
    if(!await exists(final))throw new AppError('O arquivo deste corte não está disponível.',404);
    if(req.query.download==='1'){
      const dir=await mkdtemp(join(tmpdir(),'watcher-cut-download-'));
      try {
        const download=join(dir,'cut.mp4');
        await stripVideoMetadata(final,download,'any',Infinity);
        if(res.destroyed)return;
        await new Promise<void>((resolve,reject)=>{
          res.download(download,clip.title+'.mp4',error=>{
            if(error&&res.headersSent)res.destroy();
            if(error&&!res.destroyed)reject(error);
            else resolve();
          });
        });
      } finally {
        await rm(dir,{recursive:true,force:true}).catch(error=>{
          logger.warn({event:'cut_download_cleanup_failed',message:errorMessage(error)},'Não foi possível remover a cópia temporária do download.');
        });
      }
    }else res.type('video/mp4').sendFile(final);
    return;
  }
  const path=join(cutDirectory(clip.job_id),id+'.mp4');
  if(!await exists(path))throw new AppError('O arquivo da prévia não está disponível.',404);
  const originalImport=clip.imported&&clip.revision===1&&!clip.edited_from_cut_id&&await exists(join(cutDirectory(clip.job_id),'source.mp4'));
  const playback=originalImport?await importedCutPreview(clip.job_id):path;
  if(!res.destroyed)res.type('video/mp4').sendFile(playback);
});

cutsRoutes.get('/api/cuts/:id/export',async(req,res)=>{
  const id=uuid.parse(req.params.id);
  const {rows:[clip]}=await pool.query<Clip&{source_quality:CutSourceQuality;export_error:string|null}>(
    'SELECT c.*,j.source_quality FROM cuts c JOIN cut_jobs j ON j.id=c.job_id WHERE c.id=$1',[id]);
  if(!clip?.local_file||!playableStatuses.includes(clip.status)||String(clip.revision)!==req.query.v)
    throw new AppError('O corte mudou. Escolha a versão atual para continuar.',409);
  const final=await finalCutFile(clip.source_quality,clip);
  res.json({status:final?'ready':clip.export_status==='ready'?null:clip.export_status,error:clip.export_error});
});

cutsRoutes.post('/api/cuts/:id/export',async(req,res)=>{
  const {revision}=z.object({revision:z.number().int().positive()}).parse(req.body);
  const status=await withJob(uuid.parse(req.params.id),true,async(db,job,clip)=>{
    if(!clip?.local_file||!playableStatuses.includes(clip.status))throw new AppError('Aguarde uma prévia pronta para gerar o MP4 final.',409);
    if(revision!==clip.revision)throw new AppError('O corte mudou. Confira a nova prévia antes de gerar o MP4 final.',409);
    if(await finalCutFile(job.source_quality,clip))return 'ready';
    if(clip.export_status==='queued'||clip.export_status==='rendering')return clip.export_status;
    await db.query("UPDATE cuts SET export_status='queued',export_error=NULL,updated_at=now() WHERE id=$1",[clip.id]);
    return 'queued';
  });
  res.status(status==='ready'?200:202).json({status});
});

cutsRoutes.put('/api/cuts/:id',async(req,res)=>{
  const id=uuid.parse(req.params.id);
  const input=z.object({title:z.string().trim().min(1).max(100),start:z.number().finite().min(0),end:z.number().finite().positive(),framing:z.enum(['fit','crop','blur']).optional(),
    captionStyle:captionStyleSchema.optional(),framingOptions:framingOptionsSchema.optional(),excludedRanges:z.array(timeRangeSchema).max(20).optional(),overlays:cutOverlaysSchema.optional(),
    captions:z.array(cueSchema).max(2000).optional(),useOriginalCaptions:z.boolean().default(false),revision:z.number().int().positive().optional(),versionId:uuid.optional()}).parse(req.body);
  const result=await withJob(id,true,async(db,job,clip)=>{
    if(!clip||!['review','failed','publishing','posted'].includes(clip.status))throw new AppError('Aguarde a geração da prévia para ajustar este corte.',409);
    if(input.revision!==undefined&&input.revision!==clip.revision)throw new AppError('A prévia mudou. Reabra o ajuste para editar a versão atual.',409);
    if(!job.transcript||!await exists(join(cutDirectory(job.id),'source.mp4')))throw new AppError('A fonte foi removida. Reabra Ajustar para recuperar o vídeo original e continuar.',409);
    let captions:Cue[];
    if(input.useOriginalCaptions)captions=clipCaptions(job.transcript,input.start,input.end);
    else if(input.captions){
      const sources=[...clip.captions,...job.transcript];
      captions=input.captions.map(cue=>{
        const words=captionWords(cue,sources);
        return {start:cue.start,end:cue.end,text:cue.text,...(words?{words}:{})};
      });
    }
    else if(Math.abs(input.start-clip.start_seconds)<0.001&&Math.abs(input.end-clip.end_seconds)<0.001)captions=clip.captions;
    else captions=preserveEditedCaptions(job.transcript,clip,input.start,input.end);
    // Omitting optional edits preserves them; changing bounds must not restore
    // removed audio silently. Invalid retained gaps require an explicit choice.
    const excludedRanges=input.excludedRanges??clip.excluded_ranges??[];
    const captionStyle=captionStyleSchema.parse(input.captionStyle||clip.caption_style||{});
    const outputDuration=validateCutEdit({...input,captions,excludedRanges,captionStyle,maxOutputSeconds:clip.max_output_seconds},job.duration!);
    const framingOptions=framingOptionsSchema.parse(input.framingOptions||{...clip.framing_options,mode:input.framing||clip.framing_options?.mode||clip.framing});
    const overlays=cutOverlaysSchema.parse(input.overlays??clip.overlays??[]);validateOverlayTimes(overlays,outputDuration);
    for(const overlay of overlays)if(overlay.type==='image')await overlayImage(cutDirectory(job.id),overlay.imageId);
    // A video's ID owns immutable upload bytes and destination claims. Published
    // cuts fork into a separate review copy; active uploads keep their snapshot.
    const {rows:[recorded]}=await db.query('SELECT EXISTS(SELECT 1 FROM videos WHERE id=$1) AS value',[id]);
    const createdVersion=!!clip.delivery_id||recorded.value||['posted','publishing'].includes(clip.status);
    const targetId=createdVersion?(input.versionId||randomUUID()):id;
    const edits={title:input.title,start_seconds:input.start,end_seconds:input.end,framing:framingOptions.mode==='crop'?'crop':'fit',
      captions,caption_style:captionStyle,framing_options:framingOptions,excluded_ranges:excludedRanges,output_duration:outputDuration,overlays};
    if(createdVersion){
      const {rows:[existing]}=await db.query('SELECT * FROM cuts WHERE id=$1',[targetId]);
      if(existing){
        if(existing.edited_from_cut_id!==id||existing.status==='discarded'||!Object.entries(edits).every(([key,value])=>isDeepStrictEqual(existing[key],value)))
          throw new AppError('Esta versão já foi salva ou alterada. Atualize o painel e abra o ajuste da nova versão para continuar.',409);
        return {ok:true,id:targetId,createdVersion:true,reused:true};
      }
      const {rows:[count]}=await db.query("SELECT count(*)::int AS n,(count(*) FILTER (WHERE status NOT IN ('posted','discarded')))::int AS active FROM cuts WHERE job_id=$1",[job.id]);
      if(count.n>=50||count.active>=10)throw new AppError('Este projeto atingiu o limite de versões. Ajuste ou exclua um corte pendente antes de criar outra versão.',409);
    }
    const values=[targetId,input.title,input.start,input.end,edits.framing,JSON.stringify(captions),JSON.stringify(captionStyle),JSON.stringify(framingOptions),JSON.stringify(excludedRanges),outputDuration,JSON.stringify(overlays)];
    if(createdVersion)await db.query(`INSERT INTO cuts(id,title,start_seconds,end_seconds,framing,captions,caption_style,framing_options,excluded_ranges,output_duration,overlays,job_id,reason,score,edited_from_cut_id,max_output_seconds)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,[...values,job.id,clip.reason,clip.score,id,clip.max_output_seconds]);
    else await db.query(`UPDATE cuts SET title=$2,start_seconds=$3,end_seconds=$4,framing=$5,captions=$6,caption_style=$7,framing_options=$8,excluded_ranges=$9,output_duration=$10,overlays=$11,
      status='queued',local_file=NULL,revision=revision+1,error=NULL,render_warnings='[]',export_status=NULL,export_error=NULL,updated_at=now() WHERE id=$1`,values);
    await db.query("UPDATE cut_jobs SET status='rendering',error=NULL,updated_at=now() WHERE id=$1",[job.id]);
    return {ok:true,id:targetId,createdVersion};
  });
  res.status(202).json(result);
});

cutsRoutes.post('/api/cuts/:id/publish',async(req,res)=>{
  const id=uuid.parse(req.params.id),input=cutPublishSchema.parse(req.body);
  if(input.channelId.startsWith('native:youtube:')&&await publisherEngine()!=='local')throw new AppError('Selecione Motor local em Conexões para postar os cortes pelo YouTube direto.',409);
  const result=await withJob(id,true,async(db,job,clip)=>publishCut(db,job,clip,
    clip?await finalCutFile(job.source_quality,clip):null,input));
  res.status(202).json(result);
});

cutsRoutes.post('/api/cuts/:id/discard',async(req,res)=>{
  z.object({confirm:z.literal(true)}).parse(req.body);
  await withJob(uuid.parse(req.params.id),true,async(db,job,clip)=>{
    if(!clip)throw new AppError('Corte não encontrado.',404);
    await ensureDiscardable(db,[clip]);
    await db.query("UPDATE cuts SET status='discarded',local_file=NULL,error=NULL,export_status=NULL,export_error=NULL,updated_at=now() WHERE id=$1",[clip.id]);
    await removeCutFiles(job.id,clip.id);
  });
  await service.retirePublished();res.json({ok:true});
});

cutsRoutes.post('/api/cuts/jobs/:id/discard',async(req,res)=>{
  z.object({confirm:z.literal(true)}).parse(req.body);
  await withJob(uuid.parse(req.params.id),false,async(db,job)=>{
    const {rows:clips}=await db.query<Clip>('SELECT * FROM cuts WHERE job_id=$1 FOR UPDATE',[job.id]);
    await ensureDiscardable(db,clips);
    await db.query("UPDATE cuts SET status='discarded',local_file=NULL,error=NULL,export_status=NULL,export_error=NULL,updated_at=now() WHERE job_id=$1",[job.id]);
    await db.query("UPDATE cut_jobs SET status='discarded',source_removed_at=now(),error=NULL,updated_at=now() WHERE id=$1",[job.id]);
    await rm(cutDirectory(job.id),{recursive:true,force:true});
  });res.json({ok:true});
});

cutsRoutes.post('/api/cuts/jobs/:id/retry',async(req,res)=>{
  const {sourceRange}=z.object({sourceRange:cutSourceRangeSchema.optional()}).strict().parse(req.body??{});
  const dependencies=await service.dependencies();
  if(!dependencies.ready)throw new AppError('As dependências de geração ainda não estão disponíveis.',503);
  await withJob(uuid.parse(req.params.id),false,async(db,job)=>{
    if(job.status!=='failed')throw new AppError('Somente uma geração com falha pode ser retomada.',409);
    if(sourceRange&&(job.title||job.transcript||await exists(join(cutDirectory(job.id),'source.mp4'))||
      (await db.query('SELECT 1 FROM cuts WHERE job_id=$1 LIMIT 1',[job.id])).rowCount)){
      throw new AppError('Este projeto já tem uma fonte ou cortes. Crie um novo projeto para escolher outro trecho.',409);
    }
    await db.query("UPDATE cuts SET status='queued',error=NULL WHERE job_id=$1 AND status='failed' AND delivery_id IS NULL",[job.id]);
    await db.query("UPDATE cut_jobs SET status='queued',error=NULL,source_range=COALESCE($2::jsonb,source_range),updated_at=now() WHERE id=$1",[job.id,sourceRange??null]);
  });res.status(202).json({ok:true});
});
return cutsRoutes;
}
export const cutsRoutes=createCutsRoutes();
