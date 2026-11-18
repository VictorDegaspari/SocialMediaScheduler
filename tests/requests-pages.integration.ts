import {test,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import express from 'express';

const database=new URL(process.env.DATABASE_URL!);database.pathname='/watcher_requests_pages_test';process.env.DATABASE_URL=database.toString();
const redisUrl=new URL(process.env.REDIS_URL!);redisUrl.pathname='/8';process.env.REDIS_URL=redisUrl.toString();
const temp=await mkdtemp(join(tmpdir(),'watcher-request-pages-'));
process.env.DATA_DIR=join(temp,'data');process.env.LOCAL_MEDIA_DIR=join(temp,'media');process.env.LOCAL_MEDIA_HOST_DIR=process.env.LOCAL_MEDIA_DIR;
await mkdir(process.env.LOCAL_MEDIA_DIR);
const {pool,redis,initDb,setSetting}=await import('../src/db.js');
const {PublicationRequests,requestRoutes}=await import('../src/publication-requests.js');
const {BrowserBridge,browserRoutes}=await import('../src/browser-bridge.js');
const {parsePagination}=await import('../src/pagination.js');
const {AppError,encrypt}=await import('../src/config.js');
await initDb();
const requests=new PublicationRequests(),bridge=new BrowserBridge();
const app=express();app.use(express.json());app.use(requestRoutes);app.use(browserRoutes);
app.use((error:any,_req:any,res:any,_next:any)=>res.status(error instanceof AppError?error.status:400).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.on('listening',resolve));
const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
let profile=randomUUID();
const id=(number:number)=>'00000000-0000-4000-8000-'+String(number).padStart(12,'0');

beforeEach(async()=>{
  await pool.query('TRUNCATE manual_actions,browser_commands,publication_requests,publishing_profiles,browser_profiles,connected_accounts,settings,browser_agent,browser_settings,events CASCADE');
  profile=randomUUID();
  await pool.query("INSERT INTO browser_profiles(id,name) VALUES('default','Principal')");
  await pool.query("INSERT INTO publishing_profiles(id,name) VALUES($1,'Perfil de teste')",[profile]);
});
after(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await pool.end();await redis.quit();await rm(temp,{recursive:true,force:true});});

async function seedRequests(count=47){
  await pool.query(`INSERT INTO publication_requests(id,request_key,profile_id,provider,quantity,config,created_at)
    SELECT ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'test-'||i,$1,'youtube',2,
      '{"cadence":{"times":["08:00"],"timezone":"America/Sao_Paulo"}}'::jsonb,
      '2026-11-01T12:00:00.100001Z'::timestamptz+(i%3)*interval '1 microsecond'
    FROM generate_series(1,$2::int) i`,[profile,count]);
  await pool.query(`INSERT INTO manual_actions(id,request_id,kind,message,resolved_at,created_at)
    SELECT id,id,'setup','Conectar conta',CASE WHEN request_key='test-1' THEN now() END,created_at FROM publication_requests`);
}
async function seedJobs(count=47){
  await pool.query(`INSERT INTO browser_commands(id,kind,config,status,created_at)
    SELECT ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'login','{}','done',
      '2026-11-01T12:00:00.100001Z'::timestamptz+(i%3)*interval '1 microsecond'
    FROM generate_series(1,$1::int) i`,[count]);
}

test('contexto limita históricos e mantém todas as configurações e o total real de pendências',async()=>{
  await seedRequests();
  const tokens=encrypt({}),config=encrypt({});
  await pool.query(`INSERT INTO publishing_profiles(id,name) SELECT ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'Perfil '||i FROM generate_series(1,25) i`);
  await pool.query("INSERT INTO browser_profiles(id,name) SELECT i::text,'Chrome '||i FROM generate_series(1,25) i");
  await pool.query("INSERT INTO connected_accounts(provider,external_id,name,tokens,config) SELECT 'youtube',i::text,'Canal '||i,$1,$2 FROM generate_series(1,25) i",[tokens,config]);
  const context=await requests.context();
  assert.equal(context.requests.length,20);assert.equal(context.actions.length,20);
  assert.equal(context.summary.actionCount,46);assert.equal(context.profiles.length,26);
  assert.equal(context.browserProfiles.length,26);assert.equal(context.accounts.length,25);
  assert.equal(context.pagination.requests.hasMore,true);assert.equal(context.pagination.actions.hasMore,true);
  assert.equal(context.requests[0].waiting,2);
  assert(!JSON.stringify(context).includes('__cursor_'));
});

