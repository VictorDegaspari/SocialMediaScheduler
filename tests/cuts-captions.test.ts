import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectCaptionRows,previewEndpointToSource,mergeCaptionRows} from '../public/cuts-captions.js';

const parts=[{start:100,end:108,outputStart:0},{start:110,end:120,outputStart:8}];
const cue={start:106,end:114,text:'antes fora depois agora',words:[
  {start:106,end:107,text:'antes'},{start:108.2,end:109,text:'fora'},
  {start:111,end:112,text:'depois'},{start:113,end:114,text:'agora'}
]};
const editsFor=(rows:any[])=>rows.map(({id,start,end,text})=>({id,start,end,text}));

test('legendas usam o relógio da montagem e palavras removidas não aparecem nas linhas',()=>{
  const result=projectCaptionRows([cue],parts);
  assert.deepEqual(result.conflicts,[]);assert.equal(result.rows.length,2);
  assert.deepEqual(result.rows.map(row=>[row.id,row.start,row.end,row.text]),[['0:0',6,7,'antes'],['0:1',9,12,'depois agora']]);
  assert.deepEqual(result.rows[1].words,[{start:9,end:10,text:'depois'},{start:11,end:12,text:'agora'}]);
  assert.deepEqual(result.rows[1].source.words,cue.words.slice(2));
  assert.deepEqual(cue.words[0],{start:106,end:107,text:'antes'});
});

test('a mesma junção converte início para o trecho seguinte e fim para o anterior',()=>{
  assert.equal(previewEndpointToSource(parts,8,'start'),110);
  assert.equal(previewEndpointToSource(parts,8,'end'),108);
  assert.equal(previewEndpointToSource(parts,0,'start'),100);
  assert.equal(previewEndpointToSource(parts,18,'end'),120);
  assert.equal(previewEndpointToSource(parts,9.123,'start'),111.123);
  for(const value of [-1,18.001,NaN,Infinity])assert.throws(()=>previewEndpointToSource(parts,value),/duração/);
});

test('salvar linhas inalteradas retém a cue absoluta inteira e as palavras ocultas',()=>{
  const {rows}=projectCaptionRows([cue],parts),snapshot=structuredClone(cue);
  const merged=mergeCaptionRows([cue],rows,editsFor(rows),parts);
  assert.deepEqual(merged,[snapshot]);assert.notEqual(merged[0],cue);assert.deepEqual(cue,snapshot);
  assert.equal(projectCaptionRows(merged,[{start:100,end:120,outputStart:0}]).rows[0].text,cue.text);
});

test('editar um fragmento preserva os prefixos e sufixos ocultos para restaurar a remoção',()=>{
  const {rows}=projectCaptionRows([cue],parts),edits=editsFor(rows);
  edits[1].text='depois corrigido';
  const merged=mergeCaptionRows([cue],rows,edits,parts);
  assert.deepEqual(merged,[
    {start:106,end:109,text:'antes fora',words:cue.words.slice(0,2)},
    {start:111,end:114,text:'depois corrigido'}
  ]);
  const restored=projectCaptionRows(merged,[{start:100,end:120,outputStart:0}]);
  assert.deepEqual(restored.rows.map(row=>row.text),['antes fora','depois corrigido']);
  assert.equal('words' in merged[1],false,'alteração de texto não inventa alinhamento');
  const padded={...cue,start:105.5,end:114.5},projection=projectCaptionRows([padded],parts),paddedEdits=editsFor(projection.rows);
  paddedEdits[1].text='outra correção';
  assert.equal(mergeCaptionRows([padded],projection.rows,paddedEdits,parts)[0].start,cue.words[0].start,'fragmento parcial preserva bounds reais reconhecíveis pelo backend');
});

test('remover apenas uma linha projetada mantém fala escondida no gap e outro fragmento',()=>{
  const {rows}=projectCaptionRows([cue],parts);
  const merged=mergeCaptionRows([cue],rows,editsFor(rows.slice(1)),parts);
  assert.deepEqual(merged,[{start:108.2,end:114,text:'fora depois agora',words:cue.words.slice(1)}]);
  assert.equal(projectCaptionRows(merged,parts).rows[0].text,'depois agora');
});

