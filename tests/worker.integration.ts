import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Always use a separate database, even when invoked in the application container.
const dbUrl=new URL(process.env.DATABASE_URL!);dbUrl.pathname='/watcher_test';process.env.DATABASE_URL=dbUrl.toString();
const redisUrl=new URL(process.env.REDIS_URL!);redisUrl.pathname='/15';process.env.REDIS_URL=redisUrl.toString();
const temp=await mkdtemp(join(tmpdir(),'watcher-fixture-'));
process.env.DATA_DIR=join(temp,'spool');
process.env.LOCAL_MEDIA_DIR=join(temp,'local');
process.env.LOCAL_MEDIA_HOST_DIR=join(temp,'local');
const {pool,redis,initDb,setSetting}=await import('../src/db.js');
const {Worker}=await import('../src/worker.js');
const originalFetch=globalThis.fetch;
execFileSync('ffmpeg',['-loglevel','error','-f','lavfi','-i','color=c=green:s=64x96:d=1','-c:v','libx264','-pix_fmt','yuv420p','-metadata','title=Private embedded title',join(temp,'video.mp4')]);
const bytes=readFileSync(join(temp,'video.mp4'));
await initDb();
await pool.query('TRUNCATE connected_accounts,content_claims,deliveries,videos,events,watches,settings,oauth_states CASCADE');
let createCalls=0,uploadCalls=0,scenario='success',present=true;
let lastUploadedBytes:Buffer|undefined;
let version='1';
globalThis.fetch=async(input,options)=>{
  const url=new URL(String(input));
  if(url.hostname==='www.googleapis.com'){
    if(url.pathname.endsWith('/files') && url.searchParams.has('q'))return Response.json({files:present?[{id:'video-id',name:'video.mp4',mimeType:'video/mp4',size:String(bytes.length),version,parents:['root-folder']},{id:'json-id',name:'video.json',mimeType:'application/json',version:'1',parents:['root-folder']}]:[]});
    if(url.pathname.endsWith('/video-id') && url.searchParams.get('alt')==='media')return new Response(bytes);
    if(url.pathname.endsWith('/json-id') && url.searchParams.get('alt')==='media')return Response.json({title:'Fixture',ready:true,youtube:{visibility:'private'}});
    if(url.pathname.endsWith('/root-folder'))return Response.json({id:'root-folder',name:'Root',mimeType:'application/vnd.google-apps.folder'});
    if(url.pathname.endsWith('/video-id'))return Response.json({id:'video-id',version});
    if(url.pathname.endsWith('/json-id'))return Response.json({id:'json-id',version:'1'});
  }
  if(url.hostname==='fake-postiz.test'){
    if(url.pathname.endsWith('/integrations'))return Response.json([{id:'youtube',name:'YouTube',identifier:'youtube',disabled:false}]);
    if(url.pathname.endsWith('/upload')){
      uploadCalls++;
      lastUploadedBytes=Buffer.from(await ((options?.body as FormData).get('file') as Blob).arrayBuffer());
      return Response.json({id:'media-id-'+uploadCalls,path:'https://media.test/video.mp4'});
    }
    if(url.pathname.endsWith('/posts') && options?.method==='POST'){
      createCalls++;
      if(scenario==='ambiguous')return Response.json({message:'Lost response'},{status:500});
      return Response.json([{postId:'post-'+createCalls,integration:'youtube'}]);
    }
    if(url.pathname.endsWith('/posts'))return Response.json({posts:[]});
  }
  throw new Error('Unexpected request '+url.pathname);
};
await setSetting('google',{clientId:'fake-client.apps.googleusercontent.com',clientSecret:'fake-secret'});
await setSetting('googleTokens',{access_token:'fake-token',refresh_token:'fake-refresh',expiry_date:Date.now()+3600_000});
await setSetting('postiz',{baseUrl:'https://fake-postiz.test/public/v1',apiKey:'fake-key',youtubeSchedulingApproved:false});
await setSetting('publisherEngine','postiz');

