import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderId, nextRun, metadataSchema, buildPost, watchSchema } from '../src/domain.js';

test('aceita pasta por link, link com parâmetro ou ID e rejeita sites arbitrários',()=>{
  const id='1AbC_def-GHIjkl12345';
  assert.equal(folderId(`https://drive.google.com/drive/u/0/folders/${id}?usp=sharing`),id);
  assert.equal(folderId(`https://drive.google.com/open?id=${id}`),id);
  assert.equal(folderId(id),id);
  assert.throws(()=>folderId(`https://drive.google.com.evil.test/drive/folders/${id}`));
  assert.throws(()=>folderId('file:///tmp/video.mp4'));
});

test('horários diários respeitam São Paulo e avançam depois do instante já vencido',()=>{
  const config={cadence:'daily',interval_minutes:720,times:['20:00','08:00'],timezone:'America/Sao_Paulo'};
  assert.equal(nextRun(config,new Date('2026-11-14T10:59:00Z')).toISOString(),'2026-11-14T11:00:00.000Z');
  assert.equal(nextRun(config,new Date('2026-11-14T11:00:00Z')).toISOString(),'2026-11-14T23:00:00.000Z');
  assert.equal(nextRun(config,new Date('2026-11-14T23:01:00Z')).toISOString(),'2026-11-15T11:00:00.000Z');
});

test('retomada de intervalo programa um único próximo envio a partir de agora',()=>{
  const config={cadence:'interval',interval_minutes:90,times:[],timezone:'America/Sao_Paulo'};
  assert.equal(nextRun(config,new Date('2026-11-14T14:00:00Z')).toISOString(),'2026-11-14T15:30:00.000Z');
});

test('valida frequência, fuso e horários antes de salvar rotina',()=>{
  const valid={name:'Minha pasta',folderUrl:'1234567890abc'};
  assert.equal(watchSchema.parse(valid).mode,'draft');
  assert.equal(watchSchema.parse(valid).sourceType,'google_drive');
  assert.equal(watchSchema.parse({name:'Local',sourceType:'local',localPath:'subpasta'}).sourceType,'local');
  assert.equal(watchSchema.safeParse({name:'Drive sem pasta'}).success,false);
  assert.equal(watchSchema.safeParse({...valid,sourceType:'unsupported'}).success,false);
  assert.equal(watchSchema.parse(valid).stripMetadata,true);
  assert.equal(watchSchema.parse({...valid,stripMetadata:false}).stripMetadata,false);
  assert.equal(watchSchema.safeParse({...valid,intervalMinutes:0}).success,false);
  assert.equal(watchSchema.safeParse({...valid,times:['25:00']}).success,false);
  assert.equal(watchSchema.safeParse({...valid,timezone:'Invalid/Zone'}).success,false);
});

test('transforma metadados em contrato Postiz sem confundir tags e hashtags',()=>{
  const meta=metadataSchema.parse({title:'Teste',description:'Descrição',hashtags:['nutrição'],youtube:{visibility:'private',madeForKids:true,tags:['saúde']}});
  const body=buildPost(meta,{id:'youtube-channel',name:'Meu canal',identifier:'youtube',disabled:false},{id:'media-id',path:'https://example.com/video.mp4'},'schedule',new Date('2026-11-15T11:00:00Z'));
  assert.equal(body.posts[0].value[0].content,'Descrição\n\n#nutrição');
  assert.deepEqual(body.tags,[]);
  assert.equal(body.posts[0].settings.selfDeclaredMadeForKids,'yes');
  assert.deepEqual(body.posts[0].settings.tags,[{value:'saúde',label:'saúde'}]);
  assert.equal(body.date,'2026-11-15T11:00:00.000Z');
});

test('TikTok gera rascunho e impede agendamento direto sem fluxo de revisão',()=>{
  const meta=metadataSchema.parse({title:'Teste',tiktok:{madeWithAI:true}});
  const channel={id:'tik-channel',name:'TikTok',identifier:'tiktok',disabled:false};
  const media={id:'media',path:'https://example.com/video.mp4'};
  assert.equal(buildPost(meta,channel,media,'draft',new Date()).type,'draft');
  assert.equal(buildPost(meta,channel,media,'draft',new Date()).posts[0].settings.video_made_with_ai,true);
  assert.throws(()=>buildPost(meta,channel,media,'schedule',new Date()),/revisão/);
});
