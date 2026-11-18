import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright-core';

// Isolated source server and fake APIs: never authorize or disconnect real accounts.
const fixture={
  scheduler:{paused:false,queue:{backend:'BullMQ + Redis',waiting:2,active:1}},stats:{pending:0,sent:0,attention:0},watches:[],videos:[],events:[],
  connections:{playwrightMcp:{configured:false,source:null},local:{rootPath:'/videos'},google:{configured:true,connected:false,clientId:'drive-client',callbackUrl:'http://localhost/auth/google/callback'},postiz:{configured:false,baseUrl:'https://postiz.example/api'},native:{engine:'local',youtube:{configured:true,connected:true,account:'Canal <QA>',clientId:'youtube-client',callbackUrl:'http://localhost/auth/youtube/callback',autoPublishApproved:true},tiktok:{}}},
  publishing:{profiles:[],accounts:[],requests:[],actions:[],browserProfiles:[{id:'default',name:'Principal',profileSaved:true},{id:'biblicos',name:'Bíblicos',profileSaved:false}]},browser:{}
};
const calls=[],errors=[];let failGoogle=false,failMcp=false;
const channels=[{id:'postiz-qa',name:'Canal Postiz QA',identifier:'youtube',disabled:false}];
const root=resolve('public'),server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname,file=resolve(root,'.'+(path==='/'?'/index.html':path));assert(file.startsWith(root+'/'));
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));
  }catch(error){errors.push(error.message);res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1100}});page.setDefaultTimeout(Number(process.env.UI_TIMEOUT_MS||10_000));
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('status of 503'))errors.push(m.text());});
await page.addInitScript(()=>{
  const interval=window.setInterval.bind(window);
  window.setInterval=(callback,delay,...args)=>delay===5000?(window.__qaPoll=callback,0):interval(callback,delay,...args);
});
await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/state')return route.fulfill({json:fixture});
  if(path==='/api/integrations')return route.fulfill({json:fixture.connections.native.engine==='postiz'?channels:[]});
  assert(['POST','DELETE'].includes(req.method()));assert.equal(req.headers()['x-watcher-request'],'1');
  const body=req.postDataJSON();calls.push({path,body});
  if(path==='/api/settings/playwright-mcp'){
    if(failMcp){failMcp=false;return route.fulfill({status:503,json:{error:'Não foi possível salvar o token no teste.'}});}
    if(req.method()==='DELETE')fixture.connections.playwrightMcp={configured:false,source:null};
    else if(body.extensionToken)fixture.connections.playwrightMcp={configured:true,source:'input'};
  }else if(path==='/api/settings/publisher')fixture.connections.native.engine=body.engine;
  else if(path==='/api/settings/youtube')Object.assign(fixture.connections.native.youtube,{configured:true,clientId:body.clientId,autoPublishApproved:body.autoPublishApproved});
  else if(path==='/api/settings/google'){
    if(failGoogle){failGoogle=false;return route.fulfill({status:503,json:{error:'Falha simulada ao salvar credenciais.'}});}
    Object.assign(fixture.connections.google,{configured:true,clientId:body.clientId});
  }else if(path==='/api/settings/postiz'){Object.assign(fixture.connections.postiz,{configured:true,baseUrl:body.baseUrl,youtubeSchedulingApproved:body.youtubeSchedulingApproved});return route.fulfill({json:{channels}});}
  else if(path==='/api/settings/youtube/disconnect')fixture.connections.native.youtube.connected=false;
  else if(path==='/api/settings/google/disconnect')fixture.connections.google.connected=false;
  else throw new Error('Unexpected API '+path);
  await route.fulfill({json:{ok:true}});
});
async function poll(){
  const waiting=++fixture.scheduler.queue.waiting;
  await page.evaluate(()=>{document.activeElement.blur();window.__qaPoll();});
  await page.waitForFunction(waiting=>document.querySelector('.queue-status')?.textContent.includes(`${waiting} aguardando`),waiting);
}
async function saveEngine(engine){
  await page.getByLabel('Quem gerencia as publicações?').selectOption(engine);
  await page.getByRole('button',{name:'Salvar motor',exact:true}).click();
  await page.waitForFunction(value=>document.querySelector('.connections-engine-label')?.textContent===(value==='local'?'Publicação local':'Publicação pelo Postiz'),engine);
}
try{
  await page.goto(base+'/#connections');await page.getByRole('heading',{name:'Conexões',exact:true}).waitFor();
  assert(await page.getByText('Token obrigatório',{exact:true}).isVisible());
  assert(await page.getByLabel('PLAYWRIGHT_MCP_EXTENSION_TOKEN',{exact:true}).isVisible(),'the mandatory token is directly inside the TikTok card');
  assert(await page.getByLabel('PLAYWRIGHT_MCP_EXTENSION_TOKEN',{exact:true}).evaluate(e=>e.required));
  for(const name of ['YouTube','TikTok','Google Drive','Pastas locais'])assert(await page.getByRole('heading',{name,exact:true}).isVisible());
  assert.equal(await page.getByLabel('Client ID do YouTube',{exact:true}).isVisible(),false);
  assert.equal(await page.getByLabel('Client ID',{exact:true}).isVisible(),false);
  assert.equal(await page.getByLabel('Quem gerencia as publicações?').isVisible(),false);
  assert.equal(await page.getByRole('heading',{name:'Postiz',exact:true}).count(),0);
  assert(await page.getByText('Canal <QA>',{exact:true}).isVisible(),'account labels are escaped');
  assert(await page.getByText('1 de 2 com sessão salva',{exact:true}).isVisible());
  assert.equal(await page.getByRole('link',{name:'Autorizar Google',exact:true}).getAttribute('href'),'/auth/google');
  assert.equal(await page.getByRole('link',{name:'Abrir TikTok navegador',exact:true}).getAttribute('href'),'#browser');
  await page.getByRole('link',{name:'Gerenciar contas',exact:true}).first().click();await page.getByRole('tab',{name:'Contas',exact:true}).waitFor();
  assert.equal(await page.getByRole('tab',{name:'Contas',exact:true}).getAttribute('aria-selected'),'true','manage accounts opens the accounts view');
  await page.locator('.sidebar').getByRole('link',{name:'Conexões',exact:true}).click();await page.getByRole('heading',{name:'Conexões',exact:true}).waitFor();
  assert.deepEqual(calls,[],'navigation and disclosures do not change accounts');

  await page.getByText('Credenciais e permissões do YouTube',{exact:true}).click();
  await page.getByLabel('Client ID do YouTube',{exact:true}).fill('updated-youtube');
  await page.locator('#youtube-form [name=autoPublishApproved]').uncheck();
  await page.getByText('Credenciais do Google Drive',{exact:true}).click();
  await page.getByLabel('Client ID',{exact:true}).fill('updated-drive');await page.getByLabel('Client Secret',{exact:true}).fill('fake-draft-secret');
  const driveInput=await page.locator('#client-id').elementHandle(),youtubeForm=await page.locator('#youtube-form').elementHandle();
  await page.getByText('Credenciais do Google Drive',{exact:true}).click();await poll();
  assert(await driveInput.evaluate(input=>input===document.querySelector('#client-id')),'polling retains the existing credential input');
  assert(await youtubeForm.evaluate(form=>form===document.querySelector('#youtube-form')),'polling retains the native form and its pending submit state');
  assert.equal(await page.getByLabel('Client ID do YouTube',{exact:true}).inputValue(),'updated-youtube');
  assert.equal(await page.getByLabel('Client ID',{exact:true}).inputValue(),'updated-drive');
  assert.equal(await page.getByLabel('Client Secret',{exact:true}).inputValue(),'fake-draft-secret','unsaved credentials survive polling');
  assert.equal(await page.getByLabel('Client ID',{exact:true}).isVisible(),false,'polling preserves collapsed details');
  await page.getByRole('button',{name:'Salvar YouTube',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#youtube-client-id').defaultValue==='updated-youtube');
  const youtubeSave=calls.find(c=>c.path==='/api/settings/youtube').body;assert.equal(youtubeSave.autoPublishApproved,false);assert(!Object.hasOwn(youtubeSave,'clientSecret'),'blank secrets remain omitted');
  assert.equal(await page.getByLabel('Client Secret',{exact:true}).inputValue(),'fake-draft-secret','saving another form preserves the draft');

  await page.getByText('Credenciais do Google Drive',{exact:true}).click();failGoogle=true;
  await page.getByRole('button',{name:'Salvar credenciais',exact:true}).click();await page.getByText('Falha simulada ao salvar credenciais.',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Client Secret',{exact:true}).inputValue(),'fake-draft-secret','failed saves preserve credentials');
  await page.getByRole('button',{name:'Salvar credenciais',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#client-id').defaultValue==='updated-drive');
  assert.equal(await page.getByLabel('Client Secret',{exact:true}).inputValue(),'','saved secrets are cleared');
  fixture.connections.native.youtube.autoPublishApproved=true;fixture.connections.google.connected=true;await poll();
  assert(await page.locator('#youtube-form [name=autoPublishApproved]').isChecked(),'unedited fields reflect remote state');

  await page.getByText('Configurações avançadas',{exact:true}).click();
  const beforeEngineDraft=calls.length;
  await page.getByLabel('Quem gerencia as publicações?').selectOption('postiz');await poll();
  assert.equal(await page.getByLabel('Quem gerencia as publicações?').inputValue(),'postiz','polling preserves an unsaved engine selection');
  assert(await page.getByRole('heading',{name:'YouTube',exact:true}).isVisible(),'an unsaved selection does not change the publishing engine');
  await page.getByLabel('Quem gerencia as publicações?').selectOption('local');await poll();
  assert.equal(calls.length,beforeEngineDraft,'editing the engine selector does not save or authorize anything');
  const extensionInput=page.getByLabel('PLAYWRIGHT_MCP_EXTENSION_TOKEN',{exact:true});
  assert.equal(await extensionInput.getAttribute('type'),'password');await extensionInput.fill('fake-playwright-extension-token');
  await poll();assert.equal(await extensionInput.inputValue(),'fake-playwright-extension-token','polling preserves the token draft');
  failMcp=true;await page.getByRole('button',{name:'Salvar token',exact:true}).click();await page.getByText('Não foi possível salvar o token no teste.',{exact:true}).waitFor();assert.equal(await extensionInput.inputValue(),'fake-playwright-extension-token');
  await page.getByRole('button',{name:'Salvar token',exact:true}).click();await page.getByText('Token salvo no painel',{exact:true}).waitFor();assert.equal(await extensionInput.inputValue(),'','the saved token is never returned to the input');
  assert.equal(calls.at(-1).body.extensionToken,'fake-playwright-extension-token');
  await page.getByRole('button',{name:'Salvar token',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#playwright-mcp-form [type=submit]').disabled);assert.deepEqual(calls.at(-1).body,{},'blank input preserves the saved token');
  await page.getByRole('button',{name:'Remover token salvo',exact:true}).click();await page.getByText('Token não configurado',{exact:true}).waitFor();
  fixture.connections.playwrightMcp={configured:true,source:'environment'};await poll();await page.getByText('Token definido no ambiente',{exact:true}).waitFor();assert.equal(await extensionInput.inputValue(),'');
  await saveEngine('postiz');
  await page.getByRole('heading',{name:'Postiz',exact:true}).waitFor();assert(await page.getByText('Canal Postiz QA',{exact:false}).isVisible(),'engine switch immediately reloads matching channels');
  assert.equal(await page.getByRole('heading',{name:'YouTube',exact:true}).count(),0);
  await page.getByRole('button',{name:'Conectar Postiz',exact:true}).click();assert(await page.getByLabel('URL da API',{exact:true}).isVisible());
  await page.getByLabel('Chave da API',{exact:true}).fill('fake-postiz-key');await page.locator('#postiz-form [name=youtubeSchedulingApproved]').check();
  await page.getByRole('button',{name:'Salvar e verificar',exact:true}).click();await page.getByRole('button',{name:'Editar conexão',exact:true}).waitFor();
  assert.equal(calls.at(-1).body.youtubeSchedulingApproved,true);assert.equal(await page.getByLabel('Chave da API',{exact:true}).inputValue(),'');
  await page.getByRole('button',{name:'Atualizar canais',exact:true}).click();assert(await page.getByText('Canal Postiz QA',{exact:false}).isVisible());
  await saveEngine('local');
  await page.getByText('Credenciais e permissões do YouTube',{exact:true}).click();
  await page.getByRole('button',{name:'Desconectar YouTube',exact:true}).click();await page.getByRole('link',{name:'Autorizar YouTube',exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Autorizar YouTube',exact:true}).getAttribute('href'),'/auth/youtube');
  await page.getByRole('button',{name:'Desconectar',exact:true}).click();await page.getByRole('link',{name:'Autorizar Google',exact:true}).waitFor();

  fixture.connections.native.youtube.connected=true;await poll();
  for(const id of ['youtube-setup','google-setup','connections-advanced'])if(await page.locator('#'+id).evaluate(e=>e.open))await page.locator('#'+id+'>summary').click();
  await page.locator('#toast').waitFor({state:'hidden'});await mkdir('artifacts',{recursive:true});
  await page.screenshot({path:'artifacts/connections-desktop.png',fullPage:true});
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'closed cards overflow at '+width);
    for(const id of ['youtube-setup','google-setup','connections-advanced'])await page.locator('#'+id+'>summary').click();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'expanded settings overflow at '+width);
    for(const id of ['youtube-setup','google-setup','connections-advanced'])await page.locator('#'+id+'>summary').click();
  }
  await page.screenshot({path:'artifacts/connections-mobile.png',fullPage:true});
  fixture.connections.native.youtube.configured=false;fixture.connections.native.youtube.connected=false;fixture.connections.google.configured=false;fixture.publishing.browserProfiles=[];await poll();
  await page.getByRole('button',{name:'Configurar YouTube',exact:true}).click();assert(await page.getByLabel('Client ID do YouTube',{exact:true}).isVisible());
  await page.getByRole('button',{name:'Configurar Google Drive',exact:true}).click();assert(await page.getByLabel('Client ID',{exact:true}).isVisible());
  assert(await page.getByText('Nenhuma conta adicionada',{exact:true}).isVisible());
  await page.getByLabel('Client Secret',{exact:true}).fill('fake-navigation-draft');
  await page.locator('.sidebar').getByRole('link',{name:'Pedidos e contas',exact:true}).click();await page.getByRole('heading',{name:'Pedidos e contas',exact:true}).waitFor();
  await page.locator('.sidebar').getByRole('link',{name:'Conexões',exact:true}).click();await page.getByRole('heading',{name:'Conexões',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Client Secret',{exact:true}).inputValue(),'','leaving and reopening connections discards unsaved secrets');
  assert.deepEqual(errors,[]);
  console.log('Conexões: status, áreas recolhidas, contas, credenciais, polling, falha/retry, troca de motor, canais, desconexão e telas móveis validados com APIs simuladas.');
}catch(error){console.error({errors});throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
