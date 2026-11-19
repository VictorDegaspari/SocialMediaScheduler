import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import express from 'express';
import {editorialRoutes} from '../src/editorial-routes.js';

test('prévia HTTP gera ambas as plataformas e recusa dados de publicação e prompts sem limites',async()=>{
  const app=express();app.use(express.json({limit:'128kb'}));app.use(editorialRoutes);
  app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(400).json({error:'Dados inválidos.'}));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}/api/assistant/metadata/preview`;
  const post=(body:unknown)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
    const response=await post({sourceTitle:'Passeio pelas ruas de Vice City',transcript:'As luzes da cidade aparecem durante o passeio noturno.',useAI:false});assert.equal(response.status,200);
    const draft=await response.json();assert.equal(draft.method,'local');assert(draft.youtube.tags.length);assert(draft.tiktok.caption.length<=2200);assert(!JSON.stringify(draft).includes('approvedAt'));
    assert.equal((await post({sourceTitle:'Teste',visibility:'public',confirm:true})).status,400);
    assert.equal((await post({transcript:'x'.repeat(12001)})).status,400);
    assert.equal((await post({options:{ai:true,apiKey:'must-not-be-accepted'}})).status,400);
  }finally{server.close();await once(server,'close');}
});
