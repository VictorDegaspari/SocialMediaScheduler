import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import type {CutSourceRange} from '../src/cuts-source-limits.js';

const dbUrl=new URL(process.env.DATABASE_URL!);dbUrl.pathname='/watcher_cuts_test';process.env.DATABASE_URL=dbUrl.toString();
const redisUrl=new URL(process.env.REDIS_URL!);redisUrl.pathname='/12';process.env.REDIS_URL=redisUrl.toString();
const temp=await mkdtemp(join(tmpdir(),'watcher-cuts-'));
process.env.CUTS_PARALLELISM='2';
process.env.DATA_DIR=join(temp,'spool');await mkdir(process.env.DATA_DIR);
const fixture=join(temp,'short.mp4');
execFileSync('ffmpeg',['-loglevel','error','-f','lavfi','-i','color=c=green:s=64x96:d=1','-f','lavfi','-i','sine=frequency=400:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',fixture]);
const horizontalFixture=join(temp,'video.mp4');
execFileSync('ffmpeg',['-loglevel','error','-f','lavfi','-i','color=c=green:s=128x72:d=1','-f','lavfi','-i','sine=frequency=400:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',horizontalFixture]);
const { pool,redis,initDb,setSetting }=await import('../src/db.js');
const { AppError }=await import('../src/config.js');
const { CutsService,createCutsRoutes,cutDirectory,youtubeVideoUrl,clipCaptions,validateCutEdit }=await import('../src/cuts.js');
const { saveConnectedAccount }=await import('../src/connected-accounts.js');
const { youtubeScopes }=await import('../src/native-auth.js');
const { LocalPublisher }=await import('../src/local-publisher.js');
const { Worker }=await import('../src/worker.js');
const { cleanupPublishedMedia }=await import('../src/media-cleanup.js');
const {sha256:sha256File}=await import('../src/media.js');
await initDb();
let downloads=0,renders=0,failRender=false,renderInputs:any[]=[];
let downloadedRanges:(CutSourceRange|undefined)[]=[];
const transcript=[{start:5,end:8,text:'Como aprender algo novo?',words:[{start:5,end:5.5,text:'Como'},{start:5.6,end:6.2,text:'aprender'},{start:6.3,end:6.8,text:'algo'},{start:7,end:8,text:'novo?'}]},{start:9,end:13,text:'Pratique todos os dias.'},{start:15,end:19,text:'Assim você melhora.'}];
const media={
  dependencies:async()=>({ready:true,details:[]}),
  download:async(_url:string,dir:string,range?:CutSourceRange)=>{downloads++;downloadedRanges.push(range);await copyFile(fixture,join(dir,'source.mp4'));return {title:'Vídeo fonte de teste',duration:60};},
  transcribe:async()=>structuredClone(transcript),
  select:(_cues:unknown,_duration:number,count:number,_seconds:number,replay?:any)=>replay?.status==='available'
    ?[{start:15,end:19,title:'Pico de replay',reason:'Mapa público de replay.',score:99}]
    :Array.from({length:count},(_,i)=>({start:5+i*10,end:13+i*10,title:'Corte '+(i+1),reason:'Trecho de teste.',score:90})),
  render:async(dir:string,id:string,input:any)=>{renders++;renderInputs.push(structuredClone(input));if(failRender)throw new AppError('Falha de renderização simulada.');const path=join(dir,id+'.mp4');await copyFile(input.framingOptions?.format==='video'?horizontalFixture:fixture,path);return {path,warnings:[]};},
  replay:async()=>({status:'available' as const,source:'youtube_most_replayed' as const,points:[{start:15,end:19,value:1}],message:'Interesse relativo do YouTube.'})
};
const service=new CutsService(media);
const app=express();app.use(express.json());app.use(createCutsRoutes(service));
app.use((error:any,_req:any,res:any,_next:any)=>res.status(error instanceof AppError?error.status:400).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
const originalFetch=globalThis.fetch;
const call=(path:string,body?:unknown,method='POST')=>originalFetch(base+'/api/cuts'+path,body===undefined?{}:{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const create=async(count=1)=>{const response=await call('',{url:'https://youtu.be/abcdefghijk',count,targetSeconds:60,language:'pt'});assert.equal(response.status,202,await response.clone().text());return (await response.json()).id as string;};
const state=()=>service.state();
const currentClip=async()=>((await state()).jobs[0].clips[0]);
const publishBody=(clip:any)=>({channelId:'native:youtube:cuts-channel',title:'Título revisado',description:'Descrição revisada',visibility:'private',madeForKids:false,containsSyntheticMedia:false,confirm:true,revision:clip.revision});

beforeEach(async()=>{
  globalThis.fetch=originalFetch;downloads=0;renders=0;failRender=false;renderInputs=[];downloadedRanges=[];
  await pool.query('TRUNCATE cuts,cut_jobs,content_claims,deliveries,videos,watches,publication_requests,publishing_profiles,manual_actions,events,connected_accounts,settings,browser_commands,browser_agent,browser_settings CASCADE');
  await rm(process.env.DATA_DIR!,{recursive:true,force:true});await mkdir(process.env.DATA_DIR!);
  await setSetting('playwrightMcpExtension',{extensionToken:'test-extension-token'});
  await saveConnectedAccount('youtube','cuts-channel','Canal de cortes',{
    access_token:'test-access',refresh_token:'test-refresh',expiry_date:Date.now()+86400000,scope:youtubeScopes.join(' '),channelId:'cuts-channel'
  },{clientId:'test-client',clientSecret:'test-secret',autoPublishApproved:false});
});
after(async()=>{globalThis.fetch=originalFetch;await service.stop();await new Promise<void>(r=>server.close(()=>r()));await redis.quit();await pool.end();await rm(temp,{recursive:true,force:true});});

test('supports parallel projects with independent claims and two renders from a single project',async()=>{
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const started:string[]=[];
  const parallel=new CutsService({...media,download:async(url,dir,range)=>{
    started.push(dir);
    await gate;
    return media.download(url,dir,range);
  }});
  const waitFor=async(check:()=>boolean)=>{
    const until=Date.now()+5000;
    while(!check()&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,20));
    assert(check(),'expected concurrent work to start');
  };
  await create();
  const first=parallel.tick();
  let second:Promise<void>|undefined;
  try{
    await waitFor(()=>started.length===1);
    await create();
    second=parallel.tick();
    await waitFor(()=>started.length===2);
    await new CutsService(media).tick();
    assert.equal(new Set(started).size,2);
    assert.equal(downloads,0,'another instance cannot take either active project');
  }finally{release();await Promise.all([first,second]);await parallel.stop();}
  assert.equal((await state()).jobs.filter(job=>job.status==='review').length,2);

  await create(2);
  let releaseRenders!:()=>void;
  const renderGate=new Promise<void>(resolve=>{releaseRenders=resolve;});
  const running:string[]=[];
  const renderer=new CutsService({...media,render:async(dir,id,input)=>{
    running.push(id);await renderGate;return media.render(dir,id,input);
  }});
  const work=renderer.tick();
  try{await waitFor(()=>running.length===2);assert.equal(new Set(running).size,2);}
  finally{releaseRenders();await work;await renderer.stop();}
  assert.equal((await state()).jobs.find(job=>job.clips.length===2)?.status,'review');
});

test('URLs são normalizadas e hosts externos, credenciais e playlists são recusados',()=>{
  assert.equal(youtubeVideoUrl('https://youtu.be/abcdefghijk?t=20'),'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(youtubeVideoUrl('https://www.youtube.com/shorts/abcdefghijk'),'https://www.youtube.com/watch?v=abcdefghijk');
  for(const url of ['https://youtube.com.evil.test/watch?v=abcdefghijk','http://youtube.com/watch?v=abcdefghijk','https://user:pass@youtube.com/watch?v=abcdefghijk','https://youtube.com/playlist?list=xyz','https://127.0.0.1/watch?v=abcdefghijk'])assert.throws(()=>youtubeVideoUrl(url));
});
test('trecho acima de duas horas é aceito com janela limitada, persistida e reutilizada na recuperação',async()=>{
  const url='https://youtu.be/abcdefghijk',sourceRange={start:7800,end:7860};
  const suggestions=await call('/replay-windows',{url,duration:18000});
  assert.equal(suggestions.status,200);
  assert.deepEqual((await suggestions.json()).ranges,[{start:0,end:1800}]);
  const invalid=await call('',{url,sourceRange:{start:7800,end:9600.001}});
  assert.equal(invalid.status,400);assert.equal((await state()).jobs.length,0);
  const queued=await call('',{url,sourceRange});
  assert.equal(queued.status,202);
  const {id}=await queued.json();
  await service.tick();
  const [job]=(await state()).jobs;
  assert.equal(job.status,'review');assert.deepEqual(job.source_range,sourceRange);
  assert.deepEqual(downloadedRanges,[sourceRange]);
  assert.equal(job.clips[0].start_seconds,5);
  await rm(join(cutDirectory(id),'source.mp4'));
  assert.equal((await call('/jobs/'+id+'/prepare-source',{})).status,202);
  await service.tick();
  assert.deepEqual(downloadedRanges,[sourceRange,sourceRange]);
  assert.equal((await state()).jobs[0].clips[0].id,job.clips[0].id);
});
test('publishing a cut to TikTok requires its browser token before creating media or deliveries',async()=>{
  await create();await service.tick();const clip=await currentClip(),previous=process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN;
  try{
    delete process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN;await pool.query("DELETE FROM settings WHERE key='playwrightMcpExtension'");
    const response=await call('/'+clip.id+'/publish',{...publishBody(clip),channelId:'browser:tiktok:default',tiktok:{privacyLevel:'PUBLIC_TO_EVERYONE'}});
    assert.equal(response.status,409,await response.clone().text());assert.match((await response.json()).error,/PLAYWRIGHT_MCP_EXTENSION_TOKEN/);
    assert.equal((await pool.query('SELECT id FROM deliveries')).rowCount,0);assert.equal((await currentClip()).status,'review');
  }finally{if(previous===undefined)delete process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN;else process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN=previous;}
});
test('text, images and redactions persist, remain scoped to their job and survive new versions',async()=>{
  const jobId=await create();await service.tick();let clip=await currentClip();
  const png=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=lime:s=32x16','-frames:v','1','-threads','1','-c:v','png','-f','image2pipe','-']);
  const upload=await originalFetch(base+'/api/cuts/jobs/'+jobId+'/images',{method:'POST',headers:{'Content-Type':'image/png'},body:png});
  assert.equal(upload.status,201,await upload.clone().text());const image=await upload.json();assert.equal(image.width,32);assert.equal(image.height,16);
  const downloaded=await originalFetch(base+image.url);assert.equal(downloaded.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),png);
  const invalid=await originalFetch(base+'/api/cuts/jobs/'+jobId+'/images',{method:'POST',headers:{'Content-Type':'image/png'},body:Buffer.from('not an image')});assert.equal(invalid.status,400);
  const overlays=[{id:randomUUID(),type:'text',text:'Texto fixo',start:0,end:null,x:.4,y:.2,width:.8,fontSize:64,color:'#FFFFFF',background:'box'},
    {id:randomUUID(),type:'image',imageId:image.id,start:.5,end:2,x:.6,y:.7,width:.25},
    {id:randomUUID(),type:'redaction',effect:'blur',start:2.5,end:3.5,x:.6,y:.4,width:.25,height:.15}];
  const saved=await call('/'+clip.id,{title:clip.title,start:5,end:13,overlays,revision:clip.revision},'PUT');assert.equal(saved.status,202,await saved.clone().text());
  await service.tick();clip=await currentClip();assert.deepEqual(clip.overlays,overlays);assert.deepEqual(renderInputs.at(-1).overlays,overlays);
  assert.deepEqual((await new CutsService(media).state()).jobs[0].clips[0].overlays,overlays,'a restarted service reads the persisted overlays');
  const wrongJob=await create();await service.tick();const other=(await state()).jobs.find(j=>j.id===wrongJob)!.clips[0];
  assert.equal((await call('/'+other.id,{title:other.title,start:5,end:13,overlays},'PUT')).status,404,'images cannot be borrowed from another job');
  assert.equal((await call('/'+clip.id,{title:clip.title,start:5,end:13,overlays:[{...overlays[0],start:2,end:1}]},'PUT')).status,400);
  assert.equal((await call('/'+clip.id,{title:clip.title,start:5,end:13,overlays:[],revision:clip.revision-1},'PUT')).status,409,'a stale editor cannot clear the layers');
  await pool.query("UPDATE cuts SET status='posted' WHERE id=$1",[clip.id]);
  const version=await call('/'+clip.id,{title:'Versão com elementos',start:5,end:13,versionId:randomUUID(),revision:clip.revision},'PUT');assert.equal(version.status,202,await version.clone().text());
  const result=await version.json();assert(result.createdVersion);await service.tick();
  const job=(await state()).jobs.find(j=>j.id===jobId)!;assert.deepEqual(job.clips.find(c=>c.id===clip.id)!.overlays,overlays);assert.deepEqual(job.clips.find(c=>c.id===result.id)!.overlays,overlays,'omitted fields preserve layers in a new version');
  assert.equal((await originalFetch(base+image.url)).status,200,'both versions retain their shared image');
  assert.equal((await call('/'+result.id,{title:'Sem elementos',start:5,end:13,overlays:[]},'PUT')).status,202);await service.tick();
  const original=(await state()).jobs.find(j=>j.id===jobId)!.clips.find(c=>c.id===clip.id)!;assert.deepEqual(original.overlays,overlays,'removing layers in a copy does not alter the sent version');
});
test('recorte de legenda usa palavras reais e não mostra fala anterior ao intervalo',()=>{
  assert.deepEqual(clipCaptions(transcript,6.3,8).map(c=>c.text),['algo novo?']);
  assert.deepEqual(clipCaptions([{start:1,end:4,text:'Texto sem alinhamento.'}],2,3),[]);
  assert.throws(()=>validateCutEdit({start:5,end:10,captions:[{start:6,end:8,text:'A'},{start:7,end:9,text:'B'}]},60));
});
test('projetos são paginados por data e ID sem perder microssegundos nem ocupar páginas com descartados',async()=>{
  const active=Array.from({length:5},(_,i)=>({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,status:'review',created_at:`2026-01-01T10:00:00.${['123455','123456','123456','123456','123457'][i]}Z`}));
  const discarded=Array.from({length:35},()=>({id:randomUUID(),status:'discarded',created_at:'2026-02-01T10:00:00.000001Z'}));
  await pool.query(`INSERT INTO cut_jobs(id,url,status,title,clip_count,target_seconds,created_at)
    SELECT id,'https://www.youtube.com/watch?v=abcdefghijk',status,id::text,1,60,created_at
    FROM jsonb_to_recordset($1::jsonb) AS j(id uuid,status text,created_at timestamptz)`,[JSON.stringify([...active,...discarded])]);
  await pool.query(`INSERT INTO cuts(id,job_id,title,start_seconds,end_seconds,reason,status)
    SELECT gen_random_uuid(),id,'Corte da página',5,13,'Teste','review' FROM cut_jobs WHERE status='review'`);
  const firstResponse=await call('?limit=2');assert.equal(firstResponse.status,200);
  const first=await firstResponse.json();assert.deepEqual(first.jobs.map((j:any)=>j.id),[active[4].id,active[3].id]);
  assert.equal(first.pagination.limit,2);assert.equal(first.pagination.hasMore,true);assert.equal(typeof first.pagination.nextCursor,'string');
  const cursor=JSON.parse(Buffer.from(first.pagination.nextCursor,'base64url').toString('utf8'));
  assert.equal(cursor.time,'2026-01-01T10:00:00.123456Z');
  await pool.query(`INSERT INTO cut_jobs(id,url,status,clip_count,target_seconds,created_at) VALUES($1,'https://www.youtube.com/watch?v=abcdefghijk','review',1,60,'2026-03-01T00:00:00Z')`,[randomUUID()]);
  const second=await (await call('?limit=2&cursor='+encodeURIComponent(first.pagination.nextCursor))).json();
  assert.deepEqual(second.jobs.map((j:any)=>j.id),[active[2].id,active[1].id]);assert.equal(second.pagination.hasMore,true);
  const third=await (await call('?limit=2&cursor='+encodeURIComponent(second.pagination.nextCursor))).json();
  assert.deepEqual(third.jobs.map((j:any)=>j.id),[active[0].id]);assert.equal(third.pagination.hasMore,false);assert.equal(third.pagination.nextCursor,null);
  for(const page of [first,second,third])for(const job of page.jobs){
    assert.equal(job.clips.length,1);assert.equal(job.clips[0].job_id,job.id);
    assert.equal('__cursor_time' in job,false);assert.equal('__cursor_id' in job,false);
  }
  const all=await state();assert.equal(all.pagination.limit,10);assert.equal(all.jobs.length,6);assert.ok(all.jobs.every(j=>j.status!=='discarded'));
});
test('paginação recusa limites e cursores inválidos',async()=>{
  const validCursor={v:1,scope:'cuts',time:'2026-01-01T10:00:00.123456Z',id:randomUUID()};
  for(const query of ['limit=0','limit=-1','limit=101','limit=2.5','limit=text','limit=1&limit=2','cursor=invalid','cursor='])
    assert.equal((await call('?'+query)).status,400,query);
  for(const cursor of [{...validCursor,scope:'deliveries'},{...validCursor,time:'invalid'},{...validCursor,id:'invalid'}])
    assert.equal((await call('?cursor='+Buffer.from(JSON.stringify(cursor)).toString('base64url'))).status,400);
  assert.equal((await call('?limit=100')).status,200);
});
test('gera cortes persistentes, oferece preview Range e nunca cria upload sem aprovação',async()=>{
  await create();await service.tick();
  const s=await state(),clip=s.jobs[0].clips[0];
  assert.equal(s.jobs[0].status,'review');assert.equal(clip.status,'review');assert.equal(clip.hasMedia,true);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM deliveries')).rows[0].n,0);
  const response=await originalFetch(base+'/api/cuts/'+clip.id+'/media',{headers:{Range:'bytes=0-31'}});
  assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,32);
  assert.equal(downloads,1);assert.equal(renders,1);
});
test('ajuste gera nova versão e versão antiga não pode ser publicada',async()=>{
  await create();await service.tick();const old=await currentClip();
  const response=await call('/'+old.id,{title:'Novo título',start:6.3,end:13,framing:'crop',revision:old.revision},'PUT');
  assert.equal(response.status,202);await service.tick();
  const clip=await currentClip();assert.equal(clip.revision,2);assert.equal(clip.captions[0].text,'algo novo?');assert.equal(clip.framing,'crop');
  assert.equal((await call('/'+old.id+'/publish',publishBody(old))).status,409);
  assert.equal(downloads,1);assert.equal(renders,2);
});
test('legendas corrigidas são preservadas na renderização',async()=>{
  await create();await service.tick();const clip=await currentClip();
  assert.equal((await call('/'+clip.id,{title:clip.title,start:5,end:13,framing:'fit',captions:[{start:5,end:8,text:'Correção literal revisada.'},{start:9,end:13,text:'Pratique todos os dias.'}]},'PUT')).status,202);
  await service.tick();assert.equal((await currentClip()).captions[0].text,'Correção literal revisada.');
});
test('aparar uma legenda enquanto corrige outra preserva palavras reais e ignora alinhamento enviado pelo cliente',async()=>{
  await create();await service.tick();let clip=await currentClip();
  const captions=[{start:6.3,end:8,text:'algo novo?',words:[{start:6.3,end:8,text:'algo novo?'}]},
    {start:9,end:13,text:'Correção revisada.',words:[{start:9,end:13,text:'Correção revisada.'}]}];
  const response=await call('/'+clip.id,{title:clip.title,start:6.3,end:13,captions,captionStyle:{animation:'karaoke'},revision:clip.revision},'PUT');
  assert.equal(response.status,202,await response.clone().text());await service.tick();clip=await currentClip();
  assert.deepEqual(clip.captions[0].words,transcript[0].words!.slice(2));
  assert.equal(clip.captions[1].words,undefined,'typed corrections cannot invent word timestamps');
  const removal=await call('/'+clip.id,{title:clip.title,start:6.3,end:13,excludedRanges:[{start:6.8,end:7}],revision:clip.revision},'PUT');
  assert.equal(removal.status,202,await removal.clone().text());
});
test('ampliar o corte com correções mantém alinhamento da transcrição nas novas bordas',async()=>{
  const jobId=await create();await service.tick();let clip=await currentClip();
  const ending={start:15,end:19,text:'Assim você melhora.',words:[{start:15,end:16,text:'Assim'},{start:16,end:17,text:'você'},{start:17,end:19,text:'melhora.'}]};
  await pool.query('UPDATE cut_jobs SET transcript=$2 WHERE id=$1',[jobId,JSON.stringify([...transcript.slice(0,2),ending])]);
  const captions=[{start:5,end:8,text:'Correção literal revisada.'},transcript[1],{start:15,end:19,text:ending.text}];
  const response=await call('/'+clip.id,{title:clip.title,start:5,end:19,captions,revision:clip.revision},'PUT');
  assert.equal(response.status,202,await response.clone().text());await service.tick();clip=await currentClip();
  assert.equal(clip.captions[0].words,undefined);assert.deepEqual(clip.captions.at(-1).words,ending.words);
  const removal=await call('/'+clip.id,{title:clip.title,start:5,end:19,excludedRanges:[{start:16,end:17}],revision:clip.revision},'PUT');
  assert.equal(removal.status,202,await removal.clone().text());
});
test('publicação é idempotente, usa arquivo do delivery e sobrevive ao ciclo das rotinas',async()=>{
  await create();await service.tick();const clip=await currentClip(),body=publishBody(clip);
  const first=await call('/'+clip.id+'/publish',body);assert.equal(first.status,202,await first.clone().text());const sent=await first.json();
  const repeated=await call('/'+clip.id+'/publish',body);assert.equal(repeated.status,202);assert.equal((await repeated.json()).deliveryId,sent.deliveryId);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM deliveries')).rows[0].n,1);
  const delivery=(await pool.query('SELECT * FROM deliveries')).rows[0];assert.equal(delivery.local_file,delivery.id+'.native.mp4');
  assert.equal((await stat(join(process.env.DATA_DIR!,delivery.local_file))).isFile(),true);
  const worker=new Worker();await worker.tick();await worker.stop();
  assert.ok((await new LocalPublisher().ready()).includes(delivery.id));
  const edit=await call('/'+clip.id,{title:'Versão ajustada',start:5,end:13,framing:'fit'},'PUT');
  assert.equal(edit.status,202,await edit.clone().text());assert.notEqual((await edit.json()).id,clip.id);
  assert.equal((await currentClip()).status,'publishing','o ajuste não interrompe o envio original');
  assert.equal((await call('/'+clip.id+'/discard',{confirm:true})).status,409);
});

for(const status of ['pending','sent','unknown','failed','cancelled'])test('ajustes preservam o corte e o histórico com envio '+status,async()=>{
  await create();await service.tick();let original=await currentClip();
  const captions=[{start:5,end:8,text:'Correção salva.'},{start:9,end:13,text:'Fala revisada.'}];
  assert.equal((await call('/'+original.id,{title:original.title,start:5,end:13,captions,captionStyle:{enabled:false,fontSize:60},excludedRanges:[{start:8,end:9}],revision:original.revision},'PUT')).status,202);
  await service.tick();original=await currentClip();
  const {deliveryId}=await (await call('/'+original.id+'/publish',publishBody(original))).json();
  await pool.query('UPDATE deliveries SET status=$2,post_id=$3,release_url=$4 WHERE id=$1',[deliveryId,status,status==='sent'?'publicacao-original':null,status==='sent'?'https://www.youtube.com/watch?v=publicacao-original':null]);
  await service.retirePublished();original=await currentClip();
  const dbOriginal=(await pool.query('SELECT * FROM cuts WHERE id=$1',[original.id])).rows[0];
  const delivery=(await pool.query('SELECT * FROM deliveries WHERE id=$1',[deliveryId])).rows[0];
  const video=(await pool.query('SELECT * FROM videos WHERE id=$1',[original.id])).rows[0];
  const preview=join(cutDirectory(original.job_id),original.id+'.mp4'),source=join(cutDirectory(original.job_id),'source.mp4');
  const oldBytes=await readFile(preview),uploadBytes=await readFile(join(process.env.DATA_DIR!,delivery.local_file)),sourceHash=await sha256File(source);
  const versionId=randomUUID(),input={title:'Nova montagem horizontal',start:5,end:13,revision:original.revision,versionId,
    framingOptions:{format:'video',mode:'split',split:{topRatio:.4,webcam:{region:{x:0,y:0,width:.3,height:.3}},content:{region:{x:.35,y:.3,width:.65,height:.7},fit:'fit',zoom:.8}}}};
  assert.equal((await call('/'+original.id,{...input,revision:original.revision+1},'PUT')).status,409);
  assert.equal((await call('/'+original.id,{...input,versionId:original.id},'PUT')).status,409);
  const response=await call('/'+original.id,input,'PUT');assert.equal(response.status,202,await response.clone().text());assert.deepEqual(await response.json(),{ok:true,id:versionId,createdVersion:true});
  assert.deepEqual((await pool.query('SELECT * FROM cuts WHERE id=$1',[original.id])).rows[0],dbOriginal);
  assert.deepEqual((await pool.query('SELECT * FROM deliveries WHERE id=$1',[deliveryId])).rows[0],delivery);
  assert.deepEqual(await readFile(preview),oldBytes);assert.deepEqual(await readFile(join(process.env.DATA_DIR!,delivery.local_file)),uploadBytes);
  const retry=await call('/'+original.id,input,'PUT');assert.equal(retry.status,202,await retry.clone().text());assert.equal((await retry.json()).reused,true);
  const changed=await call('/'+original.id,{...input,title:'Outra intenção no mesmo pedido'},'PUT');assert.equal(changed.status,409);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM cuts WHERE edited_from_cut_id=$1',[original.id])).rows[0].n,1);
  assert.equal((await call('/'+versionId+'/publish',{...publishBody(original),revision:1})).status,409,'prévia pendente não autoriza outro envio');
  await service.tick();
  const jobs=(await new CutsService(media).state()).jobs,copy=jobs[0].clips.find((clip:any)=>clip.id===versionId)!;
  assert.equal(jobs[0].hasSource,true);assert.equal(copy.status,'review');assert.equal(copy.hasMedia,true);assert.equal(copy.edited_from_cut_id,original.id);assert.equal(copy.revision,1);assert.equal(copy.delivery_id,null);assert.deepEqual(copy.publications,[]);
  assert.deepEqual(copy.captions,captions);assert.deepEqual(copy.caption_style,original.caption_style);assert.deepEqual(copy.excluded_ranges,original.excluded_ranges);
  assert.equal(copy.framing_options.mode,'split');assert.equal(copy.framing_options.split!.webcam.region.width,.3);assert.equal(copy.framing_options.split!.content.fit,'fit');
  assert.equal(downloads,1);assert.equal(await sha256File(source),sourceHash);assert.deepEqual(await readFile(preview),oldBytes);
  assert.deepEqual((await pool.query('SELECT * FROM videos WHERE id=$1',[original.id])).rows[0],video);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM deliveries')).rows[0].n,1,'salvar a versão não publica automaticamente');
  const repeated=await call('/'+original.id,input,'PUT');assert.equal(repeated.status,202);assert.equal((await repeated.json()).id,versionId);
  const secondPublish=await call('/'+copy.id+'/publish',publishBody(copy));assert.equal(secondPublish.status,202,await secondPublish.clone().text());
  const newDelivery=(await pool.query('SELECT * FROM deliveries WHERE id=$1',[(await secondPublish.json()).deliveryId])).rows[0];
  assert.notEqual(newDelivery.video_id,delivery.video_id);assert.notEqual(newDelivery.payload.assetSha256,delivery.payload.assetSha256);assert.equal(newDelivery.integration_id,delivery.integration_id);
  const oldDelivery=(await pool.query('SELECT * FROM deliveries WHERE id=$1',[deliveryId])).rows[0];assert.equal(oldDelivery.status,delivery.status);assert.equal(oldDelivery.post_id,delivery.post_id);assert.equal(oldDelivery.release_url,delivery.release_url);assert.deepEqual(oldDelivery.payload,delivery.payload);
});

test('ajuste de enviado permite continuar sem a prévia local, mas exige a fonte e respeita o limite de versões',async()=>{
  await create();await service.tick();let original=await currentClip();
  await call('/'+original.id+'/publish',publishBody(original));
  await pool.query("UPDATE deliveries SET status='sent',post_id='qa-enviado' WHERE video_id=$1",[original.id]);await service.retirePublished();original=await currentClip();
  await rm(join(cutDirectory(original.job_id),original.id+'.mp4'));await pool.query('UPDATE cuts SET local_file=NULL WHERE id=$1',[original.id]);
  assert.equal((await currentClip()).hasMedia,false);assert.equal((await state()).jobs[0].hasSource,true);
  const input={title:original.title,start:5,end:13,revision:original.revision};
  const saved=await call('/'+original.id,input,'PUT');assert.equal(saved.status,202,await saved.clone().text());const {id}=await saved.json();await service.tick();
  const copy=(await state()).jobs[0].clips.find((c:any)=>c.id===id)!;
  assert.equal((await call('/'+id,{...input,title:'Continuar o ajuste',revision:copy.revision},'PUT')).status,202);await service.tick();assert.equal((await state()).jobs[0].clips.find((c:any)=>c.id===id)!.revision,2);
  for(let i=0;i<9;i++)await pool.query(`INSERT INTO cuts(id,job_id,title,start_seconds,end_seconds,reason,status) VALUES($1,$2,'Pendente',5,13,'Teste','review')`,[randomUUID(),original.job_id]);
  const limited=await call('/'+original.id,input,'PUT');assert.equal(limited.status,409);assert.match((await limited.json()).error,/limite de versões/);
  await rm(join(cutDirectory(original.job_id),'source.mp4'));assert.equal((await state()).jobs[0].hasSource,false);
  const missing=await call('/'+original.id,input,'PUT');assert.equal(missing.status,409);assert.match((await missing.json()).error,/fonte foi removida/);
});

test('recuperar a fonte de um projeto enviado mantém cortes, histórico e arquivos sem publicar outra vez',async()=>{
  await create();await service.tick();const clip=await currentClip();
  const {deliveryId}=await (await call('/'+clip.id+'/publish',publishBody(clip))).json();
  await pool.query("UPDATE deliveries SET status='sent',post_id='publicacao-preservada' WHERE id=$1",[deliveryId]);await service.retirePublished();
  const source=join(cutDirectory(clip.job_id),'source.mp4'),hash=await sha256File(source),before=(await pool.query('SELECT * FROM cuts WHERE id=$1',[clip.id])).rows[0];
  const preview=await readFile(join(cutDirectory(clip.job_id),clip.id+'.mp4'));await rm(source);await pool.query('UPDATE cut_jobs SET source_removed_at=now() WHERE id=$1',[clip.job_id]);
  const route='/jobs/'+clip.job_id;
  assert.equal((await (await call(route+'/source-status')).json()).ready,false);
  const prepared=await call(route+'/prepare-source',{});assert.equal(prepared.status,202,await prepared.clone().text());assert.equal((await prepared.json()).status,'queued');
  assert.equal((await call(route+'/prepare-source',{})).status,202,'repetir usa o mesmo trabalho');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM cuts')).rows[0].n,1);
  await service.tick();
  const ready=await call(route+'/source-status');assert.equal(ready.status,200);assert.equal((await ready.json()).ready,true);assert.equal(downloads,2);assert.equal(renders,1,'nenhum corte é renderizado ao recuperar apenas a fonte');
  assert.equal(await sha256File(source),hash);assert.deepEqual((await pool.query('SELECT * FROM cuts WHERE id=$1',[clip.id])).rows[0],before);assert.deepEqual(await readFile(join(cutDirectory(clip.job_id),clip.id+'.mp4')),preview);
  assert.equal((await call(route+'/prepare-source',{})).status,200,'a fonte pronta não volta para a fila');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM deliveries')).rows[0].n,1);
  const saved=await call('/'+clip.id,{title:'Ajuste depois da recuperação',start:5,end:13,revision:clip.revision},'PUT');assert.equal(saved.status,202,await saved.clone().text());
});

test('falha na recuperação pode ser tentada novamente e projetos descartados não são restaurados',async()=>{
  await create();await service.tick();const clip=await currentClip(),source=join(cutDirectory(clip.job_id),'source.mp4'),route='/jobs/'+clip.job_id;
  await rm(source);const download=media.download;
  try{
    media.download=async()=>{throw new AppError('Fonte indisponível no teste.');};
    assert.equal((await call(route+'/prepare-source',{})).status,202);await service.tick();
    const status=await (await call(route+'/source-status')).json();assert.equal(status.ready,false);assert.equal(status.status,'failed');assert.match(status.error,/Fonte indisponível/);
  }finally{media.download=download;}
  assert.equal((await call(route+'/prepare-source',{})).status,202);await service.tick();assert.equal((await (await call(route+'/source-status')).json()).ready,true);
  assert.equal((await call(route+'/discard',{confirm:true})).status,200);
  assert.equal((await call(route+'/prepare-source',{})).status,409);assert.equal((await call(route+'/source-status')).status,404);
});
test('mudar de Shorts para vídeo exige nova prévia e valida o formato real antes do envio',async()=>{
  await create();await service.tick();let clip=await currentClip();
  const captions=structuredClone(clip.captions);
  assert.equal(clip.framing_options.format,'shorts');
  assert.equal((await call('/'+clip.id+'/publish',{...publishBody(clip),format:'video'})).status,409);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM deliveries')).rows[0].n,0);
  assert.equal((await call('/'+clip.id,{title:clip.title,start:5,end:13,framingOptions:{format:'video'},revision:clip.revision},'PUT')).status,202);
  await service.tick();clip=await currentClip();
  assert.equal(clip.framing_options.format,'video');assert.equal(renderInputs.at(-1).framingOptions.format,'video');assert.deepEqual(clip.captions,captions);
  assert.equal((await call('/'+clip.id,{title:'Vídeo horizontal revisado',start:5,end:13,revision:clip.revision},'PUT')).status,202);
  await service.tick();clip=await currentClip();assert.equal(clip.framing_options.format,'video');
  const path=join(cutDirectory(clip.job_id),clip.id+'.mp4');
  await copyFile(fixture,path);
  assert.equal((await call('/'+clip.id+'/publish',{...publishBody(clip),format:'video'})).status,400,'metadados não tornam um arquivo vertical em vídeo horizontal');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM deliveries')).rows[0].n,0);
  await copyFile(horizontalFixture,path);
  assert.equal((await call('/'+clip.id+'/publish',{...publishBody(clip),format:'shorts'})).status,409);
  assert.equal((await call('/'+clip.id+'/publish',{...publishBody(clip),format:'video'})).status,202);
  const delivery=(await pool.query('SELECT * FROM deliveries')).rows[0];
  assert.deepEqual(delivery.payload.metadata.hashtags,[]);
  assert.deepEqual(await readFile(join(process.env.DATA_DIR!,delivery.local_file)),await readFile(path),'o envio usa exatamente os bytes da prévia horizontal revisada');
});
for(const format of ['shorts','video'] as const)test('uploader confirma '+format+' sem apagar o corte ou a fonte e permite excluir o projeto manualmente',async()=>{
  await create();await service.tick();let clip=await currentClip();
  if(format==='video'){
    assert.equal((await call('/'+clip.id,{title:clip.title,start:clip.start_seconds,end:clip.end_seconds,framingOptions:{format:'video'},revision:clip.revision},'PUT')).status,202);
    await service.tick();clip=await currentClip();
  }
  const source=join(cutDirectory(clip.job_id),'source.mp4'),preview=join(cutDirectory(clip.job_id),clip.id+'.mp4'),master=join(cutDirectory(clip.job_id),clip.id+'.master.mp4');
  const before=await readFile(preview);await copyFile(preview,master);
  const response=await call('/'+clip.id+'/publish',publishBody(clip)),{deliveryId}=await response.json();
  let uploads=0,metadata:any;const uploaded:Buffer[]=[];
  globalThis.fetch=async(input:any,init?:RequestInit)=>{
    const url=new URL(String(input));
    if(url.hostname==='www.googleapis.com'&&url.pathname==='/upload/youtube/v3/videos'){
      metadata=JSON.parse(String(init?.body));return new Response(null,{headers:{location:'https://www.googleapis.com/upload/session/cuts?upload_id=abc'}});
    }
    if(url.hostname==='www.googleapis.com'&&url.pathname==='/upload/session/cuts'){
      uploaded.push(Buffer.from(init!.body as Uint8Array));uploads++;return Response.json({id:'youtube-cuts-123'});
    }
    throw new Error('Unexpected external request: '+url.hostname+url.pathname);
  };
  await new LocalPublisher().process(deliveryId);
  const delivery=(await pool.query('SELECT * FROM deliveries WHERE id=$1',[deliveryId])).rows[0];
  assert.equal(delivery.post_id,'youtube-cuts-123',delivery.error);assert.equal(uploads,1);assert.equal(metadata.snippet.title,'Título revisado');assert.equal(metadata.status.privacyStatus,'private');
  assert.deepEqual(Buffer.concat(uploaded),before,'a API recebe os mesmos bytes da prévia, sem recodificação ou redução de qualidade');
  assert.deepEqual(delivery.payload.metadata.hashtags,format==='shorts'?['Shorts']:[]);
  assert.equal(metadata.snippet.description.includes('#Shorts'),format==='shorts','vídeos comuns não recebem a hashtag Shorts automaticamente');
  await service.retirePublished();
  assert.equal((await currentClip()).status,'posted');assert.equal((await currentClip()).hasMedia,true);
  assert.equal((await state()).jobs[0].status,'completed');
  assert.equal((await stat(source)).isFile(),true);
  assert.deepEqual(await readFile(preview),before);assert.deepEqual(await readFile(master),before);
  const download=await call('/'+clip.id+'/media');assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),before);
  const attachment=await call('/'+clip.id+'/media?download=1');assert.equal(attachment.status,200);assert.match(attachment.headers.get('content-disposition')||'',/^attachment;/);assert.deepEqual(Buffer.from(await attachment.arrayBuffer()),before);
  const partial=await originalFetch(base+'/api/cuts/'+clip.id+'/media',{headers:{Range:'bytes=0-63'}});assert.equal(partial.status,206);assert.equal((await partial.arrayBuffer()).byteLength,64);
  await assert.rejects(stat(join(process.env.DATA_DIR!,deliveryId+'.native.mp4')));
  assert.equal((await pool.query('SELECT local_file FROM deliveries WHERE id=$1',[deliveryId])).rows[0].local_file,null);
  await new CutsService(media).tick();assert.deepEqual(await readFile(preview),before);
  assert.equal((await call('/'+clip.id+'/publish',publishBody(clip))).status,202);assert.equal(uploads,1);
  assert.equal((await call('/jobs/'+clip.job_id+'/discard',{confirm:false})).status,400);assert.deepEqual(await readFile(preview),before);
  assert.equal((await call('/jobs/'+clip.job_id+'/discard',{confirm:true})).status,200);
  await assert.rejects(stat(cutDirectory(clip.job_id)));
  assert.equal((await pool.query('SELECT local_file FROM cuts WHERE id=$1',[clip.id])).rows[0].local_file,null);
  assert.equal((await pool.query('SELECT post_id FROM deliveries WHERE id=$1',[deliveryId])).rows[0].post_id,'youtube-cuts-123');
});
test('upload incerto preserva arquivos e o corte enviado só é removido por exclusão manual',async()=>{
  await create(2);await service.tick();const s=await state(),[clip,other]=s.jobs[0].clips;
  const response=await call('/'+clip.id+'/publish',publishBody(clip)),{deliveryId}=await response.json();
  await pool.query("UPDATE deliveries SET status='unknown' WHERE id=$1",[deliveryId]);await service.retirePublished();
  assert.equal((await call('/'+clip.id+'/discard',{confirm:true})).status,409);
  assert.equal((await call('/jobs/'+clip.job_id+'/discard',{confirm:true})).status,409);
  assert.equal((await currentClip()).hasMedia,true);assert.equal((await stat(join(cutDirectory(clip.job_id),'source.mp4'))).isFile(),true);
  await pool.query("UPDATE deliveries SET status='published',post_id='confirmed-id' WHERE id=$1",[deliveryId]);
  await cleanupPublishedMedia(deliveryId);await service.retirePublished();
  assert.equal((await stat(join(cutDirectory(clip.job_id),'source.mp4'))).isFile(),true);
  const preview=join(cutDirectory(clip.job_id),clip.id+'.mp4'),master=join(cutDirectory(clip.job_id),clip.id+'.master.mp4');await copyFile(preview,master);
  assert.equal((await call('/'+other.id+'/discard',{confirm:true})).status,200);
  assert.equal((await stat(preview)).isFile(),true);assert.equal((await stat(master)).isFile(),true);
  assert.equal((await stat(join(cutDirectory(clip.job_id),'source.mp4'))).isFile(),true);
  for(const body of [{},{confirm:false}])assert.equal((await call('/'+clip.id+'/discard',body)).status,400);
  assert.equal((await stat(preview)).isFile(),true);
  assert.equal((await call('/'+clip.id+'/discard',{confirm:true})).status,200);
  await assert.rejects(stat(preview));await assert.rejects(stat(master));await assert.rejects(stat(cutDirectory(clip.job_id)));
  assert.equal((await call('/'+clip.id+'/media')).status,404);
  const retained=(await pool.query('SELECT delivery_id,local_file FROM cuts WHERE id=$1',[clip.id])).rows[0];assert.equal(retained.delivery_id,deliveryId);assert.equal(retained.local_file,null);
  assert.equal((await pool.query('SELECT post_id FROM deliveries WHERE id=$1',[deliveryId])).rows[0].post_id,'confirmed-id');
});

