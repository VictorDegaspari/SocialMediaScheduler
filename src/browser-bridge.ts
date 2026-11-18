import {accountCalendar} from './calendar.js';
import {dataDir} from './config.js';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool, event, getSetting, setSetting } from './db.js';
import { AppError, localMediaHostDir,encrypt } from './config.js';
import { PackSource } from './pack-source.js';
import { packDefaultsSchema } from './pack-config.js';
import { LocalFiles } from './local.js';
import { nextRun } from './domain.js';
import { nativeScheduleSchema,planNativeDate,validScheduleDate,uploadBudgetAvailable,reservedCapacityAllowed,type Reservation } from './native-schedule.js';
import {cleanupPublishedMedia} from './media-cleanup.js';
import {browserPublicationRoutes,recoverBrowserPreparations} from './browser-publications.js';
import {cursorFields,keysetClause,pageLimit,paginateRows,parsePagination,type PageOptions} from './pagination.js';
import {browserFailureStages} from './browser-agent-core.js';
import {retryDelivery,cancelDelivery} from './queue-controls.js';
import {browserAgentAuthorized} from './browser-auth.js';
import {playwrightMcpState,requireTikTokBrowserToken} from './playwright-mcp.js';
export {browserAgentAuthorized} from './browser-auth.js';

const ACTIVE = ['pending','running','cancel_requested'];
const PUBLIC_JOB_FIELDS='id,kind,origin,status,phase,message,filename,upload_started,created_at,started_at,finished_at,planned_at,delivery_id';
const LEASE_SECONDS = 20;
export const browserConfigSchema = z.object({
  sourceType:z.enum(['local','gta6_pack']).default('local'),packDefaults:packDefaultsSchema.prefault({}),
  folder:z.string().trim().min(1).max(4096), enabled:z.boolean().default(false),
  cadence:z.enum(['daily','interval']).default('daily'), intervalMinutes:z.number().int().min(1).max(43200).default(720),
  times:z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1).max(24).default(['08:00','20:00']),
  stripMetadata:z.boolean().default(true),mode:z.enum(['review','native_schedule']).default('review'),
  nativeSchedule:nativeScheduleSchema.prefault({})
}).strict();
type Config = z.infer<typeof browserConfigSchema> & {timezone:string;revision:number;nextAt:string|null;profileId?:string;requestManaged?:boolean;publishNow?:boolean};
const stages:Record<string,string> = {
  browser_preparing_source:'Consultando a origem e baixando somente o próximo vídeo necessário.',
  browser_source_failed:'Não foi possível preparar um vídeo da origem. Confira o acesso e o formato dos vídeos.',
  browser_scheduled:'Agendamento confirmado no TikTok Studio.',
  browser_published:'Publicação confirmada no TikTok Studio.',
  platform_limit:'O TikTok informou um limite de envios ou agendamentos. A rotina foi pausada por 24 horas.',
  browser_manual_login:'Faça login no Chrome aberto, confira a conta e feche as janelas desse perfil.',
  browser_upload_started:'Vídeo selecionado no TikTok Studio. Aguardando o editor.',
  browser_review_required:'Vídeo preparado. Revise e clique em Publicar no Chrome; depois feche a janela.',
  browser_manual_action:'Confira a pendência na janela do Chrome e feche-a para continuar.',
  login_required:'Faça login pelo botão Abrir login. Prefira o QR code do TikTok.',
  security_check:'Verificação de segurança no TikTok. Resolva manualmente; a automação foi interrompida.',
  page_changed:'A interface esperada não ficou disponível. Confira o Chrome antes de repetir.',
  upload_unconfirmed:'O TikTok não confirmou a publicação ou o agendamento. Confira o TikTok Studio antes de repetir.',
  browser_attempt_failed:'A preparação não foi confirmada. Confira o Chrome e o histórico.',
  browser_agent_failed:'Falha na execução local. Confira Chrome, arquivos e sessão gráfica.',
  browser_no_video:'Nenhum MP4 novo e estável encontrado na pasta.'
};

