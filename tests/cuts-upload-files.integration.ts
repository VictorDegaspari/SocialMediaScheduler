import {test,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const dbUrl=new URL(process.env.DATABASE_URL!);dbUrl.pathname='/watcher_cuts_files_test';process.env.DATABASE_URL=dbUrl.toString();
const redisUrl=new URL(process.env.REDIS_URL!);redisUrl.pathname='/10';process.env.REDIS_URL=redisUrl.toString();
const temp=await mkdtemp(join(tmpdir(),'watcher-cuts-files-'));process.env.DATA_DIR=temp;
const {pool,redis,initDb}=await import('../src/db.js');
const {stageCutUpload,sweepCutUploadFiles}=await import('../src/cuts-upload-files.js');
await initDb();
beforeEach(async()=>{
  await pool.query('TRUNCATE watches,videos,deliveries CASCADE');
  await rm(join(temp,'cuts'),{recursive:true,force:true});
  await rm(join(temp,'cuts-publish-manifests'),{recursive:true,force:true});
});
after(async()=>{await pool.end();await redis.quit();await rm(temp,{recursive:true,force:true});});

async function fixture() {
  const jobId=randomUUID(),clipId=randomUUID(),deliveryId=randomUUID();
  const directory=join(temp,'cuts',jobId),source=join(directory,clipId+'.mp4'),bytes=Buffer.from('rendered-preview-'+clipId);
  await mkdir(directory,{recursive:true});await writeFile(source,bytes);
  const hash=createHash('sha256').update(bytes).digest('hex');
  return {jobId,clipId,deliveryId,source,bytes,sha256:hash};
}

test('manifesto prova a origem e recupera cópia de transação revertida, preservando a prévia',async()=>{
  const input=await fixture(),prepared=await stageCutUpload(input);
  assert.deepEqual(await readFile(prepared.path),input.bytes);
  assert.equal((await sweepCutUploadFiles()).recovered,1);
  await assert.rejects(()=>readFile(prepared.path),{code:'ENOENT'});
  await assert.rejects(()=>readFile(prepared.manifestPath),{code:'ENOENT'});
  assert.deepEqual(await readFile(input.source),input.bytes);
});

test('entrega pendente confirmada no banco mantém a cópia e dispensa somente o manifesto',async()=>{
  const input=await fixture(),prepared=await stageCutUpload(input);
  await pool.query("INSERT INTO watches(id,name,folder_id,folder_url) VALUES($1::uuid,'Corte','cuts:'||$1::text,'local')",[input.jobId]);
  await pool.query("INSERT INTO videos(id,watch_id,file_id,name,parent_id) VALUES($1::uuid,$2::uuid,$1::text,'clip.mp4','cuts')",[input.clipId,input.jobId]);
  await pool.query("INSERT INTO deliveries(id,video_id,integration_id,provider,engine,status,local_file) VALUES($1,$2,'native:youtube:test','youtube','local','pending',$3)",[input.deliveryId,input.clipId,prepared.filename]);
  assert.equal((await sweepCutUploadFiles()).recovered,0);
  assert.deepEqual(await readFile(prepared.path),input.bytes);
  await assert.rejects(()=>readFile(prepared.manifestPath),{code:'ENOENT'});
  assert.equal((await pool.query('SELECT status FROM deliveries WHERE id=$1',[input.deliveryId])).rows[0].status,'pending');
});

test('lock do job protege cópia de publicação ainda não confirmada por COMMIT',async()=>{
  const input=await fixture(),prepared=await stageCutUpload(input),db=await pool.connect();
  try {
    await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['drive-watcher:cuts:'+input.jobId]);
    assert.equal((await sweepCutUploadFiles()).recovered,0);
    assert.deepEqual(await readFile(prepared.path),input.bytes);assert((await readFile(prepared.manifestPath)).length>0);
  }finally{await db.query('ROLLBACK');db.release();}
  assert.equal((await sweepCutUploadFiles()).recovered,1);
  await assert.rejects(()=>readFile(prepared.path),{code:'ENOENT'});
});

test('arquivo sem manifesto ou com conteúdo diferente da prova não é apagado',async()=>{
  const input=await fixture(),prepared=await stageCutUpload(input),unproven=join(temp,randomUUID()+'.native.mp4');
  await writeFile(prepared.path,'conteúdo não associado');await writeFile(unproven,'sem manifesto');
  assert.equal((await sweepCutUploadFiles()).recovered,0);
  assert.equal((await readFile(prepared.path)).toString(),'conteúdo não associado');assert.equal((await readFile(unproven)).toString(),'sem manifesto');
  await writeFile(prepared.path,input.bytes);assert.equal((await sweepCutUploadFiles()).recovered,1);
});

test('cópia parcial é recuperada sem exigir arquivo final ou entrega',async()=>{
  const input=await fixture();await rm(input.source);
  await assert.rejects(()=>stageCutUpload(input),{code:'ENOENT'});
  const manifest=join(temp,'cuts-publish-manifests',input.jobId,'publish.'+input.deliveryId+'.json');
  assert((await readFile(manifest)).length>0);
  await writeFile(join(temp,'cuts-publish-manifests',input.jobId,'publish.'+input.deliveryId+'.part'),'parcial');
  await sweepCutUploadFiles();await assert.rejects(()=>readFile(manifest),{code:'ENOENT'});
  await assert.rejects(()=>readFile(join(temp,'cuts-publish-manifests',input.jobId,'publish.'+input.deliveryId+'.part')),{code:'ENOENT'});
});

test('descartar a pasta do job não apaga a prova de recuperação da cópia nativa órfã',async()=>{
  const input=await fixture(),prepared=await stageCutUpload(input);
  await rm(join(temp,'cuts',input.jobId),{recursive:true,force:true});
  assert((await readFile(prepared.manifestPath)).length>0);
  assert.equal((await sweepCutUploadFiles()).recovered,1);
  await assert.rejects(()=>readFile(prepared.path),{code:'ENOENT'});
  await assert.rejects(()=>readFile(prepared.manifestPath),{code:'ENOENT'});
});
