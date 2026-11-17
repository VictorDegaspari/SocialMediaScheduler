import { randomUUID } from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AppError, dataDir, errorMessage, logger } from './config.js';
import { pool } from './db.js';
import { nativeChannels, publisherEngine } from './native-auth.js';
import { metadataSchema } from './domain.js';
import { sha256, validateVideo } from './media.js';
import { cutsDependencies, downloadCutSource, transcribeCutSource, selectHighlights, renderCut, type Cue } from './cuts-media.js';
import { stageCutUpload, sweepCutUploadFiles } from './cuts-upload-files.js';
import { captionStyleSchema, framingOptionsSchema, timeRangeSchema, cutTimeline, timelineCaptions, type CaptionStyle, type FramingOptions, type TimeRange } from './cuts-edit.js';
import { fetchCutHeatmap, type ReplayData } from './cuts-heatmap.js';
import { cursorFields, keysetClause, pageLimit, paginateRows, parsePagination, type PageOptions } from './pagination.js';

const uuid=z.string().uuid();
const stages=['queued','downloading','transcribing','selecting','rendering'];
const terminal=['posted','discarded'];
const accepted=['processing','private','unlisted','published','scheduled','completed','failed'];
const root=()=>join(dataDir,'cuts');
export const cutDirectory=(id:string)=>join(root(),uuid.parse(id));
const lockKey=(id:string)=>'drive-watcher:cuts:'+id;

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
export function validateCutEdit(input:{start:number;end:number;captions:Cue[];excludedRanges?:TimeRange[]},duration:number) {
  if(!Number.isFinite(duration)||input.start<0||input.end>duration+0.001||input.end<=input.start)
    throw new AppError('Escolha um trecho dentro do vídeo de origem.');
  const parts=cutTimeline(input.start,input.end,input.excludedRanges);
  if(!input.captions.length)throw new AppError('Este trecho não contém fala transcrita. Escolha outro intervalo.');
  let lastEnd=input.start;
  for(const cue of input.captions) {
    if(cue.start<input.start-0.001||cue.end>input.end+0.001||cue.end<=cue.start||cue.start<lastEnd-0.001)
      throw new AppError('As legendas precisam estar em ordem, sem sobreposição e dentro do trecho selecionado.');
    lastEnd=cue.end;
  }
  if(!timelineCaptions(input.captions,parts).length)throw new AppError('Os trechos mantidos precisam conter fala com legenda.');
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

type Job={id:string;url:string;status:string;title:string|null;duration:number|null;language:string;clip_count:number;target_seconds:number;transcript:Cue[]|null;error:string|null;replay_data:ReplayData|null;pending_analysis:{count:number;targetSeconds:number}|null};
type Clip={id:string;job_id:string;title:string;start_seconds:number;end_seconds:number;captions:Cue[];framing:'fit'|'crop';status:string;revision:number;local_file:string|null;delivery_id:string|null;caption_style:CaptionStyle;framing_options:FramingOptions;excluded_ranges:TimeRange[];output_duration:number};
type CutsMedia={download:typeof downloadCutSource;transcribe:typeof transcribeCutSource;select:typeof selectHighlights;render:typeof renderCut;dependencies:typeof cutsDependencies;replay?:typeof fetchCutHeatmap};

async function exists(path:string) {return stat(path).then(s=>s.isFile()).catch(()=>false);}

/** One transaction + a job lock protects edits, uploads and filesystem retirement. */
async function withJob<T>(id:string,isClip:boolean,work:(db:PoolClient,job:Job,clip:Clip|undefined)=>Promise<T>):Promise<T> {
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const jobId=isClip?(await db.query('SELECT job_id FROM cuts WHERE id=$1',[id])).rows[0]?.job_id:id;
    if(!jobId)throw new AppError('Corte não encontrado.',404);
    const {rows:[lock]}=await db.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS ok',[lockKey(jobId)]);
    if(!lock.ok)throw new AppError('Este vídeo está sendo processado. Aguarde a conclusão para ajustar ou descartar.',409);
    const {rows:[job]}=await db.query<Job>('SELECT * FROM cut_jobs WHERE id=$1 FOR UPDATE',[jobId]);
    if(!job)throw new AppError('Vídeo não encontrado.',404);
    const clip=isClip?(await db.query<Clip>('SELECT * FROM cuts WHERE id=$1 FOR UPDATE',[id])).rows[0]:undefined;
    const result=await work(db,job,clip);
    await db.query('COMMIT');return result;
  } catch(error) {await db.query('ROLLBACK');throw error;}
  finally {db.release();}
}

