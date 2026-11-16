import {test,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {packDefaultsSchema,PACK_ROOT,PACK_CATALOG_URL} from '../src/pack-config.js';
process.env.ENCRYPTION_KEY||='00'.repeat(32);
const temp=await mkdtemp(join(tmpdir(),'watcher-pack-'));process.env.DATA_DIR=temp;
const {PackSource,parsePackCatalog,packMetadata}=await import('../src/pack-source.js');
const {BrowserJournal}=await import('../src/browser-tiktok.js');
const original=globalThis.fetch;
const catalog=[{t:'Vídeo 0001',type:'v',drive:'allowed-video-001'},{t:'Vídeo 0002',type:'v',drive:'allowed-video-002'},{t:'Imagem',type:'img',drive:'allowed-image-001'}];
let scenario='ok',requests:string[]=[];
globalThis.fetch=async input=>{
  const url=String(input);requests.push(url);
  if(url===PACK_CATALOG_URL) {if(scenario==='catalog-down')return new Response('Unavailable',{status:503});if(scenario==='catalog-denied')return new Response('Denied',{status:403});return Response.json(catalog);}
  if(url.startsWith('https://drive.usercontent.google.com/')) {
    if(scenario==='redirect-private')return new Response(null,{status:302,headers:{location:'http://127.0.0.1/secrets'}});
    if(scenario==='html')return new Response('<html>Sign in</html>',{headers:{'Content-Type':'text/html'}});
    if(scenario==='declared-large')return new Response('video',{headers:{'Content-Type':'video/mp4','Content-Length':'99999'}});
    if(scenario==='stream-large')return new Response('a'.repeat(100),{headers:{'Content-Type':'video/mp4'}});
    if(scenario==='partial')return new Response('video',{status:206,headers:{'Content-Type':'video/mp4'}});
    return new Response('MP4 test bytes',{headers:{'Content-Type':'video/mp4'}});
  }
  throw new Error('Unexpected network request');
};
beforeEach(async()=>{scenario='ok';requests=[];await new PackSource().catalog(true);});
test('catálogo ignora imagens, elimina IDs repetidos e rejeita URLs e registros desconhecidos',()=>{
  assert.equal(parsePackCatalog([...catalog,catalog[0]]).length,2);
  assert.throws(()=>parsePackCatalog([{t:'Teste',url:'http://localhost/private'}]),/formato/);
  assert.throws(()=>parsePackCatalog([{t:'Teste',drive:'../../private'}]),/formato/);
  assert.throws(()=>parsePackCatalog([]),/entre 1/);
});
test('origem produz vídeos e JSONs estáveis com título, privacidade e declarações configuradas',async()=>{
  const source=new PackSource({madeWithAI:true,youtubeContainsSyntheticMedia:true,youtubeVisibility:'public'}),files=await source.tree(PACK_ROOT,true);
  assert.equal(files.length,4);assert.equal(files[0].mimeType,'video/mp4');assert.equal(files[0].size,undefined);
  const meta=await source.json(files[1].id);assert.equal(meta.title,'GTA 6 — Vídeo 0001');
  assert.equal(meta.youtube.visibility,'public');assert.equal(meta.youtube.containsSyntheticMedia,true);assert.equal(meta.tiktok.madeWithAI,true);
  assert.equal(meta.tiktok.privacyLevel,'PUBLIC_TO_EVERYONE');
  assert.deepEqual(await source.file(files[0].id),files[0]);
  const changed=new PackSource({description:'Outra descrição'});assert.equal((await changed.file(files[0].id)).version,files[0].version);
  assert.notEqual((await changed.file(files[1].id)).version,files[1].version,'apenas a versão dos metadados muda');
  assert.equal(packMetadata(catalog[0] as any,packDefaultsSchema.parse({madeWithAI:false})).tiktok.madeWithAI,false);
});
test('YouTube não herda declaração de IA do TikTok e permanece desmarcado por padrão',()=>{
  const base=packDefaultsSchema.parse({madeWithAI:true});
  assert.equal(packDefaultsSchema.parse({}).youtubeContainsSyntheticMedia,false);
  assert.equal(packMetadata(catalog[0] as any,base).youtube.containsSyntheticMedia,false,'a declaração do TikTok não ativa o rótulo do YouTube');
  const separate=packMetadata(catalog[0] as any,packDefaultsSchema.parse({...base,youtubeContainsSyntheticMedia:false}));
  assert.equal(separate.youtube.containsSyntheticMedia,false);assert.equal(separate.tiktok.madeWithAI,true);
  const reverse=packMetadata(catalog[0] as any,packDefaultsSchema.parse({madeWithAI:false,youtubeContainsSyntheticMedia:true}));
  assert.equal(reverse.youtube.containsSyntheticMedia,true);assert.equal(reverse.tiktok.madeWithAI,false);
});
test('baixa somente o ID autorizado e não grava páginas de login ou arquivos parciais',async()=>{
  const source=new PackSource(),path=join(temp,'download.mp4');
  await assert.rejects(()=>source.download('gta6-pack:another-video',path,1000),/catálogo autorizado/);
  assert.equal(requests.length,1);
  assert.equal(await source.download('gta6-pack:allowed-video-001',path,1000),14);
  assert.equal((await readFile(path)).toString(),'MP4 test bytes');
  for(const value of ['html','partial']) {scenario=value;await assert.rejects(()=>source.download('gta6-pack:allowed-video-001',path,1000));await assert.rejects(()=>stat(path),{code:'ENOENT'});}
});
test('rejeita redirecionamento para rede local e aplica limite mesmo sem Content-Length',async()=>{
  const source=new PackSource(),path=join(temp,'limited.mp4');
  for(const value of ['redirect-private','declared-large','stream-large']) {
    scenario=value;await assert.rejects(()=>source.download('gta6-pack:allowed-video-001',path,20));
    await assert.rejects(()=>stat(path),{code:'ENOENT'});
  }
  assert.equal(requests.some(url=>url.startsWith('http://127.0.0.1')),false);
});
test('histórico por origem persiste e não exige baixar outra vez um arquivo já enviado',async()=>{
  const journal=new BrowserJournal(join(temp,'journal'));await journal.init();
  const hash='a'.repeat(64);await journal.claim(hash,'Video.mp4',true,'gta6-pack:allowed-video-001');
  await journal.rememberSource('gta6-pack:allowed-video-002',hash);
  assert.equal(await new BrowserJournal(journal.directory).sourceSeen('gta6-pack:allowed-video-002'),true);
  await journal.releaseBeforeUpload(hash);
  assert.equal(await journal.sourceSeen('gta6-pack:allowed-video-002'),false,'liberar antes do upload não bloqueia um envio futuro');
});
test('catálogo persistido sobrevive reinício e falha temporária, sem ocultar acesso negado',async()=>{
  (PackSource as any).cached=undefined;scenario='catalog-down';
  assert.equal((await new PackSource().catalog()).length,2);
  (PackSource as any).cached=undefined;scenario='catalog-denied';
  await assert.rejects(()=>new PackSource().catalog(),/recusou/);
});
after(async()=>{globalThis.fetch=original;await rm(temp,{recursive:true,force:true});});
