import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTimecode,parseTimecode } from '../public/cuts-time.js';

test('tempo aparece em minutos e segundos com precisão de milissegundos quando necessária',()=>{
  assert.equal(formatTimecode(0),'00:00');
  assert.equal(formatTimecode(60),'01:00');
  assert.equal(formatTimecode(551.72),'09:11,720');
  assert.equal(formatTimecode(7200),'120:00');
  assert.equal(formatTimecode(10.001),'00:10,001');
  assert.equal(formatTimecode(1.5,{precision:2,decimal:'.'}),'00:01.50');
  assert.equal(formatTimecode(551.72,{precision:0}),'09:12');
  assert.equal(formatTimecode(NaN),'');
  assert.equal(formatTimecode(-1),'');
});

test('arredondamento avança o minuto antes de separar os componentes',()=>{
  assert.equal(formatTimecode(59.9995),'01:00');
  assert.equal(formatTimecode(119.9995),'02:00');
  assert.equal(formatTimecode(59.999,{precision:2}),'01:00');
  assert.equal(formatTimecode(59.5,{precision:0}),'01:00');
  assert.equal(formatTimecode(59.999),'00:59,999');
});

test('edição aceita relógio com vírgula ou ponto e mantém compatibilidade com segundos colados',()=>{
  for(const [text,expected] of [
    ['09:11',551],['9:11,720',551.72],['09:11.720',551.72],
    ['1:02:03,004',3723.004],['120:00',7200],['551.72',551.72],
    ['551,72',551.72],['0',0],['00:00',0],[' 00:10,001 ',10.001]
  ] as const)assert.equal(parseTimecode(text),expected,text);
});

test('campos vazios, parciais, segundos impossíveis e formatos ambíguos não viram zero',()=>{
  for(const text of ['', ' ', '9:', ':11','09:1','1:2:03','1:99','00:60','1:60:00',
    '-1','+1','-00:01','1e2','Infinity','NaN','abc','01:02 lixo','1.2345','01:02,1234',
    '1,2.3','09 :11','09:11,','.5','9007199254740991000'])
    assert.ok(Number.isNaN(parseTimecode(text)),JSON.stringify(text));
  assert.ok(Number.isNaN(parseTimecode(null as unknown as string)));
});

test('relógio pode ser editado e convertido sem perder os tempos enviados ao renderizador',()=>{
  for(const value of [0,0.001,1.009,59.999,60,551.72,3723.004,7200])
    assert.equal(parseTimecode(formatTimecode(value)),value,String(value));
});