test('API percorre pedidos e ações com horários empatados e microssegundos sem perder ou repetir itens',async()=>{
  await seedRequests();
  for(const [collection,limit,expectedCount] of [['requests',7,47],['actions',5,46]] as const){
    let cursor:string|null=null;const seen:string[]=[];
    do{
      const params=new URLSearchParams({requestsLimit:'1',actionsLimit:'1',[collection+'Limit']:String(limit)});
      if(cursor)params.set(collection+'Cursor',cursor);
      const response=await fetch(base+'/api/assistant/context?'+params);assert.equal(response.status,200);
      const context=await response.json(),page=context.pagination[collection];
      assert(context[collection].length<=limit);assert.equal(context.summary.actionCount,46);
      seen.push(...context[collection].map((item:any)=>item.id));
      assert.equal(page.hasMore,!!page.nextCursor);cursor=page.nextCursor;
    }while(cursor);
    assert.equal(seen.length,expectedCount);assert.equal(new Set(seen).size,expectedCount);
    const expected=await pool.query(`SELECT id FROM ${collection==='requests'?'publication_requests':'manual_actions WHERE resolved_at IS NULL'} ORDER BY created_at DESC,id DESC`);
    assert.deepEqual(seen,expected.rows.map(row=>row.id));
  }
});

test('continuação por cursor não repete itens após nova inserção ou remoção na primeira página',async()=>{
  await seedRequests(12);
  const first=await requests.context({requests:parsePagination({limit:'4'},{scope:'requests'})});
  const cursor=first.pagination.requests.nextCursor;assert(cursor);
  await pool.query('DELETE FROM manual_actions WHERE request_id=$1',[first.requests[0].id]);
  await pool.query('DELETE FROM publication_requests WHERE id=$1',[first.requests[0].id]);
  await pool.query(`INSERT INTO publication_requests(id,request_key,profile_id,provider,quantity,config,created_at) VALUES($1,'new',$2,'youtube',1,'{}',now())`,[randomUUID(),profile]);
  const next=await requests.context({requests:parsePagination({limit:'4',cursor},{scope:'requests'})});
  assert.equal(next.requests.length,4);
  assert(next.requests.every(item=>!first.requests.some(previous=>previous.id===item.id)));
});

test('histórico do navegador é paginado e a tarefa ativa independe da página consultada',async()=>{
  await setSetting('playwrightMcpExtension',{extensionToken:'test-extension-token'});
  await seedJobs();
  // Place an active task outside the newest history page.
  await pool.query("UPDATE browser_commands SET status='pending',created_at='2026-01-01' WHERE id=$1",[id(1)]);
  const first=await bridge.state();assert.equal(first.jobs.length,20);
  assert.equal(first.active?.id,id(1));assert(!first.jobs.some(item=>item.id===id(1)));
  const second=await bridge.state(parsePagination({limit:'20',cursor:first.pagination.nextCursor!},{scope:'browser'}));
  assert.equal(second.active?.id,id(1));assert.equal(second.jobs.length,20);
  assert(second.jobs.every(item=>!first.jobs.some(previous=>previous.id===item.id)));
  const claimed=await bridge.poll({instanceId:randomUUID(),profileSaved:true,externalBusy:false,desktop:true,activeJobId:null});
  assert.equal(claimed.job?.id,id(1));
  assert.equal((await bridge.state()).active?.status,'running');
  assert(!JSON.stringify(first).includes('__cursor_'));
});

test('endpoint de tarefas percorre todo o histórico em ordem e termina com cursor nulo',async()=>{
  await seedJobs(23);let cursor:string|null=null;const seen:string[]=[];
  do{
    const query=new URLSearchParams({limit:'6'});if(cursor)query.set('cursor',cursor);
    const response=await fetch(base+'/api/browser/jobs?'+query);assert.equal(response.status,200);
    const page=await response.json();assert(page.items.length<=6);
    seen.push(...page.items.map((item:any)=>item.id));cursor=page.pagination.nextCursor;
    assert.equal(page.pagination.hasMore,!!cursor);
  }while(cursor);
  assert.equal(new Set(seen).size,23);assert.equal(seen.length,23);
  assert.deepEqual(seen,(await pool.query('SELECT id FROM browser_commands ORDER BY created_at DESC,id DESC')).rows.map(row=>row.id));
});

test('rotas rejeitam limites inválidos, cursores de outra coleção e tentativas de injeção',async()=>{
  await seedRequests();await seedJobs();
  const context=await requests.context(),browser=await bridge.jobs();
  const injection=Buffer.from(JSON.stringify({v:1,scope:'requests',time:'2026-01-01T00:00:00.000000Z',id:"' OR true --"})).toString('base64url');
  for(const path of [
    '/api/assistant/context?requestsLimit=0','/api/assistant/context?actionsLimit=101',
    '/api/assistant/context?requestsLimit=1.5','/api/assistant/context?requestsLimit=1&requestsLimit=2',
    '/api/assistant/context?requestsCursor=','/api/assistant/context?requestsCursor='+injection,
    '/api/assistant/context?actionsCursor='+context.pagination.requests.nextCursor,
    '/api/assistant/context?requestsCursor='+browser.pagination.nextCursor,
    '/api/browser/jobs?limit=-1','/api/browser/jobs?limit=101','/api/browser/jobs?cursor=invalid',
    '/api/browser/jobs?cursor='+context.pagination.actions.nextCursor
  ]){
    const response=await fetch(base+path);assert.equal(response.status,400,path);
    assert.equal(typeof (await response.json()).error,'string');
  }
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM publication_requests')).rows[0].count,47);
});