test('arredondamento de exibição não altera tempos ou words na gravação',()=>{
  const precise={start:100.123456,end:101.987654,text:'preciso',words:[{start:100.123456,end:101.987654,text:'preciso'}]},plan=[{start:100,end:105,outputStart:0}];
  const {rows}=projectCaptionRows([precise],plan),edits=editsFor(rows);
  edits[0].start=.123;edits[0].end=1.988;
  assert.deepEqual(mergeCaptionRows([precise],rows,edits,plan),[precise]);
  edits[0].text='Texto corrigido';
  assert.deepEqual(mergeCaptionRows([precise],rows,edits,plan),[{start:precise.start,end:precise.end,text:'Texto corrigido'}]);
  const fractionalPlan=[{start:100,end:101.987654,outputStart:0}],projection=projectCaptionRows([precise],fractionalPlan);
  assert.deepEqual(mergeCaptionRows([precise],projection.rows,[{...editsFor(projection.rows)[0],start:.123,end:1.988,text:'Fim arredondado'}],fractionalPlan),[{start:precise.start,end:precise.end,text:'Fim arredondado'}]);
});

test('cue sem words atravessada permanece acessível como conflito sem apagar o rascunho',()=>{
  const corrected={start:106,end:114,text:'Minha correção literal.'},result=projectCaptionRows([corrected],parts);
  assert.equal(result.conflicts.length,1);assert.equal(result.rows.length,1);assert.equal(result.rows[0].conflict,true);
  assert.deepEqual([result.rows[0].start,result.rows[0].end],[6,12]);
  assert.deepEqual(mergeCaptionRows([corrected],result.rows,editsFor(result.rows),parts),[corrected]);
  assert.deepEqual(mergeCaptionRows([corrected],result.rows,[],parts),[]);
  const edit={id:result.rows[0].id,start:9,end:12,text:'Minha correção literal.'};
  assert.deepEqual(mergeCaptionRows([corrected],result.rows,[edit],parts),[{start:111,end:114,text:corrected.text}]);
});

test('linhas novas e modificadas não atravessam uma junção nem ultrapassam a duração',()=>{
  assert.deepEqual(mergeCaptionRows([],[],[{id:'new',start:0,end:8,text:'primeira parte'}],parts),[{start:100,end:108,text:'primeira parte'}]);
  assert.deepEqual(mergeCaptionRows([],[],[{id:'new',start:8,end:10,text:'segunda parte'}],parts),[{start:110,end:112,text:'segunda parte'}]);
  for(const edit of [{id:'new',start:7,end:9,text:'atravessa'},{id:'new',start:17,end:19,text:'fora'},{id:'new',start:1,end:1,text:'vazio'},{id:'new',start:NaN,end:2,text:'inválido'},{id:'new',start:1,end:2,text:''}])
    assert.throws(()=>mergeCaptionRows([],[],[edit],parts));
});

test('estado inválido, referências duplicadas e sobreposição falham explicitamente',()=>{
  for(const plan of [[],[{start:0,end:2,outputStart:1}],[{start:0,end:2,outputStart:0},{start:1,end:3,outputStart:2}],[{start:0,end:2,outputStart:0,outputEnd:9}]])
    assert.throws(()=>projectCaptionRows([cue],plan));
  const {rows}=projectCaptionRows([cue],parts),edits=editsFor(rows);
  assert.throws(()=>mergeCaptionRows([cue],rows,[...edits,edits[0]],parts),/única/);
  assert.throws(()=>mergeCaptionRows([cue],[...rows,rows[0]],edits,parts),/desatualizada/);
  assert.throws(()=>mergeCaptionRows([],[],[{id:'a',start:1,end:3,text:'uma'},{id:'b',start:2,end:4,text:'outra'}],parts),/sobrepor/);
});
