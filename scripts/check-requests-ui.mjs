import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const id='11111111-1111-4111-8111-111111111111',requestId='22222222-2222-4222-8222-222222222222';
const fixture={publishing:{profiles:[{id,name:'Bíblicos',watch_id:null,youtube_id:null,tiktok_profile_id:null,source_roots:[],pack_defaults:{}}],accounts:[{id:'native:youtube:channel-one',identifier:'youtube',name:'GTA 6',disabled:false,autoPublishApproved:true},{id:'native:youtube:channel-two',identifier:'youtube',name:'Bíblicos',disabled:false,autoPublishApproved:false}],browserProfiles:[{id:'default',name:'GTA 6',profileSaved:true}],agentOnline:true,googleConnected:false,requests:[],actions:[]},browser:{},
  scheduler:{paused:false,queue:{}},watches:[],stats:{pending:0,sent:0,attention:0},videos:[],events:[],connections:{playwrightMcp:{configured:true,source:'input'},local:{rootPath:'/videos'},google:{},postiz:{},native:{engine:'local',youtube:{configured:true},tiktok:{}}}};
const calls=[],errors=[];let polls=0,failRequest=false;
// Serve the checkout with simulated APIs; this check never connects real accounts.
const publicRoot=resolve('public');
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname,filename=resolve(publicRoot,'.'+(path==='/'?'/index.html':path));
    assert(filename.startsWith(publicRoot+'/'));
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(filename)]||'application/octet-stream');
    res.end(await readFile(filename));
  }catch(error){res.statusCode=404;res.end();errors.push(error.message);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1100}});