export class CutsService {
  private busy:Promise<void>|undefined;
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
      this.dependencies(),nativeChannels(),pool.query(`SELECT j.id,j.url,j.status,j.title,j.duration,j.error,j.replay_data,j.analysis_message,j.created_at,${cursorFields('j.created_at','j.id')}
        FROM cut_jobs j WHERE j.status<>'discarded'${keysetClause(page,'j.created_at','j.id',values)}
        ORDER BY j.created_at DESC,j.id DESC${pageLimit(page,values)}`,values)
    ]);
    const {items:jobs,pagination}=paginateRows(result.rows,page);
    const clips=await pool.query(`SELECT c.*,d.status AS delivery_status,d.error AS delivery_error,d.release_url,d.post_id
      FROM cuts c LEFT JOIN deliveries d ON d.id=c.delivery_id
      WHERE c.job_id=ANY($1::uuid[]) ORDER BY c.created_at,c.id`,[jobs.map(j=>j.id)]);
    const mapped=await Promise.all(clips.rows.map(async c=>{
      const {local_file:localFile,...rest}=c;
      return {...rest,caption_style:captionStyleSchema.parse(c.caption_style||{}),framing_options:framingOptionsSchema.parse({mode:c.framing,...c.framing_options}),
        output_duration:c.output_duration??c.end_seconds-c.start_seconds,error:c.error||c.delivery_error,hasMedia:!!localFile&&await exists(join(cutDirectory(c.job_id),c.id+'.mp4')),
        release_url:c.release_url||(c.post_id?'https://www.youtube.com/watch?v='+encodeURIComponent(c.post_id):null)};
    }));
    return {dependencies,channels:channels.filter(c=>c.identifier==='youtube'),jobs:jobs.map(j=>({...j,clips:mapped.filter(c=>c.job_id===j.id)})),pagination};
  }
  start() {
    const wake=()=>{void this.tick().catch(()=>logger.error({event:'cuts_tick_failed'},'O gerador de cortes será reavaliado no próximo ciclo.'));};
    this.timer=setInterval(wake,3000);this.timer.unref();wake();
  }
  async stop() {if(this.timer)clearInterval(this.timer);await this.busy;}
  async tick() {
    if(this.busy)return;
    this.busy=this.run();
    try {await this.busy;} finally {this.busy=undefined;}
  }
  private async run() {
    const lock=await pool.connect();
    let acquired=false;
    try {
      acquired=(await lock.query('SELECT pg_try_advisory_lock(74839129) AS ok')).rows[0].ok;
      if(!acquired)return;
      await sweepCutUploadFiles();
      await this.retirePublished();
      const {rows:[job]}=await pool.query<Job>('SELECT * FROM cut_jobs WHERE status=ANY($1::text[]) ORDER BY created_at LIMIT 1',[stages]);
      if(!job)return;
      const key=lockKey(job.id);
      const {rows:[claimed]}=await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS ok',[key]);
      if(!claimed.ok)return;
      try {
        // An API request may have discarded the queued job between selection
        // and lock acquisition. Re-read under the lock before touching files.
        const {rows:[current]}=await pool.query<Job>('SELECT * FROM cut_jobs WHERE id=$1',[job.id]);
        if(current&&stages.includes(current.status))await this.generate(current);
      } finally {await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);}
    } finally {
      if(acquired)await lock.query('SELECT pg_advisory_unlock(74839129)');
      lock.release();
    }
  }
  private async stage(id:string,status:string) {await pool.query('UPDATE cut_jobs SET status=$2,error=NULL,updated_at=now() WHERE id=$1',[id,status]);}
  private async generate(job:Job) {
    const dir=cutDirectory(job.id);
    try {
      await mkdir(dir,{recursive:true});
      if(!job.title||!await exists(join(dir,'source.mp4'))) {
        await this.stage(job.id,'downloading');
        const source=await this.media.download(job.url,dir);job.title=source.title;job.duration=source.duration;
        job.replay_data=source.replay||null;
        await pool.query('UPDATE cut_jobs SET title=$2,duration=$3,replay_data=$4,source_removed_at=NULL WHERE id=$1',[job.id,source.title,source.duration,source.replay?JSON.stringify(source.replay):null]);
      }
      if(!job.transcript) {
        await this.stage(job.id,'transcribing');job.transcript=await this.media.transcribe(dir,job.language);
        await pool.query('UPDATE cut_jobs SET transcript=$2 WHERE id=$1',[job.id,JSON.stringify(job.transcript)]);
      }
      let {rows:clips}=await pool.query<Clip>('SELECT * FROM cuts WHERE job_id=$1 ORDER BY created_at,id',[job.id]);
      if(!clips.length||job.pending_analysis) {
        await this.stage(job.id,'selecting');
        if(job.pending_analysis&&this.media.replay) {
          const fresh=await this.media.replay(job.url);
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
      for(const clip of clips.filter(c=>['queued','rendering'].includes(c.status))) {
        await pool.query("UPDATE cuts SET status='rendering',error=NULL,updated_at=now() WHERE id=$1",[clip.id]);
        const result=await this.media.render(dir,clip.id,{start:clip.start_seconds,end:clip.end_seconds,captions:clip.captions,framing:clip.framing,
          captionStyle:captionStyleSchema.parse(clip.caption_style||{}),framingOptions:framingOptionsSchema.parse({...clip.framing_options,mode:clip.framing_options?.mode||clip.framing}),excludedRanges:clip.excluded_ranges||[]});
        await pool.query("UPDATE cuts SET status='review',local_file=$2,render_warnings=$3,error=NULL,updated_at=now() WHERE id=$1",[clip.id,clip.id+'.mp4',JSON.stringify(result.warnings||[])]);
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
  /** Upload confirmation is enough to retire bytes; retain the provider ID/history. */
  async retirePublished() {
    const {rows:jobs}=await pool.query<{id:string}>(`SELECT DISTINCT j.id FROM cut_jobs j JOIN cuts c ON c.job_id=j.id
      WHERE (c.status='publishing' OR c.status IN ('posted','discarded') AND c.local_file IS NOT NULL)
      OR (j.source_removed_at IS NULL AND j.status IN ('review','completed','discarded'))`);
    for(const item of jobs) {
      try {
        await withJob(item.id,false,async(db,job)=>{
          const {rows:clips}=await db.query(`SELECT c.*,d.status AS delivery_status,d.post_id FROM cuts c LEFT JOIN deliveries d ON d.id=c.delivery_id WHERE c.job_id=$1 FOR UPDATE OF c`,[job.id]);
          for(const clip of clips) {
            if(clip.status==='publishing'&&clip.post_id&&accepted.includes(clip.delivery_status)) {
              await db.query("UPDATE cuts SET status='posted',error=NULL,updated_at=now() WHERE id=$1",[clip.id]);clip.status='posted';
            } else if(clip.status==='publishing'&&clip.delivery_status==='cancelled') {
              await db.query("UPDATE cuts SET status='discarded',updated_at=now() WHERE id=$1",[clip.id]);clip.status='discarded';
            }
            if(terminal.includes(clip.status)) {
              await rm(join(cutDirectory(job.id),clip.id+'.mp4'),{force:true});
              await rm(join(cutDirectory(job.id),clip.id+'.ass'),{force:true});
              await db.query('UPDATE cuts SET local_file=NULL WHERE id=$1',[clip.id]);
            }
          }
          if(clips.length&&clips.every(c=>terminal.includes(c.status))&&!job.pending_analysis&&!stages.includes(job.status)) {
            await rm(cutDirectory(job.id),{recursive:true,force:true});
            await db.query("UPDATE cut_jobs SET status=$2,source_removed_at=now(),updated_at=now() WHERE id=$1",[job.id,clips.some(c=>c.status==='posted')?'completed':'discarded']);
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
cutsRoutes.get('/api/cuts',async(req,res)=>{res.json(await service.state(parsePagination(req.query,{scope:'cuts',defaultLimit:10})));});
cutsRoutes.get('/api/cuts/jobs/:id/source',async(req,res)=>{
  const id=uuid.parse(req.params.id);
  const {rows:[job]}=await pool.query('SELECT id FROM cut_jobs WHERE id=$1',[id]);
  const path=join(cutDirectory(id),'source.mp4');
  if(!job||!await exists(path))throw new AppError('O vídeo original não está mais disponível neste projeto.',404);
  res.type('video/mp4');res.sendFile(path);
});
cutsRoutes.get('/api/cuts/jobs/:id/transcript',async(req,res)=>{
  const {rows:[job]}=await pool.query('SELECT transcript,duration,replay_data FROM cut_jobs WHERE id=$1',[uuid.parse(req.params.id)]);
  if(!job?.transcript)throw new AppError('A transcrição ainda não está disponível.',404);
  res.json({captions:job.transcript,duration:job.duration,replay:job.replay_data});
});
cutsRoutes.post('/api/cuts/jobs/:id/analyze',async(req,res)=>{
  const input=z.object({count:z.number().int().min(1).max(5).default(1),targetSeconds:z.number().int().min(20).max(180).default(60)}).parse(req.body);
  await withJob(uuid.parse(req.params.id),false,async(db,job)=>{
    if(!['review','failed'].includes(job.status)||!job.transcript||!await exists(join(cutDirectory(job.id),'source.mp4')))
      throw new AppError('Aguarde a geração terminar. A análise precisa do vídeo original e da transcrição disponíveis.',409);
    const {rows:[count]}=await db.query("SELECT count(*)::int AS n,(count(*) FILTER (WHERE status NOT IN ('posted','discarded')))::int AS active FROM cuts WHERE job_id=$1",[job.id]);
    if(count.active+input.count>10)throw new AppError('Este projeto já tem muitas sugestões pendentes. Poste ou descarte algumas antes de gerar outras para liberar espaço.',409);
    if(count.n+input.count>50)throw new AppError('Este projeto já atingiu o limite de sugestões. Use os cortes existentes ou crie outro projeto.',409);
    await db.query("UPDATE cut_jobs SET pending_analysis=$2,status='selecting',error=NULL,analysis_message=NULL,updated_at=now() WHERE id=$1",[job.id,JSON.stringify(input)]);
  });
  res.status(202).json({ok:true});
});
cutsRoutes.post('/api/cuts',async(req,res)=>{
  const input=z.object({url:z.string().trim().max(2000),count:z.number().int().min(1).max(5).default(1),targetSeconds:z.number().int().min(20).max(180).default(60),language:z.enum(['pt','auto','en','es']).default('pt')}).parse(req.body);
  const url=youtubeVideoUrl(input.url);
  const dependencies=await service.dependencies();
  if(!dependencies.ready)throw new AppError('Instale as dependências do gerador: '+dependencies.details.join(' '),503);
  const db=await pool.connect(),id=randomUUID();
  try {
    await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(74839130)');
    const {rows:[count]}=await db.query("SELECT count(*)::int AS n FROM cut_jobs WHERE status NOT IN ('completed','discarded')");
    if(count.n>=10)throw new AppError('Há 10 vídeos guardados no gerador. Finalize ou descarte os anteriores para liberar espaço.',409);
    await db.query('INSERT INTO cut_jobs(id,url,language,clip_count,target_seconds) VALUES($1,$2,$3,$4,$5)',[id,url,input.language,input.count,input.targetSeconds]);
    await db.query('COMMIT');
  } catch(error) {await db.query('ROLLBACK');throw error;} finally {db.release();}
  res.status(202).json({id,status:'queued'});
});

cutsRoutes.get('/api/cuts/:id/media',async(req,res)=>{
  const id=uuid.parse(req.params.id);
  const {rows:[clip]}=await pool.query<Clip>('SELECT * FROM cuts WHERE id=$1',[id]);
  if(!clip?.local_file||!['review','publishing','failed'].includes(clip.status))throw new AppError('A prévia não está disponível. Vídeos enviados ou descartados são removidos do armazenamento.',404);
  const path=join(cutDirectory(clip.job_id),id+'.mp4');
  if(!await exists(path))throw new AppError('O arquivo da prévia não está disponível.',404);
  res.type('video/mp4');res.sendFile(path);
});

cutsRoutes.put('/api/cuts/:id',async(req,res)=>{
  const id=uuid.parse(req.params.id);
  const input=z.object({title:z.string().trim().min(1).max(100),start:z.number().finite().min(0),end:z.number().finite().positive(),framing:z.enum(['fit','crop','blur']).optional(),
    captionStyle:captionStyleSchema.optional(),framingOptions:framingOptionsSchema.optional(),excludedRanges:z.array(timeRangeSchema).max(20).optional(),
    captions:z.array(cueSchema).max(2000).optional(),useOriginalCaptions:z.boolean().default(false),revision:z.number().int().positive().optional()}).parse(req.body);
  await withJob(id,true,async(db,job,clip)=>{
    if(!clip||!['review','failed'].includes(clip.status)||clip.delivery_id)throw new AppError('Este corte já está em envio ou não está disponível para ajustes.',409);
    if(input.revision!==undefined&&input.revision!==clip.revision)throw new AppError('A prévia mudou. Reabra o ajuste para editar a versão atual.',409);
    if(!job.transcript||!await exists(join(cutDirectory(job.id),'source.mp4')))throw new AppError('A fonte foi removida. Gere um novo vídeo para ajustar este trecho.',409);
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
    validateCutEdit({...input,captions,excludedRanges},job.duration!);
    const captionStyle=captionStyleSchema.parse(input.captionStyle||clip.caption_style||{});
    const framingOptions=framingOptionsSchema.parse(input.framingOptions||{...clip.framing_options,mode:input.framing||clip.framing_options?.mode||clip.framing});
    const outputDuration=cutTimeline(input.start,input.end,excludedRanges).at(-1)!.outputEnd;
    await db.query(`UPDATE cuts SET title=$2,start_seconds=$3,end_seconds=$4,framing=$5,captions=$6,caption_style=$7,framing_options=$8,excluded_ranges=$9,output_duration=$10,
      status='queued',local_file=NULL,revision=revision+1,error=NULL,render_warnings='[]',updated_at=now() WHERE id=$1`,[id,input.title,input.start,input.end,framingOptions.mode==='crop'?'crop':'fit',JSON.stringify(captions),JSON.stringify(captionStyle),JSON.stringify(framingOptions),JSON.stringify(excludedRanges),outputDuration]);
    await db.query("UPDATE cut_jobs SET status='rendering',error=NULL,updated_at=now() WHERE id=$1",[job.id]);
  });
  res.status(202).json({ok:true});
});

cutsRoutes.post('/api/cuts/:id/publish',async(req,res)=>{
  if(await publisherEngine()!=='local')throw new AppError('Selecione Motor local em Conexões para postar os cortes pelo YouTube direto.',409);
  const id=uuid.parse(req.params.id);
  const input=z.object({channelId:z.string().startsWith('native:youtube:').max(250),title:z.string().trim().min(1).max(100),description:z.string().max(4900).default(''),visibility:z.enum(['private','unlisted','public']).default('private'),madeForKids:z.boolean().default(false),containsSyntheticMedia:z.boolean().default(false),confirm:z.literal(true),revision:z.number().int().positive()}).parse(req.body);
  const channels=await nativeChannels(),channel=channels.find(c=>c.id===input.channelId&&c.identifier==='youtube'&&!c.disabled);
  if(!channel)throw new AppError('Conecte e selecione o canal YouTube que deve receber este corte.',409);
  const result=await withJob(id,true,async(db,job,clip)=>{
    if(!clip)throw new AppError('Corte não encontrado.',404);
    if(clip.delivery_id) {
      const {rows:[delivery]}=await db.query('SELECT integration_id FROM deliveries WHERE id=$1',[clip.delivery_id]);
      if(delivery?.integration_id!==input.channelId)throw new AppError('Este corte já foi autorizado para outro canal. Acompanhe o envio no histórico.',409);
      return {deliveryId:clip.delivery_id,reused:true};
    }
    if(clip.status!=='review'||!clip.local_file)throw new AppError('Aguarde uma prévia pronta para autorizar o envio.',409);
    if(clip.revision!==input.revision)throw new AppError('A prévia mudou. Confira a versão atual antes de postar.',409);
    const source=join(cutDirectory(job.id),id+'.mp4');
    await validateVideo(source);
    const hash=await sha256(source),deliveryId=randomUUID();
    const filename=deliveryId+'.native.mp4';
    const metadata=metadataSchema.parse({title:input.title,description:input.description,hashtags:['Shorts'],youtube:{visibility:input.visibility,madeForKids:input.madeForKids,containsSyntheticMedia:input.containsSyntheticMedia}});
    // Hidden, non-scanning watch lets the existing durable uploader own retries and sessions.
    await db.query(`INSERT INTO watches(id,name,folder_id,folder_url,source_type,enabled,initialized,managed_by_cuts,next_scan_at,next_upload_at)
      VALUES($1,$2,$3,$4,'local',true,true,true,'9999-12-31','9999-12-31') ON CONFLICT(id) DO NOTHING`,[job.id,'Cortes · '+(job.title||'YouTube').slice(0,80),'cuts:'+job.id,job.url]);
    await db.query(`INSERT INTO videos(id,watch_id,file_id,name,parent_id,status,sha256,metadata,size)
      VALUES($1,$2,$3,$4,$8,'sent',$5,$6,$7)`,[id,job.id,id,input.title+'.mp4',hash,JSON.stringify(metadata),(await stat(source)).size,job.id]);
    await db.query(`INSERT INTO deliveries(id,video_id,integration_id,provider,engine,status,payload,local_file,approved_at)
      VALUES($1,$2,$3,'youtube','local','pending',$4,$5,now())`,[deliveryId,id,channel.id,JSON.stringify({metadata,channelName:channel.name,assetSha256:hash,stripMetadata:true,automatic:false,nativeSchedule:false}),filename]);
    const {rows:[claim]}=await db.query(`INSERT INTO content_claims(sha256,integration_id,delivery_id) VALUES($1,$2,$3)
      ON CONFLICT(sha256,integration_id) DO UPDATE SET sha256=EXCLUDED.sha256 RETURNING delivery_id`,[hash,channel.id,deliveryId]);
    if(claim.delivery_id!==deliveryId)throw new AppError('Este mesmo vídeo já foi registrado para esse canal. Confira o histórico.',409);
    await stageCutUpload({jobId:job.id,clipId:id,deliveryId,sha256:hash,source});
    await db.query("UPDATE cuts SET title=$2,status='publishing',delivery_id=$3,error=NULL,updated_at=now() WHERE id=$1",[id,input.title,deliveryId]);
    return {deliveryId,reused:false};
  });
  res.status(202).json(result);
});

cutsRoutes.post('/api/cuts/:id/discard',async(req,res)=>{
  z.object({confirm:z.literal(true)}).parse(req.body);
  await withJob(uuid.parse(req.params.id),true,async(db,job,clip)=>{
    if(!clip||clip.delivery_id||clip.status==='publishing'||clip.status==='posted')throw new AppError('Um envio já autorizado deve ser acompanhado ou cancelado no histórico.',409);
    await db.query("UPDATE cuts SET status='discarded',local_file=NULL,error=NULL,updated_at=now() WHERE id=$1",[clip.id]);
    await rm(join(cutDirectory(job.id),clip.id+'.mp4'),{force:true});
    await rm(join(cutDirectory(job.id),clip.id+'.ass'),{force:true});
  });
  await service.retirePublished();res.json({ok:true});
});

cutsRoutes.post('/api/cuts/jobs/:id/discard',async(req,res)=>{
  z.object({confirm:z.literal(true)}).parse(req.body);
  await withJob(uuid.parse(req.params.id),false,async(db,job)=>{
    const {rows:[active]}=await db.query("SELECT id FROM cuts WHERE job_id=$1 AND status='publishing' LIMIT 1",[job.id]);
    if(active)throw new AppError('Aguarde a confirmação dos envios deste vídeo antes de descartar a fonte.',409);
    await db.query("UPDATE cuts SET status='discarded',local_file=NULL,error=NULL,updated_at=now() WHERE job_id=$1 AND status<>'posted'",[job.id]);
    await db.query("UPDATE cut_jobs SET status='discarded',source_removed_at=now(),error=NULL,updated_at=now() WHERE id=$1",[job.id]);
    await rm(cutDirectory(job.id),{recursive:true,force:true});
  });res.json({ok:true});
});

cutsRoutes.post('/api/cuts/jobs/:id/retry',async(req,res)=>{
  const dependencies=await service.dependencies();
  if(!dependencies.ready)throw new AppError('As dependências de geração ainda não estão disponíveis.',503);
  await withJob(uuid.parse(req.params.id),false,async(db,job)=>{
    if(job.status!=='failed')throw new AppError('Somente uma geração com falha pode ser retomada.',409);
    await db.query("UPDATE cuts SET status='queued',error=NULL WHERE job_id=$1 AND status='failed' AND delivery_id IS NULL",[job.id]);
    await db.query("UPDATE cut_jobs SET status='queued',error=NULL,updated_at=now() WHERE id=$1",[job.id]);
  });res.status(202).json({ok:true});
});
return cutsRoutes;
}
export const cutsRoutes=createCutsRoutes();
