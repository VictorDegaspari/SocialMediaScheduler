import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright-core';

// Exercise pending writes with local assets/fake APIs; no media or accounts.
const root=resolve('public'),jobId='11111111-1111-4111-8111-111111111111',a='22222222-2222-4222-8222-222222222222',b='33333333-3333-4333-8333-333333333333';
const clips=[a,b].map((id,index)=>({id,job_id:jobId,title:'Corte '+(index?'B':'A'),start_seconds:10,end_seconds:40,status:'failed',framing:'fit',revision:1,hasMedia:false,captions:[{start:10,end:12,text:'Fala de exemplo.'}],excluded_ranges:[]}));
const fixture={cuts:{dependencies:{ready:true,details:[]},channels:[{id:'native:youtube:qa',name:'Canal QA',disabled:false}],jobs:[{id:jobId,title:'Projeto QA',url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ',duration:180,status:'review',clips}]},scheduler:{paused:false,queue:{}},stats:{watches:0,pending:0,sent:0,attention:0},watches:[],videos:[],events:[],publishing:{actions:[]}};
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname,file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+'/'))throw new Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(10_000);
const actions=[],errors=[];let release=null,nextStatus=200;
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/state')return route.fulfill({json:fixture});
  if(path.endsWith('/transcript'))return route.fulfill({json:{captions:clips[0].captions,duration:180}});
  if(path.endsWith('/source')||path.endsWith('/media'))return route.fulfill({status:404,body:''});
  assert.equal(req.headers()['x-watcher-request'],'1');
  assert(req.method()==='PUT'&&[a,b].some(id=>path==='/api/cuts/'+id)||req.method()==='POST'&&path==='/api/cuts/'+a+'/publish');
  const action={path,method:req.method(),body:req.postDataJSON()};actions.push(action);
  const status=nextStatus;nextStatus=200;await new Promise(resolve=>{release=resolve;});release=null;
  return route.fulfill({status,json:status===200?{ok:true}:{error:'Falha QA; tente novamente.'}});
});
const modal=page.locator('#cuts-dialog'),form=page.locator('#cuts-dialog-form');
const edit=id=>page.locator(`[data-cut-clip="${id}"] [data-cuts-action="edit"]`).click();
async function duplicate(){await form.evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));}
async function complete(path){const response=page.waitForResponse(response=>new URL(response.url()).pathname===path&&['PUT','POST'].includes(response.request().method()));assert(release,'request is pending');release();await response;}
async function pending(count){await page.waitForFunction(count=>document.querySelector('#cuts-dialog-form [type=submit]')?.dataset.busy==='1',count);assert.equal(actions.length,count);}
try{
  await page.goto(base+'/#cuts');await page.getByRole('heading',{name:'Gerador de cortes',exact:true}).waitFor();
  await edit(a);await page.getByLabel('Título do corte',{exact:true}).fill('Alteração A');
  await form.locator('[type=submit]').click();await pending(1);await duplicate();assert.equal(actions.length,1,'duplicate submit is ignored while edit is pending');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#cuts-dialog').open);
  await edit(b);await page.getByLabel('Título do corte',{exact:true}).fill('Rascunho B preservado');
  await complete('/api/cuts/'+a);await page.waitForTimeout(80);
  assert.equal(await modal.evaluate(dialog=>dialog.open),true,'a completed write must not close another editor');
  assert.equal(await page.getByLabel('Título do corte',{exact:true}).inputValue(),'Rascunho B preservado');
  await form.locator('[type=submit]').click();await pending(2);await duplicate();assert.equal(actions.length,2);
  await complete('/api/cuts/'+b);await page.waitForFunction(()=>!document.querySelector('#cuts-dialog').open);
  assert.equal(actions[1].body.title,'Rascunho B preservado');

  // The same protection applies after an explicitly authorized fake publish.
  clips[0].status='review';clips[0].hasMedia=true;
  await page.getByRole('button',{name:'Atualizar',exact:true}).click();
  await page.locator(`[data-cut-clip="${a}"] [data-cuts-action="publish"]`).click();
  await page.getByLabel('Canal do YouTube',{exact:true}).selectOption('native:youtube:qa');
  await form.locator('[name=confirm]').check();await form.locator('[type=submit]').click();await pending(3);await duplicate();assert.equal(actions.length,3,'duplicate publication is ignored');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#cuts-dialog').open);
  await edit(b);await page.getByLabel('Título do corte',{exact:true}).fill('Outro rascunho B');
  await complete('/api/cuts/'+a+'/publish');await page.waitForTimeout(80);
  assert.equal(await modal.evaluate(dialog=>dialog.open),true);
  assert.equal(await page.getByLabel('Título do corte',{exact:true}).inputValue(),'Outro rascunho B');
  assert.equal(actions[2].body.confirm,true);assert.equal(actions[2].body.revision,1);

  nextStatus=503;await form.locator('[type=submit]').click();await pending(4);await complete('/api/cuts/'+b);
  await page.waitForFunction(()=>!document.querySelector('#cuts-dialog-form [type=submit]').disabled);
  assert.equal(await modal.evaluate(dialog=>dialog.open),true,'a failed save preserves the current editor');
  assert.equal(await page.getByLabel('Título do corte',{exact:true}).inputValue(),'Outro rascunho B');
  assert.equal(await form.locator('#cuts-dialog-feedback').textContent(),'Falha QA; tente novamente.');
  assert.equal(await form.locator('#cuts-dialog-feedback').getAttribute('role'),'alert');
  await form.locator('[type=submit]').click();await pending(5);assert.equal(await form.locator('#cuts-dialog-feedback').isHidden(),true,'a retry clears obsolete feedback');
  await complete('/api/cuts/'+b);await page.waitForFunction(()=>!document.querySelector('#cuts-dialog').open);
  assert.deepEqual(errors,[]);
  console.log('Sessões de cortes: respostas atrasadas preservam outro editor; duplicatas de salvar/postar são ignoradas; falha mantém rascunho e permite nova tentativa. APIs simuladas.');
}finally{if(release)release();await browser.close();await new Promise(resolve=>server.close(resolve));}
