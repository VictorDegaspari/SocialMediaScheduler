import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayTimeAt,selectionFromReplay } from '../public/cuts-replay.js';

test('o ponto do gráfico vira um instante exato, sem centralizar janela ou alinhar a um bucket',()=>{
  const rect={left:100,width:800};
  assert.equal(replayTimeAt(700,rect,180),135);
  assert.equal(replayTimeAt(703.2,rect,180),135.72);
  assert.equal(replayTimeAt(300,rect,180),45);
  assert.equal(replayTimeAt(50,rect,180),0);
  assert.equal(replayTimeAt(1000,rect,180),180);
  assert.ok(Number.isNaN(replayTimeAt(100,{left:100,width:0},180)));
  assert.ok(Number.isNaN(replayTimeAt(NaN,rect,180)));
});

test('clicar depois do fim estende a seleção sem mover o início escolhido para trás',()=>{
  assert.deepEqual(selectionFromReplay(10,40,135,180),{start:135,end:165,excludedRanges:[]});
  assert.deepEqual(selectionFromReplay(10,40,135.72,180),{start:135.72,end:165.72,excludedRanges:[]});
  assert.deepEqual(selectionFromReplay(10,40,179.8,180),{start:179.5,end:180,excludedRanges:[]});
  assert.deepEqual(selectionFromReplay(10,40,180,180),{start:179.5,end:180,excludedRanges:[]});
});

test('clicar antes do fim conserva o fim e permite marcar o primeiro instante',()=>{
  assert.deepEqual(selectionFromReplay(135,165,45,180),{start:45,end:165,excludedRanges:[]});
  assert.deepEqual(selectionFromReplay(10,40,0,180),{start:0,end:40,excludedRanges:[]});
});

test('seleção remove uma exclusão que esconderia o início e conserva as demais remoções',()=>{
  assert.deepEqual(selectionFromReplay(10,40,20,180,[{start:12,end:15},{start:18,end:22},{start:25,end:27}]),{
    start:20,end:40,excludedRanges:[{start:25,end:27}]
  });
  assert.deepEqual(selectionFromReplay(100,400,120,600,[{start:200,end:350}]),{
    start:120,end:400,excludedRanges:[{start:200,end:350}]
  },'a long source window stays intact when its retained parts already fit in a Short');
});
