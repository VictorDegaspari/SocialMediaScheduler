import express, { type ErrorRequestHandler } from 'express';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import { appUrl, port, localMediaHostDir, AppError, errorMessage, logger, encrypt, decrypt } from './config.js';
import { initDb, pool, redis, getSetting, setSetting, event } from './db.js';
import { googleClient, GoogleDrive, driveToken, Postiz, postizClient, type GoogleConfig, type PostizConfig } from './clients.js';
import { folderId, watchSchema, nextRun } from './domain.js';
import { Worker } from './worker.js';
import { PackSource } from './pack-source.js';
import { PACK_URL,PACK_ROOT } from './pack-config.js';
import { LocalFiles } from './local.js';
import { LocalScheduler } from './scheduler.js';
import {requestRoutes,publicationRequests} from './publication-requests.js';
import { nativeRoutes } from './native-routes.js';
import { browserRoutes, browserBridge } from './browser-bridge.js';
import { cutsRoutes, cutsService } from './cuts.js';
import { dashboardRoutes, listWatches, listEvents, listVideos, dashboardStats } from './dashboard-lists.js';
import { parsePagination } from './pagination.js';
import { publisherEngine,nativeConnectionState,publishingChannels } from './native-auth.js';
import type { Credentials } from 'google-auth-library';

await initDb();
const worker=new Worker();
const scheduler=new LocalScheduler(worker);
const app=express();
app.disable('x-powered-by');
const publicHost=new URL(appUrl).host;
const publicPort=new URL(appUrl).port || (appUrl.startsWith('https:')?'443':'80');
const allowedHosts=new Set([publicHost,`localhost:${publicPort}`,`127.0.0.1:${publicPort}`,`localhost:${port}`,`127.0.0.1:${port}`]);
app.use((req,res,next)=>{
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  if(!allowedHosts.has(req.get('host') || '')) return res.status(403).json({error:'Acesso permitido apenas pelo endereço local configurado.'});
  const origin=req.get('origin');
  if(origin && ![appUrl,`http://127.0.0.1:${publicPort}`].includes(origin)) return res.status(403).json({error:'Origem não permitida.'});
  if(['POST','PUT','PATCH','DELETE'].includes(req.method) && req.get('x-watcher-request')!=='1') return res.status(403).json({error:'Requisição sem proteção de origem.'});
  if(req.path.startsWith('/api')) res.setHeader('Cache-Control','no-store');
  next();
});
app.use(express.json({limit:'128kb'}));
app.use(nativeRoutes);
app.use(requestRoutes);
app.use(browserRoutes);
app.use(cutsRoutes);
app.use(dashboardRoutes);
const uuid=z.string().uuid();

app.get('/api/health',async(_req,res)=>{
  await pool.query('SELECT 1');
  const ready=!!worker.lastTick && redis.status==='ready';
  res.status(ready?200:503).json({ok:ready,worker:!!worker.lastTick,redis:redis.status==='ready'});
});

app.get('/api/state',async(req,res)=>{
  const watchesPage=parsePagination(req.query,{scope:'watches',prefix:'watches'});
  const eventsPage=parsePagination(req.query,{scope:'events',prefix:'events',idType:'bigint'});
  const videosPage=parsePagination(req.query,{scope:'videos',prefix:'videos'});
  const cutsPage=parsePagination(req.query,{scope:'cuts',prefix:'cuts',defaultLimit:10});
  const cutFoldersPage=parsePagination(req.query,{scope:'cutFolders',prefix:'cutFolders',defaultLimit:10});
  const requestsPage=parsePagination(req.query,{scope:'requests',prefix:'requests'});
  const actionsPage=parsePagination(req.query,{scope:'actions',prefix:'actions'});
  const browserPage=parsePagination(req.query,{scope:'browser',prefix:'browser'});
  const [google,tokens,postiz,paused,heartbeat,watches,stats,activities,videos,publishing,browser,cuts,cutFolders,native,queue]=await Promise.all([
    getSetting<GoogleConfig>('google'),getSetting<Credentials>('googleTokens'),getSetting<PostizConfig>('postiz'),
    getSetting<boolean>('paused'),getSetting<string>('heartbeat'),
    listWatches(watchesPage),dashboardStats(),listEvents(eventsPage),listVideos(videosPage),
    publicationRequests.context({requests:requestsPage,actions:actionsPage}),browserBridge.state(browserPage),cutsService.state(cutsPage),cutsService.state(cutFoldersPage),
    nativeConnectionState(),scheduler.state()
  ]);
  res.json({publishing,browser,cuts,cutFolders,
    connections:{native,local:{rootPath:localMediaHostDir},google:{configured:!!google,connected:!!tokens?.refresh_token,clientId:google?.clientId || '',callbackUrl:`${appUrl}/auth/google/callback`},postiz:{configured:!!postiz,baseUrl:postiz?.baseUrl || '',youtubeSchedulingApproved:postiz?.youtubeSchedulingApproved || false}},
    scheduler:{paused:!!paused,heartbeat,timezone:'America/Sao_Paulo',queue},
    watches:watches.items,stats,events:activities.items,videos:videos.items,
    pagination:{watches:watches.pagination,events:activities.pagination,videos:videos.pagination}
  });
});

