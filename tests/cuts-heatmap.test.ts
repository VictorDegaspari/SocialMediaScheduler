import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCutHeatmap, normalizeHeatmap, replayFromMetadata, replayInterest, type ReplayData } from '../src/cuts-heatmap.js';
import { selectHighlights, type Cue } from '../src/cuts-media.js';

test('normalização limita o mapa à duração e rejeita pontos não numéricos sem inventar valores',()=>{
  const points=normalizeHeatmap([
    {start_time:30,end_time:60,value:0.8},
    {start_time:0,end_time:20,value:0.2},
    {start_time:10,end_time:40,value:0.7},
    {start_time:60,end_time:150,value:1.7},
    {start_time:-1,end_time:5,value:0.9},
    {start_time:'5',end_time:10,value:0.7},
    {start_time:100,end_time:110,value:1},
    {start_time:10,end_time:15,value:NaN},
    {start_time:20,end_time:20,value:0.8},
    {start_time:20,end_time:21,value:-1}
  ],100);
  assert.deepEqual(points,[{start:0,end:20,value:0.2},{start:20,end:40,value:0.7},{start:40,end:60,value:0.8},{start:60,end:100,value:1}]);
  assert.deepEqual(normalizeHeatmap([{start:0,end:10,value:0}],10),[]);
  assert.deepEqual(normalizeHeatmap([],NaN),[]);
  assert.deepEqual(normalizeHeatmap({},100),[]);
});

test('mapa ausente é indisponível e metadados privados não aparecem no resultado',()=>{
  assert.deepEqual(replayFromMetadata({duration:100,title:'Não copiar',formats:[{url:'https://example.test/signed?secret=hidden'}]}),{
    status:'unavailable',source:'youtube_most_replayed',points:[],
    message:'O YouTube não disponibilizou o mapa público de momentos mais repetidos deste vídeo. As sugestões usam a fala e os limites de frases.'
  });
  const replay=replayFromMetadata({duration:100,heatmap:[{start_time:20,end_time:30,value:0.65}],title:'Não copiar'});
  assert.equal(replay.status,'available');assert.deepEqual(replay.points,[{start:20,end:30,value:0.65}]);
  assert.equal('title' in replay,false);assert.ok(!replay.message.includes('%'));
});

test('interesse é ponderado pelo tempo coberto e não soma duas vezes o mapa saneado',()=>{
  const points=normalizeHeatmap([{start:0,end:10,value:0.2},{start:10,end:20,value:1}],30);
  assert.deepEqual(replayInterest(points,5,15),{mean:0.6,peak:1});
  assert.deepEqual(replayInterest(points,20,30),{mean:0,peak:0});
  assert.deepEqual(replayInterest(points,20,20),{mean:0,peak:0});
});

test('picos públicos mudam a escolha preservando frases, diversidade e palavras originais',()=>{
  const cues:Cue[]=Array.from({length:48},(_,i)=>({start:i*5,end:i*5+4.6,text:`Fala original número ${i}.`}));
  const replay:ReplayData={status:'available',source:'youtube_most_replayed',message:'Interesse relativo.',points:[
    {start:0,end:90,value:0.05},{start:90,end:125,value:0.95},{start:125,end:165,value:0.1},{start:165,end:200,value:0.8},{start:200,end:240,value:0.05}
  ]};
  const result=selectHighlights(cues,240,2,30,replay);
  assert.equal(result.length,2);
  assert.ok(result.some(c=>c.start>=85&&c.start<125),'um corte deve cobrir o pico mais forte');
  assert.ok(result.some(c=>c.start>=160&&c.start<200),'um corte distinto deve cobrir o outro pico');
  assert.ok(result.every(c=>c.reason.includes('mais repetidos')&&c.reason.includes('não é contagem')));
  for(const clip of result) {
    assert.ok(clip.end-clip.start<=180);
    const quote=cues.filter(c=>c.start>=clip.start&&c.end<=clip.end).map(c=>c.text).join(' ');
    assert.ok(quote.startsWith(clip.title.replace(/…$/,'')));
  }
  assert.ok(result[1].start>=result[0].end-0.05);
});

