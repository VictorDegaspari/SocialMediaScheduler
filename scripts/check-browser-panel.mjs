import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base=process.env.APP_URL||'http://localhost:4317';
const fixture={
  browser:{configured:true,rootPath:'/videos',config:{folder:'/videos',enabled:false,cadence:'daily',intervalMinutes:720,times:['08:00','20:00'],timezone:'America/Sao_Paulo',stripMetadata:true,nextAt:null,revision:0},agent:{online:true,desktop:true,externalBusy:false,profileSaved:true,lastSeen:null},active:null,jobs:[]},
  scheduler:{paused:false,queue:{backend:'BullMQ + Redis'}},watches:[],stats:{pending:0,sent:0,attention:0},videos:[],events:[],
  connections:{local:{rootPath:'/videos'},google:{configured:false,connected:false,clientId:'',callbackUrl:base+'/auth/google/callback'},postiz:{configured:false,baseUrl:'',youtubeSchedulingApproved:false},native:{engine:'local',youtube:{configured:false,connected:false,clientId:'',account:'',autoPublishApproved:false,callbackUrl:base+'/auth/youtube/callback'},tiktok:{configured:false,connected:false,clientKey:'',account:'',loginMode:'desktop',desktopAvailable:true,httpsRequired:false,callbackUrl:base+'/auth/tiktok/callback'}}}
};
const actions=[],errors=[];
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(path==='/api/state')return route.fulfill({json:fixture});
  if(path==='/api/integrations')return route.fulfill({json:[]});
  assert.equal(request.method(),'POST');assert.equal(request.headers()['x-watcher-request'],'1');
  const body=request.postDataJSON();actions.push({path,body});
  if(path==='/api/browser/config')Object.assign(fixture.browser.config,body,{nextAt:'2026-11-15T22:00:00Z'});
  else if(path==='/api/browser/login'||path==='/api/browser/run'){
    const job={id:'11111111-1111-4111-8111-111111111111',kind:path.endsWith('login')?'login':'upload',origin:'manual',status:'running',phase:'opening',message:'Abrindo o Chrome no computador.',created_at:'2026-11-15T12:00:00-03:00'};
    fixture.browser.active=job;fixture.browser.jobs.unshift(job);
  }else if(path==='/api/browser/pause')fixture.browser.config.enabled=false;
  else if(path==='/api/browser/stop'){fixture.browser.config.enabled=false;fixture.browser.active.status='cancel_requested';fixture.browser.active.message='Interrupção solicitada pelo painel.';}
  else if(path==='/api/scheduler')fixture.scheduler.paused=body.paused;
  else throw new Error('Requisição inesperada: '+path);
  return route.fulfill({json:{ok:true}});
});
try{
  await page.goto(base+'/#connections');
  await page.getByRole('link',{name:/Abrir TikTok navegador/}).click();
  await page.getByRole('heading',{name:'TikTok pelo navegador',exact:true}).waitFor();
  assert(await page.getByRole('checkbox',{name:/Remover metadados do vídeo/}).isChecked());
  assert.equal(await page.getByLabel('Horários do TikTok').inputValue(),'08:00, 20:00');
  await page.getByLabel('Horários do TikTok').fill('09:00, 19:00');
  await page.getByRole('checkbox',{name:/Ativar envios automáticos pelo navegador/}).check();
  await page.getByRole('button',{name:'Salvar rotina do navegador',exact:true}).click();
  await page.getByRole('button',{name:'Pausar rotina do navegador',exact:true}).waitFor();
  assert.deepEqual(actions.at(-1).body.times,['09:00','19:00']);assert.equal(actions.at(-1).body.enabled,true);
  await page.reload();await page.getByLabel('Horários do TikTok').waitFor();
  assert.equal(await page.getByLabel('Horários do TikTok').inputValue(),'09:00, 19:00');
  await page.getByLabel('Quando enviar pelo navegador?').selectOption('interval');
  await page.getByLabel('Intervalo entre envios (minutos)').fill('120');
  await page.getByRole('button',{name:'Salvar rotina do navegador',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#browser-cadence')?.value==='interval'&&!document.querySelector('#browser-config-form [type="submit"]').disabled);
  assert.equal(actions.at(-1).body.intervalMinutes,120);
  await page.getByRole('button',{name:'Pausar rotina do navegador',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#browser-config-form [name="enabled"]').checked);
  await page.getByRole('button',{name:'Abrir login do TikTok',exact:true}).click();
  await page.getByRole('button',{name:'Interromper tarefa',exact:true}).waitFor();
  assert(await page.getByRole('button',{name:'Enviar próximo agora',exact:true}).isDisabled());
  fixture.browser.active.status='done';fixture.browser.active=null;
  await page.getByRole('button',{name:'Atualizar status',exact:true}).click();
  await page.getByRole('button',{name:'Enviar próximo agora',exact:true}).click();
  await page.getByRole('button',{name:'Interromper tarefa',exact:true}).waitFor();
  assert.deepEqual(actions.slice(-2).map(a=>a.path),['/api/browser/config','/api/browser/run']);
  await page.getByRole('button',{name:'Interromper tarefa',exact:true}).click();
  await page.getByText('Interrompendo',{exact:true}).waitFor();
  fixture.browser.active.status='unknown';fixture.browser.active=null;
  fixture.browser.agent.online=false;
  await page.getByRole('button',{name:'Atualizar status',exact:true}).click();
  assert(await page.getByRole('button',{name:'Abrir login do TikTok',exact:true}).isDisabled());
  fixture.browser.agent.online=true;fixture.browser.agent.externalBusy=true;
  await page.getByRole('button',{name:'Atualizar status',exact:true}).click();
  await page.getByText('Janela já aberta',{exact:true}).waitFor();
  assert(await page.getByRole('button',{name:'Enviar próximo agora',exact:true}).isDisabled());
  fixture.browser.agent.externalBusy=false;
  await page.getByRole('button',{name:'Atualizar status',exact:true}).click();
  await page.getByText('Pronto para receber tarefas',{exact:true}).waitFor();
  await page.getByLabel('Como processar os vídeos?').selectOption('native_schedule');
  await page.getByLabel('Máximo de vídeos agendados',{exact:true}).fill('4');
  await page.getByLabel('Agendados fora deste sistema',{exact:true}).fill('1');
  await page.getByLabel('Máximo de uploads em 24 horas',{exact:true}).fill('3');
  await page.getByLabel('Publicar a partir de (opcional)').fill('2026-11-20T08:00');
  await page.getByLabel('Publicar até (opcional)').fill('2026-11-25T20:00');
  await page.getByRole('button',{name:'Salvar rotina do navegador',exact:true}).click();
  await page.getByRole('button',{name:'Agendar próximo agora',exact:true}).waitFor();
  assert.equal(actions.at(-1).body.mode,'native_schedule');
  assert.equal(actions.at(-1).body.nativeSchedule.maxScheduled,4);
  assert.equal(actions.at(-1).body.nativeSchedule.externalScheduled,1);
  assert.equal(actions.at(-1).body.nativeSchedule.startAt,'2026-11-20T11:00:00.000Z');
  assert.equal(actions.at(-1).body.nativeSchedule.endAt,'2026-11-25T23:00:00.000Z');
  await page.getByLabel('Origem dos vídeos do TikTok').selectOption('gta6_pack');
  await page.getByLabel('Prefixo do título').fill('Meu GTA 6');
  assert.equal(await page.getByRole('checkbox',{name:'YouTube: conteúdo realista alterado ou sintético',exact:false}).isChecked(),false,'declaração do YouTube inicia desmarcada');
  await page.getByRole('button',{name:'Salvar rotina do navegador',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#browser-source')?.value==='gta6_pack'&&!document.querySelector('#browser-config-form [type="submit"]').disabled);
  assert.equal(actions.at(-1).body.sourceType,'gta6_pack');
  assert.equal(actions.at(-1).body.packDefaults.titlePrefix,'Meu GTA 6');
  assert.equal(actions.at(-1).body.packDefaults.madeWithAI,true);
  assert.equal(actions.at(-1).body.packDefaults.youtubeContainsSyntheticMedia,false);
  await mkdir('artifacts',{recursive:true});
  await page.screenshot({path:'artifacts/browser-panel-desktop.png',fullPage:true});
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Layout não pode ultrapassar a tela: '+width);
    if(width===390)await page.screenshot({path:'artifacts/browser-panel-mobile.png',fullPage:true});
  }
  assert.deepEqual(errors,[]);
  await page.setViewportSize({width:1440,height:1100});
  await page.goto(base+'/#watches');
  await page.getByRole('button',{name:'Adicionar pasta',exact:true}).click();
  await page.getByLabel('Como processar o vídeo?').selectOption('native_schedule');
  await page.getByLabel('Origem dos vídeos',{exact:true}).selectOption('gta6_pack');
  assert(await page.locator('#pack-source').isVisible());
  assert(await page.locator('#watch-form [name="importExisting"]').isChecked());
  assert(await page.locator('#folder-url').isDisabled());
  assert(await page.locator('#native-schedule-fields').isVisible());
  await page.getByLabel('Máximo de vídeos agendados',{exact:true}).fill('5');
  await page.getByLabel('Publicar até (opcional)').fill('2026-12-01T20:00');
  assert.equal(await page.getByLabel('Como processar o vídeo?').inputValue(),'native_schedule');
  for(const width of [390,320]) {
    await page.setViewportSize({width,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Formulário YouTube ultrapassou a tela: '+width);
  }
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  assert.deepEqual(errors,[]);
  console.log('Painel validado: rotinas, login, interrupção, lote TikTok com limites/datas, formulário YouTube e telas móveis. Todos os comandos foram simulados.');
}finally{await browser.close();}