app.post('/api/settings/google',async(req,res)=>{
  const input=z.object({clientId:z.string().trim().min(10).max(500),clientSecret:z.string().max(1000).optional()}).parse(req.body);
  const existing=await getSetting<GoogleConfig>('google');
  const secret=input.clientSecret || existing?.clientSecret;
  if(!secret) throw new AppError('Informe o Client Secret do aplicativo Google.');
  if(existing && (existing.clientId!==input.clientId || (input.clientSecret && input.clientSecret!==existing.clientSecret))) {
    await pool.query("DELETE FROM settings WHERE key='googleTokens'");
  }
  await setSetting('google',{clientId:input.clientId,clientSecret:secret});
  await event('info','Credenciais do Google atualizadas.');
  res.json({ok:true});
});

app.post('/api/settings/google/disconnect',async(_req,res)=>{
  // Local disconnect removes our copy; revoke access in the Google account if desired.
  await pool.query("DELETE FROM settings WHERE key='googleTokens'");
  await event('info','Conta Google desconectada deste aplicativo.');
  res.json({ok:true});
});

app.get('/auth/google',async(req,res)=>{
  // Keep the state cookie on the same host as the registered OAuth callback.
  if(req.get('host')!==publicHost) return res.redirect(`${appUrl}/auth/google`);
  const client=await googleClient();
  const state=randomBytes(32).toString('hex');
  const {codeVerifier,codeChallenge}=await client.generateCodeVerifierAsync();
  await pool.query('INSERT INTO oauth_states(hash,verifier,expires_at) VALUES($1,$2,now()+interval \'10 minutes\')',[createHash('sha256').update(state).digest('hex'),encrypt(codeVerifier)]);
  res.cookie('drive_oauth',state,{httpOnly:true,sameSite:'lax',secure:appUrl.startsWith('https:'),maxAge:600_000,path:'/auth/google/callback'});
  const url=client.generateAuthUrl({access_type:'offline',prompt:'consent',scope:['https://www.googleapis.com/auth/drive.readonly'],state,code_challenge:codeChallenge,code_challenge_method:'S256' as never});
  res.redirect(url);
});

app.get('/auth/google/callback',async(req,res)=>{
  const state=z.string().regex(/^[a-f0-9]{64}$/).safeParse(req.query.state);
  const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('drive_oauth='))?.slice('drive_oauth='.length);
  res.clearCookie('drive_oauth',{path:'/auth/google/callback'});
  if(!state.success || cookie!==state.data) return res.redirect('/?oauth=invalid');
  const {rows}=await pool.query('DELETE FROM oauth_states WHERE hash=$1 AND expires_at>now() RETURNING verifier',[createHash('sha256').update(state.data).digest('hex')]);
  if(!rows.length || req.query.error || typeof req.query.code!=='string') return res.redirect('/?oauth=denied');
  try {
    const client=await googleClient();
    const {tokens}=await client.getToken({code:req.query.code,codeVerifier:decrypt<string>(rows[0].verifier)});
    if(!tokens.refresh_token || !tokens.access_token) throw new Error('Offline access missing');
    const info=await client.getTokenInfo(tokens.access_token);
    if(!info.scopes.includes('https://www.googleapis.com/auth/drive.readonly')) throw new Error('Drive scope missing');
    await setSetting('googleTokens',tokens);
    await pool.query('UPDATE watches SET next_scan_at=now()');
    await event('success','Google Drive conectado com permissão de leitura.');
    return res.redirect('/?oauth=success');
  } catch {
    await event('error','Não foi possível concluir a autorização Google. Confira o aplicativo OAuth e tente novamente.');
    return res.redirect('/?oauth=failed');
  }
});

