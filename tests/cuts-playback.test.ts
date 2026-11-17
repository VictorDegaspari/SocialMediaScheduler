import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewTimeToSource,sourceTimeToPreview } from '../public/cuts-playback.js';

const parts=[{start:10,end:18,outputStart:0},{start:20,end:40,outputStart:8}];
const near=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} should equal ${expected}`);

test('a prévia começa no instante selecionado e atravessa remoções sem mostrar a lacuna',()=>{
  assert.equal(previewTimeToSource(parts,0),10);
  assert.equal(previewTimeToSource(parts,8),20);
  assert.equal(previewTimeToSource(parts,28),40);
  assert.equal(previewTimeToSource(parts,-10),10);
  assert.equal(previewTimeToSource(parts,100),40);
  near(previewTimeToSource(parts,7.999),17.999);
  near(previewTimeToSource(parts,8.001),20.001);
});

test('o relógio original identifica as partes mantidas e os instantes removidos',()=>{
  assert.deepEqual(sourceTimeToPreview(parts,9),{time:0,included:false});
  assert.deepEqual(sourceTimeToPreview(parts,10),{time:0,included:true});
  assert.deepEqual(sourceTimeToPreview(parts,18),{time:8,included:false});
  assert.deepEqual(sourceTimeToPreview(parts,19),{time:8,included:false});
  assert.deepEqual(sourceTimeToPreview(parts,20),{time:8,included:true});
  assert.deepEqual(sourceTimeToPreview(parts,40),{time:28,included:true});
  assert.deepEqual(sourceTimeToPreview(parts,41),{time:28,included:false});
});

test('voltar cinco segundos pela prévia atravessa a junção com a posição correta',()=>{
  const current=sourceTimeToPreview(parts,22);
  assert.deepEqual(current,{time:10,included:true});
  assert.equal(previewTimeToSource(parts,current.time-5),15);
  assert.equal(previewTimeToSource(parts,current.time+5),27);
});

test('zero e milissegundos são preservados sem usar um instante anterior como fallback',()=>{
  const precise=[{start:0,end:1.001,outputStart:0,outputEnd:1.001},{start:9.123,end:10.124,outputStart:1.001,outputEnd:2.002}];
  assert.equal(previewTimeToSource(precise,0),0);
  assert.deepEqual(sourceTimeToPreview(precise,0),{time:0,included:true});
  assert.equal(previewTimeToSource(precise,1.001),9.123);
  near(previewTimeToSource(precise,1.002),9.124);
  near(sourceTimeToPreview(precise,9.124).time,1.002);
  for(const time of [0,.001,1,1.001,1.002,2.002])near(sourceTimeToPreview(precise,previewTimeToSource(precise,time)).time,time);
});

test('planos inválidos e tempos não finitos não são convertidos silenciosamente em zero',()=>{
  for(const invalid of [[],[{start:10,end:9,outputStart:0}],[{start:10,end:18,outputStart:1}],[{start:10,end:18,outputStart:0,outputEnd:7}]]){
    assert.ok(Number.isNaN(previewTimeToSource(invalid,0)));
    const result=sourceTimeToPreview(invalid,10);assert.ok(Number.isNaN(result.time));assert.equal(result.included,false);
  }
  for(const invalid of [NaN,Infinity,-Infinity]){
    assert.ok(Number.isNaN(previewTimeToSource(parts,invalid)));
    const result=sourceTimeToPreview(parts,invalid);assert.ok(Number.isNaN(result.time));assert.equal(result.included,false);
  }
});

test('partes adjacentes e ruído mínimo de ponto flutuante não selecionam a parte anterior',()=>{
  const adjacent=[{start:1,end:1.1,outputStart:0},{start:1.1,end:2.1,outputStart:.1}];
  near(previewTimeToSource(adjacent,.1),1.1);
  near(sourceTimeToPreview(adjacent,1.1).time,.1);
  assert.equal(sourceTimeToPreview(adjacent,1.1).included,true);
  assert.equal(previewTimeToSource(parts,8-1e-12),20);
});