test('cancelar um envio mantém o arquivo e uma sessão sem resultado bloqueia a exclusão',async()=>{
  await create();await service.tick();const clip=await currentClip();
  const response=await call('/'+clip.id+'/publish',publishBody(clip)),{deliveryId}=await response.json();
  await pool.query("UPDATE deliveries SET status='cancelled',session='sessao-sem-confirmacao',upload_started_at=now() WHERE id=$1",[deliveryId]);
  await service.retirePublished();
  assert.equal((await currentClip()).status,'failed');assert.equal((await currentClip()).hasMedia,true);
  // Older workers treated cancellation as a discard, even with an unresolved session.
  await pool.query("UPDATE cuts SET status='discarded' WHERE id=$1",[clip.id]);
  await service.retirePublished();assert.equal((await currentClip()).hasMedia,true);
  assert.equal((await call('/'+clip.id+'/discard',{confirm:true})).status,409);
  assert.equal((await call('/jobs/'+clip.job_id+'/discard',{confirm:true})).status,409);
  assert.equal((await stat(join(cutDirectory(clip.job_id),'source.mp4'))).isFile(),true);
  await pool.query("UPDATE deliveries SET payload=payload||'{\"manualConfirmed\":true}'::jsonb WHERE id=$1",[deliveryId]);
  assert.equal((await call('/'+clip.id+'/discard',{confirm:true})).status,200);
  await assert.rejects(stat(cutDirectory(clip.job_id)));
});

