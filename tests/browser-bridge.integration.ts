import {test,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,rm,readFile,writeFile,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DateTime} from 'luxon';
import express from 'express';

const database=new URL(process.env.DATABASE_URL!);database.pathname='/watcher_browser_test';process.env.DATABASE_URL=database.toString();
const redisUrl=new URL(process.env.REDIS_URL!);redisUrl.pathname='/12';process.env.REDIS_URL=redisUrl.toString();
process.env.BROWSER_AGENT_TOKEN='1'.repeat(64);
const temp=await mkdtemp(join(tmpdir(),'watcher-bridge-'));
process.env.LOCAL_MEDIA_DIR=join(temp,'media');process.env.LOCAL_MEDIA_HOST_DIR=process.env.LOCAL_MEDIA_DIR;
process.env.DATA_DIR=join(temp,'spool');
await mkdir(process.env.LOCAL_MEDIA_DIR);
await mkdir(process.env.DATA_DIR);
const {pool,redis,initDb,setSetting}=await import('../src/db.js');
const {BrowserBridge,browserRoutes}=await import('../src/browser-bridge.js');
const {nativeRoutes}=await import('../src/native-routes.js');
const {LocalFiles}=await import('../src/local.js');
const {metadataSchema}=await import('../src/domain.js');
const {sha256}=await import('../src/media.js');
const {recoverBrowserPreparations}=await import('../src/browser-publications.js');
const {AppError}=await import('../src/config.js');
await initDb();
const bridge=new BrowserBridge();
const app=express();app.use(express.json());app.use(browserRoutes);app.use(nativeRoutes);
app.use((error:any,_req:any,res:any,_next:any)=>res.status(error instanceof AppError?error.status:400).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.on('listening',resolve));
const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
let instanceId=randomUUID();
const report=(activeJobId:string|null=null)=>({instanceId,profileSaved:true,externalBusy:false,desktop:true,activeJobId});
const config=(extra:Record<string,unknown>={})=>({folder:process.env.LOCAL_MEDIA_DIR,enabled:false,cadence:'daily',intervalMinutes:120,times:['08:00','20:00'],stripMetadata:true,...extra});
async function post(path:string,body:unknown,authorized=true){return fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Watcher-Request':'1',...(authorized?{Authorization:'Bearer '+process.env.BROWSER_AGENT_TOKEN}:{})},body:JSON.stringify(body)});}
beforeEach(async()=>{
  await pool.query('TRUNCATE browser_commands,browser_agent,browser_settings,settings,events,content_claims,deliveries,videos,watches CASCADE');
  instanceId=randomUUID();await setSetting('paused',false);
});

test('agente exige chave e o estado do painel não expõe a credencial',async()=>{
  assert.equal((await post('/api/browser-agent/poll',report(),false)).status,401);
  assert.equal((await post('/api/browser-agent/poll',report())).status,200);
  assert.equal((await bridge.state()).agent.online,true);
  assert(!JSON.stringify(await bridge.state()).includes(process.env.BROWSER_AGENT_TOKEN!));
  assert.equal((await post('/api/browser-agent/poll',{...report(),instanceId:randomUUID()})).status,409);
});

test('persiste pasta e horários em São Paulo e rejeita pasta fora da raiz',async()=>{
  assert.equal((await post('/api/browser/config',config({folder:'../outside'}))).status,400);
  assert.equal((await post('/api/browser/config',config({enabled:true}))).status,200);
  const state=await new BrowserBridge().state();
  assert.deepEqual(state.config.times,['08:00','20:00']);assert.equal(state.config.timezone,'America/Sao_Paulo');
  assert.equal(state.config.stripMetadata,true);assert.equal(state.config.enabled,true);
  assert(['08:00','20:00'].includes(DateTime.fromISO(state.config.nextAt!).setZone(state.config.timezone).toFormat('HH:mm')));
});

test('scheduler cria uma tarefa por oportunidade e respeita pausa e revisão em andamento',async()=>{
  await bridge.save(config({enabled:true,cadence:'interval'}));await bridge.poll(report());
  await Promise.all([bridge.tick(),bridge.tick()]);
  assert.equal((await pool.query("SELECT id FROM browser_commands WHERE status='pending'")).rowCount,1);
  const {job}=await bridge.poll(report());assert(job);
  await bridge.progress(job.id,{instanceId,stage:'browser_review_required'});
  await bridge.tick();assert.equal((await pool.query('SELECT id FROM browser_commands')).rowCount,1);
  await bridge.finish(job.id,{instanceId,result:'review'});
  assert(new Date((await bridge.state()).config.nextAt!).getTime()>Date.now());
  await pool.query("UPDATE browser_settings SET next_at=now()-interval '1 minute'");
  await setSetting('paused',true);await bridge.tick();
  assert.equal((await pool.query('SELECT id FROM browser_commands')).rowCount,1);
  assert.equal((await post('/api/browser/run',{})).status,409);
});

test('reivindicação concorrente não duplica envio e exige a identidade do agente',async()=>{
  await bridge.poll(report());const id=await bridge.request('upload');
  await assert.rejects(()=>bridge.request('login'),/andamento/);
  const responses=await Promise.all([bridge.poll(report()),bridge.poll(report())]);
  assert.equal(responses.filter(r=>r.job).length,1);assert.equal(responses.find(r=>r.job)!.job!.id,id);
  assert.equal((await post('/api/browser-agent/jobs/'+id+'/progress',{instanceId:randomUUID(),stage:'browser_upload_started'})).status,409);
  assert.equal((await post('/api/browser-agent/jobs/'+id+'/finish',{instanceId,result:'done'})).status,400);
});

test('perder a conexão durante upload mantém resultado desconhecido sem retomar automaticamente',async()=>{
  await bridge.save(config({enabled:true,cadence:'interval'}));await bridge.poll(report());
  const id=await bridge.request('upload');await bridge.poll(report());
  await bridge.progress(id,{instanceId,stage:'browser_upload_started',filename:'video.mp4',hash:'a'.repeat(64)});
  await pool.query("UPDATE browser_commands SET lease_until=now()-interval '1 second' WHERE id=$1",[id]);
  const response=await bridge.poll(report(id));assert.equal(response.cancel,true);assert.equal(response.job,null);
  assert.equal((await bridge.state()).jobs[0].status,'unknown');
  assert.equal((await bridge.poll(report())).job,null);
  assert.equal((await pool.query('SELECT id FROM browser_commands')).rowCount,1);
});

test('interromper antes do envio cancela; após a transferência exige conferência',async()=>{
  await bridge.poll(report());
  let id=await bridge.request('upload');await bridge.poll(report());await bridge.stop();
  assert.equal((await bridge.poll(report(id))).cancel,true);
  assert.equal(await bridge.finish(id,{instanceId,result:'cancelled'}),'cancelled');
  id=await bridge.request('upload');await bridge.poll(report());
  await bridge.progress(id,{instanceId,stage:'browser_upload_started'});await bridge.stop();
  assert.equal(await bridge.finish(id,{instanceId,result:'cancelled'}),'unknown');
});

test('pasta vazia aguarda nova verificação sem consumir o próximo horário nem criar fila em excesso',async()=>{
  await bridge.save(config({enabled:true,cadence:'interval'}));await bridge.poll(report());await bridge.tick();
  const {job}=await bridge.poll(report());await bridge.finish(job!.id,{instanceId,result:'empty'});
  await bridge.tick();assert.equal((await pool.query('SELECT id FROM browser_commands')).rowCount,1);
  await pool.query("UPDATE browser_settings SET retry_at=now()-interval '1 second'");
  await bridge.tick();assert.equal((await pool.query('SELECT id FROM browser_commands')).rowCount,2);
  await bridge.pause();assert.equal((await bridge.state()).active,null);assert.equal((await bridge.state()).config.enabled,false);
});

test('perfil ocupado e ausência de sessão gráfica impedem abrir outra janela',async()=>{
  assert.equal((await post('/api/browser/login',{})).status,503);
  await bridge.poll({...report(),externalBusy:true});
  assert.equal((await post('/api/browser/login',{})).status,409);
  await bridge.poll({...report(),desktop:false});
  assert.equal((await post('/api/browser/run',{})).status,409);
  await bridge.poll(report());const id=await bridge.request('login');await bridge.poll(report());
  await bridge.progress(id,{instanceId,stage:'browser_manual_login'});
  assert.equal(await bridge.finish(id,{instanceId,result:'done'}),'done');
  assert(!(await bridge.state()).agent.hasOwnProperty('accountConnected'));
});

test('lote TikTok reserva datas e só avança até o teto após confirmação real do agente',async()=>{
  await bridge.save(config({enabled:true,mode:'native_schedule',cadence:'interval',nativeSchedule:{maxScheduled:2}}));await bridge.poll(report());
  const dates:string[]=[];
  for(let i=0;i<2;i++) {
    await Promise.all([bridge.tick(),bridge.tick()]);
    const {job}=await bridge.poll(report());assert(job?.publishAt);dates.push(job.publishAt);
    await assert.rejects(()=>bridge.finish(job.id,{instanceId,result:'scheduled'}),/não confirmou/);
    await bridge.progress(job.id,{instanceId,stage:'browser_upload_started'});
    await bridge.progress(job.id,{instanceId,stage:'browser_scheduled'});
    assert.equal(await bridge.finish(job.id,{instanceId,result:'scheduled'}),'scheduled');
  }
  assert(Date.parse(dates[1])>Date.parse(dates[0]));
  await bridge.tick();assert.equal((await bridge.state()).active,null);
  await assert.rejects(()=>bridge.request('upload'),/capacidade|datas/);
  assert.equal((await pool.query('SELECT id FROM browser_commands')).rowCount,2);
});
test('lote respeita uploads em 24h, bloqueio da plataforma e alteração de configuração',async()=>{
  const value=config({enabled:true,mode:'native_schedule',cadence:'interval',nativeSchedule:{uploadsPer24h:1}});
  await bridge.save(value);await bridge.poll(report());await bridge.tick();
  const {job}=await bridge.poll(report());assert(job);
  await bridge.progress(job.id,{instanceId,stage:'browser_upload_started'});
  await bridge.progress(job.id,{instanceId,stage:'platform_limit'});
  assert.equal(await bridge.finish(job.id,{instanceId,result:'failed'}),'unknown');
  assert.equal((await bridge.state()).config.enabled,false);
  await bridge.save(value);await bridge.tick();assert.equal((await bridge.state()).active,null);
  await assert.rejects(()=>bridge.request('upload'),/prazo/,'salvar novamente não remove o bloqueio remoto');
  await pool.query("UPDATE browser_settings SET blocked_until=now()-interval '1 second'");
  await bridge.tick();assert.equal((await bridge.state()).active,null,'o upload anterior ainda consome o limite de 24h');
  await pool.query("UPDATE browser_commands SET started_at=now()-interval '25 hours'");
  await bridge.tick();assert((await bridge.state()).active);
  await bridge.save({...value,mode:'review'});
  assert.equal((await bridge.state()).active,null,'a configuração antiga não pode iniciar um upload depois da edição');
});
test('data vencida na fila é cancelada antes do upload e erro de interface interrompe o lote',async()=>{
  await bridge.save(config({enabled:true,mode:'native_schedule',cadence:'interval'}));await bridge.poll(report());await bridge.tick();
  await pool.query("UPDATE browser_commands SET planned_at=now()-interval '1 minute'");
  assert.equal((await bridge.poll(report())).job,null);
  assert.equal((await bridge.state()).jobs[0].status,'cancelled');
  await bridge.tick();const {job}=await bridge.poll(report());assert(job);
  await bridge.progress(job.id,{instanceId,stage:'page_changed'});
  await bridge.finish(job.id,{instanceId,result:'failed'});
  assert.equal((await bridge.state()).config.enabled,false);
});
test('confirmação de agendamento persiste se o agente desconectar antes do encerramento',async()=>{
  await bridge.save(config({enabled:true,mode:'native_schedule',cadence:'interval'}));await bridge.poll(report());await bridge.tick();
  const {job}=await bridge.poll(report());assert(job);
  await bridge.progress(job.id,{instanceId,stage:'browser_upload_started'});
  await bridge.progress(job.id,{instanceId,stage:'browser_scheduled'});
  await pool.query("UPDATE browser_commands SET lease_until=now()-interval '1 second' WHERE id=$1",[job.id]);
  await bridge.poll(report(job.id));
  const state=await bridge.state();assert.equal(state.jobs[0].status,'scheduled');assert.equal(state.config.enabled,true);
});
test('origem pack persiste sem pasta manual e é enviada ao agente com as declarações configuradas',async()=>{
  const original=globalThis.fetch;
  const {PACK_CATALOG_URL}=await import('../src/pack-config.js');
  const {PackSource}=await import('../src/pack-source.js');
  globalThis.fetch=async(input,options)=>String(input)===PACK_CATALOG_URL?Response.json([{t:'Vídeo',drive:'public-pack-test-01',type:'v'}]):original(input,options);
  try {
    await new PackSource().catalog(true);
    await bridge.save(config({enabled:true,sourceType:'gta6_pack',folder:'outside-ignored-for-pack',mode:'native_schedule',cadence:'interval',packDefaults:{titlePrefix:'Meu canal',madeWithAI:true}}));
    await bridge.poll(report());await bridge.tick();const {job}=await bridge.poll(report());assert(job);
    assert.equal(job.sourceType,'gta6_pack');assert.equal(job.packDefaults?.titlePrefix,'Meu canal');assert.equal(job.packDefaults?.madeWithAI,true);
    assert.equal((await bridge.state()).config.sourceType,'gta6_pack');
  }finally{globalThis.fetch=original;}
});

after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();await redis.quit();await rm(temp,{recursive:true,force:true});});


