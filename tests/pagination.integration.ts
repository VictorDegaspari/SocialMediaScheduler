import { after,beforeEach,test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';

const dbUrl=new URL(process.env.DATABASE_URL!);dbUrl.pathname='/watcher_pagination_test';process.env.DATABASE_URL=dbUrl.toString();
const redisUrl=new URL(process.env.REDIS_URL!);redisUrl.pathname='/11';process.env.REDIS_URL=redisUrl.toString();
const { pool,redis,initDb }=await import('../src/db.js');
const { AppError }=await import('../src/config.js');
const { dashboardRoutes,dashboardStats }=await import('../src/dashboard-lists.js');
await initDb();
const app=express();app.use(dashboardRoutes);
app.use((error:any,_req:any,res:any,_next:any)=>res.status(error instanceof AppError?error.status:500).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
const request=(path:string)=>fetch(base+'/api/'+path);
const page=async(path:string)=>{const response=await request(path);assert.equal(response.status,200,await response.clone().text());return response.json();};
const uid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const times=['123455','123456','123456','123456','123457'].map(micros=>'2026-01-01T10:00:00.'+micros+'Z');
async function watch(options:{id?:string;createdAt?:string;enabled?:boolean;source?:string;managed?:boolean;controlled?:boolean}={}){
  const id=options.id||randomUUID();
  await pool.query(`INSERT INTO watches(id,name,folder_id,folder_url,created_at,enabled,source_type,managed_by_cuts,controlled_by_requests)
    VALUES($1::uuid,$2,$1::text,$2,$3,$4,$5,$6,$7)`,[id,'Origem '+id,options.createdAt||times[1],options.enabled??true,options.source||'google_drive',options.managed??false,options.controlled??false]);
  return id;
}
async function video(watchId:string,options:{id?:string;status?:string;createdAt?:string;updatedAt?:string}={}){
  const id=options.id||randomUUID();
  await pool.query(`INSERT INTO videos(id,watch_id,file_id,name,parent_id,status,created_at,updated_at) VALUES($1::uuid,$2,$1::text,$3,'root',$4,$5,$6)`,
    [id,watchId,'Vídeo '+id,options.status||'posted',options.createdAt||times[1],options.updatedAt||times[1]]);
  return id;
}
async function delivery(videoId:string,status:string,options:{engine?:string;provider?:string;postId?:string;url?:string;error?:string;plannedAt?:string}={}){
  const id=randomUUID();
  await pool.query(`INSERT INTO deliveries(id,video_id,integration_id,provider,engine,status,post_id,release_url,error,planned_at) VALUES($1::uuid,$2,$1::text,$3,$4,$5,$6,$7,$8,$9)`,
    [id,videoId,options.provider||'youtube',options.engine||'local',status,options.postId||null,options.url||null,options.error||null,options.plannedAt||null]);
  return id;
}
beforeEach(async()=>{await pool.query('TRUNCATE watches,videos,deliveries,events RESTART IDENTITY CASCADE');});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await redis.quit();await pool.end();});

test('origens ocultas não ocupam páginas e empates com microssegundos permanecem estáveis',async()=>{
  for(let i=0;i<5;i++)await watch({id:uid(i+1),createdAt:times[i]});
  await pool.query(`INSERT INTO watches(id,name,folder_id,folder_url,created_at,managed_by_cuts,controlled_by_requests)
    SELECT gen_random_uuid(),'Oculta',n::text,'oculta','2026-02-01T00:00:00Z',n%2=0,n%2=1 FROM generate_series(1,45) n`);
  const videoId=await video(uid(5),{status:'ready'});await delivery(videoId,'pending');await delivery(videoId,'pending',{engine:'postiz'});
  const first=await page('watches?limit=2');assert.deepEqual(first.items.map((w:any)=>w.id),[uid(5),uid(4)]);
  assert.equal(first.items[0].pending_count,2);assert.equal(first.pagination.hasMore,true);
  assert.equal(JSON.parse(Buffer.from(first.pagination.nextCursor,'base64url').toString()).time,times[3]);
  await watch({createdAt:'2026-03-01T00:00:00Z'});
  const second=await page('watches?limit=2&cursor='+first.pagination.nextCursor);
  assert.deepEqual(second.items.map((w:any)=>w.id),[uid(3),uid(2)]);
  const third=await page('watches?limit=2&cursor='+second.pagination.nextCursor);
  assert.deepEqual(third.items.map((w:any)=>w.id),[uid(1)]);assert.equal(third.pagination.hasMore,false);assert.equal(third.pagination.nextCursor,null);
  for(const result of [first,second,third])for(const item of result.items){assert.equal('__cursor_time' in item,false);assert.equal('__cursor_id' in item,false);}
});