test('projetos concluídos com arquivos retidos contam no limite até a exclusão manual',async()=>{
  const ids=Array.from({length:10},()=>randomUUID());
  await pool.query("INSERT INTO cut_jobs(id,url,status,clip_count,target_seconds) SELECT unnest($1::uuid[]),'https://youtu.be/abcdefghijk','completed',1,60",[ids]);
  const request={url:'https://youtu.be/abcdefghijk',count:1,targetSeconds:60};
  assert.equal((await call('',request)).status,409);
  assert.equal((await call('/jobs/'+ids[0]+'/discard',{confirm:true})).status,200);
  assert.equal((await call('',request)).status,202);
});
test('falha pode ser retomada por outra instância sem baixar a fonte novamente',async()=>{
  await create();failRender=true;await service.tick();assert.equal((await state()).jobs[0].status,'failed');
  failRender=false;assert.equal((await call('/jobs/'+(await state()).jobs[0].id+'/retry',{})).status,202);
  await new CutsService(media).tick();assert.equal((await currentClip()).status,'review');assert.equal(downloads,1);
});
test('análise sem novas sugestões não deixa ajuste pendente preso sem renderização',async()=>{
  const jobId=await create();await service.tick();const clip=await currentClip();
  // A previous analysis failed before clearing its persisted request. The
  // user can still save an existing reviewed cut before the next worker tick.
  await pool.query("UPDATE cut_jobs SET status='failed',pending_analysis=$2 WHERE id=$1",[jobId,JSON.stringify({count:1,targetSeconds:60})]);
  const response=await call('/'+clip.id,{title:'Ajuste preservado',start:5,end:13,revision:clip.revision},'PUT');
  assert.equal(response.status,202,await response.clone().text());
  await new CutsService({...media,select:()=>[]}).tick();
  const result=(await state()).jobs[0];
  assert.equal(result.status,'review');assert.equal(result.clips[0].status,'review');assert.equal(result.clips[0].title,'Ajuste preservado');
  assert.equal(result.clips[0].hasMedia,true);assert.equal(renders,2);assert.equal(downloads,1);
  assert.match(result.analysis_message,/Não há novas sugestões/);
  assert.equal((await pool.query('SELECT pending_analysis FROM cut_jobs WHERE id=$1',[jobId])).rows[0].pending_analysis,null);
});
test('descartar projeto libera a fonte e impede geração posterior',async()=>{
  const id=await create();assert.equal((await call('/jobs/'+id+'/discard',{confirm:true})).status,200);await service.tick();
  assert.equal(downloads,0);assert.equal((await pool.query('SELECT status FROM cut_jobs WHERE id=$1',[id])).rows[0].status,'discarded');
  assert.deepEqual((await state()).jobs,[]);
});
test('descarte exige confirmação explícita antes de alterar projetos, cortes ou arquivos',async()=>{
  const id=await create();await service.tick();const clip=await currentClip();
  const source=join(cutDirectory(id),'source.mp4'),preview=join(cutDirectory(id),clip.id+'.mp4');
  for(const path of ['/jobs/'+id+'/discard','/'+clip.id+'/discard'])for(const body of [{},{confirm:false}]){
    assert.equal((await call(path,body)).status,400);
    assert.equal((await pool.query('SELECT status FROM cut_jobs WHERE id=$1',[id])).rows[0].status,'review');
    assert.equal((await pool.query('SELECT status FROM cuts WHERE id=$1',[clip.id])).rows[0].status,'review');
    assert.equal((await stat(source)).isFile(),true);assert.equal((await stat(preview)).isFile(),true);
  }
  assert.equal((await call('/jobs/'+id+'/discard',{confirm:true})).status,200);
  assert.equal((await pool.query('SELECT status FROM cut_jobs WHERE id=$1',[id])).rows[0].status,'discarded');
  assert.equal((await pool.query('SELECT status FROM cuts WHERE id=$1',[clip.id])).rows[0].status,'discarded');
  await assert.rejects(stat(cutDirectory(id)));assert.deepEqual((await state()).jobs,[]);
});
test('Postiz e conta diferente não iniciam envios locais silenciosos',async()=>{
  await create();await service.tick();const clip=await currentClip();await setSetting('publisherEngine','postiz');
  assert.equal((await call('/'+clip.id+'/publish',publishBody(clip))).status,409);
  await setSetting('publisherEngine','local');
  assert.equal((await call('/'+clip.id+'/publish',{...publishBody(clip),channelId:'native:youtube:outra-conta'})).status,409);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM deliveries')).rows[0].n,0);
});