page.setDefaultTimeout(Number(process.env.UI_TIMEOUT_MS||10_000));
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
  const interval=window.setInterval.bind(window);
  window.setInterval=(callback,delay,...args)=>delay===5000?(window.__qaPoll=callback,0):interval(callback,delay,...args);
});
await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;if(path==='/api/state')return route.fulfill({json:fixture});
  const body=request.postDataJSON();calls.push({path,body});assert.equal(request.headers()['x-watcher-request'],'1');
  if(path==='/api/assistant/requests'){if(failRequest){failRequest=false;return route.fulfill({status:503,json:{error:'Falha simulada ao criar pedido.'}});}fixture.publishing.requests.push({id:requestId,profile_name:'Bíblicos',provider:'youtube',status:'active',quantity:body.quantity,confirmed:0,reserved:0,waiting:body.quantity,config:{cadence:{times:body.times,timezone:body.timezone}},created_at:'2026-11-16T12:00:00Z'});return route.fulfill({status:202,json:{requests:[{id:requestId,provider:'youtube'}]}});}
  if(path==='/api/assistant/requests/'+requestId+'/cancel')fixture.publishing.requests[0].status='cancelled';
  else if(path==='/api/assistant/profiles')fixture.publishing.profiles.push({...body,id:'33333333-3333-4333-8333-333333333333',source_type:body.sourceType});
  else if(path==='/api/browser/profiles')fixture.publishing.browserProfiles.push({id:'44444444-4444-4444-8444-444444444444',name:body.name,profileSaved:false});
  else if(path==='/api/accounts/update'){assert.equal(body.id,'channel-two');fixture.publishing.accounts[1].autoPublishApproved=body.autoPublishApproved;}
  else if(path.startsWith('/api/browser/profiles/')&&path.endsWith('/login')){}
  else throw new Error('Unexpected API '+path);
  await route.fulfill({json:{ok:true}});
});
async function pollRequests(){
  const name=fixture.publishing.browserProfiles[0].name='Conta atualizada '+ ++polls;
  await page.evaluate(()=>{document.activeElement.blur();window.__qaPoll();});
  await page.waitForFunction(name=>Array.from(document.querySelectorAll('.requests-account h3')).some(element=>element.textContent===name),name);
}
try {
  await page.goto(base+'/#requests');await page.getByRole('heading',{name:'Pedidos e contas',exact:true}).waitFor();
  assert.equal(await page.getByRole('tab',{name:'Pedidos',exact:true}).getAttribute('aria-selected'),'true');
  assert.equal(await page.getByRole('heading',{name:'Perfis de conteúdo',exact:true}).isVisible(),false);
  assert.equal(await page.getByLabel('Máximo de vídeos agendados').isVisible(),false,'advanced limits start collapsed');
  await page.getByRole('tab',{name:'Contas',exact:true}).click();
  assert.equal(await page.getByRole('link',{name:'Adicionar conta YouTube'}).getAttribute('href'),'/auth/youtube');
  await page.getByRole('button',{name:'Autorizar automático',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-request-action=approval][data-approved=false]').length===2);
  assert.equal(calls.at(-1).body.autoPublishApproved,true);
  await page.getByRole('tab',{name:'Pedidos',exact:true}).click();
  await page.getByLabel('Perfil de conteúdo',{exact:true}).selectOption(id);await page.getByLabel('Quantidade de vídeos por plataforma').fill('17');await page.getByLabel('Horários de postagem').fill('09:00, 18:00');
  await page.getByRole('checkbox',{name:'TikTok',exact:true}).uncheck();
  const requestForm=await page.locator('#publication-request-form').elementHandle();
  await page.getByRole('tab',{name:'Contas',exact:true}).click();
  await pollRequests();
  assert(await requestForm.evaluate(form=>form===document.querySelector('#publication-request-form')),'polling keeps the existing request form');
  assert.equal(await page.getByRole('tab',{name:'Contas',exact:true}).getAttribute('aria-selected'),'true','polling preserves the selected view');
  await page.getByRole('tab',{name:'Pedidos',exact:true}).click();
  assert.equal(await page.getByLabel('Quantidade de vídeos por plataforma').inputValue(),'17','draft survives polling after blur');
  assert.equal(await page.getByLabel('Horários de postagem').inputValue(),'09:00, 18:00');
  assert.equal(await page.getByRole('checkbox',{name:'TikTok',exact:true}).isChecked(),false);
  await page.getByRole('checkbox',{name:'YouTube',exact:true}).uncheck();await page.getByRole('button',{name:'Criar pedido e colocar na fila',exact:true}).click();
  await page.getByText('Selecione pelo menos uma plataforma.',{exact:true}).waitFor();assert(!calls.some(c=>c.path==='/api/assistant/requests'));
  await page.getByRole('checkbox',{name:'YouTube',exact:true}).check();
  await page.getByText('Limites e período de publicação',{exact:true}).click();
  await page.getByLabel('Máximo de vídeos agendados').fill('0');
  await page.getByText('Limites e período de publicação',{exact:true}).click();await page.getByRole('button',{name:'Criar pedido e colocar na fila',exact:true}).click();
  assert(await page.getByLabel('Máximo de vídeos agendados').isVisible(),'invalid advanced settings expand for correction');assert(!calls.some(c=>c.path==='/api/assistant/requests'));
  await page.getByLabel('Máximo de vídeos agendados').fill('14');
  await page.getByLabel('Agendados fora deste sistema').fill('2');await page.getByLabel('Máximo de uploads em 24 horas').fill('7');
  await page.getByLabel('Máximo de publicações por dia').fill('3');await page.getByLabel('Preparar quantos dias à frente?').fill('8');
  await page.getByLabel('Publicar a partir de (opcional)').fill('2026-11-20T09:15');await page.getByLabel('Publicar até (opcional)').fill('2026-11-27T18:30');
  await page.getByText('Limites e período de publicação',{exact:true}).click();
  failRequest=true;await page.getByRole('button',{name:'Criar pedido e colocar na fila',exact:true}).click();
  await page.getByText('Falha simulada ao criar pedido.',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Quantidade de vídeos por plataforma').inputValue(),'17','failed requests preserve their draft');
  const failed=calls.at(-1).body;
  await page.getByRole('button',{name:'Criar pedido e colocar na fila',exact:true}).click();
  await page.getByText('0 / 17 confirmados',{exact:false}).waitFor();const sent=calls.find(c=>c.path==='/api/assistant/requests').body;
  assert.equal(sent.quantity,17);assert.deepEqual(sent.platforms,['youtube']);assert.deepEqual(sent.times,['09:00','18:00']);assert(sent.requestKey);assert.equal(sent.policy.maxScheduled,14,'collapsed controls still submit their values');
  assert.deepEqual(sent.policy,{maxScheduled:14,uploadsPer24h:7,postsPerDay:3,horizonDays:8,externalScheduled:2,startAt:'2026-11-20T12:15:00.000Z',endAt:'2026-11-27T21:30:00.000Z'},'all scheduling limits and São Paulo date conversions keep their API contract');
  assert.deepEqual(calls.filter(call=>call.path==='/api/assistant/requests').at(-1).body,failed,'retry preserves the complete request and its idempotency key');
  assert.equal(await page.getByLabel('Quantidade de vídeos por plataforma').inputValue(),'10','successful creation resets the request form');
  assert.equal(await page.getByLabel('Horários de postagem').inputValue(),'08:00, 20:00');
  assert.equal(await page.getByLabel('Máximo de vídeos agendados').inputValue(),'10','successful creation resets advanced limits');
  assert.equal(await page.getByLabel('Publicar a partir de (opcional)').inputValue(),'');
  await page.getByText('Detalhes do pedido',{exact:true}).click();
  await page.getByRole('button',{name:'Cancelar restante do pedido',exact:true}).click();await page.getByText('Cancelado',{exact:true}).waitFor();
  await page.getByRole('tab',{name:/^Perfis/}).click();
  await page.getByText('Adicionar perfil de conteúdo',{exact:true}).click();await page.getByLabel('Nome do perfil',{exact:true}).fill('Outro canal');await page.getByLabel('Origem do perfil').selectOption('gta6_pack');
  assert.equal(await page.getByLabel('Pastas do Drive (uma por linha)').isVisible(),false);
  assert.equal(await page.getByLabel('Pasta local',{exact:true}).isVisible(),false);
  await page.getByLabel('Origem do perfil').selectOption('google_drive');assert(await page.getByLabel('Pastas do Drive (uma por linha)').isVisible());
  await page.getByLabel('Origem do perfil').selectOption('local');assert(await page.getByLabel('Pasta local',{exact:true}).isVisible());
  await page.getByLabel('Origem do perfil').selectOption('gta6_pack');
  assert.equal(await page.getByRole('checkbox',{name:'YouTube: conteúdo realista alterado ou sintético',exact:false}).isChecked(),false,'declaração do YouTube inicia desmarcada');
  await page.getByRole('button',{name:'Salvar perfil',exact:true}).click();await page.getByRole('heading',{name:'Outro canal',exact:true}).waitFor();
  assert.equal(calls.find(c=>c.path==='/api/assistant/profiles').body.sourceType,'gta6_pack');
  assert.equal(calls.find(c=>c.path==='/api/assistant/profiles').body.packDefaults.youtubeContainsSyntheticMedia,false);
  assert.equal(calls.find(c=>c.path==='/api/assistant/profiles').body.packDefaults.madeWithAI,true);
  await page.getByRole('tab',{name:'Contas',exact:true}).click();
  await page.getByText('Adicionar conta TikTok',{exact:true}).click();await page.getByLabel('Nome de outra conta TikTok').fill('Bíblicos');await page.getByRole('button',{name:'Adicionar perfil TikTok',exact:true}).click();await page.locator('.requests-account').filter({hasText:'Bíblicos'}).getByText('Login necessário',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Abrir login',exact:true}).last().click();assert(calls.at(-1).path.endsWith('/login'));
  await page.getByRole('tab',{name:'Contas',exact:true}).focus();await page.keyboard.press('Home');assert.equal(await page.getByRole('tab',{name:'Pedidos',exact:true}).getAttribute('aria-selected'),'true');
  await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('tab',{name:/^Perfis/}).getAttribute('aria-selected'),'true');
  await page.getByRole('button',{name:'Editar perfil Bíblicos',exact:true}).click();await page.getByLabel('Nome do perfil',{exact:true}).fill('Rascunho');
  await page.getByLabel('Origem do perfil').selectOption('google_drive');await page.getByLabel('Pastas do Drive (uma por linha)').fill('https://drive.google.com/drive/folders/rascunho');
  await page.getByText('Títulos, descrição e hashtags',{exact:true}).click();await page.getByLabel('Descrição padrão').fill('Descrição <b>literal</b>');
  await page.getByLabel('Canal YouTube',{exact:true}).selectOption('native:youtube:channel-one');
  const removedAccount=fixture.publishing.accounts.shift();
  await page.getByRole('tab',{name:'Pedidos',exact:true}).click();await pollRequests();
  await page.getByRole('tab',{name:/^Perfis/}).click();assert.equal(await page.getByLabel('Nome do perfil',{exact:true}).inputValue(),'Rascunho','profile edits survive polling');
  assert.equal(await page.getByLabel('Descrição padrão').inputValue(),'Descrição <b>literal</b>','textarea drafts survive polling');
  assert(await page.getByLabel('Pastas do Drive (uma por linha)').isVisible(),'the draft source controls remain visible');
  assert.equal(await page.getByLabel('Canal YouTube',{exact:true}).inputValue(),'','a removed account cannot remain selected in a draft');
  fixture.publishing.accounts.unshift(removedAccount);
  await page.getByRole('button',{name:'Editar perfil Outro canal',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#profile-name').value==='Outro canal');
  fixture.publishing.actions=[{id:'pending-action',profile_name:'Bíblicos',provider:'youtube',kind:'setup',message:'Revise o título antes do envio.',href:'/#requests',request_id:requestId}];
  Object.assign(fixture.publishing.requests[0],{status:'waiting_manual',confirmed:9,reserved:0,waiting:8,message:'Revise o título antes do envio.'});
  await page.getByRole('tab',{name:'Pedidos',exact:true}).click();await pollRequests();await page.locator('.requests-action').getByText('Revise o título antes do envio.',{exact:true}).waitFor();
  await page.getByText('Detalhes do pedido',{exact:true}).click();await page.locator('#toast').waitFor({state:'hidden'});
  await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/requests-desktop.png',fullPage:true});
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    for(const name of ['Pedidos',/^Perfis/,'Contas']){await page.getByRole('tab',{name,exact:true}).click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Overflow em '+width+' '+name);}
  }
  await page.getByRole('tab',{name:'Pedidos',exact:true}).click();await page.screenshot({path:'artifacts/requests-mobile.png',fullPage:true});
  const attention=await page.locator('.requests-attention').boundingBox(),compose=await page.locator('.requests-compose').boundingBox();assert(attention.y<compose.y,'mobile puts pending actions before the form');
  fixture.connections.playwrightMcp={configured:false,source:null};await page.reload();
  assert(await page.getByRole('checkbox',{name:'TikTok',exact:true}).isDisabled());
  await page.getByRole('tab',{name:'Contas',exact:true}).click();assert(await page.getByRole('button',{name:'Abrir login',exact:true}).first().isDisabled());
  await page.getByText('Adicionar conta TikTok',{exact:true}).click();assert(await page.getByRole('button',{name:'Adicionar perfil TikTok',exact:true}).isDisabled());
  fixture.publishing.profiles=[];await page.reload();await page.getByRole('button',{name:'Criar perfil de conteúdo',exact:true}).click();
  assert.equal(await page.getByRole('tab',{name:/^Perfis/}).getAttribute('aria-selected'),'true');assert(await page.getByLabel('Nome do perfil',{exact:true}).isVisible());
  assert.deepEqual(errors,[]);console.log('Pedidos e contas: abas, rascunhos, conta removida, reset, falha/retry idempotente, limites/datas, autorização, cancelamento, perfis, login e mobile validados com APIs simuladas.');
}catch(error){console.error({errors});throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
