import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base=process.env.APP_URL||'http://localhost:4317',id='11111111-1111-4111-8111-111111111111',requestId='22222222-2222-4222-8222-222222222222';
const fixture={publishing:{profiles:[{id,name:'Bíblicos',watch_id:null,youtube_id:null,tiktok_profile_id:null,source_roots:[],pack_defaults:{}}],accounts:[{id:'native:youtube:channel-one',identifier:'youtube',name:'GTA 6',disabled:false,autoPublishApproved:true},{id:'native:youtube:channel-two',identifier:'youtube',name:'Bíblicos',disabled:false,autoPublishApproved:false}],browserProfiles:[{id:'default',name:'GTA 6',profileSaved:true}],agentOnline:true,googleConnected:false,requests:[],actions:[]},browser:{},
  scheduler:{paused:false,queue:{}},watches:[],stats:{pending:0,sent:0,attention:0},videos:[],events:[],connections:{local:{rootPath:'/videos'},google:{},postiz:{},native:{engine:'local',youtube:{configured:true},tiktok:{}}}};
const calls=[],errors=[];
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1100}});
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;if(path==='/api/state')return route.fulfill({json:fixture});
  const body=request.postDataJSON();calls.push({path,body});assert.equal(request.headers()['x-watcher-request'],'1');
  if(path==='/api/assistant/requests'){fixture.publishing.requests.push({id:requestId,profile_name:'Bíblicos',provider:'youtube',status:'active',quantity:body.quantity,confirmed:0,reserved:0,waiting:body.quantity,config:{cadence:{times:body.times,timezone:body.timezone}},created_at:'2026-11-16T12:00:00Z'});return route.fulfill({status:202,json:{requests:[{id:requestId,provider:'youtube'}]}});}
  if(path==='/api/assistant/requests/'+requestId+'/cancel')fixture.publishing.requests[0].status='cancelled';
  else if(path==='/api/assistant/profiles')fixture.publishing.profiles.push({...body,id:'33333333-3333-4333-8333-333333333333',source_type:body.sourceType});
  else if(path==='/api/browser/profiles')fixture.publishing.browserProfiles.push({id:'44444444-4444-4444-8444-444444444444',name:body.name,profileSaved:false});
  else if(path==='/api/accounts/update')assert.equal(body.id,'channel-two');
  else if(path.startsWith('/api/browser/profiles/')&&path.endsWith('/login')){}
  else throw new Error('Unexpected API '+path);
  await route.fulfill({json:{ok:true}});
});
try {
  await page.goto(base+'/#requests');await page.getByRole('heading',{name:'Pedidos e contas',exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Adicionar conta YouTube'}).getAttribute('href'),'/auth/youtube');
  await page.getByRole('button',{name:'Autorizar automático',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-request-action=approval][data-approved=true]').disabled);
  assert.equal(calls.at(-1).body.autoPublishApproved,true);
  await page.getByLabel('Perfil de conteúdo',{exact:true}).selectOption(id);await page.getByLabel('Quantidade de vídeos por plataforma').fill('17');await page.getByLabel('Horários de postagem').fill('09:00, 18:00');
  await page.getByRole('checkbox',{name:'TikTok',exact:true}).uncheck();await page.getByRole('button',{name:'Criar pedido e colocar na fila',exact:true}).click();
  await page.getByText('0 / 17 confirmados',{exact:false}).waitFor();const sent=calls.find(c=>c.path==='/api/assistant/requests').body;
  assert.equal(sent.quantity,17);assert.deepEqual(sent.platforms,['youtube']);assert.deepEqual(sent.times,['09:00','18:00']);assert(sent.requestKey);
  await page.getByRole('button',{name:'Cancelar restante do pedido',exact:true}).click();await page.getByText('Cancelado',{exact:true}).waitFor();
  await page.getByText('Adicionar perfil de conteúdo',{exact:true}).click();await page.getByLabel('Nome do perfil',{exact:true}).fill('Outro canal');await page.getByLabel('Origem do perfil').selectOption('gta6_pack');
  assert.equal(await page.getByRole('checkbox',{name:'YouTube: conteúdo realista alterado ou sintético',exact:false}).isChecked(),false,'declaração do YouTube inicia desmarcada');
  await page.getByRole('button',{name:'Salvar perfil',exact:true}).click();await page.getByText('Outro canal',{exact:true}).first().waitFor();
  assert.equal(calls.find(c=>c.path==='/api/assistant/profiles').body.sourceType,'gta6_pack');
  assert.equal(calls.find(c=>c.path==='/api/assistant/profiles').body.packDefaults.youtubeContainsSyntheticMedia,false);
  assert.equal(calls.find(c=>c.path==='/api/assistant/profiles').body.packDefaults.madeWithAI,true);
  await page.getByLabel('Nome de outra conta TikTok').fill('Bíblicos');await page.getByRole('button',{name:'Adicionar perfil TikTok',exact:true}).click();await page.getByText('Bíblicos · Login necessário',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Abrir login',exact:true}).last().click();assert(calls.at(-1).path.endsWith('/login'));
  await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/requests-desktop.png',fullPage:true});
  for(const width of [390,320]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Overflow em '+width);}
  assert.deepEqual(errors,[]);console.log('Pedidos e contas: quantidade, horários, autorização por conta, cancelamento, novos perfis, login separado e telas móveis validados com APIs simuladas.');
}finally{await browser.close();}
