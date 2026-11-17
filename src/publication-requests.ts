import {Router} from 'express';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {DateTime} from 'luxon';
import {rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pool,getSetting,event,type Watch} from './db.js';
import {AppError,localMediaHostDir,dataDir} from './config.js';
import {folderId,metadataSchema} from './domain.js';
import {LocalFiles} from './local.js';
import {PACK_ROOT,PACK_URL,packDefaultsSchema,packYoutubeSynthetic} from './pack-config.js';
import {nativeChannels,publisherEngine} from './native-auth.js';
import {nativeScheduleSchema,planNativeDate,uploadBudgetAvailable,validScheduleDate} from './native-schedule.js';
import {browserBridge,browserConfigSchema} from './browser-bridge.js';
import type {LocalPublisher} from './local-publisher.js';
import {saveTitleReviews} from './video-titles.js';
import {cursorFields,keysetClause,pageLimit,paginateRows,parsePagination,type PageOptions} from './pagination.js';

const uuid=z.string().uuid(),profileId=z.union([z.literal('default'),uuid]);
const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const profileSchema=z.object({name:z.string().trim().min(1).max(100),sourceType:z.enum(['gta6_pack','google_drive','local']).nullable().default(null),
  folderUrls:z.array(z.string().max(1000)).max(10).default([]),localPath:z.string().max(4096).default(''),
  youtubeId:z.string().regex(/^native:youtube:[\w-]{6,200}$/).nullable().default(null),tiktokProfileId:profileId.nullable().default(null),
  packDefaults:packDefaultsSchema.optional()}).strict();
const requestSchema=z.object({profileId:uuid,platforms:z.array(z.enum(['youtube','tiktok'])).min(1).max(2),quantity:z.number().int().min(1).max(10000),
  times:z.array(time).min(1).max(24),timezone:z.string().refine(v=>DateTime.now().setZone(v).isValid,'Fuso inválido').default('America/Sao_Paulo'),
  policy:nativeScheduleSchema.prefault({}),requestKey:z.string().min(8).max(200)}).strict();

