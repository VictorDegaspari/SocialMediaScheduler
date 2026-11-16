import { test,beforeEach,after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';

const dbUrl=new URL(process.env.DATABASE_URL!);dbUrl.pathname='/watcher_native_test';process.env.DATABASE_URL=dbUrl.toString();
const redisUrl=new URL(process.env.REDIS_URL!);redisUrl.pathname='/13';process.env.REDIS_URL=redisUrl.toString();
const temp=await mkdtemp(join(tmpdir(),'watcher-native-'));
process.env.DATA_DIR=join(temp,'spool');process.env.LOCAL_MEDIA_DIR=join(temp,'media');process.env.LOCAL_MEDIA_HOST_DIR=join(temp,'media');
await mkdir(process.env.LOCAL_MEDIA_DIR);
const app=express();app.use(express.json());
const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.on('listening',resolve));
const address=server.address() as {port:number},base='http://127.0.0.1:'+address.port;
process.env.APP_URL=base;
const {pool,redis,initDb,setSetting,getSetting}=await import('../src/db.js');
const {Worker}=await import('../src/worker.js');
const {PackSource}=await import('../src/pack-source.js');
const {PACK_ROOT,PACK_URL}=await import('../src/pack-config.js');
const {nativeScheduleSchema}=await import('../src/native-schedule.js');
const {LocalFiles}=await import('../src/local.js');
const {publicationRequests,requestRoutes}=await import('../src/publication-requests.js');
const {saveTitleReviews,syncYoutubeTitles}=await import('../src/video-titles.js');
const {updateYoutubeDisclosure}=await import('../src/native-api.js');
const {browserBridge,browserRoutes}=await import('../src/browser-bridge.js');
const {saveConnectedAccount,disconnectAccount}=await import('../src/connected-accounts.js');
const {nativeRoutes}=await import('../src/native-routes.js');
const {youtubeScopes,tiktokScopes,youtubeToken,tiktokToken,nativeChannels,nativeConnectionState}=await import('../src/native-auth.js');
const {decrypt,encrypt,AppError}=await import('../src/config.js');
await initDb();
execFileSync('ffmpeg',['-loglevel','error','-f','lavfi','-i','color=c=blue:s=64x96:d=1','-c:v','libx264','-pix_fmt','yuv420p','-metadata','title=Native private tag',join(temp,'video.mp4')]);
const bytes=await readFile(join(temp,'video.mp4'));
const originalFetch=globalThis.fetch;
let ytInit=0,ytBinary=0,ttInit=0,ttBinary=0,refreshes=0,scenario='ok';
let sentBody:any,ytFinished=false,ttFinished=false;
let ytRanges:string[]=[],ttRanges:string[]=[];
let authExchanges=0,authParams:URLSearchParams|undefined;
let uploadGate:Promise<void>|undefined;
let titleUpdates=0,remoteTitle='Título anterior';
let disclosureUpdates=0,remoteSynthetic=true;
globalThis.fetch=async(input,options)=>{
  const url=new URL(String(input));
  if(['localhost','127.0.0.1'].includes(url.hostname))return originalFetch(input,options);
  if(url.hostname==='monetizecomgta6.netlify.app')return Response.json([{t:'Vídeo 0001',drive:'public-pack-video-001',type:'v'},{t:'Imagem',drive:'public-pack-image-001',type:'img'}]);
  if(url.hostname==='drive.usercontent.google.com')return new Response(bytes,{headers:{'Content-Type':'video/mp4'}});
  if(url.hostname==='www.googleapis.com') {
    if(url.pathname==='/upload/youtube/v3/videos') {ytInit++;if(scenario==='quota')return Response.json({error:{errors:[{reason:'uploadLimitExceeded'}]}},{status:403});if(scenario==='reject')return Response.json({error:{errors:[{reason:'forbidden'}]}},{status:403});sentBody=JSON.parse(String(options?.body));return new Response(null,{status:200,headers:{location:'https://www.googleapis.com/upload/session/native?upload_id=secret-session'}});}
    if(url.pathname==='/upload/session/native') {
      const range=new Headers(options?.headers).get('content-range');
      if(range?.startsWith('bytes */')) {
        if(scenario==='expired')return new Response(null,{status:404});
        return ytFinished?Response.json({id:'youtube-native-123'}):new Response(null,{status:308});
      }
      ytBinary++;ytRanges.push(range!);
      if(uploadGate)await uploadGate;
      const limits=range!.match(/^bytes (\d+)-(\d+)\/(\d+)$/)!;
      assert.equal((options!.body as Buffer).length,Number(limits[2])-Number(limits[1])+1);
      if(Number(limits[2])+1<Number(limits[3]))return new Response(null,{status:308,headers:{range:'bytes=0-'+limits[2]}});
      ytFinished=true;
      if(scenario==='lost-yt')throw new TypeError('Lost response');
      return Response.json({id:'youtube-native-123'},{status:201});
    }
    if(url.pathname==='/youtube/v3/videos'){
      if(options?.method==='PUT'){
        if(url.searchParams.get('part')==='status'){
          const body=JSON.parse(String(options.body));assert.equal('snippet' in body,false);assert.equal(body.status.privacyStatus,'private');assert.equal(body.status.publishAt,sentBody.status.publishAt);assert.equal(body.status.selfDeclaredMadeForKids,false);
          disclosureUpdates++;remoteSynthetic=body.status.containsSyntheticMedia;return Response.json({id:'youtube-native-123',status:body.status});
        }
        const body=JSON.parse(String(options.body));assert.equal('status' in body,false);assert.equal(body.snippet.description,'Descrição preservada');assert.deepEqual(body.snippet.tags,['existente']);assert.equal(body.snippet.categoryId,'20');
        titleUpdates++;remoteTitle=body.snippet.title;return Response.json({id:'youtube-native-123',snippet:body.snippet});
      }
      return Response.json({items:[{id:'youtube-native-123',snippet:{channelId:scenario==='wrong-owner'?'another-channel':'youtube-channel',title:remoteTitle,description:'Descrição preservada',tags:['existente'],categoryId:'20'},status:{uploadStatus:'processed',privacyStatus:'private',publishAt:sentBody?.status?.publishAt,selfDeclaredMadeForKids:false,containsSyntheticMedia:remoteSynthetic}}]});
    }
    if(url.pathname==='/youtube/v3/channels')return Response.json({items:[{id:'youtube-channel',snippet:{title:'Canal de teste'}}]});
  }
  if(url.hostname==='open.tiktokapis.com') {
    if(url.pathname==='/v2/oauth/token/') {const params=new URLSearchParams(String(options?.body));if(params.get('grant_type')==='refresh_token')refreshes++;else{authExchanges++;authParams=params;}return Response.json({access_token:'refreshed-access',refresh_token:'rotated-refresh-'+refreshes,open_id:'tiktok-account',scope:tiktokScopes.join(','),expires_in:7200,refresh_expires_in:180*86400});}
    if(url.pathname==='/v2/user/info/')return Response.json({data:{user:{open_id:'tiktok-account',display_name:'TikTok teste'}},error:{code:'ok'}});
    if(url.pathname==='/v2/post/publish/inbox/video/init/') {ttInit++;return Response.json({data:{publish_id:'v_inbox_file~native',upload_url:'https://upload.us.tiktokapis.com/video/?upload_token=secret-session'},error:{code:'ok'}});}
    if(url.pathname==='/v2/post/publish/status/fetch/')return Response.json({data:{status:ttFinished?'SEND_TO_USER_INBOX':'PROCESSING_UPLOAD',uploaded_bytes:ttFinished?bytes.length:0},error:{code:'ok'}});
  }
  if(url.hostname==='upload.us.tiktokapis.com') {ttBinary++;const range=new Headers(options?.headers).get('content-range')!;ttRanges.push(range);const limits=range.match(/^bytes (\d+)-(\d+)\/(\d+)$/)!;assert.equal((options!.body as Buffer).length,Number(limits[2])-Number(limits[1])+1);ttFinished=Number(limits[2])+1===Number(limits[3]);if(scenario==='lost-tt')throw new TypeError('Lost response');return new Response(null,{status:ttFinished?201:206});}
  throw new Error('Unexpected request to '+url.hostname);
};
app.use(nativeRoutes);app.use(requestRoutes);app.use(browserRoutes);app.use((error:any,_req:any,res:any,_next:any)=>res.status(error instanceof AppError?error.status:400).json({error:error.message}));
async function post(path:string,body:unknown){return originalFetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
beforeEach(async()=>{
  await pool.query('TRUNCATE browser_commands,browser_agent,browser_settings,connected_accounts,content_claims,deliveries,videos,events,watches,settings,oauth_states CASCADE');
  ytInit=ytBinary=ttInit=ttBinary=refreshes=0;scenario='ok';ytFinished=ttFinished=false;
  ytRanges=[];ttRanges=[];
  authExchanges=0;authParams=undefined;
  titleUpdates=0;remoteTitle='Título anterior';
  disclosureUpdates=0;remoteSynthetic=true;
  await setSetting('publisherEngine','local');
  await setSetting('youtubeConfig',{clientId:'fake-client.apps.googleusercontent.com',clientSecret:'fake-secret',autoPublishApproved:true});
  await setSetting('youtubeAccount',{id:'youtube-channel',name:'Canal de teste'});
  await setSetting('youtubeTokens',{channelId:'youtube-channel',access_token:'fake-access',refresh_token:'fake-refresh',expiry_date:Date.now()+3600_000,scope:youtubeScopes.join(' ')});
  await setSetting('tiktokConfig',{clientKey:'test-key',clientSecret:'test-secret'});
  await setSetting('tiktokAccount',{id:'tiktok-account',name:'TikTok teste'});
  await setSetting('tiktokTokens',{access_token:'fake-tt-access',refresh_token:'fake-tt-refresh',open_id:'tiktok-account',scope:tiktokScopes.join(','),expires_at:Date.now()+3600_000,refresh_expires_at:Date.now()+86400_000});
});
async function prepare(mode='schedule',channels=['native:youtube:youtube-channel'],policy:Record<string,unknown>={}) {
  // Keep ordinary fixtures away from the moving minimum during FFmpeg preparation.
  if(mode==='native_schedule')policy={startAt:new Date(Date.now()+3600_000).toISOString(),...policy};
  const id=randomUUID(),path=join(process.env.LOCAL_MEDIA_DIR!,id);await mkdir(path);
  await writeFile(join(path,'video.mp4'),mode==='native_schedule'?Buffer.concat([bytes,Buffer.from(id)]):bytes);await writeFile(join(path,'video.json'),JSON.stringify({title:'Teste nativo',description:'Minha descrição',youtube:{visibility:mode==='native_schedule'?'public':'private',containsSyntheticMedia:true},tiktok:{madeWithAI:true}}));
  const folder=await new LocalFiles().folder(id);
  await pool.query(`INSERT INTO watches(id,name,folder_id,folder_url,source_type,integration_ids,import_existing,mode,native_schedule) VALUES($1,'Nativo',$2,$3,'local',$4,true,$5,$6)`,[id,folder.id,folder.hostPath,JSON.stringify(channels),mode,JSON.stringify(policy)]);
  const {rows:[watch]}=await pool.query('SELECT * FROM watches WHERE id=$1',[id]);
  const worker=new Worker();await worker.scan(watch);await pool.query("UPDATE videos SET stable_since=now()-interval '1 minute' WHERE watch_id=$1",[id]);await worker.native.prepareNext(watch);
  const {rows:deliveries}=await pool.query('SELECT * FROM deliveries WHERE video_id IN(SELECT id FROM videos WHERE watch_id=$1) ORDER BY provider',[id]);
  return {worker,watch,deliveries};
}
async function requestFixture(quantity=2,platforms=['youtube'],policy:Record<string,unknown>={maxScheduled:1,uploadsPer24h:100,postsPerDay:10}) {
  const path=join(process.env.LOCAL_MEDIA_DIR!,randomUUID());await mkdir(path);
  for(let n=0;n<3;n++)await writeFile(join(path,'video-'+n+'.mp4'),Buffer.concat([bytes,Buffer.from('request-'+path+'-'+n)]));
  const {id}=await publicationRequests.saveProfile({name:'Perfil '+randomUUID(),sourceType:'local',localPath:path,youtubeId:'native:youtube:youtube-channel',tiktokProfileId:'default',packDefaults:{titlePrefix:'Pedido',hashtags:[],madeWithAI:true}});
  const key=randomUUID(),body={profileId:id,platforms,quantity,times:['08:00','20:00'],policy,requestKey:key};
  const result=await publicationRequests.create(body);
  const {rows:[watch]}=await pool.query('SELECT w.* FROM watches w JOIN publishing_profiles p ON p.watch_id=w.id WHERE p.id=$1',[id]);
  const worker=new Worker();await worker.scan(watch);await pool.query("UPDATE videos SET stable_since=now()-interval '1 minute' WHERE watch_id=$1",[watch.id]);
  return {worker,watch,result,body};
}
test('pedido finito guarda excedente, libera vagas e para exatamente na quantidade solicitada',async()=>{
  const {worker,watch,result}=await requestFixture();const id=result.requests[0].id;
  await publicationRequests.tick(worker.native);await publicationRequests.tick(worker.native);
  let rows=(await pool.query('SELECT * FROM deliveries WHERE request_id=$1',[id])).rows;assert.equal(rows.length,1,'o teto de um agendado impede preparar o excedente');
  await worker.native.process(rows[0].id);await worker.native.reconcile();
  let context=await publicationRequests.context();let request=context.requests.find(r=>r.id===id)!;assert.equal(request.confirmed,1);assert.equal(request.waiting,1);
  await pool.query("UPDATE deliveries SET planned_at=now()-interval '1 hour',status='published' WHERE id=$1",[rows[0].id]);
  await publicationRequests.tick(worker.native);rows=(await pool.query('SELECT * FROM deliveries WHERE request_id=$1 ORDER BY created_at',[id])).rows;assert.equal(rows.length,2);
  await worker.native.process(rows[1].id);await new Worker().native.reconcile();await publicationRequests.tick(worker.native);await publicationRequests.tick(worker.native);
  request=(await publicationRequests.context()).requests.find(r=>r.id===id)!;assert.equal(request.status,'completed');assert.equal(request.confirmed,2);assert.equal(ytInit,2);
  assert.equal((await pool.query('SELECT enabled FROM watches WHERE id=$1',[watch.id])).rows[0].enabled,false);
  await pool.query("UPDATE deliveries SET status='failed',error='Processamento recusado' WHERE id=$1",[rows[1].id]);await publicationRequests.tick(worker.native);
  assert.equal((await publicationRequests.context()).requests.find(r=>r.id===id)?.status,'waiting_manual');assert.equal(ytInit,2,'falha tardia não inicia substituição sem revisão');
});
test('pedido é idempotente, quantidade vale por plataforma e cancelamento bloqueia novos envios',async()=>{
  const {worker,result,body}=await requestFixture(3,['youtube','tiktok']);assert.equal(result.requests.length,2);
  const repeated=await publicationRequests.create(body);assert.equal(repeated.reused,true);assert.deepEqual(repeated.requests,result.requests);
  await assert.rejects(()=>publicationRequests.create({...body,quantity:4}),/outros parâmetros/);
  await publicationRequests.cancel(result.requests.find(r=>r.provider==='youtube')!.id);await publicationRequests.tick(worker.native);
  assert.equal((await pool.query("SELECT id FROM deliveries WHERE provider='youtube'")).rowCount,0);
  const context=await publicationRequests.context();assert(context.actions.some(a=>a.kind==='browser_agent'));
});
test('arquivos aguardando metadados não bloqueiam um vídeo suficiente para concluir o pedido',async()=>{
  const {worker,watch,result}=await requestFixture(1);
  for(const n of [1,2])await writeFile(join(watch.folder_url,'video-'+n+'.json'),JSON.stringify({title:'Aguardando',ready:false}));
  await worker.scan(watch);await pool.query("UPDATE videos SET stable_since=now()-interval '1 minute' WHERE watch_id=$1",[watch.id]);
  await publicationRequests.tick(worker.native);
  const request=(await publicationRequests.context()).requests.find(r=>r.id===result.requests[0].id)!;assert.equal(request.status,'active');assert.equal(request.reserved,1);
});
test('origem bloqueada sinaliza a ação e continua habilitada para detectar correção dos arquivos',async()=>{
  const {worker,watch,result}=await requestFixture(1);
  for(const n of [0,1,2])await writeFile(join(watch.folder_url,'video-'+n+'.json'),JSON.stringify({title:'Aguardando',ready:false}));
  await worker.scan(watch);await publicationRequests.tick(worker.native);
  const context=await publicationRequests.context();assert(context.actions.some(a=>a.request_id===result.requests[0].id&&a.kind==='source_media'));
  assert.equal((await pool.query('SELECT enabled FROM watches WHERE id=$1',[watch.id])).rows[0].enabled,true);
});
test('conta de um pedido iniciado fica vinculada e não muda ao editar o perfil',async()=>{
  const {worker,result,body}=await requestFixture(2,['youtube'],{maxScheduled:10,uploadsPer24h:100,postsPerDay:10});
  await publicationRequests.tick(worker.native);
  await pool.query('UPDATE publishing_profiles SET youtube_id=NULL WHERE id=$1',[body.profileId]);
  await publicationRequests.tick(worker.native);
  const {rows}=await pool.query('SELECT integration_id FROM deliveries WHERE request_id=$1',[result.requests[0].id]);assert.equal(rows.length,2);assert(rows.every(r=>r.integration_id==='native:youtube:youtube-channel'));
});
test('data vencida de um pedido é replanejada antes do upload sem publicar imediatamente',async()=>{
  const {worker,result}=await requestFixture(1);await publicationRequests.tick(worker.native);
  const {rows:[d]}=await pool.query('SELECT * FROM deliveries WHERE request_id=$1',[result.requests[0].id]);
  await pool.query("UPDATE deliveries SET planned_at=now()-interval '1 day' WHERE id=$1",[d.id]);
  await worker.native.process(d.id);assert.equal(ytInit,1);assert(Date.parse(sentBody.status.publishAt)>Date.now());
  assert.equal(sentBody.status.privacyStatus,'private');
});
test('contas YouTube mantêm tokens independentes e desconectar uma não desconecta outra',async()=>{
  const config={clientId:'fake-client.apps.googleusercontent.com',clientSecret:'fake-secret',autoPublishApproved:true};
  for(const id of ['saved-one-123','saved-two-456'])await saveConnectedAccount('youtube',id,id,{channelId:id,access_token:'token-'+id,refresh_token:'refresh-'+id,expiry_date:Date.now()+3600000,scope:youtubeScopes.join(' ')},config);
  assert.equal(await youtubeToken('saved-one-123'),'token-saved-one-123');assert.equal(await youtubeToken('saved-two-456'),'token-saved-two-456');
  assert.equal((await nativeChannels()).filter(c=>c.id.includes('saved-')&&!c.disabled).length,2);
  await disconnectAccount('youtube','saved-two-456');assert.equal(await youtubeToken('saved-one-123'),'token-saved-one-123');await assert.rejects(()=>youtubeToken('saved-two-456'),/desconectada/);
  assert(!JSON.stringify(await publicationRequests.context()).includes('token-saved'));
});
test('Bíblicos sem canal ou autorização Drive gera pendência sem tentar publicar',async()=>{
  const {id}=await publicationRequests.saveProfile({name:'Bíblicos',sourceType:'google_drive',folderUrls:['https://drive.google.com/drive/folders/biblical-root-001','https://drive.google.com/drive/folders/biblical-child-02']});
  const result=await publicationRequests.create({profileId:id,quantity:5,platforms:['youtube'],times:['08:00'],requestKey:randomUUID()});
  await publicationRequests.tick(new Worker().native);const context=await publicationRequests.context();
  assert.equal(context.requests.find(r=>r.id===result.requests[0].id)?.status,'waiting_manual');assert(context.actions.some(a=>a.kind==='drive_login'));assert.equal(ytInit+ttInit,0);
});
test('pedido TikTok usa mídia preparada e confirma a conta/perfil sem depender da pasta de uploads',async()=>{
  process.env.BROWSER_AGENT_TOKEN='4'.repeat(64);const instanceId=randomUUID();
  await pool.query('TRUNCATE browser_commands,browser_agent,browser_settings');
  await browserBridge.poll({instanceId,desktop:true,profileSaved:true,externalBusy:false,activeJobId:null});
  const {worker,result}=await requestFixture(1,['tiktok']);const id=result.requests[0].id;
  await publicationRequests.tick(worker.native);await publicationRequests.tick(worker.native);
  const {job}=await browserBridge.poll({instanceId,desktop:true,profileSaved:true,externalBusy:false,activeJobId:null});assert(job?.media);assert.equal(job.profileId,'default');
  const response=await originalFetch(base+'/api/browser-agent/jobs/'+job.id+'/media',{headers:{Authorization:'Bearer '+process.env.BROWSER_AGENT_TOKEN}});assert.equal(response.status,200);
  assert((await response.arrayBuffer()).byteLength>0);
  await browserBridge.progress(job.id,{instanceId,stage:'browser_upload_started'});await browserBridge.progress(job.id,{instanceId,stage:'browser_scheduled'});await browserBridge.finish(job.id,{instanceId,result:'scheduled'});
  await publicationRequests.tick(worker.native);const request=(await publicationRequests.context()).requests.find(r=>r.id===id)!;assert.equal(request.status,'completed');assert.equal(request.confirmed,1);assert.equal(ytInit+ttInit,0);
});
test('YouTube e TikTok reaproveitam a mesma mídia verificada sem repetir download nem misturar claims',async()=>{
  await browserBridge.poll({instanceId:randomUUID(),desktop:true,profileSaved:true,externalBusy:false,activeJobId:null});
  const {worker,result}=await requestFixture(1,['youtube','tiktok']);
  const download=LocalFiles.prototype.download;let downloads=0;
  LocalFiles.prototype.download=async function(...args:Parameters<typeof download>){downloads++;return download.apply(this,args);};
  try{await publicationRequests.tick(worker.native);}finally{LocalFiles.prototype.download=download;}
  const {rows}=await pool.query('SELECT * FROM deliveries WHERE request_id=ANY($1::uuid[])',[result.requests.map(r=>r.id)]);
  assert.equal(rows.length,2);assert.equal(downloads,1);assert.equal(rows[0].video_id,rows[1].video_id);assert.equal(rows[0].payload.assetSha256,rows[1].payload.assetSha256);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM content_claims WHERE delivery_id=ANY($1::uuid[])',[rows.map(r=>r.id)])).rows[0].n,2);
  await publicationRequests.cancel(rows[0].request_id);
  assert((await readFile(join(process.env.DATA_DIR!,rows[1].local_file))).length>0,'cancelar um destino preserva a cópia independente do outro');
});
test('cópia preparada alterada não é reutilizada por outro destino',async()=>{
  await browserBridge.poll({instanceId:randomUUID(),desktop:true,profileSaved:true,externalBusy:false,activeJobId:null});
  const {worker,result,body}=await requestFixture(1,['tiktok']);
  const download=LocalFiles.prototype.download;let downloads=0;
  LocalFiles.prototype.download=async function(...args:Parameters<typeof download>){downloads++;return download.apply(this,args);};
  try {
    await publicationRequests.tick(worker.native);
    const {rows:[tt]}=await pool.query('SELECT * FROM deliveries WHERE request_id=$1',[result.requests[0].id]);
    await writeFile(join(process.env.DATA_DIR!,tt.local_file),'alterado');
    const next=await publicationRequests.create({...body,platforms:['youtube'],requestKey:randomUUID()});
    await publicationRequests.tick(worker.native);
    const {rows:[yt]}=await pool.query('SELECT * FROM deliveries WHERE request_id=$1',[next.requests[0].id]);
    assert(yt);assert.equal(downloads,2);assert.notEqual((await readFile(join(process.env.DATA_DIR!,yt.local_file))).toString(),'alterado');
    assert.equal(ytInit+ttInit,0);
  }finally{LocalFiles.prototype.download=download;}
});
test('cancelar um pedido durante transferência ainda sinaliza o resultado desconhecido',async()=>{
  const instanceId=randomUUID();await browserBridge.poll({instanceId,desktop:true,profileSaved:true,externalBusy:false,activeJobId:null});
  const {worker,result}=await requestFixture(1,['tiktok']);const id=result.requests[0].id;
  await publicationRequests.tick(worker.native);await publicationRequests.tick(worker.native);
  const {job}=await browserBridge.poll({instanceId,desktop:true,profileSaved:true,externalBusy:false,activeJobId:null});assert(job);
  await browserBridge.progress(job.id,{instanceId,stage:'browser_upload_started'});await publicationRequests.cancel(id);
  assert.equal(await browserBridge.finish(job.id,{instanceId,result:'cancelled'}),'unknown');
  const context=await publicationRequests.context();assert.equal(context.requests.find(r=>r.id===id)?.status,'cancelled');const action=context.actions.find(a=>a.request_id===id&&a.kind==='unknown_upload');assert(action);
  const resolved=await post('/api/assistant/actions/'+action.id+'/resolve',{confirm:true,resolution:'checked_not_scheduled'});assert.equal(resolved.status,200);
  assert.equal((await pool.query('SELECT status FROM deliveries WHERE request_id=$1',[id])).rows[0].status,'cancelled');
});
test('limite móvel do TikTok é revalidado ao entregar um trabalho ao agente',async()=>{
  const instanceId=randomUUID();await browserBridge.poll({instanceId,desktop:true,profileSaved:true,externalBusy:false,activeJobId:null});
  const {worker,result}=await requestFixture(2,['tiktok'],{maxScheduled:10,uploadsPer24h:1,postsPerDay:10});
  await publicationRequests.tick(worker.native);await publicationRequests.tick(worker.native);
  let {job}=await browserBridge.poll({instanceId,desktop:true,profileSaved:true,externalBusy:false,activeJobId:null});assert(job);
  await browserBridge.progress(job.id,{instanceId,stage:'browser_upload_started'});await browserBridge.progress(job.id,{instanceId,stage:'browser_scheduled'});await browserBridge.finish(job.id,{instanceId,result:'scheduled'});
  await publicationRequests.tick(worker.native);
  job=(await browserBridge.poll({instanceId,desktop:true,profileSaved:true,externalBusy:false,activeJobId:null})).job;assert.equal(job,null);
  const {rows}=await pool.query('SELECT status FROM deliveries WHERE request_id=$1',[result.requests[0].id]);assert.equal(rows.filter(r=>r.status==='scheduled').length,1);assert.equal(rows.filter(r=>r.status==='pending').length,1);
  assert.equal((await pool.query("SELECT id FROM browser_commands WHERE status IN ('pending','running')")).rowCount,0,'o limite de uma conta não reserva o agente ocioso');
  const login=await browserBridge.request('login');assert.equal((await browserBridge.poll({instanceId,desktop:true,profileSaved:true,externalBusy:false,activeJobId:null})).job?.id,login);
});
test('pack do site encontra vídeos sem OAuth Drive e agenda sem pasta ou JSON manual',async()=>{
  await new PackSource().catalog(true);
  const id=randomUUID();
  await pool.query(`INSERT INTO watches(id,name,folder_id,folder_url,source_type,integration_ids,import_existing,mode) VALUES($1,'Pack GTA 6',$2,$3,'gta6_pack','["native:youtube:youtube-channel"]',true,'native_schedule')`,[id,PACK_ROOT,PACK_URL]);
  const {rows:[watch]}=await pool.query('SELECT * FROM watches WHERE id=$1',[id]);
  const worker=new Worker();await worker.scan(watch);
  const {rows:videos}=await pool.query('SELECT * FROM videos WHERE watch_id=$1',[id]);assert.equal(videos.length,1);assert.equal(videos[0].status,'ready');
  assert.equal(videos[0].metadata.title,'GTA 6 — Vídeo 0001');assert.equal(Number(videos[0].size),0);
  await pool.query("UPDATE videos SET stable_since=now()-interval '1 minute' WHERE watch_id=$1",[id]);
  const blocked=await worker.native.prepareNext(watch);assert(blocked?.titleReviewRequired);assert.equal(ytInit,0);
  await saveTitleReviews({reviews:[{videoId:videos[0].id,title:'Cena azul de teste em formato vertical',sha256:createHash('sha256').update(bytes).digest('hex'),evidence:'Inspeção do MP4 de teste: um quadro azul vertical.'}]});
  await worker.native.prepareNext(watch);
  const {rows:[delivery]}=await pool.query('SELECT * FROM deliveries WHERE video_id=$1',[videos[0].id]);assert(delivery?.planned_at);
  await worker.native.process(delivery.id);assert.equal(ytInit,1);assert.equal(sentBody.status.publishAt,new Date(delivery.planned_at).toISOString());
  assert.equal(sentBody.status.containsSyntheticMedia,false,'upload do pack deixa o rótulo desmarcado quando não há declaração explícita');
  assert.equal(sentBody.snippet.title,'Cena azul de teste em formato vertical');
});
test('pack já enviado ao YouTube reutiliza revisão por hash após mudar os padrões do TikTok',async()=>{
  await new PackSource().catalog(true);
  const id=randomUUID();
  await pool.query(`INSERT INTO watches(id,name,folder_id,folder_url,source_type,integration_ids,import_existing,mode) VALUES($1,'Pack para duas contas',$2,$3,'gta6_pack','["native:youtube:youtube-channel"]',true,'draft')`,[id,PACK_ROOT,PACK_URL]);
  let {rows:[watch]}=await pool.query('SELECT * FROM watches WHERE id=$1',[id]);
  const worker=new Worker();await worker.scan(watch);
  const {rows:[video]}=await pool.query('SELECT * FROM videos WHERE watch_id=$1',[id]);
  await pool.query("UPDATE videos SET stable_since=now()-interval '1 minute' WHERE id=$1",[video.id]);
  await saveTitleReviews({reviews:[{videoId:video.id,title:'Gameplay azul revisado para as duas contas',sha256:createHash('sha256').update(bytes).digest('hex'),evidence:'Inspeção do mesmo MP4 vertical azul nos dois destinos.'}]});
  await worker.native.prepareNext(watch);
  // Simulate versions persisted by the old catalog, which mixed asset and defaults.
  await pool.query("UPDATE videos SET version='legacy-pack-version',json_version='legacy-json-version' WHERE id=$1",[video.id]);
  await pool.query("UPDATE video_title_reviews SET source_version='legacy-pack-version' WHERE video_id=$1",[video.id]);
  // A scan may already have rebound a ready asset while its hash review keeps
  // the old version; the reviewed bytes must still be checked before upload.
  await pool.query('UPDATE videos SET version=$2 WHERE id=$1',[video.id,video.version]);
  await pool.query(`UPDATE watches SET pack_defaults='{"madeWithAI":false,"youtubeContainsSyntheticMedia":false}' WHERE id=$1`,[id]);
  ({rows:[watch]}=await pool.query('SELECT * FROM watches WHERE id=$1',[id]));
  await worker.native.prepareNext(watch,{provider:'tiktok',integrationId:'browser:tiktok:default',channelName:'GTA 6',policy:nativeScheduleSchema.parse({}),cadence:watch});
  const {rows}=await pool.query('SELECT * FROM deliveries WHERE video_id=$1',[video.id]);assert.equal(rows.length,2);
  const tt=rows.find(d=>d.provider==='tiktok');assert(tt);assert.equal(tt.payload.metadata.tiktok.madeWithAI,false);
  assert.equal(tt.payload.metadata.title,'Gameplay azul revisado para as duas contas');assert.equal(tt.payload.stripMetadata,true);
  const {rows:[rebound]}=await pool.query('SELECT v.version,t.source_version FROM videos v JOIN video_title_reviews t ON t.video_id=v.id WHERE v.id=$1',[video.id]);
  assert.equal(rebound.version,rebound.source_version);assert.notEqual(rebound.version,'legacy-pack-version');assert.equal(ytInit,0);
  await pool.query("UPDATE video_title_reviews SET source_version='stale-review',sha256=$2 WHERE video_id=$1",[video.id,'f'.repeat(64)]);
  await worker.native.prepareNext(watch,{provider:'tiktok',integrationId:'browser:tiktok:other',channelName:'Outra conta',policy:nativeScheduleSchema.parse({}),cadence:watch});
  assert.equal((await pool.query('SELECT id FROM deliveries WHERE video_id=$1',[video.id])).rowCount,2,'hash diferente da revisão impede outra entrega');
});
test('títulos revisados aguardam a permissão de edição e sincronizam sem novos uploads ou alteração de data',async()=>{
  const {worker,result}=await requestFixture(1);await publicationRequests.tick(worker.native);
  const {rows:[delivery]}=await pool.query('SELECT d.*,v.sha256 FROM deliveries d JOIN videos v ON v.id=d.video_id WHERE d.request_id=$1',[result.requests[0].id]);
  await worker.native.process(delivery.id);
  const title='Cena azul de teste em formato vertical';
  await saveTitleReviews({reviews:[{videoId:delivery.video_id,title,sha256:delivery.sha256,evidence:'Inspeção do vídeo sintético azul vertical usado na integração.'}]});
  await syncYoutubeTitles(true);assert.equal(titleUpdates,0);assert((await publicationRequests.context()).actions.some(a=>a.kind==='youtube_titles'));
  await post('/api/assistant/requests/'+result.requests[0].id+'/resume',{});
  assert((await publicationRequests.context()).actions.some(a=>a.kind==='youtube_titles'),'retomar uploads não dispensa o consentimento de edição pendente');
  const tokens=await getSetting<any>('youtubeTokens');await setSetting('youtubeTokens',{...tokens,scope:tokens.scope+' https://www.googleapis.com/auth/youtube.force-ssl'});
  await syncYoutubeTitles(true);
  const {rows:[after]}=await pool.query('SELECT * FROM deliveries WHERE id=$1',[delivery.id]);
  assert.equal(after.payload.metadata.title,title);assert.equal(titleUpdates,1);assert.equal(ytInit,1);assert.equal(after.post_id,'youtube-native-123');assert.equal(after.planned_at.toISOString(),delivery.planned_at.toISOString());
  await syncYoutubeTitles(true);assert.equal(titleUpdates,1,'reiniciar ou repetir a sincronização não repete a edição confirmada');
  assert(!(await publicationRequests.context()).actions.some(a=>a.kind==='youtube_titles'));
  await assert.rejects(()=>saveTitleReviews({reviews:[{videoId:delivery.video_id,title,sha256:'f'.repeat(64),evidence:'Bytes de outro vídeo não podem receber esta revisão.'}]}),/bytes/);
});
test('consentimento de edição é opcional e fica vinculado ao canal solicitado',async()=>{
  const start=await originalFetch(base+'/auth/youtube?edit=1&channel=youtube-channel',{headers:{Host:new URL(process.env.APP_URL||'http://localhost').host},redirect:'manual'});
  assert.equal(start.status,302);const url=new URL(start.headers.get('location')!);
  assert(url.searchParams.get('scope')?.split(' ').includes('https://www.googleapis.com/auth/youtube.force-ssl'));
  const {rows:[state]}=await pool.query('SELECT verifier FROM oauth_states WHERE hash=$1',[createHash('sha256').update(url.searchParams.get('state')!).digest('hex')]);
  const saved=decrypt<any>(state.verifier);assert.equal(saved.editMetadata,true);assert.equal(saved.expectedChannelId,'youtube-channel');
  assert((await nativeChannels()).some(c=>c.id==='native:youtube:youtube-channel'&&!c.disabled&&!c.canEditVideos),'pedir edição não invalida a autorização de upload já existente');
});
test('OAuth de edição recusa outro canal e preserva a preferência de envio automático na renovação correta',async()=>{
  const {OAuth2Client}=await import('google-auth-library');
  const getToken=OAuth2Client.prototype.getToken,getTokenInfo=OAuth2Client.prototype.getTokenInfo;
  (OAuth2Client.prototype as any).getToken=async()=>({tokens:{access_token:'new-edit-token',refresh_token:'new-edit-refresh',expiry_date:Date.now()+3600000}});
  (OAuth2Client.prototype as any).getTokenInfo=async()=>({scopes:[...youtubeScopes,'https://www.googleapis.com/auth/youtube.force-ssl']});
  await saveConnectedAccount('youtube','youtube-channel','Canal de teste',{channelId:'youtube-channel',access_token:'original-access',refresh_token:'original-refresh',scope:youtubeScopes.join(' '),expiry_date:Date.now()+3600000},{clientId:'fake-client.apps.googleusercontent.com',clientSecret:'fake-secret',autoPublishApproved:false});
  try {
    for(const expected of ['different-channel','youtube-channel']) {
      const start=await originalFetch(base+'/auth/youtube?edit=1&channel='+expected,{redirect:'manual'}),url=new URL(start.headers.get('location')!);
      const response=await originalFetch(base+'/auth/youtube/callback?state='+url.searchParams.get('state')+'&code=fixture-edit-code',{redirect:'manual',headers:{Cookie:start.headers.get('set-cookie')!.split(';')[0]}});
      const {rows:[account]}=await pool.query("SELECT tokens,config FROM connected_accounts WHERE provider='youtube' AND external_id='youtube-channel'");
      assert.equal(decrypt<any>(account.config).autoPublishApproved,false);
      if(expected==='different-channel'){assert.match(response.headers.get('location')!,/youtube-failed/);assert.equal(decrypt<any>(account.tokens).access_token,'original-access');}
      else {assert.match(response.headers.get('location')!,/youtube-success/);assert.equal(decrypt<any>(account.tokens).access_token,'new-edit-token');assert((await nativeChannels()).find(c=>c.id==='native:youtube:youtube-channel')?.canEditVideos);}
    }
  }finally{OAuth2Client.prototype.getToken=getToken;OAuth2Client.prototype.getTokenInfo=getTokenInfo;}
});
test('motor local envia ao YouTube sem Postiz e preserva visibilidade, IA e original',async()=>{
  const {worker,watch,deliveries:[d]}=await prepare();
  assert.equal(d.status,'pending');assert(d.approved_at);assert.deepEqual(await worker.native.ready(),[d.id]);
  await worker.native.process(d.id);
  assert.equal(ytInit,1);assert.equal(ytBinary,1);
  assert.equal(sentBody.status.privacyStatus,'private');assert.equal(sentBody.status.containsSyntheticMedia,true);
  const {rows:[saved]}=await pool.query('SELECT * FROM deliveries WHERE id=$1',[d.id]);
  assert.equal(saved.post_id,'youtube-native-123');assert.equal(saved.status,'processing');assert.equal(saved.local_file,null);
  assert(!saved.session.includes('secret-session'),'session URL must be encrypted');
  await worker.native.reconcile();
  const {rows:[done]}=await pool.query('SELECT status FROM deliveries WHERE id=$1',[d.id]);assert.equal(done.status,'private');
  assert.deepEqual(await readFile(join(watch.folder_url,'video.mp4')),bytes);
});
test('corrige a declaração de um vídeo existente sem reenviar ou mudar a publicação',async()=>{
  const {worker,deliveries:[delivery]}=await prepare('native_schedule');await worker.native.process(delivery.id);
  const result=await updateYoutubeDisclosure('youtube-native-123',false,'youtube-channel');
  assert.equal(result.apiAccepted,true);assert.equal(result.reportedSyntheticMedia,false);assert.equal(result.privacyStatus,'private');assert.equal(result.publishAt,new Date(delivery.planned_at).toISOString());
  assert.equal(ytInit,1);assert.equal(disclosureUpdates,1);assert.equal(titleUpdates,0);
  scenario='wrong-owner';await assert.rejects(()=>updateYoutubeDisclosure('youtube-native-123',false,'youtube-channel'),/pertence/);assert.equal(disclosureUpdates,1);
});
test('perfil guarda declarações independentes do YouTube e TikTok',async()=>{
  const {id}=await publicationRequests.saveProfile({name:'Declarações independentes',sourceType:'gta6_pack',youtubeId:'native:youtube:youtube-channel',packDefaults:{madeWithAI:true,youtubeContainsSyntheticMedia:false}});
  const {rows:[watch]}=await pool.query('SELECT w.* FROM watches w JOIN publishing_profiles p ON p.watch_id=w.id WHERE p.id=$1',[id]);
  assert.equal(watch.metadata_defaults.youtube.containsSyntheticMedia,false);assert.equal(watch.metadata_defaults.tiktok.madeWithAI,true);
});
test('padrão do YouTube desmarca a antiga herança sem apagar uma declaração explícita',async()=>{
  const input={name:'Padrão de declaração',sourceType:'gta6_pack',youtubeId:'native:youtube:youtube-channel',packDefaults:{madeWithAI:true}};
  const {id}=await publicationRequests.saveProfile(input);
  await pool.query(`UPDATE watches SET pack_defaults=pack_defaults-'youtubeContainsSyntheticMedia',
    metadata_defaults=jsonb_set(metadata_defaults,'{youtube,containsSyntheticMedia}','true'::jsonb)
    WHERE id=(SELECT watch_id FROM publishing_profiles WHERE id=$1)`,[id]);
  await initDb();
  let {rows:[watch]}=await pool.query('SELECT w.* FROM watches w JOIN publishing_profiles p ON p.watch_id=w.id WHERE p.id=$1',[id]);
  assert.equal(watch.pack_defaults.youtubeContainsSyntheticMedia,false);assert.equal(watch.metadata_defaults.youtube.containsSyntheticMedia,false);assert.equal(watch.metadata_defaults.tiktok.madeWithAI,true);
  await publicationRequests.saveProfile({...input,packDefaults:{...input.packDefaults,youtubeContainsSyntheticMedia:true}},id);
  await initDb();
  ({rows:[watch]}=await pool.query('SELECT w.* FROM watches w JOIN publishing_profiles p ON p.watch_id=w.id WHERE p.id=$1',[id]));
  assert.equal(watch.pack_defaults.youtubeContainsSyntheticMedia,true);assert.equal(watch.metadata_defaults.youtube.containsSyntheticMedia,true,'uma declaração selecionada explicitamente é preservada após reiniciar');
});
test('lote nativo reserva datas distintas no mesmo canal e para no teto global',async()=>{
  const first=await prepare('native_schedule',['native:youtube:youtube-channel'],{maxScheduled:2});
  const second=await prepare('native_schedule',['native:youtube:youtube-channel'],{maxScheduled:2});
  const third=await prepare('native_schedule',['native:youtube:youtube-channel'],{maxScheduled:2});
  assert.equal(first.deliveries.length,1);assert.equal(second.deliveries.length,1);assert.equal(third.deliveries.length,0);
  assert(new Date(second.deliveries[0].planned_at).getTime()>new Date(first.deliveries[0].planned_at).getTime());
  await first.worker.native.process(first.deliveries[0].id);
  assert.equal(sentBody.status.publishAt,new Date(first.deliveries[0].planned_at).toISOString());
  assert.equal(sentBody.status.privacyStatus,'private');
  await first.worker.native.reconcile();
  assert.equal((await pool.query('SELECT status FROM deliveries WHERE id=$1',[first.deliveries[0].id])).rows[0].status,'scheduled');
});
test('orçamento móvel impede segundo upload e horário vencido nunca vira publicação imediata',async()=>{
  const first=await prepare('native_schedule',['native:youtube:youtube-channel'],{uploadsPer24h:1});
  const second=await prepare('native_schedule',['native:youtube:youtube-channel'],{uploadsPer24h:1});
  await first.worker.native.process(first.deliveries[0].id);
  await second.worker.native.process(second.deliveries[0].id);assert.equal(ytInit,1);
  await pool.query("UPDATE deliveries SET upload_started_at=now()-interval '25 hours'");
  await pool.query("UPDATE deliveries SET planned_at=now()-interval '1 minute' WHERE id=$1",[second.deliveries[0].id]);
  await second.worker.native.process(second.deliveries[0].id);assert.equal(ytInit,1);
  assert.equal((await pool.query('SELECT status FROM deliveries WHERE id=$1',[second.deliveries[0].id])).rows[0].status,'failed');
});
test('limite do canal YouTube bloqueia o restante do lote inclusive depois de reiniciar',async()=>{
  const first=await prepare('native_schedule'),second=await prepare('native_schedule');scenario='quota';
  await first.worker.native.process(first.deliveries[0].id);assert.equal(ytInit,1,JSON.stringify((await pool.query('SELECT status,error FROM deliveries WHERE id=$1',[first.deliveries[0].id])).rows[0]));
  const until=await getSetting<string>('uploadCooldown:native:youtube:youtube-channel');assert(Date.parse(until!)>Date.now()+23*3600_000);
  await new Worker().native.process(second.deliveries[0].id);assert.equal(ytInit,1);
});
test('cem itens em cooldown não escondem outra conta e a seleção intercala contas quando liberadas',async()=>{
  const {worker,watch,deliveries:[first]}=await prepare('native_schedule');
  const blocked='native:youtube:blocked-channel';
  await pool.query(`INSERT INTO videos(id,watch_id,file_id,name,parent_id,status)
    SELECT gen_random_uuid(),$1,'blocked-'||n,'Bloqueado '||n,'root','sent' FROM generate_series(1,100) n`,[watch.id]);
  await pool.query(`INSERT INTO deliveries(id,video_id,integration_id,provider,engine,status,approved_at,created_at)
    SELECT gen_random_uuid(),id,$2,'youtube','local','pending',now(),now()-interval '1 day' FROM videos WHERE watch_id=$1 AND file_id LIKE 'blocked-%'`,[watch.id,blocked]);
  await setSetting('uploadCooldown:'+blocked,new Date(Date.now()+3600_000).toISOString());
  assert.deepEqual(await worker.native.ready(),[first.id]);
  await setSetting('uploadCooldown:'+blocked,new Date(Date.now()-1).toISOString());
  const ready=await worker.native.ready();assert.equal(ready.length,100);assert(ready.slice(0,2).includes(first.id),'a conta mais recente recebe uma vez antes da segunda vez da conta antiga');
  assert.equal(ytInit,0);
});
test('coordenação e recuperação continuam durante upload sem retomar a entrega ativa nem ultrapassar orçamento',async()=>{
  const first=await prepare('native_schedule',['native:youtube:youtube-channel'],{uploadsPer24h:1});
  const second=await prepare('native_schedule',['native:youtube:youtube-channel'],{uploadsPer24h:1});
  let release!:()=>void;uploadGate=new Promise<void>(resolve=>{release=resolve;});
  const transfer=first.worker.native.process(first.deliveries[0].id);
  try {
    const limit=Date.now()+5000;while(!ytBinary){if(Date.now()>limit)throw new Error('O upload não começou');await new Promise(resolve=>setTimeout(resolve,10));}
    await second.worker.native.process(first.deliveries[0].id);
    await second.worker.native.process(second.deliveries[0].id);
    await second.worker.tick();
    assert(second.worker.lastTick);assert.equal(ytInit,1);
    assert.equal((await pool.query('SELECT status FROM deliveries WHERE id=$1',[first.deliveries[0].id])).rows[0].status,'submitting');
  }finally{uploadGate=undefined;release();await transfer;}
  await second.worker.native.process(second.deliveries[0].id);assert.equal(ytInit,1,'o ciclo concorrente preserva o orçamento móvel');
});
test('calendário compacto conserva o último horário antigo e tentativas canceladas recentes',async()=>{
  const {worker,watch,deliveries:[first]}=await prepare('native_schedule');
  const channel=first.integration_id;
  await pool.query(`INSERT INTO videos(id,watch_id,file_id,name,parent_id,status)
    SELECT gen_random_uuid(),$1,'history-'||n,'Antigo '||n,'root','sent' FROM generate_series(1,500) n`,[watch.id]);
  await pool.query(`INSERT INTO deliveries(id,video_id,integration_id,provider,status,planned_at)
    SELECT gen_random_uuid(),id,$2,'youtube','published',now()-interval '1 year' FROM videos WHERE watch_id=$1 AND file_id LIKE 'history-%'`,[watch.id,channel]);
  await pool.query("UPDATE deliveries SET status='cancelled',planned_at=now()-interval '3 days',upload_started_at=now()-interval '1 hour' WHERE id=$1",[first.id]);
  const calendar=await worker.native.calendar(channel);
  assert.equal(calendar.length,2);assert.equal(calendar.filter(r=>r.plannedAt).length,1);
  assert.equal(calendar.find(r=>r.id===first.id)?.plannedAt,null);assert(calendar.find(r=>r.id===first.id)?.startedAt);
});
test('reduzir o teto revalida reservas antes do upload e cancelar o excedente libera capacidade',async()=>{
  const first=await prepare('native_schedule'),second=await prepare('native_schedule');
  await pool.query('UPDATE watches SET native_schedule=$2 WHERE id=$1',[first.watch.id,JSON.stringify({maxScheduled:1})]);
  await first.worker.native.process(first.deliveries[0].id);assert.equal(ytInit,0);
  assert.match((await pool.query('SELECT error FROM deliveries WHERE id=$1',[first.deliveries[0].id])).rows[0].error,/limites atuais/);
  assert.equal((await post('/api/native/deliveries/'+second.deliveries[0].id+'/cancel',{})).status,200);
  await first.worker.native.process(first.deliveries[0].id);assert.equal(ytInit,1);
});
test('cancelar uma tentativa iniciada não devolve o orçamento de uploads das últimas 24 horas',async()=>{
  const first=await prepare('native_schedule',['native:youtube:youtube-channel'],{uploadsPer24h:1});
  const second=await prepare('native_schedule',['native:youtube:youtube-channel'],{uploadsPer24h:1});
  scenario='reject';await first.worker.native.process(first.deliveries[0].id);assert.equal(ytInit,1);
  assert.equal((await post('/api/native/deliveries/'+first.deliveries[0].id+'/cancel',{})).status,200);
  scenario='ok';await second.worker.native.process(second.deliveries[0].id);assert.equal(ytInit,1);
});
test('retoma criação cuja resposta final foi perdida sem inicializar outro upload',async()=>{
  scenario='lost-yt';const {worker,deliveries:[d]}=await prepare();await worker.native.process(d.id);
  let {rows:[saved]}=await pool.query('SELECT * FROM deliveries WHERE id=$1',[d.id]);assert.equal(saved.status,'retry');
  assert.equal(decrypt<any>(saved.session).finalizing,true);
  await pool.query("UPDATE deliveries SET status='submitting' WHERE id=$1",[d.id]);
  const restarted=new Worker();await restarted.native.recover();await restarted.native.process(d.id);
  ({rows:[saved]}=await pool.query('SELECT * FROM deliveries WHERE id=$1',[d.id]));
  assert.equal(saved.post_id,'youtube-native-123');assert.equal(ytInit,1);assert.equal(ytBinary,1);
});
test('sessão expirada fica sem confirmação e nunca inicia um segundo vídeo',async()=>{
  scenario='lost-yt';const {worker,deliveries:[d]}=await prepare();await worker.native.process(d.id);
  scenario='expired';await pool.query('UPDATE deliveries SET retry_at=now() WHERE id=$1',[d.id]);await worker.native.process(d.id);
  const {rows:[saved]}=await pool.query('SELECT status FROM deliveries WHERE id=$1',[d.id]);assert.equal(saved.status,'unknown');assert.equal(ytInit,1);
  await worker.native.process(d.id);assert.equal(ytInit,1);
  scenario='wrong-owner';assert.equal((await post('/api/native/deliveries/'+d.id+'/link',{postId:'youtube-native-123'})).status,400);
  scenario='ok';assert.equal((await post('/api/native/deliveries/'+d.id+'/link',{postId:'youtube-native-123'})).status,200);
  assert.equal(ytInit,1);
});
test('TikTok sempre exige revisão e aprovação explícita antes do envio à caixa de entrada',async()=>{
  const {worker,deliveries:[d]}=await prepare('schedule',['native:tiktok:tiktok-account']);
  assert.equal(d.status,'review');assert.equal(d.approved_at,null);assert.deepEqual(await worker.native.ready(),[]);
  await worker.native.process(d.id);assert.equal(ttInit,0);
  assert.equal((await post('/api/native/deliveries/'+d.id+'/approve',{confirm:false,metadata:d.payload.metadata})).status,400);
  const preview=await originalFetch(base+'/api/native/deliveries/'+d.id+'/media');assert.equal(preview.status,200);
  assert.equal((await post('/api/native/deliveries/'+d.id+'/approve',{confirm:true,metadata:d.payload.metadata})).status,200);
  await worker.native.process(d.id);assert.equal(ttInit,1);assert.equal(ttBinary,1);
  await worker.native.reconcile();
  const {rows:[saved]}=await pool.query('SELECT status,payload FROM deliveries WHERE id=$1',[d.id]);assert.equal(saved.status,'inbox');assert.equal(saved.payload.metadata.tiktok.madeWithAI,true);
});
test('retoma TikTok pela posição da sessão e persiste refresh token rotacionado',async()=>{
  scenario='lost-tt';const {worker,deliveries:[d]}=await prepare('draft',['native:tiktok:tiktok-account']);
  await post('/api/native/deliveries/'+d.id+'/approve',{confirm:true,metadata:d.payload.metadata});
  await worker.native.process(d.id);assert.equal(ttInit,1);assert.equal(ttBinary,1);
  await pool.query('UPDATE deliveries SET retry_at=now() WHERE id=$1',[d.id]);await worker.native.process(d.id);
  assert.equal(ttInit,1);assert.equal(ttBinary,1);
  const tokens=await getSetting<any>('tiktokTokens');await setSetting('tiktokTokens',{...tokens,expires_at:0});
  await Promise.all([tiktokToken(),tiktokToken()]);assert.equal(refreshes,1);
  assert.equal((await getSetting<any>('tiktokTokens')).refresh_token,'rotated-refresh-1');
});
test('revogar automático, pausar rotina e copiar vídeo não gera envio adicional',async()=>{
  const {worker,watch,deliveries:[d]}=await prepare();
  const config=await getSetting<any>('youtubeConfig');await setSetting('youtubeConfig',{...config,autoPublishApproved:false});
  await worker.native.process(d.id);assert.equal(ytInit,0);
  const {rows:[review]}=await pool.query('SELECT status FROM deliveries WHERE id=$1',[d.id]);assert.equal(review.status,'review');
  await post('/api/native/deliveries/'+d.id+'/approve',{confirm:true,metadata:d.payload.metadata});
  await pool.query('UPDATE watches SET enabled=false WHERE id=$1',[watch.id]);await worker.native.process(d.id);assert.equal(ytInit,0);
  await pool.query('UPDATE watches SET enabled=true WHERE id=$1',[watch.id]);await worker.native.process(d.id);assert.equal(ytInit,1);
  const other=await prepare();assert.equal(other.deliveries[0].status,'duplicate');await other.worker.native.process(other.deliveries[0].id);assert.equal(ytInit,1);
});
test('cópia alterada e conta diferente bloqueiam o envio; cancelamento libera arquivo sem publicar',async()=>{
  const {worker,deliveries:[d]}=await prepare();
  await writeFile(join(process.env.DATA_DIR!,d.local_file),'tampered');await worker.native.process(d.id);
  let {rows:[saved]}=await pool.query('SELECT status FROM deliveries WHERE id=$1',[d.id]);assert.equal(saved.status,'unknown');assert.equal(ytInit,0);
  await setSetting('youtubeAccount',{id:'different-account',name:'Outra conta'});
  await pool.query("UPDATE deliveries SET status='pending',retry_at=now() WHERE id=$1",[d.id]);await worker.native.process(d.id);
  ({rows:[saved]}=await pool.query('SELECT status FROM deliveries WHERE id=$1',[d.id]));assert.equal(saved.status,'failed');
  const response=await post('/api/native/deliveries/'+d.id+'/cancel',{});assert.equal(response.status,200);
  await assert.rejects(()=>readFile(join(process.env.DATA_DIR!,d.local_file)),{code:'ENOENT'});assert.equal(ytInit,0);
});
test('escopos ausentes desabilitam o canal e nenhum upload é tentado',async()=>{
  const {worker,deliveries:[d]}=await prepare();
  const tokens=await getSetting<any>('youtubeTokens');await setSetting('youtubeTokens',{...tokens,scope:youtubeScopes[1]});
  assert.equal((await nativeChannels()).find(c=>c.identifier==='youtube')?.disabled,true);
  assert.equal((await nativeConnectionState()).youtube.connected,false);
  await worker.native.process(d.id);assert.equal(ytInit,0);
  const tt=await getSetting<any>('tiktokTokens');await setSetting('tiktokTokens',{...tt,scope:'user.info.basic'});
  await assert.rejects(()=>tiktokToken(),/video.upload/);assert.equal(ttInit,0);
});
test('tokens são vinculados à conta da entrega, inclusive após uma troca de conexão',async()=>{
  await assert.rejects(()=>youtubeToken('other-channel'),/não pertence/);
  await assert.rejects(()=>tiktokToken('other-account'),/não pertence/);
  await setSetting('youtubeAccount',{id:'other-channel',name:'Outro canal'});
  await assert.rejects(()=>youtubeToken(),/não pertence/);
  assert.equal((await nativeConnectionState()).youtube.connected,false);
  assert.equal(ytInit+ttInit,0);
});
test('YouTube usa PKCE e state de uso único; TikTok recusa autorização web sem HTTPS',async()=>{
  const start=await originalFetch(base+'/auth/youtube',{headers:{Host:new URL(process.env.APP_URL||'http://localhost:4317').host},redirect:'manual'});
  assert.equal(start.status,302);
  const location=new URL(start.headers.get('location')!);assert(location.searchParams.get('code_challenge'));assert.equal(location.searchParams.get('code_challenge_method'),'S256');
  assert(youtubeScopes.every(s=>location.searchParams.get('scope')?.split(' ').includes(s)));
  const state=location.searchParams.get('state'),cookie=start.headers.get('set-cookie')!.split(';')[0];
  const invalid=await originalFetch(base+'/auth/youtube/callback?state='+state,{redirect:'manual'});assert.match(invalid.headers.get('location')!,/youtube-invalid/);
  const denied=await originalFetch(base+'/auth/youtube/callback?state='+state+'&error=access_denied',{redirect:'manual',headers:{Cookie:cookie}});assert.match(denied.headers.get('location')!,/youtube-denied/);
  assert.equal((await pool.query('SELECT * FROM oauth_states')).rows.length,0);
  const tiktok=await originalFetch(base+'/auth/tiktok',{redirect:'manual',headers:{Host:new URL(process.env.APP_URL||'http://localhost:4317').host}});assert.equal(tiktok.status,400);
  assert.equal(ytInit+ttInit,0);
});
test('TikTok Desktop conecta pelo loopback com PKCE hexadecimal e preserva o canal YouTube',async()=>{
  assert.equal((await post('/api/settings/tiktok',{clientKey:'test-key',loginMode:'desktop'})).status,200);
  const initial=await nativeConnectionState();
  assert.equal(initial.tiktok.loginMode,'desktop');assert.equal(initial.tiktok.httpsRequired,false);assert.equal(initial.youtube.connected,true);
  const start=await originalFetch(base+'/auth/tiktok',{redirect:'manual'});assert.equal(start.status,302);
  const url=new URL(start.headers.get('location')!);assert.equal(url.hostname,'www.tiktok.com');
  assert.equal(url.searchParams.get('redirect_uri'),base+'/auth/tiktok/callback');
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.match(url.searchParams.get('code_challenge')!,/^[a-f\d]{64}$/);
  assert.equal(url.searchParams.has('code_verifier'),false);assert.equal(url.searchParams.has('client_secret'),false);
  const state=url.searchParams.get('state')!,hash=createHash('sha256').update(state).digest('hex');
  const {rows:[row]}=await pool.query('SELECT verifier FROM oauth_states WHERE hash=$1',[hash]);
  const saved=decrypt<any>(row.verifier);
  assert.equal(saved.loginMode,'desktop');assert.match(saved.verifier,/^[\w-]{43}$/);
  assert.equal(url.searchParams.get('code_challenge'),createHash('sha256').update(saved.verifier).digest('hex'));
  assert(!row.verifier.includes(saved.verifier));
  const cookie=start.headers.get('set-cookie')!.split(';')[0];
  const callback=await originalFetch(base+'/auth/tiktok/callback?state='+state+'&code=fixture-code',{headers:{Cookie:cookie},redirect:'manual'});
  assert.match(callback.headers.get('location')!,/tiktok-success/);assert.equal(authExchanges,1);
  assert.equal(authParams?.get('code_verifier'),saved.verifier);assert.equal(authParams?.get('redirect_uri'),base+'/auth/tiktok/callback');
  const connected=await nativeConnectionState();assert.equal(connected.tiktok.connected,true);assert.equal(connected.youtube.connected,true);
  const replay=await originalFetch(base+'/auth/tiktok/callback?state='+state+'&code=fixture-code',{headers:{Cookie:cookie},redirect:'manual'});
  assert.match(replay.headers.get('location')!,/tiktok-denied/);assert.equal(authExchanges,1);
});
test('Desktop não troca o código por token sem cookie e verificador PKCE válido',async()=>{
  await post('/api/settings/tiktok',{clientKey:'test-key',loginMode:'desktop'});
  const start=await originalFetch(base+'/auth/tiktok',{redirect:'manual'}),url=new URL(start.headers.get('location')!);
  const state=url.searchParams.get('state')!,cookie=start.headers.get('set-cookie')!.split(';')[0];
  const noCookie=await originalFetch(base+'/auth/tiktok/callback?state='+state+'&code=fixture-code',{redirect:'manual'});
  assert.match(noCookie.headers.get('location')!,/tiktok-invalid/);
  await pool.query('UPDATE oauth_states SET verifier=$2 WHERE hash=$1',[createHash('sha256').update(state).digest('hex'),encrypt({provider:'tiktok',loginMode:'desktop'})]);
  const missingPkce=await originalFetch(base+'/auth/tiktok/callback?state='+state+'&code=fixture-code',{headers:{Cookie:cookie},redirect:'manual'});
  assert.match(missingPkce.headers.get('location')!,/tiktok-failed/);assert.equal(authExchanges,0);
});
test('uploads maiores usam blocos sequenciais com Content-Range e tamanhos corretos',async()=>{
  const {uploadYoutube,uploadTiktok}=await import('../src/native-api.js');
  const {metadataSchema}=await import('../src/domain.js');
  const path=join(temp,'large.bin'),size=20*1024*1024;await writeFile(path,Buffer.alloc(size,7));
  await uploadYoutube(path,metadataSchema.parse({title:'Arquivo grande'}),null,async()=>{});
  assert.deepEqual(ytRanges,[`bytes 0-8388607/${size}`,`bytes 8388608-16777215/${size}`,`bytes 16777216-${size-1}/${size}`]);
  await uploadTiktok(path,null,async()=>{});
  assert.deepEqual(ttRanges,[`bytes 0-8388607/${size}`,`bytes 8388608-${size-1}/${size}`]);
});
after(async()=>{globalThis.fetch=originalFetch;await new Promise<void>(resolve=>server.close(()=>resolve()));await redis.quit();await pool.end();await rm(temp,{recursive:true,force:true});});