test('mapa de replay cria candidato em monólogo longo sem cortar uma palavra ao meio',()=>{
  const cues:Cue[]=Array.from({length:80},(_,i)=>({start:i*2.5,end:i*2.5+2.4,text:`continuação da fala ${i}`}));
  const replay=replayFromMetadata({duration:200,heatmap:[{start_time:150,end_time:175,value:1}]});
  const [result]=selectHighlights(cues,200,1,30,replay);
  assert.ok(result.start>120&&result.start<175);
  assert.ok(cues.some(c=>Math.abs(c.start-result.start-0.08)<0.001));
});

test('pedidos de like, inscrição e publicidade reduzem a pontuação do trecho',()=>{
  const normal:Cue[]=Array.from({length:24},(_,i)=>({start:i*5,end:i*5+4.6,text:`Conteúdo importante ${i}.`}));
  const promoted=normal.map((c,i)=>i<8?{...c,text:'Deixa o likezão, se inscreve no canal e ativa o sininho.'}:c);
  const [result]=selectHighlights(promoted,120,1,30);
  assert.ok(result.start>=35,'a preferência não deve ser a chamada promocional');
  const [cleanScore]=selectHighlights(normal.slice(0,6),30,1,25);
  const [adScore]=selectHighlights(promoted.slice(0,6),30,1,25);
  assert.ok(adScore.score<cleanScore.score);
});

test('fallback sem mapa continua determinístico e informa a origem da sugestão',()=>{
  const cues=[{start:0,end:10,text:'Uma frase completa.'},{start:11,end:20,text:'Outra frase completa.'}];
  const missing=replayFromMetadata({duration:21});
  assert.deepEqual(selectHighlights(cues,21,1,20,missing),selectHighlights(cues,21,1,20));
  assert.match(selectHighlights(cues,21,1,20)[0].reason,/Sem mapa de replay/);
});

test('nova sugestão ignora o melhor pico já representado antes de aplicar a quantidade',()=>{
  const cues:Cue[]=[{start:3,end:25,text:'Primeiro momento completo.'},{start:70,end:92,text:'Segundo momento completo.'}];
  const replay=replayFromMetadata({duration:100,heatmap:[{start_time:0,end_time:30,value:1},{start_time:65,end_time:95,value:0.8}]});
  const [first]=selectHighlights(cues,100,1,25,replay);
  assert.ok(first.start<30);
  const [next]=selectHighlights(cues,100,1,25,replay,[{start:first.start,end:first.end}]);
  assert.ok(next.start>=65,'deve encontrar o próximo pico em vez de retornar somente o duplicado');
  assert.deepEqual(selectHighlights(cues,100,1,25,replay,[first,next]),[]);
});

test('exclusão usa a proporção do menor intervalo e mantém sugestões suficientemente diferentes',()=>{
  const cue={start:10.08,end:30.08,text:'Trecho completo de fala.'};
  // The candidate is [10,30.16]. A short existing selection fully inside it
  // represents that moment, even though it covers little of the outer span.
  assert.deepEqual(selectHighlights([cue],40,1,25,undefined,[{start:15,end:20}]),[]);
  assert.equal(selectHighlights([cue],40,1,25,undefined,[{start:2,end:12}]).length,1);
  assert.equal(selectHighlights([cue],40,1,25,undefined,[{start:NaN,end:20}]).length,1);
});

test('consulta de heatmap rejeita URLs externas e playlists antes de executar subprocesso',async()=>{
  for(const url of ['https://example.test/watch?v=abcdefghijk','https://youtube.com.evil.test/watch?v=abcdefghijk','http://youtube.com/watch?v=abcdefghijk','https://user:pass@youtube.com/watch?v=abcdefghijk','https://youtube.com/playlist?list=abc','https://youtu.be/abcdefghijk/extra'])
    await assert.rejects(()=>fetchCutHeatmap(url),/link|HTTPS/);
});