test('cores, animação e enquadramento persistem sem substituir legendas corrigidas',async()=>{
  await create();await service.tick();let clip=await currentClip();
  const captions=[{start:5,end:8,text:'Correção literal.'},{start:9,end:13,text:'Fala revisada.'}];
  assert.equal((await call('/'+clip.id,{title:clip.title,start:5,end:13,framing:'fit',captions,revision:clip.revision},'PUT')).status,202);
  await service.tick();clip=await currentClip();
  const input={title:clip.title,start:5,end:13,captionStyle:{fontSize:60,color:'#FF8800',highlightColor:'#00FF00',animation:'pop',position:'middle',background:'box'},
    framingOptions:{mode:'crop',focusX:0.8,focusY:0.2,zoom:1.8},revision:clip.revision};
  assert.equal((await call('/'+clip.id,input,'PUT')).status,202);await service.tick();
  clip=await currentClip();assert.equal(clip.caption_style.color,'#FF8800');assert.equal(clip.caption_style.animation,'pop');assert.equal(clip.framing_options.zoom,1.8);
  assert.deepEqual(clip.captions,captions);assert.equal(renderInputs.at(-1).captionStyle.fontSize,60);assert.equal(renderInputs.at(-1).framingOptions.focusX,0.8);
});

test('webcam e vídeo persistem com ajustes independentes e recusam regiões inválidas',async()=>{
  await create();await service.tick();let clip=await currentClip();
  const captions=structuredClone(clip.captions),sourceHash=await sha256File(join(cutDirectory(clip.job_id),'source.mp4'));
  const pane={fit:'crop',focusX:.2,focusY:.7,zoom:1.5,region:{x:.7,y:.1,width:.3,height:.4}};
  const split={topRatio:.4,webcam:pane,content:{...pane,fit:'fit',zoom:.5,region:{x:0,y:.4,width:.7,height:.6}}};
  const input={title:clip.title,start:5,end:13,framing:'fit',framingOptions:{mode:'split',split},revision:clip.revision};
  assert.equal((await call('/'+clip.id,{...input,framingOptions:{mode:'split',split:{...split,webcam:{...pane,region:{...pane.region,width:.5}}}}},'PUT')).status,400);
  assert.equal((await currentClip()).revision,clip.revision);
  const saved=await call('/'+clip.id,input,'PUT');assert.equal(saved.status,202,await saved.clone().text());await service.tick();clip=await currentClip();
  assert.equal(clip.framing_options.mode,'split');assert.deepEqual(clip.framing_options.split,split);assert.deepEqual(renderInputs.at(-1).framingOptions.split,split);
  const restarted=new CutsService(media);const restored=(await restarted.state()).jobs[0].clips[0];
  assert.deepEqual(restored.framing_options,clip.framing_options);assert.deepEqual(restored.captions,captions);
  assert.equal((await call('/'+clip.id,input,'PUT')).status,409,'an old editor cannot replace the new layout');
  const renamed=await call('/'+clip.id,{title:'Reação revisada',start:5,end:13,revision:clip.revision},'PUT');assert.equal(renamed.status,202,await renamed.clone().text());await service.tick();
  assert.deepEqual((await currentClip()).framing_options.split,split,'unrelated edits preserve both regions');
  assert.equal(await sha256File(join(cutDirectory(clip.job_id),'source.mp4')),sourceHash);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM deliveries')).rows[0].n,0);
});