async function watch(importExisting=true){
  const id=randomUUID();await pool.query("INSERT INTO watches(id,name,folder_id,folder_url,integration_ids,import_existing) VALUES($1,'Test',$2,'https://drive.google.com/drive/folders/test','[\"youtube\"]',$3)",[id,'root-folder-'+id,importExisting]);
  // Mock the validated root without relaxing the real Drive adapter.
  const {rows:[w]}=await pool.query('SELECT * FROM watches WHERE id=$1',[id]);
  w.folder_id='root-folder';return w;
}
async function prepare(w:any){const worker=new Worker();await worker.scan(w);await pool.query("UPDATE videos SET stable_since=now()-interval '1 minute' WHERE watch_id=$1",[w.id]);return worker;}

test('migra rotinas existentes com limpeza ativa por padrão e aceita desativação',async()=>{
  await pool.query('ALTER TABLE watches DROP COLUMN strip_metadata');
  await pool.query('ALTER TABLE watches DROP COLUMN source_type');
  const id=randomUUID();
  await pool.query("INSERT INTO watches(id,name,folder_id,folder_url) VALUES($1,'Legacy','legacy-folder','https://drive.google.com/drive/folders/legacy-folder')",[id]);
  await initDb();
  let {rows:[row]}=await pool.query('SELECT strip_metadata,source_type FROM watches WHERE id=$1',[id]);
  assert.equal(row.strip_metadata,true);
  assert.equal(row.source_type,'google_drive');
  await pool.query('UPDATE watches SET strip_metadata=false WHERE id=$1',[id]);
  await initDb();
  ({rows:[row]}=await pool.query('SELECT strip_metadata FROM watches WHERE id=$1',[id]));
  assert.equal(row.strip_metadata,false);
  await pool.query('DELETE FROM watches WHERE id=$1',[id]);
});

test('envia uma vez, preserva a entrega depois de reiniciar e bloqueia cópia idêntica',async()=>{
  const w=await watch();const worker=await prepare(w);
  // tick reads the stored folder ID only when a new scan is due; scan above postponed it.
  await Promise.all([worker.tick(),new Worker().tick()]);assert.equal(createCalls,1);assert.equal(uploadCalls,1);
  const uploaded=join(temp,'uploaded.mp4');await writeFile(uploaded,lastUploadedBytes!);
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-of','json',uploaded],{encoding:'utf8'}));
  assert.equal(probe.format.tags?.title,undefined);
  const {rows:[saved]}=await pool.query('SELECT media_stripped_metadata,sha256 FROM videos WHERE watch_id=$1',[w.id]);
  assert.equal(saved.media_stripped_metadata,true);
  assert.equal(saved.sha256,createHash('sha256').update(bytes).digest('hex'),'deduplication must use original bytes');
  await pool.query('UPDATE watches SET next_upload_at=now() WHERE id=$1',[w.id]);
  await new Worker().tick();assert.equal(createCalls,1);
  const other=await watch();await prepare(other);await worker.tick();
  assert.equal(createCalls,1,'a copied video must not create another post on the same channel');
  const {rows}=await pool.query("SELECT status FROM deliveries WHERE video_id IN(SELECT id FROM videos WHERE watch_id=$1)",[other.id]);assert.equal(rows[0].status,'duplicate');
});

test('desmarcar a limpeza envia o original e mantém a deduplicação entre as opções',async()=>{
  const beforeCreate=createCalls,beforeUpload=uploadCalls;
  const w=await watch();w.strip_metadata=false;
  await pool.query('UPDATE watches SET strip_metadata=false WHERE id=$1',[w.id]);
  const worker=await prepare(w);await worker.tick();
  assert.equal(uploadCalls,beforeUpload+1,'a cleaned cache entry cannot replace an explicitly requested original');
  assert.deepEqual(lastUploadedBytes,bytes);
  assert.equal(createCalls,beforeCreate,'changing metadata handling must not publish the same source again');
  const {rows:[saved]}=await pool.query('SELECT media_stripped_metadata FROM videos WHERE watch_id=$1',[w.id]);
  assert.equal(saved.media_stripped_metadata,false);
});