async function manual(requestId:string,kind:string,message:string,href='/#requests') {
  await pool.query("UPDATE manual_actions SET resolved_at=now() WHERE request_id=$1 AND kind<>$2 AND kind NOT IN ('unknown_upload','delivery_review','youtube_titles') AND resolved_at IS NULL",[requestId,kind]);
  await pool.query(`INSERT INTO manual_actions(id,request_id,kind,message,href) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(request_id,kind) DO UPDATE SET message=EXCLUDED.message,href=EXCLUDED.href,resolved_at=NULL
    WHERE (manual_actions.message,manual_actions.href,manual_actions.resolved_at) IS DISTINCT FROM (EXCLUDED.message,EXCLUDED.href,NULL::timestamptz)`,[randomUUID(),requestId,kind,message,href]);
  await pool.query("UPDATE publication_requests SET status='waiting_manual',message=$2,updated_at=now() WHERE id=$1 AND status<>'cancelled' AND (status,message) IS DISTINCT FROM ('waiting_manual',$2::text)",[requestId,message]);
}
type Counts={confirmed:number;reserved:number;unknown:number;attention:number};
const emptyCounts=():Counts=>({confirmed:0,reserved:0,unknown:0,attention:0});
async function countsMany(ids:string[]):Promise<Map<string,Counts>> {
  if(!ids.length)return new Map();
  const {rows}=await pool.query(`SELECT request_id,count(*) FILTER(WHERE status IN ('scheduled','published'))::int AS confirmed,
    count(*) FILTER(WHERE status IN ('review','pending','retry','submitting','processing','unknown','private','unlisted','inbox','completed'))::int AS reserved,
    count(*) FILTER(WHERE status='unknown')::int AS unknown,
    count(*) FILTER(WHERE status IN ('failed','review','private','unlisted','inbox','completed'))::int AS attention FROM deliveries WHERE request_id=ANY($1::uuid[]) GROUP BY request_id`,[ids]);
  return new Map(rows.map(row=>[row.request_id,row]));
}
async function counts(id:string){return (await countsMany([id])).get(id)||emptyCounts();}
export class PublicationRequests {
  async context(pages:{requests?:PageOptions;actions?:PageOptions}={}) {
    const requestPage=pages.requests||parsePagination({},{scope:'requests'}),actionPage=pages.actions||parsePagination({},{scope:'actions'});
    const requestValues:unknown[]=[],actionValues:unknown[]=[];
    const requestFilter=keysetClause(requestPage,'r.created_at','r.id',requestValues),requestLimit=pageLimit(requestPage,requestValues);
    const actionFilter=keysetClause(actionPage,'a.created_at','a.id',actionValues),actionLimit=pageLimit(actionPage,actionValues);
    const [profiles,accounts,browsers,agent,requests,actions,actionCount]=await Promise.all([
      pool.query(`SELECT p.*,w.source_type,w.folder_url,w.source_roots,w.pack_defaults,w.metadata_defaults FROM publishing_profiles p LEFT JOIN watches w ON w.id=p.watch_id ORDER BY p.created_at`),nativeChannels(),
      pool.query('SELECT id,name FROM browser_profiles ORDER BY created_at'),pool.query('SELECT * FROM browser_agent WHERE id=true'),
      pool.query(`SELECT r.*,p.name AS profile_name,${cursorFields('r.created_at','r.id')} FROM publication_requests r JOIN publishing_profiles p ON p.id=r.profile_id
        WHERE true${requestFilter} ORDER BY r.created_at DESC,r.id DESC${requestLimit}`,requestValues),
      pool.query(`SELECT a.*,p.name AS profile_name,r.provider,${cursorFields('a.created_at','a.id')} FROM manual_actions a JOIN publication_requests r ON r.id=a.request_id JOIN publishing_profiles p ON p.id=r.profile_id
        WHERE a.resolved_at IS NULL${actionFilter} ORDER BY a.created_at DESC,a.id DESC${actionLimit}`,actionValues),
      pool.query('SELECT count(*)::int AS count FROM manual_actions WHERE resolved_at IS NULL')]);
    const report=agent.rows[0];
    const requestResult=paginateRows(requests.rows,requestPage),actionResult=paginateRows(actions.rows,actionPage);
    const totals=await countsMany(requestResult.items.map(r=>r.id));
    const jobs=requestResult.items.map(row=>{const n=totals.get(row.id)||emptyCounts();return {...row,...n,waiting:Math.max(0,row.quantity-n.confirmed-n.reserved)};});
    return {profiles:profiles.rows,accounts,browserProfiles:browsers.rows.map(p=>({...p,...(report?.profiles?.[p.id]||(p.id==='default'?{profileSaved:report?.profile_saved,externalBusy:report?.external_busy}:{}))})),
      agentOnline:!!report&&new Date(report.last_seen).getTime()>Date.now()-20_000,googleConnected:!!(await getSetting<any>('googleTokens'))?.refresh_token,
      requests:jobs,actions:actionResult.items,summary:{actionCount:actionCount.rows[0].count},
      pagination:{requests:requestResult.pagination,actions:actionResult.pagination}};
  }
  async saveProfile(body:unknown,id:string=randomUUID()) {
    const input=profileSchema.parse(body);
    if(input.tiktokProfileId&&!(await pool.query('SELECT id FROM browser_profiles WHERE id=$1',[input.tiktokProfileId])).rowCount)throw new AppError('Perfil TikTok não encontrado.');
    if(input.youtubeId&&!(await nativeChannels()).some(c=>c.id===input.youtubeId&&!c.disabled))throw new AppError('Conecte o canal YouTube selecionado.');
    const defaults=packDefaultsSchema.parse(input.packDefaults||(input.sourceType==='gta6_pack'?{}:{titlePrefix:input.name,hashtags:[],madeWithAI:true}));
    const roots=input.folderUrls.map(folderId);
    let folder:string|null=null,path='';
    if(input.sourceType==='gta6_pack'){folder=PACK_ROOT;path=PACK_URL;}
    if(input.sourceType==='google_drive'){if(!roots.length)throw new AppError('Informe ao menos uma pasta do Drive.');folder=roots[0];path=input.folderUrls[0];}
    if(input.sourceType==='local'){const local=await new LocalFiles().folder(input.localPath);folder=local.id;path=local.hostPath;}
    const db=await pool.connect();
    try {
      await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(74839202)');
      const {rows:[old]}=await db.query('SELECT * FROM publishing_profiles WHERE id=$1 FOR UPDATE',[id]);
      let watchId=old?.watch_id||null;
      if(watchId) {
        const {rows:[w]}=await db.query('SELECT * FROM watches WHERE id=$1',[watchId]);
        if(w.source_type!==input.sourceType||w.folder_id!==folder||JSON.stringify(w.source_roots)!==JSON.stringify(roots))throw new AppError('Para trocar a origem, crie outro perfil. Isso preserva o histórico e evita misturar os acervos.');
      }
      if(folder&&!watchId) {
        watchId=randomUUID();
        const metadata=metadataSchema.parse({title:defaults.titlePrefix||input.name,description:defaults.description,hashtags:defaults.hashtags,
          youtube:{visibility:defaults.youtubeVisibility,madeForKids:defaults.madeForKids,containsSyntheticMedia:packYoutubeSynthetic(defaults)},tiktok:{privacyLevel:'PUBLIC_TO_EVERYONE',madeWithAI:defaults.madeWithAI}});
        await db.query(`INSERT INTO watches(id,name,folder_id,folder_url,source_type,profile_id,controlled_by_requests,enabled,import_existing,require_metadata,mode,source_roots,pack_defaults,metadata_defaults)
          VALUES($1,$2,$3,$4,$5,$6,true,false,true,false,'native_schedule',$7,$8,$9)`,[watchId,input.name,folder,path,input.sourceType,id,JSON.stringify(roots),JSON.stringify(defaults),JSON.stringify(metadata)]);
      }
      if(watchId)await db.query('UPDATE watches SET pack_defaults=$2,metadata_defaults=$3,next_scan_at=now() WHERE id=$1',[watchId,JSON.stringify(defaults),JSON.stringify(metadataSchema.parse({title:defaults.titlePrefix||input.name,description:defaults.description,hashtags:defaults.hashtags,youtube:{visibility:defaults.youtubeVisibility,madeForKids:defaults.madeForKids,containsSyntheticMedia:packYoutubeSynthetic(defaults)},tiktok:{privacyLevel:"PUBLIC_TO_EVERYONE",madeWithAI:defaults.madeWithAI}}))]);
      await db.query(`INSERT INTO publishing_profiles(id,name,watch_id,youtube_id,tiktok_profile_id) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,watch_id=EXCLUDED.watch_id,youtube_id=EXCLUDED.youtube_id,tiktok_profile_id=EXCLUDED.tiktok_profile_id`,[id,input.name,watchId,input.youtubeId,input.tiktokProfileId]);
      await db.query('COMMIT');return {id};
    }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
  }
  async create(body:unknown) {
    const input=requestSchema.parse(body),platforms=[...new Set(input.platforms)].sort();
    const config={cadence:{cadence:'daily',interval_minutes:720,times:[...new Set(input.times)].sort(),timezone:input.timezone},policy:input.policy};
    const fingerprint=createHash('sha256').update(JSON.stringify({profileId:input.profileId,quantity:input.quantity,platforms,config})).digest('hex');
    const db=await pool.connect();
    try {
      await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(74839202)');
      const existing=await db.query('SELECT * FROM publication_requests WHERE request_key=$1 ORDER BY provider',[input.requestKey]);
      if(existing.rowCount){if(existing.rows[0].config.fingerprint!==fingerprint)throw new AppError('A chave deste pedido já foi usada com outros parâmetros.',409);await db.query('COMMIT');return {requests:existing.rows.map(r=>({id:r.id,provider:r.provider})),reused:true};}
      const {rows:[profile]}=await db.query('SELECT * FROM publishing_profiles WHERE id=$1',[input.profileId]);if(!profile)throw new AppError('Perfil não encontrado.',404);
      const requests=[];
      for(const provider of platforms) {
        const id=randomUUID();await db.query('INSERT INTO publication_requests(id,request_key,profile_id,provider,quantity,config) VALUES($1,$2,$3,$4,$5,$6)',[id,input.requestKey,input.profileId,provider,input.quantity,JSON.stringify({...config,fingerprint})]);requests.push({id,provider});
      }
      await db.query('COMMIT');return {requests,reused:false};
    }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
  }
  async tick(publisher:LocalPublisher) {
    const {rows}=await pool.query(`SELECT r.*,p.name,p.watch_id,p.youtube_id,p.tiktok_profile_id FROM publication_requests r JOIN publishing_profiles p ON p.id=r.profile_id
      WHERE r.status IN ('active','waiting_manual') OR (r.status='completed' AND EXISTS(SELECT 1 FROM deliveries d WHERE d.request_id=r.id AND d.status IN ('failed','unknown'))) ORDER BY r.created_at`);
    const totals=await countsMany(rows.map(r=>r.id));
    let channels:Awaited<ReturnType<typeof nativeChannels>>|undefined;
    for(const r of rows) {
      if(r.status==='waiting_manual'&&(await pool.query("SELECT id FROM manual_actions WHERE request_id=$1 AND kind='title_review' AND resolved_at IS NULL LIMIT 1",[r.id])).rowCount)continue;
      const n=totals.get(r.id)||emptyCounts();
      if(n.confirmed>=r.quantity){await pool.query("UPDATE publication_requests SET status='completed',message='Quantidade solicitada confirmada no agendador.',updated_at=now() WHERE id=$1 AND status<>'completed'",[r.id]);await pool.query("UPDATE manual_actions SET resolved_at=now() WHERE request_id=$1 AND resolved_at IS NULL AND kind<>'youtube_titles'",[r.id]);continue;}
      if(n.unknown){const {rows:[unknown]}=await pool.query("SELECT v.name FROM deliveries d JOIN videos v ON v.id=d.video_id WHERE d.request_id=$1 AND d.status='unknown' ORDER BY d.created_at LIMIT 1",[r.id]);await manual(r.id,'unknown_upload',`O envio de ${unknown?.name||'um vídeo'} ficou sem confirmação. Confira a conta antes de continuar.`);continue;}
      if(n.attention){const {rows:[problem]}=await pool.query("SELECT error FROM deliveries WHERE request_id=$1 AND status IN ('failed','review','private','unlisted','inbox','completed') ORDER BY updated_at LIMIT 1",[r.id]);await manual(r.id,'delivery_review',problem?.error||'Há um vídeo que exige revisão ou cuja data não foi confirmada. Confira o histórico.','/#history');continue;}
      if(!r.watch_id){await manual(r.id,'source','Defina a origem dos vídeos deste perfil.');continue;}
      const {rows:[watch]}=await pool.query<Watch>('SELECT * FROM watches WHERE id=$1',[r.watch_id]);
      if(watch.last_error){await manual(r.id,'source_access',watch.last_error,'/#connections');continue;}
      if(watch.source_type==='google_drive'&&!(await getSetting<any>('googleTokens'))?.refresh_token){await manual(r.id,'drive_login','Autorize o Google Drive em Conexões para ler as pastas bíblicas.','/#connections');continue;}
      if(await publisherEngine()!=='local'){await manual(r.id,'engine','Selecione o motor local para os pedidos de agendamento.','/#connections');continue;}
      let integrationId:string,channelName:string;
      if(r.provider==='youtube') {
        channels??=await nativeChannels();
        const channel=channels.find(c=>c.id===(r.config.target?.integrationId||r.youtube_id)&&!c.disabled);
        if(!channel){await manual(r.id,'account','Crie/conecte o canal YouTube e vincule-o a este perfil.','/#connections');continue;}
        if(!channel.autoPublishApproved){await manual(r.id,'approval','Autorize os envios automáticos desta conta YouTube em Conexões.','/#connections');continue;}
        integrationId=channel.id;channelName=channel.name;
      } else {
        const browserId=r.config.target?.tiktokProfileId||r.tiktok_profile_id;
        if(!browserId){await manual(r.id,'account','Adicione um perfil TikTok, faça login e vincule-o a este perfil.');continue;}
        const {rows:[agent]}=await pool.query('SELECT * FROM browser_agent WHERE id=true');
        const profile=agent?.profiles?.[browserId]||(browserId==='default'?{profileSaved:agent?.profile_saved,externalBusy:agent?.external_busy}:null);
        if(!agent||new Date(agent.last_seen).getTime()<Date.now()-20_000||!agent.desktop){await manual(r.id,'browser_agent','Abra a sessão gráfica e inicie o agente local do navegador.');continue;}
        if(!profile?.profileSaved){await manual(r.id,'browser_login','Faça login no perfil TikTok selecionado e confira a conta.');continue;}
        if(profile.externalBusy){await manual(r.id,'browser_busy','Feche a janela de login/revisão deste perfil TikTok para liberar os envios.');continue;}
        integrationId='browser:tiktok:'+browserId;channelName=r.name+' · TikTok';
      }
      if(!r.config.target){r.config.target={integrationId,channelName,tiktokProfileId:r.provider==='tiktok'?integrationId.slice('browser:tiktok:'.length):null};await pool.query('UPDATE publication_requests SET config=$2 WHERE id=$1',[r.id,JSON.stringify(r.config)]);}
      await pool.query("UPDATE publication_requests SET status='active' WHERE id=$1 AND status='waiting_manual'",[r.id]);await pool.query("UPDATE manual_actions SET resolved_at=now() WHERE request_id=$1 AND resolved_at IS NULL AND kind NOT IN ('unknown_upload','delivery_review','youtube_titles')",[r.id]);
      await pool.query('UPDATE watches SET enabled=true WHERE id=$1 AND enabled=false',[watch.id]);
      const cooldown=await getSetting<string>('uploadCooldown:'+integrationId);
      if(cooldown&&Date.parse(cooldown)>Date.now()){await this.message(r.id,'Aguardando o prazo de liberação informado pela plataforma.');continue;}
      const policy=nativeScheduleSchema.parse(r.config.policy),cadence=r.config.cadence;
      if(policy.endAt&&Date.parse(policy.endAt)<Date.now()){await manual(r.id,'dates','O período permitido terminou. Defina novas datas em um novo pedido para a quantidade restante.');continue;}
      if(r.provider==='tiktok') {
        const {rows:pending}=await pool.query(`SELECT d.*,v.sha256 AS original_hash,v.name,v.file_id FROM deliveries d JOIN videos v ON v.id=d.video_id WHERE d.request_id=$1 AND d.engine='browser' AND d.status='pending' ORDER BY d.planned_at LIMIT 1`,[r.id]);
        if(pending[0]) {
          if(!validScheduleDate('tiktok',new Date(pending[0].planned_at),policy)){const date=planNativeDate('tiktok',cadence,policy,await publisher.calendar(integrationId,pool,pending[0].id));if(!date){await this.message(r.id,'Aguardando uma data permitida para retomar o envio.');continue;}await pool.query('UPDATE deliveries SET planned_at=$2 WHERE id=$1',[pending[0].id,date]);pending[0].planned_at=date;}
          const config={...browserConfigSchema.parse({folder:localMediaHostDir,mode:'native_schedule',nativeSchedule:policy}),timezone:cadence.timezone,revision:0,nextAt:null};
          await browserBridge.enqueueDelivery(pending[0],r.config.target.tiktokProfileId,config);
        }
      }
      if(n.confirmed+n.reserved>=r.quantity){await this.message(r.id,'Aguardando a confirmação dos envios já reservados.');continue;}
      const reservations=await publisher.calendar(integrationId);
      if(!uploadBudgetAvailable(policy,reservations)||!planNativeDate(r.provider,cadence,policy,reservations)){await this.message(r.id,'Aguardando capacidade ou abertura da janela da plataforma. O restante permanece na fila.');continue;}
      const prepared=await publisher.prepareNext({...watch,mode:'native_schedule'}, {id:r.id,provider:r.provider,integrationId,channelName,policy,cadence});
      if(prepared?.titleReviewRequired){await manual(r.id,'title_review',prepared.titleReviewRequired);continue;}
      const after=await counts(r.id);
      const {rows:[sourceState]}=await pool.query("SELECT count(*) FILTER(WHERE status IN ('ready','retry','sent'))::int AS eligible,count(*) FILTER(WHERE status='failed')::int AS failed,count(*) FILTER(WHERE status='waiting' AND error IS NOT NULL)::int AS blocked,min(error) FILTER(WHERE status='waiting') AS issue FROM videos v WHERE watch_id=$1 AND NOT EXISTS(SELECT 1 FROM deliveries d WHERE d.video_id=v.id AND d.integration_id=$2)",[watch.id,integrationId]);
      if(!sourceState.eligible&&(sourceState.failed||sourceState.blocked)&&!after.reserved){await manual(r.id,'source_media',sourceState.issue||'Os vídeos encontrados falharam na validação. Confira formato, duração e acesso à origem.','/#history');continue;}
      if(!sourceState.eligible&&!after.reserved){await this.message(r.id,'Aguardando novos vídeos elegíveis na origem. A quantidade restante continua na fila.');continue;}
      await this.message(r.id,'Buscando e preparando os próximos vídeos até a quantidade solicitada.');
    }
    await pool.query(`UPDATE watches w SET enabled=false WHERE enabled=true AND controlled_by_requests=true AND NOT EXISTS(SELECT 1 FROM publication_requests r JOIN publishing_profiles p ON p.id=r.profile_id WHERE p.watch_id=w.id AND (r.status='active' OR (r.status='waiting_manual' AND EXISTS(SELECT 1 FROM manual_actions a WHERE a.request_id=r.id AND a.resolved_at IS NULL AND a.kind IN ('source_access','source_media')))))`);
  }
  private async message(id:string,message:string){await pool.query('UPDATE publication_requests SET message=$2,updated_at=now() WHERE id=$1 AND message IS DISTINCT FROM $2',[id,message]);}
  async cancel(id:string) {
    await pool.query("UPDATE publication_requests SET status='cancelled',message='Pedido cancelado. Agendamentos já confirmados continuam na plataforma.' WHERE id=$1",[id]);
    await pool.query("UPDATE browser_commands SET status=CASE WHEN status='pending' THEN 'cancelled' ELSE 'cancel_requested' END WHERE request_id=$1 AND status IN ('pending','running')",[id]);
    const {rows:cancelled}=await pool.query("UPDATE deliveries SET status='cancelled',local_file=NULL WHERE request_id=$1 AND status IN ('review','pending','retry') AND session IS NULL AND upload_started_at IS NULL RETURNING id",[id]);
    for(const row of cancelled)await rm(join(dataDir,row.id+'.native.mp4'),{force:true});
    await pool.query("UPDATE manual_actions SET resolved_at=now() WHERE request_id=$1 AND kind NOT IN ('unknown_upload','youtube_titles')",[id]);
  }
}
export const publicationRequests=new PublicationRequests();
export const requestRoutes=Router();
requestRoutes.post('/api/assistant/titles',async(req,res)=>res.json(await saveTitleReviews(req.body)));
requestRoutes.get('/api/assistant/context',async(req,res)=>res.json(await publicationRequests.context({
  requests:parsePagination(req.query,{scope:'requests',prefix:'requests'}),actions:parsePagination(req.query,{scope:'actions',prefix:'actions'})
})));
requestRoutes.post('/api/assistant/profiles',async(req,res)=>res.status(201).json(await publicationRequests.saveProfile(req.body)));
requestRoutes.put('/api/assistant/profiles/:id',async(req,res)=>res.json(await publicationRequests.saveProfile(req.body,uuid.parse(req.params.id))));
requestRoutes.post('/api/assistant/profiles/:id/accounts',async(req,res)=>{
  const id=uuid.parse(req.params.id),input=z.object({youtubeId:z.string().regex(/^native:youtube:[\w-]{6,200}$/).nullable().optional(),tiktokProfileId:profileId.nullable().optional()}).strict().refine(v=>v.youtubeId!==undefined||v.tiktokProfileId!==undefined).parse(req.body);
  if(input.youtubeId&&!(await nativeChannels()).some(c=>c.id===input.youtubeId&&!c.disabled))throw new AppError('Conecte o canal YouTube antes de vinculá-lo.');
  if(input.tiktokProfileId&&!(await pool.query('SELECT id FROM browser_profiles WHERE id=$1',[input.tiktokProfileId])).rowCount)throw new AppError('Perfil TikTok não encontrado.');
  const result=await pool.query('UPDATE publishing_profiles SET youtube_id=CASE WHEN $2 THEN $3 ELSE youtube_id END,tiktok_profile_id=CASE WHEN $4 THEN $5 ELSE tiktok_profile_id END WHERE id=$1',[id,input.youtubeId!==undefined,input.youtubeId||null,input.tiktokProfileId!==undefined,input.tiktokProfileId||null]);
  if(!result.rowCount)throw new AppError('Perfil não encontrado.',404);res.json({ok:true});
});
requestRoutes.post('/api/assistant/requests',async(req,res)=>res.status(202).json(await publicationRequests.create(req.body)));
requestRoutes.post('/api/assistant/requests/:id/cancel',async(req,res)=>{await publicationRequests.cancel(uuid.parse(req.params.id));res.json({ok:true});});
requestRoutes.post('/api/assistant/requests/:id/resume',async(req,res)=>{
  const id=uuid.parse(req.params.id);await pool.query("UPDATE publication_requests SET status='active' WHERE id=$1 AND status='waiting_manual'",[id]);
  await pool.query("UPDATE manual_actions SET resolved_at=now() WHERE request_id=$1 AND kind NOT IN ('unknown_upload','youtube_titles')",[id]);
  await pool.query('UPDATE watches SET last_error=NULL,next_scan_at=now() WHERE id=(SELECT p.watch_id FROM publishing_profiles p JOIN publication_requests r ON r.profile_id=p.id WHERE r.id=$1)',[id]);
  await pool.query("UPDATE deliveries SET status='pending',error=NULL,attempts=0,retry_at=now() WHERE request_id=$1 AND status='failed' AND session IS NULL AND upload_started_at IS NULL",[id]);res.json({ok:true});
});
requestRoutes.post('/api/assistant/actions/:id/resolve',async(req,res)=>{
  const id=uuid.parse(req.params.id),{resolution}=z.object({confirm:z.literal(true),resolution:z.enum(['setup_done','checked_scheduled','checked_not_scheduled'])}).parse(req.body);
  const {rows:[action]}=await pool.query('SELECT * FROM manual_actions WHERE id=$1 AND resolved_at IS NULL',[id]);if(!action)throw new AppError('Pendência não encontrada.',404);
  if(action.kind==='unknown_upload'||(action.kind==='delivery_review'&&resolution!=='setup_done')) {
    if(resolution==='setup_done')throw new AppError('Confira o resultado na plataforma e informe o que encontrou.');
    const {rows:unknown}=await pool.query("SELECT * FROM deliveries WHERE request_id=$1 AND status IN ('unknown','failed','review','private','unlisted','inbox','completed')",[action.request_id]);
    if(unknown.length!==1)throw new AppError('Confira cada envio individualmente no histórico.');
    if(unknown[0].provider==='youtube'&&resolution==='checked_scheduled')throw new AppError('Vincule o ID do vídeo no histórico; o YouTube verificará a conta e a data.');
    await pool.query("UPDATE deliveries SET status=$2,error=NULL,payload=payload||$3::jsonb WHERE id=$1",[unknown[0].id,resolution==='checked_scheduled'?'scheduled':'cancelled',JSON.stringify({manualConfirmed:true})]);
    await pool.query('UPDATE deliveries SET local_file=NULL WHERE id=$1',[unknown[0].id]);await rm(join(dataDir,unknown[0].id+'.native.mp4'),{force:true});
  }
  await pool.query('UPDATE manual_actions SET resolved_at=now() WHERE id=$1',[id]);
  await pool.query("UPDATE publication_requests SET status='active' WHERE id=$1 AND status='waiting_manual'",[action.request_id]);
  await event('info','Conferência manual registrada para o pedido.');res.json({ok:true});
});