test('publicação imediata exige consentimento específico e confirmação nova com upload iniciado',async()=>{
  await bridge.poll(report());
  const id=await bridge.request('upload');await bridge.poll(report());
  await assert.rejects(()=>bridge.finish(id,{instanceId,result:'published'}),/não confirmou/);
  await pool.query(`UPDATE browser_commands SET config=config||'{"publishNow":true,"requestManaged":true}'::jsonb WHERE id=$1`,[id]);
  await assert.rejects(()=>bridge.finish(id,{instanceId,result:'published'}),/não confirmou/);
  await bridge.progress(id,{instanceId,stage:'browser_upload_started'});
  await assert.rejects(()=>bridge.finish(id,{instanceId,result:'published'}),/não confirmou/);
  await bridge.progress(id,{instanceId,stage:'browser_published'});
  assert.equal(await bridge.finish(id,{instanceId,result:'published'}),'completed');
  assert.equal((await bridge.state()).jobs[0].status,'completed');
});

async function manualVideo(){
  const path=join(process.env.LOCAL_MEDIA_DIR!,'manual.mp4');
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=blue:s=96x64:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-c:a','aac','-shortest',path]);
  const source=new LocalFiles(),folder=await source.folder(process.env.LOCAL_MEDIA_DIR!);
  const file=(await source.tree(folder.id,false)).find(file=>file.name==='manual.mp4')!;
  const watchId=randomUUID(),videoId=randomUUID(),metadata=metadataSchema.parse({title:'Uma partida de corrida',description:'Legenda revisada.'});
  await pool.query("INSERT INTO watches(id,name,folder_id,folder_url,source_type) VALUES($1,'Pasta de teste',$2,'local','local')",[watchId,folder.id]);
  await pool.query("INSERT INTO videos(id,watch_id,file_id,name,size,version,status,metadata,parent_id) VALUES($1,$2,$3,$4,$5,$6,'ready',$7,$8)",[videoId,watchId,file.id,file.name,file.size,file.version,JSON.stringify(metadata),folder.id]);
  return {path,videoId,version:file.version!,metadata};
}

