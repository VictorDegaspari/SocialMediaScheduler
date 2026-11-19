import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';

const root=resolve('public'),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname,file=resolve(root,'.'+(path==='/'?'/index.html':path));
    assert(file.startsWith(root+'/'));
    res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');
    res.end(await readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base='http://127.0.0.1:'+server.address().port;
const yt='11111111-1111-4111-8111-111111111111',tt='22222222-2222-4222-8222-222222222222';
const fixture={
  watches:[],videos:[],events:[],stats:{pending:0,sent:0,attention:0},scheduler:{paused:false,queue:{}},
  connections:{
    local:{rootPath:'/videos'},playwrightMcp:{configured:true,source:'input'},google:{configured:false},postiz:{configured:false},
    native:{engine:'local',youtube:{configured:true,connected:true,account:'QA · Canal YouTube',clientId:'qa-client.apps.googleusercontent.com'},tiktok:{}},
  },
};
const metadata={schemaVersion:1,ready:true,title:'Vídeo QA',description:'Descrição QA',hashtags:['dica'],youtube:{visibility:'private',madeForKids:false,containsSyntheticMedia:true,tags:[]},tiktok:{madeWithAI:true}};
const details=new Map([[yt,{id:yt,provider:'youtube',status:'review',hasMedia:true,payload:{metadata:structuredClone(metadata),channelName:'QA · Canal YouTube'}}],[tt,{id:tt,provider:'tiktok',status:'review',hasMedia:true,payload:{metadata:structuredClone(metadata),channelName:'QA · Conta TikTok'}}]]);
function choose(id){const d=details.get(id);fixture.videos=[{id:'33333333-3333-4333-8333-333333333333',name:'video-qa.mp4',status:'sent',watch_name:'QA · Motor local',deliveries:[{id,provider:d.provider,status:d.status,engine:'local'}]}];}
choose(yt);
const video=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=90x160:d=1','-c:v','libx264','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4','-']),approvals=[];
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(path==='/api/state')return route.fulfill({json:fixture});
  if(path==='/api/integrations')return route.fulfill({json:[]});
  const match=path.match(/^\/api\/native\/deliveries\/([^/]+)(?:\/(media|approve))?$/);
  if(match){const d=details.get(match[1]);if(match[2]==='media')return route.fulfill({contentType:'video/mp4',body:video});
    if(match[2]==='approve'){assert.equal(route.request().headers()['x-watcher-request'],'1');const body=route.request().postDataJSON();approvals.push({id:d.id,body});d.status='pending';fixture.videos[0].deliveries[0].status='pending';return route.fulfill({json:{ok:true}});}
    return route.fulfill({json:d});}
  throw new Error('Unexpected browser API request: '+path);
});
try {
  await mkdir('artifacts',{recursive:true});
  await page.goto(base+'/#history');await page.getByRole('button',{name:'Revisar e aprovar',exact:true}).click();
  await page.getByText('Destino: QA · Canal YouTube',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Visibilidade no YouTube').inputValue(),'private');
  assert(await page.getByRole('checkbox',{name:/Contém conteúdo realista/}).isChecked());
  await page.getByLabel('Título do vídeo',{exact:true}).fill('Título revisado');
  await page.getByLabel('Visibilidade no YouTube').selectOption('unlisted');
  await page.getByRole('button',{name:'Autorizar e enviar',exact:true}).click();assert.equal(approvals.length,0,'explicit consent must be required');
  await page.screenshot({path:'artifacts/native-review-youtube.png',fullPage:true});
  await page.getByRole('checkbox',{name:/Autorizo o envio deste vídeo/}).check();await page.getByRole('button',{name:'Autorizar e enviar',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#delivery-dialog').open);assert.equal(approvals.length,1);
  assert.equal(approvals[0].body.confirm,true);assert.equal(approvals[0].body.metadata.title,'Título revisado');assert.equal(approvals[0].body.metadata.youtube.visibility,'unlisted');assert.equal(approvals[0].body.metadata.youtube.containsSyntheticMedia,true);
  choose(tt);await page.reload();await page.getByRole('button',{name:'Revisar e aprovar',exact:true}).click();
  await page.getByText('Destino: QA · Conta TikTok',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Visibilidade no YouTube').count(),0);
  await page.getByText('O JSON declara uso de IA.',{exact:false}).waitFor();
  await page.getByRole('checkbox',{name:/Autorizo o envio deste vídeo/}).check();await page.getByRole('button',{name:'Autorizar e enviar',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#delivery-dialog').open);assert.equal(approvals.length,2);assert.equal(approvals[1].body.metadata.tiktok.madeWithAI,true);
  await page.getByRole('link',{name:'Conexões',exact:true}).click();
  await page.getByText('Configurações avançadas',{exact:true}).click();
  await page.getByRole('heading',{name:'Motor de publicação',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Quem gerencia as publicações?').inputValue(),'local');
  await page.getByText('Configurações avançadas',{exact:true}).click();
  assert.equal(await page.locator('#tiktok-form').count(),0);
  assert.equal(await page.getByRole('link',{name:'Autorizar TikTok',exact:true}).count(),0);
  assert.equal(await page.getByRole('link',{name:/Abrir TikTok navegador/}).isVisible(),true);
  await page.screenshot({path:'artifacts/native-connections-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'native connections must fit on mobile');
  await page.screenshot({path:'artifacts/native-connections-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('Motor local validado no navegador: revisão, consentimento obrigatório, visibilidade, IA e conexões responsivas. APIs externas simuladas.');
}finally{await browser.close();await new Promise(done=>server.close(done));}
