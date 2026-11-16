import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {metadataSchema} from '../src/domain.js';
import {createServer} from 'node:http';
import {once} from 'node:events';
process.env.ENCRYPTION_KEY||='00'.repeat(32);
const {youtubeBody,youtubeTitleBody,youtubeDisclosureBody,tiktokChunks}=await import('../src/native-api.js');
const {pool,redis}=await import('../src/db.js');
const {providerFetch}=await import('../src/native-auth.js');
const {youtubeEditAuthorized,youtubeEditScope}=await import('../src/native-auth.js');
const {genericVideoTitle}=await import('../src/video-titles.js');
const {AppError}=await import('../src/config.js');
test('308 real do upload retomável retorna Range sem seguir redirects nem expor credenciais',async()=>{
  let calls=0;
  const server=createServer((req,res)=>{calls++;res.writeHead(req.url==='/other-redirect'?307:308,{Range:'bytes=0-8388607',...(req.url==='/no-location'?{}:{Location:'/must-not-follow'})});res.end();});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert(address&&typeof address!=='string');
  try {
    for(const path of ['/no-location','/with-location']){
      const response=await providerFetch(`http://127.0.0.1:${address.port}${path}`,{method:'PUT',headers:{Authorization:'Bearer fixture-only','Content-Length':'0','Content-Range':'bytes */10000000'}},'YouTube');
      assert.equal(response.status,308);assert.equal(response.headers.get('range'),'bytes=0-8388607');await response.body?.cancel();
    }
    await assert.rejects(()=>providerFetch(`http://127.0.0.1:${address.port}/other-redirect`,{},'YouTube'),e=>e instanceof AppError&&e.status===307);
    assert.equal(calls,3,'nenhum redirecionamento é seguido');
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('metadados YouTube preservam privacidade e declaração de mídia sintética',()=>{
  const body=youtubeBody(metadataSchema.parse({title:'Título',hashtags:['#dica','bem estar'],youtube:{containsSyntheticMedia:true}}));
  assert.equal(body.status.privacyStatus,'private');assert.equal(body.status.containsSyntheticMedia,true);
  assert.equal(body.snippet.description,'#dica #bemestar');
  assert(!('publishAt' in body.status),'the local scheduler controls when upload starts');
  assert.throws(()=>youtubeBody(metadataSchema.parse({title:'Título',description:'a'.repeat(4900),hashtags:['x'.repeat(100),'y'.repeat(100)]})),/limites/);
});
test('plano de blocos TikTok respeita arredondamento para baixo e último bloco maior',()=>{
  assert.deepEqual(tiktokChunks(1024),{chunkSize:1024,chunks:1});
  const size=50_000_123,{chunkSize,chunks}=tiktokChunks(size);
  assert.equal(chunks,Math.floor(size/chunkSize));
  assert(chunkSize>=5_000_000 && chunkSize<=64_000_000);
  assert(size-(chunks-1)*chunkSize<128_000_000);
  assert.throws(()=>tiktokChunks(0));
});
test('agendamento nativo grava publishAt e mantém o vídeo privado até a publicação',()=>{
  const date=new Date(Date.now()+86400_000);
  const meta=metadataSchema.parse({title:'Agendado',youtube:{visibility:'public'}});
  const body=youtubeBody(meta,date);
  assert.equal(body.status.publishAt,date.toISOString());assert.equal(body.status.privacyStatus,'private');
  assert.throws(()=>youtubeBody(meta,new Date(Date.now()-1000)),/futuro/);
  assert.throws(()=>youtubeBody(metadataSchema.parse({title:'Privado'}),date),/visibilidade public/);
});
test('edição do título preserva descrição, tags e idiomas e não inclui status ou datas',()=>{
  const video={id:'existing-video',snippet:{title:'Antigo',channelId:'owner',description:'Preservar',categoryId:'20',tags:['gta'],defaultLanguage:'pt',defaultAudioLanguage:'pt'},status:{privacyStatus:'private',publishAt:'2030-01-01T00:00:00Z'}};
  const body=youtubeTitleBody(video,'Título descritivo');
  assert.deepEqual(body,{id:video.id,snippet:{title:'Título descritivo',description:'Preservar',categoryId:'20',tags:['gta'],defaultLanguage:'pt',defaultAudioLanguage:'pt'}});
  assert.equal('status' in body,false);assert.equal('channelId' in body.snippet,false);
  assert.equal(youtubeEditAuthorized('https://www.googleapis.com/auth/youtube.upload'),false);
  assert.equal(youtubeEditAuthorized('https://www.googleapis.com/auth/youtube.readonly '+youtubeEditScope),true);
});
test('números de arquivo não substituem títulos descritivos',()=>{
  for(const title of ['GTA 6 — Vídeo 0060','Vídeo 0001','video-42.mp4','0019'])assert.equal(genericVideoTitle(title),true,title);
  for(const title of ['Days Gone: hordas de zumbis','GTA 6 a 30 ou 60 FPS?','Análise do segundo trailer de GTA 6'])assert.equal(genericVideoTitle(title),false,title);
});
test('corrigir declaração de IA preserva privacidade, agendamento, audiência e outras configurações',()=>{
  const now=new Date('2026-11-16T12:00:00Z'),status={privacyStatus:'private',publishAt:'2026-11-17T22:00:00Z',license:'youtube',embeddable:true,publicStatsViewable:false,selfDeclaredMadeForKids:false,containsSyntheticMedia:true};
  const body=youtubeDisclosureBody({id:'existing',status,snippet:{title:'Preservar'}},false,now);
  assert.deepEqual(body,{id:'existing',status:{...status,containsSyntheticMedia:false}});assert.equal('snippet' in body,false);
  assert.deepEqual(youtubeDisclosureBody({id:'public',status:{privacyStatus:'public',selfDeclaredMadeForKids:false}},false,now),{id:'public',status:{privacyStatus:'public',selfDeclaredMadeForKids:false,containsSyntheticMedia:false}});
  assert.throws(()=>youtubeDisclosureBody({id:'old',status:{...status,publishAt:'2026-11-15T22:00:00Z'}},false,now),/data/);
});
after(async()=>{redis.disconnect();await pool.end();});
