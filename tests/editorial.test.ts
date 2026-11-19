import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateEditorial,fitPublicationText,captionFor,completeMetadata,cutEditorial,youtubeTagLength,boundedTags} from '../src/editorial.js';
import {generateEditorialWithAI,publicationMetadata} from '../src/editorial-ai.js';
import {metadataSchema} from '../src/domain.js';
import {youtubeBody} from '../src/native-api.js';
import {tiktokCaption} from '../src/tiktok-caption.js';

test('geração local é estável, usa o conteúdo real e separa tags e hashtags',()=>{
  const input={sourceTitle:'GTA 6 — passeio_noturno_em_Vice_City.mp4',titlePrefix:'GTA 6 —',transcript:'O passeio noturno mostra as ruas de Vice City. As luzes da cidade aparecem durante o passeio.',hashtags:['#GTA6','gta6'],options:{keywords:['Vice City','GTA 6']}};
  const result=generateEditorial(input);assert.deepEqual(result,generateEditorial(input));
  assert.equal(result.method,'local');assert(!result.youtube.title.endsWith('.mp4'));assert.equal(result.youtube.title.match(/GTA 6/g)?.length,1);
  assert(result.youtube.description.includes('passeio'));assert(result.youtube.tags.includes('Vice City'));assert.equal(result.youtube.hashtags.filter(tag=>tag.toLowerCase()==='gta6').length,1);
  assert(result.youtube.hashtags.every(tag=>!/[#\s]/.test(tag)));assert(result.tiktok.tags.length===0);assert.equal(result.tiktok.caption,captionFor(result.tiktok));
});
test('nomes genéricos não viram descrições inventadas a partir do tema do perfil',()=>{
  const result=generateEditorial({sourceTitle:'Vídeo 0001',options:{topic:'Carros velozes',context:'Uma perseguição histórica e lançamento confirmado.'}});
  assert.equal(result.youtube.title,'Vídeo 0001');assert.equal(result.youtube.description,'');assert(result.warnings.length);
  const withSpeech=generateEditorial({sourceTitle:'Vídeo 0001',transcript:'A cidade fica iluminada durante a noite. Este passeio segue pelas ruas centrais.'});
  assert.notEqual(withSpeech.youtube.title,'Vídeo 0001');assert(withSpeech.youtube.title.includes('cidade')||withSpeech.youtube.title.includes('passeio'));
});
test('resumo extrativo ignora introduções e combina o conteúdo com a descrição do perfil',()=>{
  const draft=generateEditorial({sourceTitle:'Vídeo 0042',transcript:'Olá pessoal, sejam bem-vindos ao canal. A esperança fortalece a fé nos momentos difíceis. A fé inspira esperança para continuar.',description:'Acompanhe as reflexões do canal.',options:{keywords:['esperança','fé']}});
  assert(!draft.youtube.title.startsWith('Olá'));assert(draft.youtube.description.includes('esperança'));assert(draft.youtube.description.endsWith('Acompanhe as reflexões do canal.'));
});
test('limites consideram bytes UTF-8, UTF-16, separadores de tags e pares substitutos',()=>{
  const text={title:'Título 🎬 '.repeat(30),description:'Descrição útil 🎬 '.repeat(600),hashtags:Array.from({length:20},(_,i)=>'tema'+i),tags:Array.from({length:40},(_,i)=>'palavra composta '+i+'x'.repeat(60))};
  const yt=fitPublicationText(text,'youtube'),tt=fitPublicationText(text,'tiktok');
  assert(yt.title.length<=100);assert(Buffer.byteLength([yt.description,yt.hashtags.map(tag=>'#'+tag).join(' ')].join('\n\n'),'utf8')<=5000);
  assert(captionFor(tt).length<=2200);assert(youtubeTagLength(yt.tags)<=500);assert.equal(youtubeTagLength(['uma frase','outra']),17);
  assert(!/[\uD800-\uDBFF]$/.test(yt.title));assert(yt.hashtags.length<=5);
  const meta=metadataSchema.parse({title:yt.title,description:yt.description,hashtags:yt.hashtags,youtube:{tags:yt.tags}});assert.doesNotThrow(()=>youtubeBody(meta));
  assert.throws(()=>youtubeBody(metadataSchema.parse({title:'teste',description:'🎬'.repeat(1600)})),/limites/);
  assert.throws(()=>tiktokCaption(metadataSchema.parse({title:'t',description:'🎬'.repeat(1200)})),/2.200/);
  assert(youtubeTagLength(boundedTags(['x'.repeat(80),'x'.repeat(80),'palavras compostas']))<=500);
  const ascii=fitPublicationText({...text,description:'a'.repeat(6000),hashtags:[]},'youtube');assert(ascii.description.length<=4900);
});
test('preenchimento mantém título revisado, destino, consentimento e declarações',()=>{
  const meta=metadataSchema.parse({title:'Um título revisado',targets:['youtube'],youtube:{visibility:'private',madeForKids:true,containsSyntheticMedia:false},tiktok:{madeWithAI:true,allowComment:false}});
  const result=completeMetadata(meta,{});assert.equal(result.title,meta.title);assert.deepEqual(result.targets,meta.targets);
  const reviewed=completeMetadata(metadataSchema.parse({title:'Esperança em tempos difíceis',hashtags:['canal'],youtube:{tags:['canal']}}));assert(reviewed.youtube.tags.some(tag=>tag.toLowerCase()==='esperança'));assert(reviewed.hashtags.some(tag=>tag.toLowerCase()==='esperança'));
  assert.equal(result.youtube.visibility,'private');assert.equal(result.youtube.madeForKids,true);assert.equal(result.youtube.containsSyntheticMedia,false);assert.deepEqual(result.tiktok,meta.tiktok);
  assert.deepEqual(completeMetadata(meta,{options:{enabled:false,ai:false,topic:'',context:'',keywords:[]}}),meta);
});
test('sugestões de cortes usam apenas fala mantida e preservam nomes e formato',()=>{
  const result=cutEditorial({title:'Um passeio pela cidade',start_seconds:10,end_seconds:30,excluded_ranges:[{start:15,end:20}],captions:[{start:11,end:14,text:'As luzes iluminam a cidade à noite.'},{start:16,end:19,text:'FALA REMOVIDA'},{start:25,end:28,text:'O passeio segue pelas ruas centrais.'}],framing_options:{format:'shorts'}});
  assert(!result.evidence.includes('REMOVIDA'));assert(result.youtube.hashtags.includes('Shorts'));assert(!result.tiktok.hashtags.includes('Shorts'));
});
test('IA é opt-in, tem saída restrita e falha retorna ao gerador local sem expor o provedor',async()=>{
  const original=globalThis.fetch,previous=Object.fromEntries(['TEXT_AI_BASE_URL','TEXT_AI_MODEL','TEXT_AI_API_KEY'].map(name=>[name,process.env[name]]));let calls=0;
  try{
    process.env.TEXT_AI_BASE_URL='http://localhost:9999/v1';process.env.TEXT_AI_MODEL='modelo-teste';process.env.TEXT_AI_API_KEY='secret-test-key';
    globalThis.fetch=async(_url,options)=>{calls++;assert.equal(new Headers(options?.headers).get('authorization'),'Bearer secret-test-key');return Response.json({choices:[{message:{content:JSON.stringify({youtube:{title:'Título melhorado',description:'Resumo fiel.',hashtags:['cidade'],tags:['cidade à noite']},tiktok:{title:'Passeio pela cidade',description:'Resumo curto.',hashtags:['cidade'],tags:[]}})}}]});};
    await generateEditorialWithAI({sourceTitle:'Passeio pela cidade'});assert.equal(calls,0);
    const result=await generateEditorialWithAI({sourceTitle:'Passeio pela cidade'},true);assert.equal(result.method,'ai');assert.equal(calls,1);
    const meta=metadataSchema.parse({title:'Título revisado',youtube:{visibility:'unlisted'},tiktok:{madeWithAI:false}});
    const improved=await publicationMetadata(meta,{options:{enabled:true,ai:true,topic:'',context:'',keywords:[]}},'youtube');assert.equal(improved.title,'Título revisado');assert.equal(improved.youtube.visibility,'unlisted');assert.equal(improved.tiktok.madeWithAI,false);
    globalThis.fetch=async()=>Response.json({choices:[{message:{content:'{"youtube":{"visibility":"public"}}'}}]});
    const invalid=await generateEditorialWithAI({sourceTitle:'Passeio'},true);assert.equal(invalid.method,'local');assert(invalid.warnings.length);
    globalThis.fetch=async()=>{throw new Error('secret-test-key http://private-provider');};
    const fallback=await generateEditorialWithAI({sourceTitle:'Passeio'},true);assert.equal(fallback.method,'local');assert(!JSON.stringify(fallback).includes('secret-test-key'));assert(!JSON.stringify(fallback).includes('private-provider'));
    delete process.env.TEXT_AI_MODEL;assert.equal((await generateEditorialWithAI({sourceTitle:'Passeio'},true)).method,'local');
  }finally{globalThis.fetch=original;for(const [name,value] of Object.entries(previous)){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});