app.post('/api/settings/postiz',async(req,res)=>{
  const input=z.object({baseUrl:z.string().url().max(1000),apiKey:z.string().max(3000).optional(),youtubeSchedulingApproved:z.boolean().default(false)}).parse(req.body);
  const url=new URL(input.baseUrl);
  if(!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new AppError('Informe uma URL HTTP(S) da API Postiz, sem credenciais na URL.');
  const existing=await getSetting<PostizConfig>('postiz');
  const apiKey=input.apiKey || existing?.apiKey;
  if(!apiKey) throw new AppError('Informe a chave da API Postiz.');
  const config={baseUrl:input.baseUrl.replace(/\/+$/,''),apiKey,youtubeSchedulingApproved:input.youtubeSchedulingApproved};
  // Verify the actual key before replacing the working connection.
  const channels=await new Postiz(config).integrations();
  await setSetting('postiz',config);
  await event('success',`Postiz conectado: ${channels.length} canal(is) de vídeo encontrado(s).`);
  res.json({ok:true,channels});
});

app.get('/api/integrations',async(_req,res)=>res.json(await publishingChannels()));
app.post('/api/folders/check',async(req,res)=>{
  const input=z.object({sourceType:z.enum(['google_drive','local','gta6_pack']).default('google_drive'),url:z.string().max(1000).default(''),localPath:z.string().max(4096).default('')}).parse(req.body);
  if(input.sourceType==='gta6_pack') {
    const videos=await new PackSource().catalog(true);
    return void res.json({id:PACK_ROOT,name:'Pack GTA 6',videos:videos.length});
  }
  if(input.sourceType==='local') {
    const folder=await new LocalFiles().folder(input.localPath);
    return void res.json({id:folder.id,name:folder.name,path:folder.hostPath});
  }
  let id:string;
  try {id=folderId(input.url);} catch(e) {throw new AppError((e as Error).message);}
  const folder=await new GoogleDrive(await driveToken()).file(id);
  if(folder.mimeType!=='application/vnd.google-apps.folder') throw new AppError('O link não aponta para uma pasta do Drive.');
  res.json({id:folder.id,name:folder.name});
});

async function saveWatch(body:unknown,id?:string) {
  const input=watchSchema.parse(body);
  let sourceId:string,sourcePath:string;
  if(input.sourceType==='gta6_pack') {
    await new PackSource(input.packDefaults).catalog();sourceId=PACK_ROOT;sourcePath=PACK_URL;
  } else if(input.sourceType==='local') {
    const folder=await new LocalFiles().folder(input.localPath);
    sourceId=folder.id;sourcePath=folder.hostPath;
  } else {
    try {sourceId=folderId(input.folderUrl);} catch(e) {throw new AppError((e as Error).message);}
    sourcePath=input.folderUrl;
  }
  const config={cadence:input.cadence,interval_minutes:input.intervalMinutes,times:input.times,timezone:input.timezone};
  const firstRun=input.cadence==='daily'?nextRun(config,new Date()):new Date();
  if(input.integrationIds.length) {
    const channels=await publishingChannels();
    if(input.integrationIds.some(id=>!channels.find(c=>c.id===id && !c.disabled))) throw new AppError('Selecione apenas canais ativos do motor de publicação escolhido.');
  }
  if(input.mode==='native_schedule'&&(await publisherEngine()!=='local'||input.integrationIds.some(id=>!id.startsWith('native:youtube:'))))throw new AppError('Agendamento nativo nesta tela exige o motor local e canais YouTube. Para TikTok, use TikTok navegador.');
  if(id) {
    const {rows:[old]}=await pool.query('SELECT folder_id,source_type FROM watches WHERE id=$1',[id]);
    if(!old) throw new AppError('Rotina não encontrada.',404);
    if(old.folder_id!==sourceId || old.source_type!==input.sourceType) throw new AppError('Para mudar a pasta ou a origem, crie outra rotina e pause a anterior. Isso preserva o histórico.');
  }
  const watchId=id || randomUUID();
  await pool.query(`INSERT INTO watches(id,name,folder_id,folder_url,recursive,enabled,scan_minutes,cadence,interval_minutes,times,timezone,mode,integration_ids,import_existing,require_metadata,next_upload_at,strip_metadata,source_type,native_schedule,pack_defaults)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
    ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,recursive=EXCLUDED.recursive,enabled=EXCLUDED.enabled,
    scan_minutes=EXCLUDED.scan_minutes,cadence=EXCLUDED.cadence,interval_minutes=EXCLUDED.interval_minutes,
    times=EXCLUDED.times,timezone=EXCLUDED.timezone,mode=EXCLUDED.mode,integration_ids=EXCLUDED.integration_ids,
    require_metadata=EXCLUDED.require_metadata,strip_metadata=EXCLUDED.strip_metadata,native_schedule=EXCLUDED.native_schedule,pack_defaults=EXCLUDED.pack_defaults,
    next_scan_at=now(),next_upload_at=EXCLUDED.next_upload_at,last_error=NULL`,
    [watchId,input.name,sourceId,sourcePath,input.recursive,input.enabled,input.scanMinutes,input.cadence,input.intervalMinutes,JSON.stringify(input.times),input.timezone,input.mode,JSON.stringify(input.integrationIds),input.importExisting,input.requireMetadata,firstRun,input.stripMetadata,input.sourceType,JSON.stringify(input.nativeSchedule),JSON.stringify(input.packDefaults)]);
  await event('info',id?'Configuração da rotina atualizada.':'Nova pasta adicionada à rotina.',watchId);
  return watchId;
}

app.post('/api/watches',async(req,res)=>res.status(201).json({id:await saveWatch(req.body)}));
app.put('/api/watches/:id',async(req,res)=>res.json({id:await saveWatch(req.body,uuid.parse(req.params.id))}));
app.post('/api/watches/:id/toggle',async(req,res)=>{
  const id=uuid.parse(req.params.id);
  const {rows}=await pool.query('UPDATE watches SET enabled=NOT enabled,next_scan_at=now() WHERE id=$1 RETURNING enabled',[id]);
  if(!rows.length) throw new AppError('Rotina não encontrada.',404);
  await event('info',rows[0].enabled?'Rotina retomada.':'Rotina pausada.',id);
  res.json(rows[0]);
});
app.post('/api/watches/:id/scan',async(req,res)=>{
  const id=uuid.parse(req.params.id);
  const result=await pool.query('UPDATE watches SET next_scan_at=now() WHERE id=$1 AND enabled=true',[id]);
  if(!result.rowCount) throw new AppError('A rotina não existe ou está pausada.');
  res.json({ok:true,message:'Verificação solicitada. O worker executará no próximo ciclo.'});
});
app.post('/api/scheduler',async(req,res)=>{
  const input=z.object({paused:z.boolean()}).parse(req.body);
  await setSetting('paused',input.paused);
  await event('info',input.paused?'Todas as rotinas foram pausadas.':'Rotinas retomadas.');
  res.json({ok:true});
});
app.post('/api/scan',async(_req,res)=>{
  await pool.query('UPDATE watches SET next_scan_at=now() WHERE enabled=true');
  res.json({ok:true});
});
app.post('/api/videos/:id/retry',async(req,res)=>{
  const id=uuid.parse(req.params.id);
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const {rows:[video]}=await db.query('SELECT * FROM videos WHERE id=$1 FOR UPDATE',[id]);
    if(!video || video.status!=='failed') throw new AppError('Somente falhas confirmadas podem ser retomadas. Confira resultados desconhecidos no Postiz.');
    const {rows:unsafe}=await db.query("SELECT id FROM deliveries WHERE video_id=$1 AND (status IN ('submitting','unknown') OR (status='failed' AND post_id IS NOT NULL))",[id]);
    if(unsafe.length) throw new AppError('Há um envio aceito ou sem confirmação. Corrija esse post diretamente no Postiz.');
    await db.query("UPDATE deliveries SET status='pending',error=NULL WHERE video_id=$1 AND status='failed' AND post_id IS NULL",[id]);
    await db.query("UPDATE videos SET status='waiting',attempts=0,retry_at=NULL,error=NULL WHERE id=$1",[id]);
    await db.query('UPDATE watches SET next_scan_at=now() WHERE id=$1',[video.watch_id]);
    await db.query('COMMIT');
    await event('info','Nova tentativa solicitada para falha confirmada.',video.watch_id,id);
    res.json({ok:true});
  } catch(error) {await db.query('ROLLBACK');throw error;} finally {db.release();}
});

