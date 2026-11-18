import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';

const root=resolve('public'),uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const channels=[{id:'native:youtube:qa',name:'Canal de teste',identifier:'youtube'},{id:'browser:tiktok:default',name:'Perfil TikTok',identifier:'tiktok-browser'}];
const jobs=Array.from({length:3},(_,i)=>({id:uuid(i+1),title:i===0?'GTA 6 · gameplay e reações do streamer em alta qualidade':'Projeto '+(i+1),status:'review',duration:120,clips:Array.from({length:2},(_,j)=>({id:uuid(i*2+j+10),job_id:uuid(i+1),title:i===0&&j===0?'A reação do streamer ao descobrir uma nova área do mapa de GTA 6':'Meu corte '+(i*2+j+1),reason:'Descrição completa do corte, preservada para consulta nos detalhes.',status:j===0?'review':'posted',hasMedia:true,revision:2,start_seconds:0,end_seconds:3,output_duration:3,framing_options:{format:i===2?'video':'shorts',mode:'crop'},render_warnings:i===0&&j===0?['Confira os tempos das palavras antes de publicar.']:[],publications:j===0?[]:[{provider:'youtube',channel_name:'Meu canal',status:'published',release_url:'https://www.youtube.com/watch?v=qa'}],captions:[{start:0,end:3,text:'Fala original.'}]}))}));
const watches=Array.from({length:2},(_,i)=>({id:uuid(i+30),name:i===0?'Vídeos do canal principal':'Minha pasta de vídeos com um nome longo para conferir a leitura',source_type:'local',folder_url:'/videos/'+('minha-subpasta/'.repeat(i===0?2:18)),enabled:i===0,pending_count:i===0?1:12,scan_minutes:5,cadence:i===0?'daily':'interval',times:['08:00','20:00'],interval_minutes:720,next_upload_at:'2026-11-18T20:00:00-03:00',recursive:true,integration_ids:['native:youtube:qa'],mode:'draft'}));
const fixture={watches,connections:{local:{rootPath:'/videos'}},stats:{watches:2,pending:13,sent:0,attention:0},scheduler:{paused:false,queue:{}},cuts:{jobs,channels,dependencies:{ready:true}},cutFolders:{jobs,channels,pagination:{limit:10,hasMore:false}},pagination:{watches:{limit:20,hasMore:false}},publishing:{actions:[]}};
const media=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=90x160:d=3','-c:v','libx264','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4','-'],{maxBuffer:1024*1024});
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname,file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+'/'))throw Error('Not found');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]||'text/plain');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10_000);await page.emulateMedia({reducedMotion:'reduce'});
const errors=[],mutations=[];page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(()=>{const interval=window.setInterval.bind(window);window.setInterval=(callback,ms,...args)=>{if(ms===5000){window.__foldersPoll=callback;return 0;}return interval(callback,ms,...args);};});
await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(path==='/api/state')return route.fulfill({json:fixture});
  if(path==='/api/integrations')return route.fulfill({json:channels});
  if(path.endsWith('/media')||path.endsWith('/source'))return route.fulfill({body:media,contentType:'video/mp4'});
  assert.equal(request.method(),'POST');assert.equal(request.headers()['x-watcher-request'],'1');mutations.push({path,body:request.postDataJSON()});
  if(path==='/api/watches/'+watches[0].id+'/toggle'){watches[0].enabled=!watches[0].enabled;return route.fulfill({json:{ok:true}});}
  throw new Error('Unexpected mutation: '+path);
});
try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/#watches');await page.getByRole('heading',{name:'Minhas pastas',exact:true}).waitFor();
  assert.equal(await page.locator('#main h1').count(),1);assert.equal(await page.locator('.cuts-library-card').count(),6);assert.equal(await page.locator('.watch-card').count(),2);
  assert.equal(await page.locator('#main details[open]').count(),0);
  const cards=page.locator('.cuts-library-card'),boxes=await cards.evaluateAll(cards=>cards.map(card=>{const r=card.getBoundingClientRect();return {x:r.x,y:r.y,height:r.height};}));
  assert.ok(Math.abs(boxes[0].y-boxes[2].y)<2&&boxes[2].x>boxes[1].x,'three compact columns fit on desktop');assert.ok(boxes.every(box=>box.height<550));
  const first=cards.first(),details=first.locator('details');
  assert.equal(await first.getByRole('button',{name:'Postar no YouTube',exact:true}).count(),1);assert.equal(await first.getByRole('button',{name:'Postar no TikTok',exact:true}).count(),1);
  assert.equal(await first.getByRole('button',{name:'Ajustar',exact:true}).count(),1);assert.equal(await first.getByRole('link',{name:'Baixar MP4',exact:true}).count(),1);
  await details.locator('summary').click();await first.getByText('Confira os tempos das palavras antes de publicar.',{exact:true}).waitFor();
  const video=first.locator('video');await video.evaluate(async video=>{video.dataset.preserved='yes';video.loop=true;video.muted=true;await video.play();});
  jobs[0].title='Projeto atualizado durante a reprodução';await page.getByRole('heading',{name:'Minhas pastas',exact:true}).click();await page.evaluate(async()=>{await window.__foldersPoll();window.dispatchEvent(new Event('hashchange'));});
  assert.equal(await video.getAttribute('data-preserved'),'yes');assert.equal(await video.evaluate(video=>video.paused),false);assert.equal(await details.getAttribute('open'),'');
  await video.evaluate(video=>video.pause());jobs[0].title='Projeto atualizado para revisão';
  await page.getByRole('heading',{name:'Minhas pastas',exact:true}).click();await page.evaluate(async()=>{await window.__foldersPoll();window.dispatchEvent(new Event('hashchange'));});
  assert.equal(await details.getAttribute('open'),'','details remain open when cards update');
  await page.getByRole('button',{name:'Pastas de vídeos',exact:true}).click();assert.equal(await page.evaluate(()=>location.hash),'#watches');
  const folderDetails=page.locator('.watch-card').first().locator('details');await folderDetails.locator('summary').click();
  await page.getByRole('button',{name:'Pausar Vídeos do canal principal',exact:true}).click();await page.getByRole('button',{name:'Retomar Vídeos do canal principal',exact:true}).waitFor();
  assert.equal(await folderDetails.getAttribute('open'),'');assert.equal(mutations.length,1);
  await page.getByRole('button',{name:'Editar Vídeos do canal principal',exact:true}).click();await page.getByRole('heading',{name:'Editar rotina',exact:true}).waitFor();await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('button',{name:'Cortes salvos',exact:true}).click();
  await page.locator('#main details').evaluateAll(items=>items.forEach(item=>item.open=false));await page.evaluate(()=>scrollTo(0,0));
  await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/my-folders-desktop.png',fullPage:true});
  for(const width of [1366,1024,768,390,320]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow at '+width);
    assert.equal(await page.locator('.cuts-library-card').count(),6);
    const player=await cards.first().locator('.cuts-player-wrap').boundingBox();assert.ok(player.height<300,'preview stays compact at '+width);
    if(width===390)await page.screenshot({path:'artifacts/my-folders-mobile.png',fullPage:true});
  }
  assert.deepEqual(errors,[]);console.log('Minhas pastas: compact grid, details and playback preserved on polling, folder controls, navigation and mobile widths validated. APIs simulated.');
}finally{await browser.close();await new Promise(done=>server.close(done));}