test('desativar e reativar legendas preserva o texto corrigido e a opção entre ajustes',async()=>{
  await create();await service.tick();let clip=await currentClip();
  assert.equal(clip.caption_style.enabled,true,'projetos anteriores continuam com legendas');
  const captions=[{start:5,end:8,text:'Texto corrigido para guardar.'},{start:9,end:13,text:'Fala revisada.'}];
  assert.equal((await call('/'+clip.id,{title:clip.title,start:5,end:13,captions,captionStyle:{enabled:false,fontSize:60},revision:clip.revision},'PUT')).status,202);
  await service.tick();clip=await currentClip();
  assert.equal(clip.caption_style.enabled,false);assert.deepEqual(clip.captions,captions);
  assert.equal(renderInputs.at(-1).captionStyle.enabled,false);assert.deepEqual(renderInputs.at(-1).captions,captions);
  assert.equal((await call('/'+clip.id,{title:'Título atualizado sem reativar legendas',start:5,end:13,revision:clip.revision},'PUT')).status,202);
  await service.tick();clip=await currentClip();
  assert.equal(clip.caption_style.enabled,false);assert.equal(renderInputs.at(-1).captionStyle.enabled,false);
  assert.equal((await call('/'+clip.id,{title:clip.title,start:5,end:13,captionStyle:{...clip.caption_style,enabled:true},revision:clip.revision},'PUT')).status,202);
  await service.tick();clip=await currentClip();
  assert.equal(clip.caption_style.enabled,true);assert.equal(clip.caption_style.fontSize,60);assert.deepEqual(clip.captions,captions);
  assert.equal(renderInputs.at(-1).captionStyle.enabled,true);
});

