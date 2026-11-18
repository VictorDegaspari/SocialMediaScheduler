import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.ENCRYPTION_KEY||='00'.repeat(32);
const { captionStyleSchema, framingOptionsSchema, cutTimeline, timelineCaptions, outputTime }=await import('../src/cuts-edit.js');

test('remover um trecho junta a linha do tempo e recalcula a duração sem lacunas',()=>{
  const parts=cutTimeline(100,400,[{start:200,end:350}]);
  assert.deepEqual(parts,[{start:100,end:200,outputStart:0,outputEnd:100},{start:350,end:400,outputStart:100,outputEnd:150}]);
  assert.equal(outputTime(parts,375),125);assert.equal(outputTime(parts,250),null);
  assert.throws(()=>cutTimeline(0,200));
  assert.throws(()=>cutTimeline(10,20,[{start:10,end:20}]));
  assert.throws(()=>cutTimeline(10,20,[{start:11,end:15},{start:14,end:18}]));
  assert.throws(()=>cutTimeline(10,20,[{start:5,end:15}]));
});
test('legendas usam somente palavras mantidas e acompanham o salto de áudio',()=>{
  const cues=[{start:10,end:14,text:'um dois três quatro',words:[{start:10,end:11,text:'um'},{start:11,end:12,text:'dois'},{start:12,end:13,text:'três'},{start:13,end:14,text:'quatro'}]}];
  const output=timelineCaptions(cues,cutTimeline(10,14,[{start:11,end:13}]));
  assert.deepEqual(output.map(c=>({start:c.start,end:c.end,text:c.text})),[{start:0,end:1,text:'um'},{start:1,end:2,text:'quatro'}]);
  assert.equal(output[1].words?.[0].start,1);
});
test('legenda corrigida sem alinhamento não recebe palavras ou tempos inventados',()=>{
  const cues=[{start:10,end:14,text:'Texto corrigido pelo usuário.'}];
  assert.throws(()=>timelineCaptions(cues,cutTimeline(10,14,[{start:11,end:13}])),/alinhamento de palavras/);
  assert.equal(timelineCaptions(cues,cutTimeline(10,14))[0].text,cues[0].text);
});
test('estilos e enquadramento aceitam opções suportadas e recusam filtros ou cores arbitrários',()=>{
  assert.equal(captionStyleSchema.parse({}).enabled,true);
  assert.equal(captionStyleSchema.parse({enabled:false}).enabled,false);
  assert.throws(()=>captionStyleSchema.parse({enabled:'false'}));
  assert.equal(captionStyleSchema.parse({}).fontSize,42);
  assert.equal(captionStyleSchema.parse({color:'#aBcD01',animation:'karaoke',fontSize:64}).animation,'karaoke');
  assert.throws(()=>captionStyleSchema.parse({color:'white;movie=/etc/passwd'}));
  assert.throws(()=>captionStyleSchema.parse({fontSize:500}));
  assert.equal(framingOptionsSchema.parse({}).format,'shorts');
  assert.equal(framingOptionsSchema.parse({format:'video'}).format,'video');
  assert.throws(()=>framingOptionsSchema.parse({format:'invalid'}));
  assert.equal(framingOptionsSchema.parse({mode:'crop',zoom:0.25}).zoom,0.25);
  assert.throws(()=>framingOptionsSchema.parse({mode:'crop',zoom:0}));
  assert.throws(()=>framingOptionsSchema.parse({mode:'crop',zoom:4}));
  assert.throws(()=>framingOptionsSchema.parse({mode:'crop',focusX:-1}));
  assert.equal(framingOptionsSchema.parse({mode:'blur'}).mode,'blur');
});