test('eventos paginam IDs bigint sem conversão para números e preservam origens opcionais',async()=>{
  const watchId=await watch(),ids=Array.from({length:5},(_,i)=>(9007199254740991n+BigInt(i)).toString());
  for(let i=0;i<5;i++)await pool.query(`INSERT INTO events(id,level,message,watch_id,created_at) VALUES($1,'info',$2,$3,$4)`,[ids[i],'Evento '+ids[i],i%2?watchId:null,times[i]]);
  const first=await page('events?limit=2');assert.deepEqual(first.items.map((e:any)=>e.id),[ids[4],ids[3]]);
  assert.equal(first.items[0].watch_name,null);assert.equal(first.items[1].watch_name,'Origem '+watchId);
  await pool.query(`INSERT INTO events(id,level,message,created_at) VALUES('9223372036854775807','info','Novo','2026-03-01T00:00:00Z')`);
  const second=await page('events?limit=2&cursor='+first.pagination.nextCursor);
  assert.deepEqual(second.items.map((e:any)=>e.id),[ids[2],ids[1]]);
  const third=await page('events?limit=2&cursor='+second.pagination.nextCursor);
  assert.deepEqual(third.items.map((e:any)=>e.id),[ids[0]]);assert.equal(third.pagination.nextCursor,null);
});

test('vídeos seguem a última atualização e mantêm todas as entregas em cada página',async()=>{
  const watchId=await watch();
  for(let i=0;i<5;i++)await video(watchId,{id:uid(i+1),updatedAt:times[i],createdAt:times[4-i]});
  const expected=await delivery(uid(5),'published',{postId:'youtube-id',url:'https://www.youtube.com/watch?v=abcdefghijk'});
  await delivery(uid(5),'failed',{provider:'tiktok',error:'Falha conhecida'});
  await delivery(uid(5),'scheduled',{plannedAt:'2026-05-01T12:00:00Z'});
  const first=await page('videos?limit=2');assert.deepEqual(first.items.map((v:any)=>v.id),[uid(5),uid(4)]);
  assert.equal(first.items[0].deliveries.length,3);assert.deepEqual(first.items[1].deliveries,[]);
  const sent=first.items[0].deliveries.find((d:any)=>d.id===expected);
  assert.equal(sent.postId,'youtube-id');assert.equal(sent.url,'https://www.youtube.com/watch?v=abcdefghijk');assert.equal(sent.engine,'local');
  assert.equal(first.items[0].deliveries.find((d:any)=>d.status==='failed').error,'Falha conhecida');
  assert.ok(first.items[0].deliveries.find((d:any)=>d.status==='scheduled').plannedAt.startsWith('2026-05-01T12:00:00'));
  await video(watchId,{updatedAt:'2026-03-01T00:00:00Z'});
  const second=await page('videos?limit=2&cursor='+first.pagination.nextCursor);
  assert.deepEqual(second.items.map((v:any)=>v.id),[uid(3),uid(2)]);
  const third=await page('videos?limit=2&cursor='+second.pagination.nextCursor);
  assert.deepEqual(third.items.map((v:any)=>v.id),[uid(1)]);assert.equal(third.pagination.hasMore,false);
});