app.post('/api/deliveries/:id/link',async(req,res)=>{
  const id=uuid.parse(req.params.id);
  const input=z.object({postId:z.string().min(1).max(200)}).parse(req.body);
  const {rows:[delivery]}=await pool.query("SELECT * FROM deliveries WHERE id=$1 AND status='unknown' AND engine='postiz'",[id]);
  if(!delivery) throw new AppError('Envio sem confirmação não encontrado.');
  const planned=new Date(delivery.planned_at).getTime();
  const posts=await (await postizClient()).posts(new Date(planned-86400_000),new Date(Math.max(planned,Date.now())+86400_000));
  const post=posts.find(p=>p.id===input.postId && p.integration?.id===delivery.integration_id);
  if(!post) throw new AppError('O post informado não foi encontrado nesse canal e intervalo.');
  const status=post.state==='PUBLISHED'?'published':post.state==='ERROR'?'failed':post.state==='DRAFT'?'draft':'scheduled';
  await pool.query('UPDATE deliveries SET status=$2,post_id=$3,release_url=$4,error=NULL,updated_at=now() WHERE id=$1',[id,status,post.id,post.releaseURL || null]);
  await pool.query(`UPDATE videos SET status=CASE WHEN EXISTS(SELECT 1 FROM deliveries WHERE video_id=$1 AND status IN ('unknown','submitting')) THEN 'unknown'
    WHEN EXISTS(SELECT 1 FROM deliveries WHERE video_id=$1 AND status='failed') THEN 'failed' ELSE 'sent' END,error=NULL,updated_at=now() WHERE id=$1`,[delivery.video_id]);
  await event('success','Envio reconciliado com o post informado.',undefined,delivery.video_id);
  res.json({ok:true});
});

