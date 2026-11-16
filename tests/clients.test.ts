import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
const {Postiz,GoogleDrive}=await import('../src/clients.js');
const {AppError}=await import('../src/config.js');
const {retryAfter}=await import('../src/config.js');

async function stub(status:number,body:unknown,run:(client:InstanceType<typeof Postiz>)=>Promise<void>) {
  const server=createServer((_req,res)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert(address && typeof address!=='string');
  try{await run(new Postiz({baseUrl:`http://127.0.0.1:${address.port}`,apiKey:'test-key',youtubeSchedulingApproved:false}));}
  finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
}

test('criação perdida ou resposta 500 é resultado desconhecido, sem retry automático',async()=>{
  await stub(500,{message:'Unavailable'},async client=>{
    await assert.rejects(()=>client.create({}),e=>e instanceof AppError && e.ambiguous);
  });
  await stub(200,[],async client=>{
    await assert.rejects(()=>client.create({}),e=>e instanceof AppError && e.ambiguous);
  });
});

test('429 e rejeição de validação são distinguíveis de uma criação sem confirmação',async()=>{
  for(const status of [400,429])await stub(status,{message:'Rejected'},async client=>{
    await assert.rejects(()=>client.create({}),e=>e instanceof AppError && !e.ambiguous && e.status===status);
  });
});

test('interpreta Retry-After em segundos e data HTTP',()=>{
  assert.equal(retryAfter(new Response('',{headers:{'retry-after':'3600'}})),3600_000);
  const future=new Date(Date.now()+120_000).toUTCString();
  const delay=retryAfter(new Response('',{headers:{'retry-after':future}}));
  assert(delay && delay>118_000 && delay<=120_000);
});

test('retorna o ID real da API e filtra canais suportados sem considerar desabilitado como ativo',async()=>{
  await stub(200,[{postId:'real-post',integration:'channel'}],async client=>assert.equal(await client.create({}),'real-post'));
  await stub(200,[{id:'a',name:'Youtube',identifier:'youtube',disabled:true},{id:'b',identifier:'x'}],async client=>{
    const integrations=await client.integrations();assert.equal(integrations.length,1);assert.equal(integrations[0].disabled,true);
  });
});

test('listagem do Drive consome todas as páginas e preserva o filtro de pasta',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(input)=>{
    const url=new URL(String(input));assert.equal(url.searchParams.get('q'),"'folder-id' in parents and trashed = false");calls++;
    return Response.json(calls===1?{files:[{id:'a'}],nextPageToken:'page-2'}:{files:[{id:'b'}]});
  };
  try{const files=await new GoogleDrive('fake-token').list('folder-id');assert.equal(files.length,2);assert.equal(calls,2);}
  finally{globalThis.fetch=original;}
});
test('raízes sobrepostas do Drive compartilham a visita de subpastas e não repetem arquivos',async()=>{
  const drive=new GoogleDrive('fake-token'),calls:string[]=[];
  drive.list=async id=>{calls.push(id);return id==='root'?[{id:'child',name:'Filha',mimeType:'application/vnd.google-apps.folder'},{id:'root-video',name:'a.mp4',mimeType:'video/mp4'}]:[{id:'child-video',name:'b.mp4',mimeType:'video/mp4'}];};
  const files=await drive.treeRoots(['root','child','root'],true);
  assert.deepEqual(calls,['root','child']);assert.deepEqual(files.map(f=>f.id),['root-video','child-video']);
  assert.deepEqual(files[1].parents,['child']);
});