test('todas as rotas validam limites, escopo e tipo de cursor antes da consulta',async()=>{
  const encode=(data:unknown)=>Buffer.from(JSON.stringify(data)).toString('base64url');
  for(const collection of ['watches','events','videos']){
    for(const query of ['limit=0','limit=101','limit=-1','limit=1.5','limit=2&limit=3','cursor=invalid','cursor='])
      assert.equal((await request(collection+'?'+query)).status,400,collection+'?'+query);
    for(const cursor of [
      {v:1,scope:'wrong',time:times[1],id:collection==='events'?'1':uid(1)},
      {v:1,scope:collection,time:times[1],id:collection==='events'?uid(1):'1'},
      {v:1,scope:collection,time:'invalid',id:collection==='events'?'1':uid(1)},
      {v:1,scope:collection,time:'2026-02-31T10:00:00.123456Z',id:collection==='events'?'1':uid(1)},
      {v:1,scope:collection,time:'0000-01-01T10:00:00.123456Z',id:collection==='events'?'1':uid(1)}
    ])assert.equal((await request(collection+'?cursor='+encode(cursor))).status,400);
    assert.deepEqual(await page(collection),{items:[],pagination:{limit:20,hasMore:false,nextCursor:null}});
  }
});

test('limite padrão e teto de cem mantêm coleções grandes disponíveis até a última página',async()=>{
  await pool.query(`INSERT INTO watches(id,name,folder_id,folder_url) SELECT gen_random_uuid(),'Origem',n::text,'origem' FROM generate_series(1,105) n`);
  const watchId=(await pool.query('SELECT id FROM watches LIMIT 1')).rows[0].id;
  await pool.query(`INSERT INTO videos(id,watch_id,file_id,name,parent_id) SELECT gen_random_uuid(),$1,n::text,'Vídeo','root' FROM generate_series(1,105) n`,[watchId]);
  await pool.query(`INSERT INTO events(level,message) SELECT 'info','Evento' FROM generate_series(1,105)`);
  for(const collection of ['watches','events','videos']){
    assert.equal((await page(collection)).items.length,20);
    const first=await page(collection+'?limit=100');assert.equal(first.items.length,100);assert.equal(first.pagination.hasMore,true);
    const last=await page(collection+'?limit=100&cursor='+first.pagination.nextCursor);
    assert.equal(last.items.length,5);assert.equal(last.pagination.hasMore,false);assert.equal(last.pagination.nextCursor,null);
    assert.equal(new Set([...first.items,...last.items].map((item:any)=>item.id)).size,105);
  }
});

test('estatísticas são globais e não mudam ao navegar em páginas pequenas',async()=>{
  const local=await watch({source:'local'});await watch({enabled:false});await watch({source:'gta6_pack'});
  await watch({managed:true,source:'local'});await watch({controlled:true,source:'local'});
  const videos=[];for(const status of ['ready','waiting','retry','uploading','posted'])videos.push(await video(local,{status}));
  for(const status of ['review','pending','retry','submitting'])await delivery(videos[0],status);
  for(const status of ['draft','scheduled','published','processing','private','unlisted','inbox','completed'])await delivery(videos[1],status);
  for(const status of ['unknown','failed'])await delivery(videos[2],status);
  await delivery(videos[0],'pending',{engine:'postiz'});
  const expected={watches:3,active_watches:2,local_source_ready:true,pending:8,sent:8,attention:2};
  assert.deepEqual(await dashboardStats(),expected);
  for(const collection of ['watches','videos']){
    const first=await page(collection+'?limit=1');assert.equal(first.items.length,1);assert.deepEqual(await dashboardStats(),expected);
    const second=await page(collection+'?limit=1&cursor='+first.pagination.nextCursor);
    assert.equal(second.items.length,1);assert.notEqual(first.items[0].id,second.items[0].id);assert.deepEqual(await dashboardStats(),expected);
  }
  await pool.query("UPDATE watches SET source_type='google_drive' WHERE managed_by_cuts=false AND controlled_by_requests=false");
  assert.deepEqual(await dashboardStats(),{...expected,local_source_ready:false});
});
