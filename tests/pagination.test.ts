import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY||='00'.repeat(32);
const { AppError }=await import('../src/config.js');
const { parsePagination,cursorFields,keysetClause,pageLimit,paginateRows }=await import('../src/pagination.js');
const time='2026-01-01T10:00:00.123456Z',id='00000000-0000-4000-8000-000000000001';
const encode=(data:unknown)=>Buffer.from(JSON.stringify(data)).toString('base64url');
const payload={v:1,scope:'videos',time,id};
const badRequest=(fn:()=>unknown)=>assert.throws(fn,(error:unknown)=>error instanceof AppError&&error.status===400);

test('limites padrão, personalizados e prefixados mantêm coleções independentes',()=>{
  assert.deepEqual(parsePagination({},{scope:'videos'}),{scope:'videos',limit:20,cursor:null});
  assert.equal(parsePagination({},{scope:'cuts',defaultLimit:10}).limit,10);
  assert.equal(parsePagination({limit:'100'},{scope:'videos'}).limit,100);
  const page=parsePagination({limit:'99',cursor:'invalid',cutsLimit:'3',cutsCursor:encode({...payload,scope:'cuts'})},{scope:'cuts',prefix:'cuts'});
  assert.deepEqual(page,{scope:'cuts',limit:3,cursor:{time,id}});
  assert.equal(parsePagination({cutsLimit:'2'},{scope:'videos'}).limit,20);
  badRequest(()=>parsePagination({cutsLimit:'6'},{scope:'cuts',prefix:'cuts',maxLimit:5}));
});

test('limites inválidos não são truncados, convertidos ou aceitos como arrays',()=>{
  for(const limit of ['0','-1','101','1000','1.5','1e2','Infinity','',' 2','2 ',2,null,[],['2','3'],{}])
    badRequest(()=>parsePagination({limit},{scope:'videos'}));
});

test('cursores são validados por versão, coleção, data e UUID',()=>{
  assert.deepEqual(parsePagination({cursor:encode(payload)},{scope:'videos'}).cursor,{time,id});
  for(const cursor of ['', 'not-json','***',encode(null),encode([]),'a'.repeat(513),['abc'],{},null])
    badRequest(()=>parsePagination({cursor},{scope:'videos'}));
  for(const invalid of [
    {...payload,v:2},{...payload,scope:'events'},{...payload,id:'1'},{...payload,id:1},
    {...payload,time:'2026-01-01T10:00:00.123Z'},{...payload,time:'2026-13-01T10:00:00.123456Z'},
    {...payload,time:'2026-02-31T10:00:00.123456Z'},{...payload,time:'0000-01-01T10:00:00.123456Z'},
    {...payload,time:'2026-01-01T10:00:00.123456+00:00'},{...payload,time:0},
    {scope:'videos',time,id}
  ])badRequest(()=>parsePagination({cursor:encode(invalid)},{scope:'videos'}));
});

test('IDs bigint permanecem strings exatas dentro do intervalo positivo do PostgreSQL',()=>{
  for(const eventId of ['1','9007199254740993','9223372036854775807']){
    const page=parsePagination({cursor:encode({...payload,scope:'events',id:eventId})},{scope:'events',idType:'bigint'});
    assert.equal(page.cursor?.id,eventId);
  }
  for(const eventId of ['0','-1','01','1.0','1e3','9223372036854775808','99999999999999999999',1,id])
    badRequest(()=>parsePagination({cursor:encode({...payload,scope:'events',id:eventId})},{scope:'events',idType:'bigint'}));
});

test('SQL usa parâmetros sem OFFSET e adiciona uma linha de sondagem ao limite',()=>{
  const page=parsePagination({limit:'3',cursor:encode(payload)},{scope:'videos'}),values:unknown[]=['filter'];
  const clause=keysetClause(page,'v.updated_at','v.id',values);
  assert.match(clause,/\(v\.updated_at,v\.id\)<\(\$2::timestamptz,\$3::uuid\)/);
  assert.equal(clause.includes(time),false);assert.equal(clause.includes(id),false);
  assert.deepEqual(values,['filter',time,id]);assert.equal(pageLimit(page,values),' LIMIT $4');assert.deepEqual(values,['filter',time,id,4]);
  assert.equal(keysetClause(parsePagination({},{scope:'videos'}),'created_at','id',values),'');
  const events=parsePagination({cursor:encode({...payload,scope:'events',id:'9007199254740993'})},{scope:'events',idType:'bigint'});
  assert.match(keysetClause(events,'e.created_at','e.id',[],'bigint'),/\$2::bigint/);
});

test('colunas de cursor preservam microssegundos em UTC e recusam SQL arbitrário',()=>{
  const fields=cursorFields('v.updated_at','v.id');
  assert.match(fields,/AT TIME ZONE 'UTC'/);assert.match(fields,/SS\.US/);assert.match(fields,/v\.id::text AS __cursor_id/);
  for(const column of ['id; DROP TABLE videos','v.id DESC','v.id::text','v.id()','v.id.other','']){
    assert.throws(()=>cursorFields(column,'id'));
    assert.throws(()=>keysetClause(parsePagination({},{scope:'videos'}),'created_at',column,[]));
  }
});

test('cursor seguinte usa a última linha exibida e retém precisão sem expor campos auxiliares',()=>{
  const rows=[
    {id:'3',name:'terceiro',__cursor_time:'2026-01-01T10:00:00.123457Z',__cursor_id:'3'},
    {id:'2',name:'segundo',__cursor_time:time,__cursor_id:'2'},
    {id:'1',name:'primeiro',__cursor_time:'2026-01-01T10:00:00.123455Z',__cursor_id:'1'}
  ],original=structuredClone(rows),page=parsePagination({limit:'2'},{scope:'events',idType:'bigint'});
  const result=paginateRows(rows,page);
  assert.deepEqual(result.items,[{id:'3',name:'terceiro'},{id:'2',name:'segundo'}]);
  assert.equal(result.pagination.hasMore,true);assert.equal(result.pagination.limit,2);
  assert.deepEqual(parsePagination({cursor:result.pagination.nextCursor!},{scope:'events',idType:'bigint'}).cursor,{time,id:'2'});
  assert.deepEqual(rows,original);
  assert.deepEqual(paginateRows(rows.slice(0,2),page).pagination,{limit:2,hasMore:false,nextCursor:null});
  assert.deepEqual(paginateRows([],page),{items:[],pagination:{limit:2,hasMore:false,nextCursor:null}});
});