test('vídeo comercial da pasta só publica pelo navegador após prévia e consentimento, preservando bytes e conta',async()=>{
  const video=await manualVideo(),hash=await sha256(video.path);
  const routine=await bridge.save(config({mode:'native_schedule',enabled:false}));
  const prepared=await post('/api/browser/videos/'+video.videoId+'/prepare',{profileId:'default',version:video.version});
  assert.equal(prepared.status,201,await prepared.clone().text());const {id}=await prepared.json();
  const preview=await fetch(base+'/api/native/deliveries/'+id+'/media');assert.deepEqual(Buffer.from(await preview.arrayBuffer()),await readFile(video.path));
  await bridge.poll(report());await bridge.tick();assert.equal((await bridge.state()).jobs.length,0,'preparar uma prévia não autoriza upload');
  const metadata=metadataSchema.parse({...video.metadata,tiktok:{privacyLevel:'PUBLIC_TO_EVERYONE',commercialContent:true,ownBrand:true}});
  assert.equal((await post('/api/native/deliveries/'+id+'/approve',{confirm:true,metadata})).status,400);
  assert.equal((await post('/api/native/deliveries/'+id+'/approve',{confirm:false,metadata,publishNow:true})).status,400);
  assert.equal((await post('/api/native/deliveries/'+id+'/approve',{confirm:true,metadata,publishNow:true})).status,200);
  await bridge.tick();await bridge.tick();assert.equal((await bridge.state()).jobs.length,1);
  const {job}=await bridge.poll(report());assert.equal(job.publishNow,true);assert.equal(job.publishAt,undefined);assert.equal(job.profileId,'default');assert.equal(job.media.assetSha256,hash);assert.equal(job.media.metadata.tiktok.commercialContent,true);assert.equal(job.media.metadata.tiktok.ownBrand,true);
  await assert.rejects(()=>bridge.finish(job.id,{instanceId,result:'review'}),/confirmação/);
  await assert.rejects(()=>bridge.finish(job.id,{instanceId,result:'published'}),/não confirmou/);
  await bridge.progress(job.id,{instanceId,stage:'browser_upload_started'});
  await bridge.progress(job.id,{instanceId,stage:'browser_published'});
  assert.equal(await bridge.finish(job.id,{instanceId,result:'published'}),'completed');
  assert.equal(await sha256(video.path),hash);assert.equal((await pool.query('SELECT status FROM deliveries WHERE id=$1',[id])).rows[0].status,'completed');
  const after=(await bridge.state()).config;assert.equal(after.mode,'native_schedule');assert.equal(after.nextAt,routine.nextAt);assert.equal(after.enabled,false);
  await assert.rejects(stat(join(process.env.DATA_DIR!,id+'.native.mp4')));
});