async function atomic<T>(work:(db:PoolClient)=>Promise<T>) {
  const db=await pool.connect();
  try {await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(74839200)');const value=await work(db);await db.query('COMMIT');return value;}
  catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
async function configuration(db:PoolClient|typeof pool=pool):Promise<Config> {
  const {rows:[row]}=await db.query('SELECT * FROM browser_settings WHERE id=true');
  return row?{sourceType:row.source_type,packDefaults:packDefaultsSchema.parse(row.pack_defaults||{}),folder:row.folder,enabled:row.enabled,cadence:row.cadence,intervalMinutes:row.interval_minutes,times:row.times,
    timezone:row.timezone,stripMetadata:row.strip_metadata,mode:row.mode,nativeSchedule:nativeScheduleSchema.parse(row.native_schedule||{}),revision:row.revision,nextAt:row.next_at?.toISOString()||null}:
    {sourceType:'local',packDefaults:packDefaultsSchema.parse({}),folder:localMediaHostDir,enabled:false,cadence:'daily',intervalMinutes:720,times:['08:00','20:00'],timezone:'America/Sao_Paulo',stripMetadata:true,mode:'review',nativeSchedule:nativeScheduleSchema.parse({}),revision:0,nextAt:null};
}
function next(config:Config){return nextRun({cadence:config.cadence,interval_minutes:config.intervalMinutes,times:config.times,timezone:config.timezone},new Date());}
function online(agent:any){return !!agent && new Date(agent.last_seen).getTime()>Date.now()-LEASE_SECONDS*1000;}
async function busy(db:PoolClient){return !!(await db.query('SELECT id FROM browser_commands WHERE status=ANY($1::text[]) LIMIT 1',[ACTIVE])).rowCount;}
async function calendar(db:PoolClient,profileId='default'):Promise<Reservation[]> {return accountCalendar('browser:tiktok:'+profileId,db);}
async function insertCommand(db:PoolClient,kind:'login'|'upload',origin:'manual'|'schedule',config:Config){
  let plannedAt:Date|null=null;
  if(kind==='upload'&&config.mode==='native_schedule') {
    const reservations=await calendar(db);
    if(!uploadBudgetAvailable(config.nativeSchedule,reservations))throw new AppError('Limite de uploads em 24 horas atingido. Aguarde a liberação de capacidade.',409);
    plannedAt=planNativeDate('tiktok',{...config,interval_minutes:config.intervalMinutes},config.nativeSchedule,reservations);
    if(!plannedAt)throw new AppError('Sem capacidade ou datas disponíveis na janela do TikTok e nos limites da rotina.',409);
  }
  const id=randomUUID();
  await db.query('INSERT INTO browser_commands(id,kind,origin,config,message,planned_at) VALUES($1,$2,$3,$4,$5,$6)',[id,kind,origin,JSON.stringify(config),'Aguardando o agente no computador.',plannedAt]);return id;
}
async function advance(db:PoolClient,job:any,empty=false){
  if(job.kind!=='upload'||job.request_id||job.config.requestManaged)return;
  if(job.config.mode==='native_schedule'&&!empty) {
    if(['failed','unknown'].includes(job.status))await db.query('UPDATE browser_settings SET enabled=false WHERE revision=$1',[job.config.revision]);
    else await db.query('UPDATE browser_settings SET next_at=now(),retry_at=NULL WHERE revision=$1',[job.config.revision]);
    return;
  }
  if(empty)await db.query("UPDATE browser_settings SET retry_at=now()+interval '30 seconds' WHERE revision=$1",[job.config.revision]);
  else await db.query('UPDATE browser_settings SET next_at=$1,retry_at=NULL WHERE revision=$2',[next(job.config),job.config.revision]);
}
async function recover(db:PoolClient){
  const {rows}=await db.query(`UPDATE browser_commands SET status=CASE WHEN phase='browser_published' AND upload_started AND config->>'publishNow'='true' THEN 'completed' WHEN phase='browser_scheduled' AND upload_started THEN 'scheduled' WHEN kind='upload' AND (upload_started OR NOT phase=ANY($1::text[])) THEN 'unknown' ELSE 'failed' END,
    message=CASE WHEN phase='browser_published' AND upload_started AND config->>'publishNow'='true' THEN 'Publicação confirmada no TikTok Studio antes da desconexão.' WHEN phase='browser_scheduled' AND upload_started THEN 'Agendamento confirmado no TikTok Studio antes da desconexão.'
      WHEN phase=ANY($1::text[]) THEN message||CASE WHEN upload_started THEN ' O upload pode ter começado; confira o TikTok Studio antes de repetir.' ELSE ' O upload não começou. Corrija a pendência e tente novamente.' END
      WHEN kind='upload' THEN 'O navegador parou de responder sem confirmar o resultado. Confira o TikTok Studio antes de repetir.'
      ELSE 'O navegador parou de responder. Confira o agente e tente novamente.' END,
    phase=CASE WHEN phase=ANY($1::text[]) OR ((phase='browser_scheduled' OR (phase='browser_published' AND config->>'publishNow'='true')) AND upload_started) THEN phase ELSE 'agent_offline' END,
    finished_at=now(),lease_until=NULL
    WHERE status IN ('running','cancel_requested') AND (lease_until IS NULL OR lease_until<now() OR phase=ANY($1::text[])
      OR (status='cancel_requested' AND progress_at<now()-interval '30 seconds')
      OR (kind='upload' AND phase NOT IN ('browser_review_required','browser_manual_login') AND progress_at<now()-interval '30 minutes')) RETURNING *`,[[...browserFailureStages]]);
  for(const job of rows){
    if(job.request_id&&job.status==='unknown')await db.query("INSERT INTO manual_actions(id,request_id,kind,message) VALUES($1,$2,'unknown_upload','O agente desconectou durante um envio. Confira o TikTok Studio antes de continuar.') ON CONFLICT(request_id,kind) DO UPDATE SET resolved_at=NULL",[randomUUID(),job.request_id]);
    if(job.delivery_id){
      await db.query('UPDATE deliveries SET status=$2,error=$3,upload_started_at=CASE WHEN $4 THEN COALESCE(upload_started_at,$5) ELSE upload_started_at END,updated_at=now() WHERE id=$1',[job.delivery_id,job.status,job.message,job.upload_started,job.started_at]);
      if(job.status==='cancelled')await db.query('DELETE FROM content_claims WHERE delivery_id=$1',[job.delivery_id]);
    }
    if(job.phase==='platform_limit'){
      await db.query(`INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,['uploadCooldown:browser:tiktok:'+(job.config.profileId||'default'),encrypt(new Date(Date.now()+86400_000).toISOString())]);
      if(!job.request_id&&!job.config.requestManaged)await db.query("UPDATE browser_settings SET blocked_until=now()+interval '24 hours' WHERE id=true");
    }
    await advance(db,job);
  }
}

export class BrowserBridge {
  async jobs(page:PageOptions=parsePagination({},{scope:'browser'})){
    const values:unknown[]=[],filter=keysetClause(page,'created_at','id',values),limit=pageLimit(page,values);
    const {rows}=await pool.query(`SELECT ${PUBLIC_JOB_FIELDS},${cursorFields('created_at','id')} FROM browser_commands
      WHERE true${filter} ORDER BY created_at DESC,id DESC${limit}`,values);
    return paginateRows(rows,page);
  }
  async state(page:PageOptions=parsePagination({},{scope:'browser'})){
    await atomic(recover);
    const [config,agentResult,commands,active,calendarState]=await Promise.all([configuration(),pool.query('SELECT * FROM browser_agent WHERE id=true'),
      this.jobs(page),
      pool.query(`SELECT ${PUBLIC_JOB_FIELDS} FROM browser_commands WHERE status=ANY($1::text[]) ORDER BY created_at DESC,id DESC LIMIT 1`,[ACTIVE]),
      pool.query(`SELECT count(*) FILTER(WHERE planned_at>now() AND status NOT IN ('empty','cancelled','failed'))::int AS reserved,
        count(*) FILTER(WHERE upload_started AND started_at>now()-interval '24 hours')::int AS uploads,
        min(planned_at) FILTER(WHERE planned_at>now() AND status NOT IN ('empty','cancelled','failed')) AS next
        FROM browser_commands WHERE kind='upload'`)]);
    const agent=agentResult.rows[0];
    return {configured:/^[a-f0-9]{64}$/.test(process.env.BROWSER_AGENT_TOKEN||''),config,rootPath:localMediaHostDir,
      agent:{online:online(agent),profileSaved:!!agent?.profile_saved,externalBusy:!!agent?.external_busy,desktop:!!agent?.desktop,lastSeen:agent?.last_seen||null},
      active:active.rows[0]||null,jobs:commands.items,pagination:commands.pagination,calendar:calendarState.rows[0]};
  }
  async save(body:unknown){
    const input=browserConfigSchema.parse(body);
    await requireTikTokBrowserToken();
    const folder=input.sourceType==='gta6_pack'?{hostPath:localMediaHostDir}:await new LocalFiles().folder(input.folder);
    if(input.sourceType==='gta6_pack')await new PackSource(input.packDefaults).catalog();
    const config={...input,folder:folder.hostPath,timezone:'America/Sao_Paulo',revision:0,nextAt:null};
    await atomic(async db=>{
      await db.query(`INSERT INTO browser_settings(id,folder,enabled,cadence,interval_minutes,times,strip_metadata,next_at,mode,native_schedule,source_type,pack_defaults)
        VALUES(true,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO UPDATE SET folder=EXCLUDED.folder,enabled=EXCLUDED.enabled,
        cadence=EXCLUDED.cadence,interval_minutes=EXCLUDED.interval_minutes,times=EXCLUDED.times,strip_metadata=EXCLUDED.strip_metadata,
        next_at=EXCLUDED.next_at,retry_at=NULL,mode=EXCLUDED.mode,native_schedule=EXCLUDED.native_schedule,source_type=EXCLUDED.source_type,pack_defaults=EXCLUDED.pack_defaults,revision=browser_settings.revision+1`,
        [folder.hostPath,input.enabled,input.cadence,input.intervalMinutes,JSON.stringify(input.times),input.stripMetadata,input.mode==='native_schedule'||input.cadence==='interval'?new Date():next(config),input.mode,JSON.stringify(input.nativeSchedule),input.sourceType,JSON.stringify(input.packDefaults)]);
      await db.query("UPDATE browser_commands SET status='cancelled',message='Configuração alterada antes do envio.',finished_at=now() WHERE status='pending' AND kind='upload' AND config->>'requestManaged' IS DISTINCT FROM 'true'");
      if(!input.enabled)await db.query("UPDATE browser_commands SET status='cancelled',message='Rotina pausada antes da execução.',finished_at=now() WHERE status='pending' AND origin='schedule'");
    });
    await event('info',input.enabled?'Rotina do TikTok navegador salva e ativada.':'Configuração do TikTok navegador salva; rotina automática pausada.');
    return configuration();
  }
  async request(kind:'login'|'upload',profileId='default'){
    await requireTikTokBrowserToken();
    if(kind==='upload'&&await getSetting<boolean>('paused'))throw new AppError('As rotinas estão pausadas. Retome em Conexões antes de enviar.',409);
    const id=await atomic(async db=>{
      await recover(db);
      const {rows:[agent]}=await db.query('SELECT * FROM browser_agent WHERE id=true');
      if(!online(agent))throw new AppError('O agente do navegador está desconectado. Inicie o aplicativo pelo scripts/start.sh.',503);
      if(!agent.desktop)throw new AppError('O agente precisa de uma sessão gráfica aberta no Ubuntu.',409);
      const profile=agent.profiles?.[profileId]||(profileId==='default'?{externalBusy:agent.external_busy,profileSaved:agent.profile_saved}:null);
      if(!(await db.query('SELECT id FROM browser_profiles WHERE id=$1',[profileId])).rowCount)throw new AppError('Perfil do navegador não encontrado.',404);
      if(profile?.externalBusy)throw new AppError('Já existe uma janela ou rotina usando esse perfil. Feche-a antes de continuar.',409);
      if(await busy(db))throw new AppError('Já existe uma tarefa do navegador em andamento.',409);
      if(kind==='upload'&&!profile?.profileSaved)throw new AppError('Abra o login e conecte sua conta antes do envio.',409);
      const {rows:[cooldown]}=await db.query('SELECT (retry_at>now() OR blocked_until>now()) AS active FROM browser_settings WHERE id=true');
      if(kind==='upload'&&cooldown?.active)throw new AppError('Aguarde o prazo de nova tentativa da rotina.',409);
      return insertCommand(db,kind,'manual',{...await configuration(db),profileId});
    });
    await event('info',kind==='login'?'Abertura do login TikTok solicitada no computador.':'Envio imediato pelo navegador solicitado.');return id;
  }
  async tick(){
    const paused=await getSetting<boolean>('paused');
    await recoverBrowserPreparations();
    if(!(await playwrightMcpState()).configured)return;
    if(!paused){
      const {rows:deliveries}=await pool.query(`SELECT d.*,v.sha256 AS original_hash,v.name,v.file_id FROM deliveries d JOIN videos v ON v.id=d.video_id
        WHERE d.engine='browser' AND d.status='pending' AND d.request_id IS NULL AND d.approved_at IS NOT NULL AND d.payload->>'publishNow'='true'
        ORDER BY d.created_at,d.id`);
      for(const delivery of deliveries){
        if(await this.enqueueDelivery(delivery,delivery.integration_id.slice('browser:tiktok:'.length),{...await configuration(),mode:'review',publishNow:true,requestManaged:true,enabled:false}))break;
      }
    }
    await atomic(async db=>{
      await recover(db);
      if(paused)return;
      const {rows:[row]}=await db.query("SELECT * FROM browser_settings WHERE enabled=true AND (mode='native_schedule' OR next_at<=now()) AND (retry_at IS NULL OR retry_at<=now()) AND (blocked_until IS NULL OR blocked_until<=now())");
      if(!row||await busy(db))return;
      const {rows:[agent]}=await db.query('SELECT * FROM browser_agent WHERE id=true');
      if(!online(agent)||agent.external_busy||!agent.desktop||!agent.profile_saved)return;
      try {await insertCommand(db,'upload','schedule',await configuration(db));}
      catch(error) {if(!(error instanceof AppError&&error.status===409))throw error;return;}
      await db.query("DELETE FROM browser_commands WHERE status IN ('empty','done','cancelled') AND finished_at<now()-interval '7 days' AND planned_at IS NULL");
    });
  }
  async pause(){
    await atomic(async db=>{
      await db.query('UPDATE browser_settings SET enabled=false,revision=revision+1 WHERE id=true');
      await db.query("UPDATE browser_commands SET status='cancelled',message='Rotina pausada antes da execução.',finished_at=now() WHERE status='pending' AND origin='schedule'");
    });
    await event('info','Novos envios automáticos do TikTok navegador pausados.');
  }
  async stop(){
    await atomic(async db=>{
      await db.query('UPDATE browser_settings SET enabled=false,revision=revision+1 WHERE id=true');
      const {rows:pending}=await db.query("UPDATE deliveries SET status='cancelled',error=NULL,retry_at=NULL,updated_at=now() WHERE id IN (SELECT delivery_id FROM browser_commands WHERE status='pending') AND status IN ('pending','retry') AND upload_started_at IS NULL RETURNING id");
      for(const row of pending)await db.query('DELETE FROM content_claims WHERE delivery_id=$1',[row.id]);
      await db.query(`UPDATE browser_commands SET status=CASE WHEN status='pending' THEN 'cancelled' ELSE 'cancel_requested' END,progress_at=now(),
        message='Interrupção solicitada pelo painel.',finished_at=CASE WHEN status='pending' THEN now() ELSE NULL END WHERE status=ANY($1::text[])`,[ACTIVE]);
    });
    await event('warning','Interrupção do navegador solicitada. Envios já iniciados precisam ser conferidos no TikTok.');
  }
  async cancel(id:string){
    const {rows:[job]}=await pool.query('SELECT delivery_id FROM browser_commands WHERE id=$1',[id]);
    if(!job)throw new AppError('Tarefa não encontrada.',404);
    if(job.delivery_id)return cancelDelivery(job.delivery_id);
    return atomic(async db=>{
      await recover(db);
      const {rows:[row]}=await db.query(`UPDATE browser_commands SET status=CASE WHEN status='pending' THEN 'cancelled' ELSE 'cancel_requested' END,
        message='Cancelamento desta tarefa solicitado.',progress_at=now(),finished_at=CASE WHEN status='pending' THEN now() ELSE NULL END
        WHERE id=$1 AND status=ANY($2::text[]) RETURNING status`,[id,ACTIVE]);
      if(!row)throw new AppError('Esta tarefa já terminou. Atualize o histórico para conferir o resultado.',409);
      return {status:row.status};
    });
  }
  async retry(id:string){
    await requireTikTokBrowserToken();
    const {rows:[job]}=await pool.query('SELECT * FROM browser_commands WHERE id=$1',[id]);
    if(!job)throw new AppError('Tarefa não encontrada.',404);
    if(job.delivery_id){await retryDelivery(job.delivery_id);return;}
    await atomic(async db=>{
      await recover(db);
      const {rows:[current]}=await db.query('SELECT * FROM browser_commands WHERE id=$1 FOR UPDATE',[id]);
      if(current.status!=='failed'||current.upload_started)throw new AppError('Somente falhas anteriores ao upload podem ser repetidas. Confira o TikTok Studio.',409);
      if(await busy(db))throw new AppError('Há outra tarefa em andamento. Aguarde ou cancele essa tarefa antes de repetir.',409);
      if(current.config.revision!==(await configuration(db)).revision)throw new AppError('A rotina mudou. Use Enviar próximo agora com a configuração atual.',409);
      // Reuse the original command exactly once, retaining its account and consent.
      const plannedAt=current.kind==='upload'&&current.config.mode==='native_schedule'?
        planNativeDate('tiktok',{...current.config,interval_minutes:current.config.intervalMinutes},current.config.nativeSchedule,await calendar(db,current.config.profileId)):null;
      if(current.kind==='upload'&&current.config.mode==='native_schedule'&&!plannedAt)throw new AppError('Sem data disponível nos limites autorizados. Revise o período da rotina.',409);
      await db.query("UPDATE browser_commands SET status='pending',phase='queued',message='Nova tentativa solicitada. Aguardando o agente.',planned_at=$2,agent_instance=NULL,lease_until=NULL,started_at=NULL,finished_at=NULL,progress_at=now() WHERE id=$1",[id,plannedAt]);
    });
  }
  async poll(body:unknown){
    const input=z.object({instanceId:z.string().uuid(),profileSaved:z.boolean(),externalBusy:z.boolean(),desktop:z.boolean(),activeJobId:z.string().uuid().nullable(),profiles:z.record(z.string().max(40),z.object({profileSaved:z.boolean(),externalBusy:z.boolean()}).strict()).optional()}).strict().parse(body);
    const paused=await getSetting<boolean>('paused');
    return atomic(async db=>{
      await recover(db);
      const {rows:[previous]}=await db.query('SELECT * FROM browser_agent WHERE id=true');
      if(online(previous)&&previous.instance_id!==input.instanceId)throw new AppError('Outro agente já está conectado a esta instalação.',409);
      await db.query(`INSERT INTO browser_agent(id,instance_id,profile_saved,external_busy,desktop,profiles) VALUES(true,$1,$2,$3,$4,$5)
        ON CONFLICT(id) DO UPDATE SET instance_id=EXCLUDED.instance_id,last_seen=now(),profile_saved=EXCLUDED.profile_saved,external_busy=EXCLUDED.external_busy,desktop=EXCLUDED.desktop,profiles=EXCLUDED.profiles`,
        [input.instanceId,input.profileSaved,input.externalBusy,input.desktop,JSON.stringify(input.profiles||{})]);
      if(input.activeJobId){
        const {rows:[job]}=await db.query(`UPDATE browser_commands SET lease_until=now()+interval '20 seconds'
          WHERE id=$1 AND agent_instance=$2 AND status IN ('running','cancel_requested') AND lease_until>now() RETURNING status`,[input.activeJobId,input.instanceId]);
        return {job:null,cancel:!job||job.status==='cancel_requested'};
      }
      if(!(await playwrightMcpState()).configured)return {job:null,cancel:false};
      if(!input.desktop||(await db.query("SELECT id FROM browser_commands WHERE status IN ('running','cancel_requested') LIMIT 1")).rowCount)return {job:null,cancel:false};
      const {rows:[job]}=await db.query(`SELECT * FROM browser_commands WHERE status='pending' ${paused?"AND kind='login'":''} ORDER BY created_at LIMIT 1 FOR UPDATE`);
      if(!job)return {job:null,cancel:false};
      if(job.request_id&&!(await db.query("SELECT id FROM publication_requests WHERE id=$1 AND status='active'",[job.request_id])).rowCount){await db.query("UPDATE browser_commands SET status='cancelled',finished_at=now() WHERE id=$1",[job.id]);return {job:null,cancel:false};}
      if(job.request_id&&job.kind==='upload'){const {rows:[r]}=await db.query('SELECT config FROM publication_requests WHERE id=$1',[job.request_id]);if(!r||!validScheduleDate('tiktok',new Date(job.planned_at),r.config.policy)){await db.query("UPDATE browser_commands SET status='cancelled',phase='stale_schedule',message='A data reservada venceu antes do upload.',finished_at=now() WHERE id=$1",[job.id]);return {job:null,cancel:false};}const reservations=await accountCalendar('browser:tiktok:'+(job.config.profileId||'default'),db);if(!uploadBudgetAvailable(r.config.policy,reservations)||!reservedCapacityAllowed(new Date(job.planned_at),r.config.cadence,r.config.policy,reservations)){await db.query("UPDATE browser_commands SET status='cancelled',phase='capacity_wait',message='Aguardando limite da conta; o vídeo permanece na fila.',finished_at=now() WHERE id=$1",[job.id]);return {job:null,cancel:false};}}
      const profileId=job.config.profileId||'default',profile=input.profiles?.[profileId]||(profileId==='default'?input:null);
      if(!profile||profile.externalBusy||(job.kind==='upload'&&!profile.profileSaved))return {job:null,cancel:false};
      if(job.kind==='upload'&&!job.request_id&&!job.config.requestManaged&&(await db.query('SELECT id FROM browser_settings WHERE blocked_until>now()')).rowCount)return {job:null,cancel:false};
      if(job.kind==='upload'&&job.config.publishNow) {
        const policy=(await configuration(db)).nativeSchedule,reservations=await accountCalendar('browser:tiktok:'+profileId,db,job.delivery_id);
        const cooldown=await getSetting<string>('uploadCooldown:browser:tiktok:'+profileId);
        if((cooldown&&Date.parse(cooldown)>Date.now())||!uploadBudgetAvailable(policy,reservations))return {job:null,cancel:false};
        if(!reservedCapacityAllowed(new Date(),{cadence:'interval',interval_minutes:1,times:['08:00'],timezone:'America/Sao_Paulo'},{...policy,maxScheduled:Number.MAX_SAFE_INTEGER,externalScheduled:0},[...reservations,{plannedAt:new Date()}]))return {job:null,cancel:false};
        if(job.delivery_id)await db.query('UPDATE deliveries SET planned_at=now() WHERE id=$1',[job.delivery_id]);
      }
      if(job.kind==='upload'&&job.config.mode==='native_schedule'&&!job.request_id) {
        const current=await configuration(db);
        if(current.revision!==job.config.revision||!validScheduleDate('tiktok',new Date(job.planned_at),current.nativeSchedule)) {
          await db.query("UPDATE browser_commands SET status='cancelled',message='Data ou configuração saiu da janela autorizada.',finished_at=now() WHERE id=$1",[job.id]);
          return {job:null,cancel:false};
        }
        if(!uploadBudgetAvailable(current.nativeSchedule,await calendar(db)))return {job:null,cancel:false};
      }
      await db.query("UPDATE browser_commands SET status='running',phase='opening',message='Abrindo o navegador no computador.',agent_instance=$2,lease_until=now()+interval '20 seconds',started_at=now(),progress_at=now() WHERE id=$1",[job.id,input.instanceId]);
      return {job:{id:job.id,kind:job.kind,folder:job.config.folder,...(job.config.profileId?{profileId:job.config.profileId}:{}),...(job.config.media?{media:job.config.media}:{}),stripMetadata:job.config.stripMetadata,...(job.config.sourceType==='gta6_pack'?{sourceType:'gta6_pack',packDefaults:job.config.packDefaults}:{}),...(job.planned_at?{publishAt:job.planned_at.toISOString()}: {}),...(job.config.publishNow?{publishNow:true}: {})},cancel:false};
    });
  }
  async enqueueDelivery(delivery:any,profileId:string,config:Config) {
    if(!(await playwrightMcpState()).configured)return;
    return atomic(async db=>{
      const existing=await db.query("SELECT id FROM browser_commands WHERE delivery_id=$1 AND (status NOT IN ('cancelled','failed') OR upload_started)",[delivery.id]);if(existing.rowCount)return existing.rows[0].id;
      const {rows:[agent]}=await db.query('SELECT * FROM browser_agent WHERE id=true');
      const profile=agent?.profiles?.[profileId]||(profileId==='default'?{profileSaved:agent?.profile_saved,externalBusy:agent?.external_busy}:null);
      const waiting=async(message:string)=>{if(config.publishNow)await db.query("UPDATE deliveries SET error=$2 WHERE id=$1 AND status='pending'",[delivery.id,message]);};
      if(!online(agent)||!agent.desktop){await waiting('Aguardando o agente conectado com uma sessão gráfica aberta.');return;}
      if(!profile?.profileSaved){await waiting('Abra o login do perfil TikTok escolhido em Conexões e conclua a autenticação.');return;}
      if(profile.externalBusy||await busy(db)){await waiting('Aguardando a conclusão da tarefa ou janela aberta no Chrome.');return;}
      // Keep quota-blocked media in the delivery queue instead of holding the
      // single desktop agent and preventing login/uploads for other profiles.
      if(!uploadBudgetAvailable(config.nativeSchedule,await accountCalendar('browser:tiktok:'+profileId,db))){await waiting('Aguardando capacidade no limite de uploads desta conta.');return;}
      if(config.publishNow){
        const cooldown=await getSetting<string>('uploadCooldown:browser:tiktok:'+profileId),reservations=await accountCalendar('browser:tiktok:'+profileId,db,delivery.id);
        if(cooldown&&Date.parse(cooldown)>Date.now()){await waiting('Aguardando o prazo de nova tentativa informado pelo TikTok.');return;}
        if(!reservedCapacityAllowed(new Date(),{cadence:'interval',interval_minutes:1,times:['08:00'],timezone:'America/Sao_Paulo'},
          {...config.nativeSchedule,maxScheduled:Number.MAX_SAFE_INTEGER,externalScheduled:0},[...reservations,{plannedAt:new Date()}])){await waiting('Aguardando capacidade no limite diário desta conta.');return;}
      }
      const media={metadata:delivery.payload.metadata,assetSha256:delivery.payload.assetSha256,hash:delivery.original_hash,name:delivery.name,sourceId:delivery.file_id};
      if(config.publishNow){
        const {rows:[current]}=await db.query('SELECT status,approved_at,payload,integration_id FROM deliveries WHERE id=$1 FOR UPDATE',[delivery.id]);
        if(!current||current.status!=='pending'||!current.approved_at||!current.payload.publishNow)return;
        if(current.integration_id!=='browser:tiktok:'+profileId||!(await db.query('SELECT id FROM browser_profiles WHERE id=$1',[profileId])).rowCount)return;
        if(delivery.request_id||config.mode!=='review'||delivery.payload.nativeSchedule||!delivery.approved_at)throw new AppError('Publicação imediata exige uma única entrega aprovada, sem agendamento.');
      }
      const id=randomUUID();
      await db.query(`INSERT INTO browser_commands(id,kind,origin,config,planned_at,request_id,delivery_id,message,filename)
        VALUES($1,'upload',$6,$2,$3,$4,$5,$7,$8)`,
        [id,JSON.stringify({...config,profileId,requestManaged:true,media}),config.publishNow?null:delivery.planned_at,delivery.request_id,delivery.id,
          config.publishNow?'manual':'schedule',config.publishNow?'Aguardando o agente para postar agora na conta selecionada.':'Aguardando o agente para agendar na conta selecionada.',delivery.name]);
      if(config.publishNow)await db.query('UPDATE deliveries SET error=NULL WHERE id=$1',[delivery.id]);
      return id;
    });
  }
  async progress(id:string,body:unknown){
    const input=z.object({instanceId:z.string().uuid(),stage:z.enum(Object.keys(stages) as [string,...string[]]),filename:z.string().max(255).optional(),hash:z.string().regex(/^[a-f0-9]{64}$/).optional(),uploadStarted:z.boolean().optional()}).strict().parse(body);
    const result=await pool.query(`UPDATE browser_commands SET phase=$3,message=$4,progress_at=now(),filename=COALESCE($5,filename),hash=COALESCE($6,hash),
      upload_started=upload_started OR $3='browser_upload_started' OR $7 WHERE id=$1 AND agent_instance=$2 AND status IN ('running','cancel_requested') AND lease_until>now()`,
      [id,input.instanceId,input.stage,stages[input.stage],input.filename||null,input.hash||null,!!input.uploadStarted]);
    if(!result.rowCount)throw new AppError('A tarefa não está mais sob controle deste agente.',409);
    if(input.stage==='browser_upload_started'||input.uploadStarted)await pool.query("UPDATE deliveries SET status='submitting',upload_started_at=COALESCE(upload_started_at,now()) WHERE id=(SELECT delivery_id FROM browser_commands WHERE id=$1) AND status IN ('pending','submitting')",[id]);
    // A live agent heartbeat must not keep a reported Playwright failure running.
    if(browserFailureStages.has(input.stage))await this.finish(id,{instanceId:input.instanceId,result:'failed'});
  }
  async finish(id:string,body:unknown){
    const input=z.object({instanceId:z.string().uuid(),result:z.enum(['done','review','scheduled','published','empty','failed','unknown','cancelled','duplicate'])}).strict().parse(body);
    const status=await atomic(async db=>{
      const {rows:[job]}=await db.query('SELECT * FROM browser_commands WHERE id=$1 AND agent_instance=$2 FOR UPDATE',[id,input.instanceId]);
      if(!job)throw new AppError('Tarefa não encontrada para este agente.',404);
      if(!['running','cancel_requested'].includes(job.status))return job.status;
      if(new Date(job.lease_until).getTime()<Date.now())throw new AppError('A confirmação chegou após perder o controle da tarefa.',409);
      if(job.kind==='login'&&!['done','failed','cancelled'].includes(input.result))throw new AppError('Resultado incompatível com login.');
      if(job.kind==='upload'&&input.result==='done')throw new AppError('Preparar upload não comprova publicação.');
      if((job.config.mode==='native_schedule'||job.config.publishNow)&&input.result==='review')throw new AppError('Este envio exige confirmação da publicação ou do agendamento no TikTok.');
      if(input.result==='scheduled'&&(job.config.mode!=='native_schedule'||job.phase!=='browser_scheduled'||!job.upload_started))throw new AppError('O TikTok não confirmou este agendamento.');
      if(input.result==='published'&&(!job.config.publishNow||job.phase!=='browser_published'||!job.upload_started))throw new AppError('O TikTok não confirmou esta publicação imediata.');
      if(input.result==='duplicate'&&job.upload_started)throw new AppError('Um upload iniciado não pode ser descartado como duplicado.');
      const status=job.upload_started&&['failed','cancelled'].includes(input.result)?'unknown':input.result==='published'?'completed':input.result;
      const message=status==='completed'?stages.browser_published:status==='scheduled'?stages.browser_scheduled:status==='review'?stages.browser_review_required:status==='empty'?(job.config.sourceType==='gta6_pack'?'Nenhum vídeo novo elegível no pack. A origem será consultada novamente.':stages.browser_no_video):
        status==='done'?'Janela de login encerrada. Confira a conta no próximo envio.':status==='cancelled'?'Tarefa interrompida antes do envio.':
        status==='unknown'?`${job.message||'A execução foi interrompida.'} O upload pode ter começado. Confira o TikTok Studio antes de repetir.`:
        status==='failed'?`${job.message||'A preparação falhou.'} O upload não começou. Corrija a pendência e tente novamente.`:job.message;
      await db.query('UPDATE browser_commands SET status=$2,message=$3,finished_at=now(),lease_until=NULL WHERE id=$1',[id,status,message]);
      if(job.delivery_id)await db.query(`UPDATE deliveries SET status=$2,error=$3,updated_at=now() WHERE id=$1`,[job.delivery_id,status==='scheduled'?'scheduled':status==='duplicate'?'duplicate':status==='empty'?'failed':status,['scheduled','completed','duplicate'].includes(status)?null:message]);
      if(job.delivery_id&&status==='cancelled')await db.query('DELETE FROM content_claims WHERE delivery_id=$1',[job.delivery_id]);
      if(job.request_id&&status==='unknown')await db.query(`INSERT INTO manual_actions(id,request_id,kind,message) VALUES($1,$2,'unknown_upload','Confira o envio no TikTok Studio antes de continuar; a publicação pode ter sido iniciada.')
        ON CONFLICT(request_id,kind) DO UPDATE SET resolved_at=NULL,message=EXCLUDED.message`,[randomUUID(),job.request_id]);
      await advance(db,{...job,status},status==='empty');
      if(job.phase==='platform_limit'){await setSetting('uploadCooldown:browser:tiktok:'+(job.config.profileId||'default'),new Date(Date.now()+86400_000).toISOString());if(!job.request_id&&!job.config.requestManaged)await db.query("UPDATE browser_settings SET blocked_until=now()+interval '24 hours' WHERE id=true");}
      return status;
    });
    if(['scheduled','completed','duplicate','cancelled'].includes(status)){const {rows:[row]}=await pool.query('SELECT delivery_id FROM browser_commands WHERE id=$1',[id]);if(row?.delivery_id)await cleanupPublishedMedia(row.delivery_id);}
    if(status!=='empty')await event(status==='unknown'||status==='failed'?'warning':'info',status==='completed'?'Vídeo publicado no TikTok.':status==='scheduled'?'Vídeo agendado no TikTok para a data reservada.':status==='review'?'Vídeo preparado no navegador; publicação final depende da revisão no Chrome.':status==='done'?'Janela de login do TikTok encerrada.':status==='cancelled'?'Tarefa do navegador interrompida.':'A tarefa do navegador requer conferência.');
    return status;
  }
}

export const browserBridge=new BrowserBridge();
export const browserRoutes=Router();
browserRoutes.use(browserPublicationRoutes);
browserRoutes.get('/api/browser/jobs',async(req,res)=>res.json(await browserBridge.jobs(parsePagination(req.query,{scope:'browser'}))));
browserRoutes.post('/api/browser/config',async(req,res)=>res.json({ok:true,config:await browserBridge.save(req.body)}));
browserRoutes.post('/api/browser/login',async(_req,res)=>res.status(202).json({id:await browserBridge.request('login')}));
browserRoutes.post('/api/browser/run',async(_req,res)=>res.status(202).json({id:await browserBridge.request('upload')}));
browserRoutes.post('/api/browser/pause',async(_req,res)=>{await browserBridge.pause();res.json({ok:true});});
browserRoutes.post('/api/browser/stop',async(_req,res)=>{await browserBridge.stop();res.json({ok:true});});
browserRoutes.post('/api/browser/jobs/:id/retry',async(req,res)=>{await browserBridge.retry(z.string().uuid().parse(req.params.id));res.json({ok:true});});
browserRoutes.post('/api/browser/jobs/:id/cancel',async(req,res)=>{res.json({ok:true,...await browserBridge.cancel(z.string().uuid().parse(req.params.id))});});
browserRoutes.use('/api/browser-agent',(req,res,next)=>{
  if(!browserAgentAuthorized(req.get('authorization')))return void res.status(401).json({error:'Agente não autorizado.'});next();
});
browserRoutes.post('/api/browser-agent/poll',async(req,res)=>res.json(await browserBridge.poll(req.body)));
browserRoutes.post('/api/browser-agent/jobs/:id/progress',async(req,res)=>{await browserBridge.progress(z.string().uuid().parse(req.params.id),req.body);res.json({ok:true});});
browserRoutes.post('/api/browser-agent/jobs/:id/finish',async(req,res)=>res.json({ok:true,status:await browserBridge.finish(z.string().uuid().parse(req.params.id),req.body)}));

browserRoutes.post('/api/browser/profiles',async(req,res)=>{
  await requireTikTokBrowserToken();
  const {name}=z.object({name:z.string().trim().min(1).max(100)}).parse(req.body);const id=randomUUID();
  await pool.query('INSERT INTO browser_profiles(id,name) VALUES($1,$2)',[id,name]);res.status(201).json({id,name});
});
browserRoutes.post('/api/browser/profiles/:id/login',async(req,res)=>res.status(202).json({id:await browserBridge.request('login',z.union([z.literal('default'),z.string().uuid()]).parse(req.params.id))}));
browserRoutes.post('/api/browser-agent/profiles',async(_req,res)=>res.json((await pool.query('SELECT id FROM browser_profiles ORDER BY created_at')).rows));
browserRoutes.get('/api/browser-agent/jobs/:id/media',async(req,res)=>{
  const id=z.string().uuid().parse(req.params.id);
  const {rows:[row]}=await pool.query(`SELECT d.local_file FROM browser_commands b JOIN deliveries d ON d.id=b.delivery_id
    WHERE b.id=$1 AND b.status='running' AND b.lease_until>now()`,[id]);
  if(!row?.local_file||!/^[-a-f0-9]+\.native\.mp4$/.test(row.local_file))throw new AppError('Cópia de mídia indisponível.',404);
  res.setHeader('Cache-Control','no-store');res.sendFile(row.local_file,{root:dataDir});
});