app.use(express.static(resolve('public'),{etag:true}));
app.use('/api',(_req,res)=>res.status(404).json({error:'Rota não encontrada.'}));
const handler:ErrorRequestHandler=(error,_req,res,_next)=>{
  if(error instanceof z.ZodError) return void res.status(400).json({error:'Verifique os campos: '+error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ').slice(0,600)});
  if(error?.code==='23505') return void res.status(409).json({error:'Esta pasta já tem uma rotina cadastrada.'});
  const message=errorMessage(error);
  logger.warn({event:'request_failed',message},'Operação recusada ou indisponível.');
  res.status(error instanceof AppError?Math.min(599,Math.max(400,error.status)):500).json({error:message});
};
app.use(handler);
const server=app.listen(port,process.env.HOST || '127.0.0.1',()=>logger.info({url:appUrl},'Drive Watcher disponível.'));
void scheduler.start().catch(()=>logger.error({event:'scheduler_start_failed'},'Não foi possível iniciar o scheduler Redis. Reinicie o serviço após recuperar o Redis.'));
cutsService.start();
let closing=false;
async function shutdown(){
  if(closing) return;
  closing=true;
  server.close();
  await cutsService.stop();
  await scheduler.stop();
  await worker.stop();
  await redis.quit().catch(()=>{});
  await pool.end();
}
process.on('SIGTERM',()=>void shutdown());
process.on('SIGINT',()=>void shutdown());