test('recuperação de uma preparação usa o lock do escritor e mantém os arquivos originais',async()=>{
  const video=await manualVideo(),id=randomUUID(),account='browser:tiktok:default';
  const key='drive-watcher:browser-publication:'+video.videoId+':'+account;
  await pool.query("INSERT INTO deliveries(id,video_id,integration_id,provider,engine,status,payload) VALUES($1,$2,$3,'tiktok','browser','preparing','{\"manualPublication\":true}')",[id,video.videoId,account]);
  const partial=join(process.env.DATA_DIR!,id+'.preparing.mp4');await writeFile(partial,'partial');
  const lock=await pool.connect();await lock.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[key]);
  try{await recoverBrowserPreparations();assert.equal(await readFile(partial,'utf8'),'partial');}
  finally{await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);lock.release();}
  await recoverBrowserPreparations();await assert.rejects(stat(partial));
  assert.equal((await pool.query('SELECT status FROM deliveries WHERE id=$1',[id])).rows[0].status,'failed');assert.ok((await stat(video.path)).size>0);
});

test('preparação rejeita conta inexistente e versão alterada sem criar envio',async()=>{
  const video=await manualVideo();
  assert.equal((await post('/api/browser/videos/'+video.videoId+'/prepare',{profileId:randomUUID(),version:video.version})).status,404);
  assert.equal((await post('/api/browser/videos/'+video.videoId+'/prepare',{profileId:'default',version:'stale'})).status,409);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM deliveries')).rows[0].n,0);
});