test('remoções internas preservam alinhamento de palavras e atualizam a duração de saída',async()=>{
  await create();await service.tick();const clip=await currentClip();
  const response=await call('/'+clip.id,{title:clip.title,start:5,end:13,excludedRanges:[{start:6.2,end:7}],captionStyle:{animation:'karaoke'},revision:clip.revision},'PUT');
  assert.equal(response.status,202,await response.clone().text());await service.tick();
  const edited=await currentClip();assert.ok(Math.abs(edited.output_duration-7.2)<0.001);assert.ok(edited.captions[0].words?.length);
  assert.deepEqual(renderInputs.at(-1).excludedRanges,[{start:6.2,end:7}]);
  const invalid=await call('/'+clip.id,{title:clip.title,start:5,end:13,excludedRanges:[{start:6,end:10},{start:9,end:11}]},'PUT');assert.equal(invalid.status,400);
});

test('alterar limites sem enviar remoções preserva os trechos excluídos e recusa descartá-los silenciosamente',async()=>{
  await create();await service.tick();let clip=await currentClip();const gaps=[{start:6.2,end:7}];
  assert.equal((await call('/'+clip.id,{title:clip.title,start:5,end:13,excludedRanges:gaps,revision:clip.revision},'PUT')).status,202);
  await service.tick();clip=await currentClip();
  const extended=await call('/'+clip.id,{title:clip.title,start:5,end:19,revision:clip.revision},'PUT');
  assert.equal(extended.status,202,await extended.clone().text());await service.tick();clip=await currentClip();
  assert.deepEqual(clip.excluded_ranges,gaps);assert.deepEqual(renderInputs.at(-1).excludedRanges,gaps);
  assert.ok(Math.abs(clip.output_duration-13.2)<0.001);
  const invalid=await call('/'+clip.id,{title:clip.title,start:7.5,end:19,revision:clip.revision},'PUT');
  assert.equal(invalid.status,400);assert.deepEqual((await currentClip()).excluded_ranges,gaps);assert.equal((await currentClip()).revision,clip.revision);
  const explicit=await call('/'+clip.id,{title:clip.title,start:7.5,end:19,excludedRanges:[],revision:clip.revision},'PUT');
  assert.equal(explicit.status,202,await explicit.clone().text());assert.deepEqual((await currentClip()).excluded_ranges,[]);
});

