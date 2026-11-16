// Run with Node 22 + tsx in the Compose app environment. Only its own temporary
// database is mutated. HTTP requests to external services are disabled.
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';

if(!process.argv.includes('--worker')) {
  if(!process.env.DATABASE_URL)throw new Error('Execute no ambiente do Compose, com DATABASE_URL configurada.');
  const database='watcher_perf_'+randomUUID().replaceAll('-','');
  const admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();
  try {
    await admin.query('CREATE DATABASE '+database);
    const url=new URL(process.env.DATABASE_URL);url.pathname='/'+database;
    const code=await new Promise((done,reject)=>{
      const child=spawn(process.execPath,['--import','tsx',new URL(import.meta.url).pathname,'--worker'],{stdio:'inherit',env:{...process.env,DATABASE_URL:url.href,PERF_DATABASE_NAME:database,LOG_LEVEL:'silent'}});
      child.once('close',done);child.once('error',reject);
    });
    if(code!==0)process.exitCode=code||1;
  } finally {await admin.query('DROP DATABASE IF EXISTS '+database+' WITH (FORCE)');await admin.end();}
} else {
  const database=new URL(process.env.DATABASE_URL||'postgres://invalid/invalid').pathname.slice(1);
  if(!/^watcher_perf_[a-f0-9]{32}$/.test(database)||database!==process.env.PERF_DATABASE_NAME)throw new Error('Banco de benchmark não autorizado.');
  const {pool,redis,initDb,setSetting}=await import('../src/db.ts');
  const {Worker}=await import('../src/worker.ts');
  const {PackSource}=await import('../src/pack-source.ts');
  const {PACK_CATALOG_URL,PACK_ROOT}=await import('../src/pack-config.ts');
  const {publicationRequests}=await import('../src/publication-requests.ts');
  const {nativeScheduleSchema,planNativeDate}=await import('../src/native-schedule.ts');
  const {saveConnectedAccount}=await import('../src/connected-accounts.ts');
  const {youtubeScopes}=await import('../src/native-auth.ts');
  const originalFetch=globalThis.fetch;let catalog=[];
  globalThis.fetch=async input=>{
    if(String(input)===PACK_CATALOG_URL)return Response.json(catalog);
    throw new Error('Rede externa desabilitada no benchmark.');
  };
  let queries=0,writes=0;
  const rawQuery=pool.query.bind(pool);
  pool.query=(...args)=>{queries++;const sql=typeof args[0]==='string'?args[0]:args[0].text;if(/^\s*(INSERT|UPDATE|DELETE)/i.test(sql))writes++;return rawQuery(...args);};
  const measure=async work=>{queries=0;writes=0;const start=performance.now();await work();return {ms:+(performance.now()-start).toFixed(2),queries,writeStatements:writes};};
  const repeated=async work=>{
    await work();const samples=[];for(let n=0;n<3;n++)samples.push(await measure(work));
    return {medianMs:samples.map(s=>s.ms).sort((a,b)=>a-b)[1],queries:samples[0].queries,writeStatements:samples[0].writeStatements,samplesMs:samples.map(s=>s.ms)};
  };
  const emit=(name,data)=>console.log(JSON.stringify({scenario:name,...data}));
  try {
    await initDb();const worker=new Worker();
    emit('context-empty',await repeated(()=>publicationRequests.context()));
    for(const size of [1130,5000]) {
      catalog=Array.from({length:size},(_,i)=>({t:'Vídeo '+String(i).padStart(4,'0'),type:'v',drive:'perf-video-'+String(i).padStart(8,'0')}));
      await new PackSource().catalog(true);
      const id=randomUUID();await pool.query(`INSERT INTO watches(id,name,folder_id,folder_url,source_type,profile_id,enabled,import_existing,require_metadata)
        VALUES($1,'Benchmark catálogo',$2,'https://benchmark.invalid','gta6_pack',$3,false,true,true)`,[id,PACK_ROOT,randomUUID()]);
      let {rows:[watch]}=await pool.query('SELECT * FROM watches WHERE id=$1',[id]);
      const initial=await measure(()=>worker.scan(watch));
      ({rows:[watch]}=await pool.query('SELECT * FROM watches WHERE id=$1',[id]));
      const unchanged=await measure(()=>worker.scan(watch));
      emit('scan-catalog',{videos:size,initial,unchanged});
    }
    const historyWatch=randomUUID(),profile=randomUUID();
    await pool.query(`INSERT INTO watches(id,name,folder_id,folder_url,enabled) VALUES($1,'Benchmark histórico','benchmark-history-root','benchmark',true)`,[historyWatch]);
    await pool.query('INSERT INTO publishing_profiles(id,name) VALUES($1,$2)',[profile,'Benchmark']);
    await pool.query(`INSERT INTO publication_requests(id,request_key,profile_id,provider,quantity,config,status)
      SELECT gen_random_uuid(),'benchmark-'||n,$1,'youtube',1000,'{}','cancelled' FROM generate_series(1,100) n`,[profile]);
    const {rows:requests}=await pool.query('SELECT id FROM publication_requests ORDER BY created_at,id');
    await pool.query(`INSERT INTO videos(id,watch_id,file_id,name,parent_id,status)
      SELECT gen_random_uuid(),$1,'history-'||n,'Histórico '||n,'root','sent' FROM generate_series(1,100000) n`,[historyWatch]);
    await pool.query(`INSERT INTO deliveries(id,video_id,integration_id,provider,status,planned_at,request_id)
      SELECT gen_random_uuid(),id,'benchmark-history-channel','youtube','published',now()-interval '1 year',($1::uuid[])[1+((row_number() OVER ())-1)::int%100] FROM videos WHERE watch_id=$2`,[requests.map(r=>r.id),historyWatch]);
    await pool.query('VACUUM ANALYZE deliveries');
    const explain=async()=>{
      const result=await pool.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT count(*) FILTER(WHERE status IN ('scheduled','published'))::int FROM deliveries WHERE request_id=$1`,[requests[0].id]);
      const plan=result.rows[0]['QUERY PLAN'][0];const nodes=[];const walk=n=>{if(n['Node Type'].includes('Scan'))nodes.push({type:n['Node Type'],rows:n['Actual Rows'],removed:n['Rows Removed by Filter']||0,blocks:n['Shared Hit Blocks'],index:n['Index Name']});for(const child of n.Plans||[])walk(child);};walk(plan.Plan);
      return {executionMs:plan['Execution Time'],nodes};
    };
    await pool.query('DROP INDEX IF EXISTS deliveries_request_status');
    emit('context-history-no-request-index',{requests:100,deliveries:100000,...await repeated(()=>publicationRequests.context()),explain:await explain()});
    // This index exists only in the throwaway database, never in the application.
    await pool.query('CREATE INDEX perf_delivery_request_status ON deliveries(request_id,status)');
    emit('context-history-proposed-index',{requests:100,deliveries:100000,...await repeated(()=>publicationRequests.context()),explain:await explain()});
    emit('calendar-database-history',{deliveries:100000,returnedReservations:(await worker.native.calendar('benchmark-history-channel')).length,
      ...await repeated(()=>worker.native.calendar('benchmark-history-channel'))});
    const cadence={cadence:'daily',interval_minutes:720,times:['08:00','20:00'],timezone:'America/Sao_Paulo'},policy=nativeScheduleSchema.parse({}),now=new Date('2026-11-16T12:00:00Z');
    for(const size of [1000,10000,50000,150000]) {
      const reservations=Array.from({length:size},()=>({plannedAt:new Date('2025-11-16T12:00:00Z'),startedAt:null}));
      try {const result=await repeated(()=>planNativeDate('youtube',cadence,policy,reservations,now));emit('planner-history',{reservations:size,...result});}
      catch(error){emit('planner-history',{reservations:size,error:error.name,message:error.message});}
    }
    // Reproduce head-of-line blocking without files, platform calls or uploads.
    for(const id of ['perf-blocked-001','perf-ready-0002'])await saveConnectedAccount('youtube',id,id,{channelId:id,access_token:'benchmark-only',refresh_token:'benchmark-only',expiry_date:Date.now()+3600000,scope:youtubeScopes.join(' ')},{clientId:'benchmark',clientSecret:'benchmark',autoPublishApproved:true});
    const blocked='native:youtube:perf-blocked-001',available='native:youtube:perf-ready-0002';
    await setSetting('uploadCooldown:'+blocked,new Date(Date.now()+86400000).toISOString());
    const {rows:videos}=await pool.query('SELECT id FROM videos WHERE watch_id=$1 ORDER BY created_at,id LIMIT 101',[historyWatch]);
    const blockedIds=[];let availableId;
    for(let n=0;n<101;n++) {
      const id=randomUUID();await pool.query(`INSERT INTO deliveries(id,video_id,integration_id,provider,engine,status,approved_at,local_file,payload,created_at)
        VALUES($1,$2,$3,'youtube','local','pending',now(),$4,$5,now()+($6*interval '1 millisecond'))`,[id,videos[n].id,n<100?blocked:available,id+'.native.mp4',JSON.stringify({automatic:false,nativeSchedule:false}),n]);
      if(n<100)blockedIds.push(id);else availableId=id;
    }
    const batch=await worker.native.ready();await worker.native.process(blockedIds[0]);const next=await worker.native.ready();
    emit('queue-cooldown-fairness',{pending:101,batch:batch.length,blockedInBatch:batch.filter(id=>blockedIds.includes(id)).length,eligibleIncluded:batch.includes(availableId),sameBatchAfterBlockedProcess:JSON.stringify(batch)===JSON.stringify(next)});
  } finally {globalThis.fetch=originalFetch;redis.disconnect();await pool.end();}
}