test('postar agora espera o perfil escolhido e nunca substitui pela conta padrão',async()=>{
  const video=await manualVideo(),profileId=randomUUID();await pool.query("INSERT INTO browser_profiles(id,name) VALUES($1,'Outra conta')",[profileId]);
  const prepared=await post('/api/browser/videos/'+video.videoId+'/prepare',{profileId,version:video.version});assert.equal(prepared.status,201);const {id}=await prepared.json();
  const metadata=metadataSchema.parse({...video.metadata,tiktok:{privacyLevel:'PUBLIC_TO_EVERYONE'}});
  assert.equal((await post('/api/native/deliveries/'+id+'/approve',{confirm:true,metadata,publishNow:true})).status,200);
  await bridge.poll(report());await bridge.tick();assert.equal((await bridge.state()).jobs.length,0);
  assert.match((await pool.query('SELECT error FROM deliveries WHERE id=$1',[id])).rows[0].error,/login do perfil/);
  const profiles={[profileId]:{profileSaved:true,externalBusy:false}};
  await bridge.poll({...report(),profiles});await bridge.tick();const {job}=await bridge.poll({...report(),profiles});
  assert.equal(job.profileId,profileId);assert.equal(job.publishNow,true);
});

test('publicação manual permite preencher legenda de um MP4 da pasta sem JSON',async()=>{
  const video=await manualVideo();await pool.query("UPDATE videos SET metadata=NULL,status='waiting' WHERE id=$1",[video.videoId]);
  const candidates=await (await fetch(base+'/api/browser/videos')).json();assert.ok(candidates.items.some((item:any)=>item.id===video.videoId));
  const response=await post('/api/browser/videos/'+video.videoId+'/prepare',{profileId:'default',version:video.version});assert.equal(response.status,201,await response.clone().text());
  const {id}=await response.json(),draft=await (await fetch(base+'/api/native/deliveries/'+id)).json();
  assert.equal(draft.status,'review');assert.equal(draft.hasMedia,true);assert.equal((await bridge.state()).jobs.length,0);
});
