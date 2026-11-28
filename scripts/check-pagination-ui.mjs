import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright-core';

// Serve local source and an entirely fake API. No database, account, or uploads.
const publicRoot=resolve('public'),scopes=['watches','events','videos','requests','actions','browser'];
const defaults={watches:20,events:20,videos:20,cuts:10,requests:20,actions:20,browser:20};
const stamp='2026-11-17T12:00:00Z',profileId='10000000-0000-4000-8000-000000000001';
const uuid=number=>'00000000-0000-4000-8000-'+String(number).padStart(12,'0');
const label=(scope,number)=>`QA ${scope} item ${String(number).padStart(3,'0')}`;
const rows={};
for(const scope of scopes)rows[scope]=Array.from({length:45},(_,index)=>{
  const number=index+1,common={id:uuid(number),created_at:stamp};
  if(scope==='watches')return {...common,name:label(scope,number),enabled:true,source_type:'local',folder_url:'/videos/'+number,folder_id:'local-'+number,cadence:'daily',times:['08:00'],integration_ids:[],pending_count:0,recursive:true,mode:'draft'};
  if(scope==='events')return {...common,message:label(scope,number),level:'info',watch_name:'Pasta QA'};
  if(scope==='videos')return {...common,name:label(scope,number),watch_name:'Pasta QA',status:'ready',deliveries:[]};
  if(scope==='requests')return {...common,profile_name:label(scope,number),provider:'youtube',status:'active',quantity:10,confirmed:2,reserved:3,waiting:5,message:'Aguardando vaga.',config:{cadence:{times:['08:00'],timezone:'America/Sao_Paulo'}}};
  if(scope==='actions')return {...common,request_id:uuid(number),profile_name:label(scope,number),provider:'youtube',kind:'setup',message:'Conecte a conta de teste.',href:'/#requests'};
  return {...common,kind:'login',origin:'manual',status:'done',phase:'finished',message:label(scope,number),filename:null};
});
const fixture={
  scheduler:{paused:false,queue:{}},stats:{watches:45,active_watches:34,local_source_ready:true,pending:80,sent:222,attention:7},
  connections:{playwrightMcp:{configured:true,source:'input'},local:{rootPath:'/videos'},google:{configured:false,connected:false},postiz:{configured:false},native:{engine:'local',youtube:{configured:true,connected:true},tiktok:{}}},
  publishing:{profiles:[{id:profileId,name:'Perfil QA',watch_id:null,source_roots:[],pack_defaults:{}}],accounts:[],browserProfiles:[],googleConnected:false,summary:{actionCount:45}},
  browser:{configured:true,rootPath:'/videos',config:{sourceType:'local',folder:'/videos',enabled:false,cadence:'daily',intervalMinutes:720,times:['08:00','20:00'],timezone:'America/Sao_Paulo',stripMetadata:true,mode:'review',packDefaults:{},nextAt:null,revision:0},agent:{online:true,desktop:true,externalBusy:false,profileSaved:true,lastSeen:stamp},active:{id:'global-active',kind:'upload',status:'running',message:'Tarefa global permanece ativa.'},calendar:{reserved:0,uploads:0,next:null}},
  cuts:{jobs:[],pagination:{limit:10,hasMore:false,nextCursor:null},dependencies:{ready:true,details:[]},channels:[]}
};
const calls=[],mutations=[],errors=[];
const emptyOlderPages=new Set();let failBrowserNext=false;
function collection(scope,url){
  const limit=Number(url.searchParams.get(scope+'Limit'))||defaults[scope],cursor=url.searchParams.get(scope+'Cursor');
  const offset=cursor?Number(cursor.match(new RegExp('^qa-'+scope+'-(\\d+)$'))?.[1]):0;
  assert(Number.isInteger(offset)&&offset>=0,'cursor identifies its own collection: '+scope);
  const items=emptyOlderPages.has(scope)&&offset>0?[]:rows[scope].slice(offset,offset+limit),hasMore=items.length>0&&offset+items.length<rows[scope].length;
  return {items,pagination:{limit,hasMore,nextCursor:hasMore?'qa-'+scope+'-'+(offset+items.length):null}};
}
function statePage(url){
  const pages=Object.fromEntries(scopes.map(scope=>[scope,collection(scope,url)]));
  return {...fixture,watches:pages.watches.items,events:pages.events.items,videos:pages.videos.items,
    pagination:{watches:pages.watches.pagination,events:pages.events.pagination,videos:pages.videos.pagination},
    publishing:{...fixture.publishing,requests:pages.requests.items,actions:pages.actions.items,pagination:{requests:pages.requests.pagination,actions:pages.actions.pagination}},
    browser:{...fixture.browser,jobs:pages.browser.items,pagination:pages.browser.pagination}};
}
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/state'){
      assert.equal(req.method,'GET');calls.push(url);
      res.setHeader('Content-Type','application/json');
      if(failBrowserNext&&url.searchParams.get('browserCursor')==='qa-browser-40'){
        failBrowserNext=false;res.statusCode=503;res.end(JSON.stringify({error:'Falha simulada de conexão.'}));return;
      }
      res.end(JSON.stringify(statePage(url)));return;
    }
    if(url.pathname.startsWith('/api/')){
      assert.equal(req.method,'POST');assert.equal(req.headers['x-watcher-request'],'1');
      assert(['/api/assistant/requests','/api/browser/login','/api/browser/run','/api/browser/config'].includes(url.pathname),'unexpected API mutation '+url.pathname);
      let raw='';for await(const chunk of req)raw+=chunk;
      mutations.push({path:url.pathname,body:JSON.parse(raw)});
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,requests:[]}));return;
    }
    const filename=resolve(publicRoot,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    assert(filename.startsWith(publicRoot+'/'));
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(filename)]||'application/octet-stream');
    res.end(await readFile(filename));
  }catch(error){errors.push(error.message);res.statusCode=500;res.end(JSON.stringify({error:error.message}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(10_000);
page.on('pageerror',error=>errors.push(error.message));
// Capture the real polling callback and run it on demand to avoid timer races.
await page.addInitScript(()=>{
  const interval=window.setInterval.bind(window);
  window.setInterval=(callback,delay,...args)=>{
    if(delay===5000){window.__qaPoll=callback;return 0;}
    return interval(callback,delay,...args);
  };
});
const selectors={watches:'.watch-card',events:'.activity-item',videos:'.table-wrap tbody tr',requests:'article.notice:has([data-request-action="cancel"])',actions:'div.notice:has([data-request-action="resume"])',browser:'.browser-history tbody tr'};
const routes={watches:'watches',events:'history',videos:'history',requests:'requests',actions:'requests',browser:'browser'};
const cursors=new Map();
const pager=scope=>page.locator(`nav[aria-label="Paginação: ${scope}"]`);
async function totals(){
  assert.equal(await page.locator('#nav-count').textContent(),'45','folder badge uses the total, not the page length');
  assert.equal(await page.locator('#manual-count').textContent(),'45','manual badge uses all unresolved actions');
}
function checkQuery(url){
  for(const [scope,limit] of Object.entries(defaults)){
    assert.equal(url.searchParams.get(scope+'Limit'),String(limit),scope+' sends its own bounded limit');
    assert.equal(url.searchParams.get(scope+'Cursor'),cursors.get(scope)||null,scope+' keeps its own cursor');
  }
}
async function navigate(scope){
  await page.locator(`.sidebar [data-page="${routes[scope]}"]`).click();await pager(scope).waitFor();
}
async function assertRows(scope,offset,count){
  const content=await page.locator('#main '+selectors[scope]).allTextContents();
  assert.equal(content.length,count,scope+' displays the whole API page');
  content.forEach((text,index)=>assert(text.includes(label(scope,offset+index+1)),scope+' displays each expected item'));
  await totals();return content;
}
async function turn(scope,direction,index){
  if(index===0)cursors.delete(scope);else cursors.set(scope,'qa-'+scope+'-'+index*20);
  const [response]=await Promise.all([
    page.waitForResponse(response=>new URL(response.url()).pathname==='/api/state'&&new URL(response.url()).searchParams.get(scope+'Cursor')===(cursors.get(scope)||null)),
    pager(scope).locator(`[data-pagination-direction="${direction}"]`).click()
  ]);
  assert.equal(response.status(),200);checkQuery(new URL(response.url()));
  await page.waitForFunction(({scope,index})=>document.querySelector(`nav[aria-label="Paginação: ${scope}"] .pagination-label`)?.textContent==='Página '+(index+1),{scope,index});
}
async function poll(){
  const [response]=await Promise.all([
    page.waitForResponse(response=>new URL(response.url()).pathname==='/api/state'),
    page.evaluate(()=>{document.activeElement?.blur();window.__qaPoll();})
  ]);
  assert.equal(response.status(),200);return new URL(response.url());
}
try{
  await page.goto(base+'/#overview');await page.locator('.stat-number').first().waitFor();
  assert.deepEqual(await page.locator('.stat-number').allTextContents(),['45','80','222','07']);
  const barHeights=await page.locator('.dashboard-column-track > span').evaluateAll(bars=>bars.map(bar=>bar.getBoundingClientRect().height));
  assert(barHeights[1]>barHeights[0]&&barHeights[0]>barHeights[2]&&barHeights[2]>0,'bars use the global status counts');
  assert.equal(await page.locator('.dashboard-ring-center strong').textContent(),'76%');
  checkQuery(calls[0]);await totals();
  for(const scope of scopes){
    await navigate(scope);const first=await assertRows(scope,0,20);
    assert.equal(await pager(scope).locator('[data-pagination-direction="prev"]').isDisabled(),true);
    await turn(scope,'next',1);const second=await assertRows(scope,20,20);
    await turn(scope,'next',2);const last=await assertRows(scope,40,5);
    assert.equal(await pager(scope).locator('[data-pagination-direction="next"]').isDisabled(),true);
    assert.equal(new Set([...first,...second,...last]).size,45,scope+' makes all history items reachable');
    await turn(scope,'prev',1);await assertRows(scope,20,20);
    await turn(scope,'prev',0);await assertRows(scope,0,20);
    await turn(scope,'next',1);await assertRows(scope,20,20);
  }
  assert.equal(await page.getByText('Tarefa global permanece ativa.',{exact:true}).count(),1,'active controls remain visible outside the history page');
  checkQuery(await poll());await assertRows('browser',20,20);
  assert.equal(await pager('browser').locator('.pagination-label').textContent(),'Página 2','polling preserves the selected page');
  await page.locator('.sidebar [data-page="overview"]').click();await page.locator('.stat-number').first().waitFor();
  assert.deepEqual(await page.locator('.stat-number').allTextContents(),['45','80','222','07'],'overview totals remain global after browsing older pages');
  assert.equal(await page.locator('.dashboard-ring-center strong').textContent(),'76%','the active ratio also remains global');

  await navigate('browser');failBrowserNext=true;
  const [failure]=await Promise.all([
    page.waitForResponse(response=>new URL(response.url()).pathname==='/api/state'&&response.status()===503),
    pager('browser').locator('[data-pagination-direction="next"]').click()
  ]);
  assert.equal(new URL(failure.url()).searchParams.get('browserCursor'),'qa-browser-40');
  await page.getByText('Não foi possível carregar esta página. Tente novamente.',{exact:true}).waitFor();
  assert.equal(await pager('browser').locator('.pagination-label').textContent(),'Página 2');
  checkQuery(await poll());await assertRows('browser',20,20);
  await turn('browser','next',2);await assertRows('browser',40,5);
  await turn('browser','prev',1);

  for(const scope of scopes)emptyOlderPages.add(scope);
  const beforeEmpty=calls.length;await poll();
  await page.waitForFunction(()=>document.querySelector('nav[aria-label="Paginação: browser"] .pagination-label')?.textContent==='Página 1');
  assert.equal(calls.length-beforeEmpty,2,'an empty older page triggers exactly one fresh first-page fetch');
  checkQuery(calls[beforeEmpty]);cursors.clear();checkQuery(calls.at(-1));
  for(const scope of scopes){
    await navigate(scope);await assertRows(scope,0,20);
    assert.equal(await pager(scope).locator('.pagination-label').textContent(),'Página 1');
    assert.equal(await pager(scope).locator('[data-pagination-direction="prev"]').isDisabled(),true);
  }
  emptyOlderPages.clear();

  // Newly created work must become visible even when created from an older page.
  await navigate('requests');await turn('requests','next',1);
  await page.getByLabel('Perfil de conteúdo',{exact:true}).selectOption(profileId);
  const [created]=await Promise.all([
    page.waitForResponse(response=>new URL(response.url()).pathname==='/api/state'&&!new URL(response.url()).searchParams.has('requestsCursor')),
    page.getByRole('button',{name:'Criar pedido e colocar na fila',exact:true}).click()
  ]);
  cursors.delete('requests');checkQuery(new URL(created.url()));await assertRows('requests',0,20);
  assert.equal(mutations.at(-1).path,'/api/assistant/requests');assert.equal(mutations.at(-1).body.quantity,10);
  fixture.browser.active=null;
  await navigate('browser');await poll();await page.getByRole('button',{name:'Abrir login do TikTok',exact:true}).waitFor({state:'visible'});
  for(const [name,path] of [['Abrir login do TikTok','/api/browser/login'],['Enviar próximo agora','/api/browser/run']]){
    await turn('browser','next',1);
    const [updated]=await Promise.all([
      page.waitForResponse(response=>new URL(response.url()).pathname==='/api/state'&&!new URL(response.url()).searchParams.has('browserCursor')),
      page.getByRole('button',{name,exact:true}).click()
    ]);
    cursors.delete('browser');checkQuery(new URL(updated.url()));await assertRows('browser',0,20);
    assert.equal(mutations.at(-1).path,path);
  }
  assert.deepEqual(errors,[]);
  console.log('Paginação UI: seis listas completas, próxima/anterior, cursores independentes, totais globais, polling, falha/retry, páginas vazias e reset após criação/login/envio validados com API simulada.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