test('resultado desconhecido nunca é reenviado depois de um erro e reinício',async()=>{
  // New content hash makes this an independent intent in the same database.
  await pool.query('DELETE FROM content_claims');
  scenario='ambiguous';version='2';const before=createCalls;
  const w=await watch();const worker=await prepare(w);await worker.tick();
  const {rows}=await pool.query('SELECT status FROM deliveries WHERE video_id IN(SELECT id FROM videos WHERE watch_id=$1)',[w.id]);assert.equal(rows[0].status,'unknown');
  assert.equal(createCalls,before+1);
  await pool.query('UPDATE watches SET next_upload_at=now() WHERE id=$1',[w.id]);await new Worker().tick();
  assert.equal(createCalls,before+1,'a restart cannot replay an ambiguous request');
});

test('baseline preexistente permanece excluído mesmo após mudança de versão',async()=>{
  const w=await watch(false);const worker=await prepare(w);
  let {rows}=await pool.query('SELECT status FROM videos WHERE watch_id=$1',[w.id]);assert.equal(rows[0].status,'baseline');
  version='3';w.initialized=true;await worker.scan(w);
  ({rows}=await pool.query('SELECT status FROM videos WHERE watch_id=$1',[w.id]));assert.equal(rows[0].status,'baseline');
});

test('recupera uma criação interrompida como desconhecida e não reenvia',async()=>{
  const w=await watch();const worker=await prepare(w);
  const {rows:[video]}=await pool.query('SELECT * FROM videos WHERE watch_id=$1',[w.id]);
  await pool.query("INSERT INTO deliveries(id,video_id,integration_id,provider,status,planned_at) VALUES($1,$2,'youtube','youtube','submitting',now())",[randomUUID(),video.id]);
  const before=createCalls;await worker.tick();
  const {rows:[delivery]}=await pool.query('SELECT status FROM deliveries WHERE video_id=$1',[video.id]);
  assert.equal(delivery.status,'unknown');assert.equal(createCalls,before);
});

test('arquivo removido deixa a fila antes do envio',async()=>{
  const w=await watch();const worker=await prepare(w);present=false;w.initialized=true;await worker.scan(w);
  const {rows}=await pool.query('SELECT status FROM videos WHERE watch_id=$1',[w.id]);assert.equal(rows[0].status,'removed');
});
test('varredura sem mudanças preserva timestamps, estabilidade e prazo de retry; versão nova libera tentativa',async()=>{
  present=true;version='incremental-1';
  const w=await watch(),worker=await prepare(w);w.initialized=true;
  let {rows:[first]}=await pool.query('SELECT * FROM videos WHERE watch_id=$1',[w.id]);
  await worker.scan(w);
  let {rows:[same]}=await pool.query('SELECT * FROM videos WHERE id=$1',[first.id]);
  assert.equal(same.updated_at.toISOString(),first.updated_at.toISOString());assert.equal(same.stable_since.toISOString(),first.stable_since.toISOString());
  await pool.query("UPDATE videos SET status='retry',attempts=2,error='Aguardando',retry_at=now()+interval '1 hour' WHERE id=$1",[first.id]);
  ({rows:[first]}=await pool.query('SELECT * FROM videos WHERE id=$1',[first.id]));
  await worker.scan(w);({rows:[same]}=await pool.query('SELECT * FROM videos WHERE id=$1',[first.id]));
  assert.equal(same.status,'retry');assert.equal(same.attempts,2);assert.equal(same.retry_at.toISOString(),first.retry_at.toISOString());assert.equal(same.updated_at.toISOString(),first.updated_at.toISOString());
  version='incremental-2';await worker.scan(w);({rows:[same]}=await pool.query('SELECT * FROM videos WHERE id=$1',[first.id]));
  assert.equal(same.status,'ready');assert.equal(same.attempts,0);assert.equal(same.retry_at,null);assert(same.stable_since>first.stable_since);
  version='1';
});