test('intervalo de origem maior que três minutos é aceito quando os trechos mantidos cabem em um Short',async()=>{
  const job=await create();await service.tick();const clip=await currentClip();
  await pool.query('UPDATE cut_jobs SET duration=400,transcript=$2 WHERE id=$1',[job,JSON.stringify([...transcript,{start:250,end:258,text:'Encerramento completo.'}])]);
  const response=await call('/'+clip.id,{title:clip.title,start:5,end:258,excludedRanges:[{start:13,end:250}],useOriginalCaptions:true},'PUT');
  assert.equal(response.status,202,await response.clone().text());await service.tick();assert.equal((await currentClip()).output_duration,16);
});

test('exclusão dentro de legenda sem palavras é recusada até revisão ou restauração da transcrição',async()=>{
  await create();await service.tick();let clip=await currentClip();
  await call('/'+clip.id,{title:clip.title,start:5,end:13,captions:[{start:5,end:8,text:'Uma legenda corrigida.'},{start:9,end:13,text:'Fim.'}]},'PUT');await service.tick();clip=await currentClip();
  const input={title:clip.title,start:5,end:13,excludedRanges:[{start:6.2,end:7}],revision:clip.revision};
  assert.equal((await call('/'+clip.id,input,'PUT')).status,400);
  assert.equal((await call('/'+clip.id,{...input,useOriginalCaptions:true},'PUT')).status,202);await service.tick();
  assert.equal((await currentClip()).captions[0].text,transcript[0].text);
});