test('rotina local envia sem OAuth Google e bloqueia cópia já enviada pelo Drive',async()=>{
  scenario='success';
  await pool.query("UPDATE watches SET enabled=false");
  await pool.query("DELETE FROM settings WHERE key IN ('google','googleTokens')");
  const {LocalFiles}=await import('../src/local.js');
  const local=new LocalFiles();
  const folderPath=join(process.env.LOCAL_MEDIA_DIR!,'publicar');
  await mkdir(join(folderPath,'sub'),{recursive:true});
  await writeFile(join(folderPath,'sub','copiado.mp4'),bytes);
  await writeFile(join(folderPath,'sub','copiado.json'),JSON.stringify({title:'Cópia local'}));
  const id=randomUUID(),folder=await local.folder('publicar');
  await pool.query(`INSERT INTO watches(id,name,folder_id,folder_url,source_type,integration_ids,import_existing)
    VALUES($1,'Local',$2,$3,'local','["youtube"]',true)`,[id,folder.id,folder.hostPath]);
  const {rows:[w]}=await pool.query('SELECT * FROM watches WHERE id=$1',[id]);
  const before=createCalls;
  await prepare(w);await new Worker().tick();
  assert.equal(createCalls,before,'Drive and local copies must share the same content claim');
  const {rows:[duplicate]}=await pool.query('SELECT d.status FROM deliveries d JOIN videos v ON v.id=d.video_id WHERE v.watch_id=$1',[id]);
  assert.equal(duplicate.status,'duplicate');
  // A new original goes through the real local copy, validation and metadata cleanup.
  execFileSync('ffmpeg',['-loglevel','error','-f','lavfi','-i','color=c=blue:s=64x96:d=1','-c:v','libx264','-pix_fmt','yuv420p','-metadata','title=Local embedded title',join(folderPath,'novo.mp4')]);
  await writeFile(join(folderPath,'novo.json'),JSON.stringify({title:'Vídeo local'}));
  const original=await readFile(join(folderPath,'novo.mp4'));
  w.initialized=true;
  await prepare(w);await pool.query('UPDATE watches SET next_upload_at=now() WHERE id=$1',[id]);
  const worker=new Worker();await worker.tick();
  assert.equal(createCalls,before+1);
  assert.deepEqual(await readFile(join(folderPath,'novo.mp4')),original);
  assert.notDeepEqual(lastUploadedBytes,original);
  await pool.query('UPDATE watches SET next_upload_at=now() WHERE id=$1',[id]);
  await new Worker().tick();assert.equal(createCalls,before+1,'restart must not repeat a local post');
});

test('pastas locais respeitam baseline, JSON, estabilidade e arquivos removidos',async()=>{
  await pool.query('UPDATE watches SET enabled=false');
  const {LocalFiles}=await import('../src/local.js');
  const path=join(process.env.LOCAL_MEDIA_DIR!,'baseline');await mkdir(path);
  await writeFile(join(path,'existente.mp4'),bytes);
  const local=new LocalFiles(),folder=await local.folder('baseline'),id=randomUUID();
  await pool.query(`INSERT INTO watches(id,name,folder_id,folder_url,source_type,integration_ids)
    VALUES($1,'Baseline local',$2,$3,'local','["youtube"]')`,[id,folder.id,folder.hostPath]);
  const {rows:[w]}=await pool.query('SELECT * FROM watches WHERE id=$1',[id]);
  const worker=new Worker();await worker.scan(w);
  let {rows}=await pool.query('SELECT status FROM videos WHERE watch_id=$1',[id]);assert.equal(rows[0].status,'baseline');
  w.initialized=true;
  await writeFile(join(path,'aguardando.mp4'),bytes);await worker.scan(w);
  ({rows}=await pool.query("SELECT status FROM videos WHERE watch_id=$1 AND name='aguardando.mp4'",[id]));assert.equal(rows[0].status,'waiting');
  await writeFile(join(path,'aguardando.json'),JSON.stringify({title:'Novo local'}));await worker.scan(w);
  ({rows}=await pool.query("SELECT status FROM videos WHERE watch_id=$1 AND name='aguardando.mp4'",[id]));assert.equal(rows[0].status,'ready');
  const before=createCalls;await worker.tick();assert.equal(createCalls,before,'a file must settle for 30 seconds');
  await rm(join(path,'aguardando.mp4'));await worker.scan(w);
  ({rows}=await pool.query("SELECT status FROM videos WHERE watch_id=$1 AND name='aguardando.mp4'",[id]));assert.equal(rows[0].status,'removed');
});

after(async()=>{globalThis.fetch=originalFetch;await redis.quit();await pool.end();await rm(temp,{recursive:true,force:true});});