test('ampliar o intervalo conserva correções e só acrescenta transcrição nas novas bordas',async()=>{
  await create();await service.tick();let clip=await currentClip();
  await call('/'+clip.id,{title:clip.title,start:5,end:13,captions:[{start:5,end:8,text:'Uma fala corrigida.'},{start:9,end:13,text:'Outra correção.'}]},'PUT');await service.tick();clip=await currentClip();
  assert.equal((await call('/'+clip.id,{title:clip.title,start:5,end:19,useOriginalCaptions:false,revision:clip.revision},'PUT')).status,202);await service.tick();
  clip=await currentClip();assert.equal(clip.captions[0].text,'Uma fala corrigida.');assert.equal(clip.captions[1].text,'Outra correção.');assert.equal(clip.captions.at(-1).text,'Assim você melhora.');
  assert.equal((await call('/'+clip.id,{title:clip.title,start:6,end:19,useOriginalCaptions:false,revision:clip.revision},'PUT')).status,400);
});

test('fonte e transcrição permitem revisão e análise de replay acrescenta sugestão sem apagar edições',async()=>{
  const job=await create();await service.tick();const clip=await currentClip();
  await call('/'+clip.id,{title:'Título que foi revisado',start:5,end:13,captionStyle:{color:'#00FF00'}},'PUT');await service.tick();
  const source=await originalFetch(base+'/api/cuts/jobs/'+job+'/source',{headers:{Range:'bytes=0-15'}});assert.equal(source.status,206);assert.equal((await source.arrayBuffer()).byteLength,16);
  const transcriptResponse=await call('/jobs/'+job+'/transcript');assert.equal(transcriptResponse.status,200);assert.equal((await transcriptResponse.json()).captions.length,transcript.length);
  assert.equal((await call('/jobs/'+job+'/analyze',{count:1,targetSeconds:60})).status,202);await service.tick();
  const result=(await state()).jobs[0];assert.equal(result.replay_data.status,'available');assert.equal(result.clips.length,2);
  const original=result.clips.find(c=>c.id===clip.id)!;assert.equal(original.title,'Título que foi revisado');assert.equal(original.caption_style.color,'#00FF00');
  assert.ok(result.clips.some(c=>c.title==='Pico de replay'));assert.equal(downloads,1);
});

test('falha temporária do YouTube conserva o mapa de replay já consultado',async()=>{
  const job=await create();await service.tick();
  await pool.query('UPDATE cut_jobs SET replay_data=$2 WHERE id=$1',[job,JSON.stringify(await media.replay())]);
  const previous=media.replay;
  media.replay=async()=>({status:'failed' as any,source:'youtube_most_replayed',points:[],message:'Consulta indisponível.'});
  try {
    assert.equal((await call('/jobs/'+job+'/analyze',{})).status,202);await service.tick();
    const replay=(await state()).jobs[0].replay_data;assert.equal(replay.status,'available');assert.equal(replay.points.length,1);assert.match(replay.message,/consultado anteriormente/);
  } finally {media.replay=previous;}
});

test('corte publica agora no TikTok com consentimento, conta e bytes preservados e aceita outro destino',async()=>{
  const {BrowserBridge}=await import('../src/browser-bridge.js');
  await create();await service.tick();let clip=await currentClip();
  const original=await readFile(join(cutDirectory(clip.job_id),clip.id+'.mp4'));
  const body={channelId:'browser:tiktok:default',title:'Título revisado',description:'Descrição revisada',revision:clip.revision,confirm:true,tiktok:{privacyLevel:'PUBLIC_TO_EVERYONE',madeWithAI:false,commercialContent:true,ownBrand:true}};
  assert.equal((await call('/'+clip.id+'/publish',{...body,visibility:null})).status,400);
  assert.equal((await call('/'+clip.id+'/publish',{...body,confirm:false})).status,400);
  assert.equal((await call('/'+clip.id+'/publish',{...body,revision:clip.revision+1})).status,409);
  const first=await call('/'+clip.id+'/publish',body);assert.equal(first.status,202,await first.clone().text());const {deliveryId}=await first.json();
  assert.equal((await (await call('/'+clip.id+'/publish',body)).json()).deliveryId,deliveryId);
  const delivery=(await pool.query('SELECT * FROM deliveries WHERE id=$1',[deliveryId])).rows[0];
  assert.equal(delivery.payload.metadata.youtube.visibility,'private','campos do YouTube omitidos usam o padrão válido sem afetar a privacidade pública do TikTok');assert.equal(delivery.engine,'browser');assert.equal(delivery.payload.publishNow,true);assert.ok(delivery.approved_at);assert.equal(delivery.planned_at,null);
  assert.deepEqual(await readFile(join(process.env.DATA_DIR!,delivery.local_file)),original);
  const bridge=new BrowserBridge(),instanceId=randomUUID(),report={instanceId,profileSaved:true,externalBusy:false,desktop:true,activeJobId:null};
  await bridge.poll(report);await bridge.tick();const {job}=await bridge.poll(report);
  assert.equal(job.publishNow,true);assert.equal(job.publishAt,undefined);assert.equal(job.profileId,'default');assert.equal(job.media.metadata.tiktok.commercialContent,true);assert.equal(job.media.metadata.tiktok.ownBrand,true);
  await assert.rejects(()=>bridge.finish(job.id,{instanceId,result:'published'}),/não confirmou/);
  await bridge.progress(job.id,{instanceId,stage:'browser_upload_started'});
  await bridge.progress(job.id,{instanceId,stage:'browser_published'});await bridge.finish(job.id,{instanceId,result:'published'});
  await service.retirePublished();clip=await currentClip();assert.equal(clip.status,'posted');
  assert.deepEqual(await readFile(join(cutDirectory(clip.job_id),clip.id+'.mp4')),original);
  assert.equal((await call('/'+clip.id+'/publish',publishBody(clip))).status,202);
  clip=await currentClip();assert.equal(clip.publications.length,2);assert.equal(clip.delivery_id,deliveryId);
  assert.equal((await call('/'+clip.id+'/discard',{confirm:true})).status,409,'um segundo destino pendente protege o arquivo mesmo com o primeiro confirmado');
  const edit=await call('/'+clip.id,{title:'Ajuste depois do TikTok',start:clip.start_seconds,end:clip.end_seconds,revision:clip.revision,framingOptions:{format:'video',mode:'split'}},'PUT');
  assert.equal(edit.status,202,await edit.clone().text());const {id}=await edit.json();await service.tick();
  const copy=(await state()).jobs[0].clips.find((item:any)=>item.id===id)!;
  assert.equal(copy.edited_from_cut_id,clip.id);assert.deepEqual(copy.publications,[]);assert.equal((await currentClip()).publications.length,2);
  assert.deepEqual(await readFile(join(cutDirectory(clip.job_id),clip.id+'.mp4')),original);
  assert.equal((await call('/'+copy.id+'/publish',{...body,revision:copy.revision})).status,202,'a versão revisada pode ser enviada à mesma conta do TikTok');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM deliveries')).rows[0].n,3);
});

test('biblioteca filtra projetos sem arquivos antes de paginar e inclui cortes ainda não publicados',async()=>{
  const ids=[];
  for(let i=0;i<2;i++){ids.push(await create());await service.tick();}
  const pending=await create();
  const {parsePagination}=await import('../src/pagination.js');
  let page=await service.state(parsePagination({limit:'1'},{scope:'cutFolders'}));
  const found=[page.jobs[0].id];assert.ok(!found.includes(pending));assert.equal(page.jobs[0].clips[0].hasMedia,true);assert.equal(page.pagination.hasMore,true);
  page=await service.state(parsePagination({limit:'1',cursor:page.pagination.nextCursor!},{scope:'cutFolders'}));found.push(page.jobs[0].id);
  assert.deepEqual(new Set(found),new Set(ids));assert.equal(page.pagination.hasMore,false);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM deliveries')).rows[0].n,0);
});
