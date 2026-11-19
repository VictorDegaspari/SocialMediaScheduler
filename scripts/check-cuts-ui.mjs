import {revealEditorControl} from './cuts-ui-tabs.mjs';
import {generateEditorial} from '../src/editorial.ts';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from 'playwright-core';
import {parseTimecode,formatTimecode} from '../public/cuts-time.js';
import {replayTimeAt} from '../public/cuts-replay.js';

// Isolated UI checks: static assets and fake API responses, with no real uploads.
const publicRoot=resolve('public'),temp=await mkdtemp(join(tmpdir(),'watcher-cuts-ui-'));
await promisify(execFile)('ffmpeg',['-loglevel','error','-f','lavfi','-i','color=c=red:s=180x320:r=30:d=180','-vf',"drawbox=c=green:t=fill:enable='gte(t,60)*lt(t,120)',drawbox=c=blue:t=fill:enable='gte(t,120)'",'-c:v','libx264','-preset','ultrafast','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart',join(temp,'preview.mp4')]);
const media=await readFile(join(temp,'preview.mp4'));
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),pathname=url.pathname;if(pathname==='/api/cuts/'+clipId+'/media'&&url.searchParams.get('download')==='1'){res.setHeader('Content-Type','video/mp4');res.setHeader('Content-Disposition','attachment; filename="corte.mp4"');res.end(media);return;}const filename=resolve(publicRoot,'.'+(pathname==='/'?'/index.html':pathname));if(!filename.startsWith(publicRoot+'/'))throw new Error('not found');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(filename)]||'application/octet-stream');res.end(await readFile(filename));}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const jobId='11111111-1111-4111-8111-111111111111',clipId='22222222-2222-4222-8222-222222222222',channelId='native:youtube:qa';
const clip={id:clipId,job_id:jobId,title:'Um exemplo de corte',start_seconds:10,end_seconds:40,reason:'Trecho com fala contínua e frase completa.',status:'review',framing:'fit',captions:[{start:10.001,end:13,text:'A legenda segue o áudio.',words:[{start:10.001,end:10.2,text:'A'},{start:10.2,end:10.8,text:'legenda'},{start:10.8,end:11.4,text:'segue'},{start:11.4,end:11.6,text:'o'},{start:11.6,end:13,text:'áudio.'}]},{start:14,end:17,text:'Mais uma frase.',words:[{start:14,end:15,text:'Mais'},{start:15,end:15.5,text:'uma'},{start:15.5,end:17,text:'frase.'}]}],caption_style:{fontSize:42,color:'#FFFFFF',highlightColor:'#FFE600',outlineColor:'#101010',background:'none',position:'bottom',animation:'none'},framing_options:{mode:'fit',focusX:.5,focusY:.5,zoom:1},excluded_ranges:[],revision:2,hasMedia:true};
// Speech after the removed interval begins one second after its boundary.
clip.captions.push({start:17.5,end:23,text:'Antes depois agora.',words:[{start:17.5,end:18,text:'Antes'},{start:21,end:22,text:'depois'},{start:22,end:23,text:'agora.'}]});
const job={id:jobId,url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ',title:'Vídeo de exemplo',duration:180,replay_data:{status:'available',source:'youtube_most_replayed',message:'Mapa público de replay.',points:[{start:0,end:60,value:.2},{start:60,end:120,value:1},{start:120,end:180,value:.4}]},status:'review',created_at:'2026-11-17T12:00:00Z',clips:[clip]};
const discardedJob={id:'00000000-0000-4000-8000-000000000000',title:'Projeto já descartado',status:'discarded',created_at:'2026-11-17T15:00:00Z',clips:[]};
const fixture={cuts:{dependencies:{ready:true,details:[]},channels:[{id:channelId,name:'Canal de teste',identifier:'youtube',disabled:false}],jobs:[job,discardedJob]},scheduler:{paused:false,queue:{}},stats:{watches:0,pending:0,sent:0,attention:0},watches:[],publishing:{actions:[]}};
const actions=[],errors=[],stateRequests=[];let polls=0,leakDiscarded=true,discardGate=null,adjusted=null,recoveryMode='ready';
let releaseTextPreview;
const textPreviewGate=new Promise(resolve=>{releaseTextPreview=resolve;});
function statePage(url){
  const jobs=fixture.cuts.jobs.filter(item=>item.status!=='discarded').sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
  const limit=Math.max(1,Math.min(100,Number(url.searchParams.get('cutsLimit'))||10));
  const cursor=url.searchParams.get('cutsCursor'),offset=cursor?Math.max(0,jobs.findIndex(item=>cursor==='qa-after-'+item.id)+1):0;
  const pageJobs=jobs.slice(offset,offset+limit),hasMore=offset+limit<jobs.length,nextCursor=hasMore?'qa-after-'+pageJobs.at(-1).id:null;
  // A stale payload must not restore a previously discarded project in the UI.
  if(leakDiscarded){pageJobs.push(discardedJob);leakDiscarded=false;}
  return {...fixture,cuts:{...fixture.cuts,jobs:pageJobs,pagination:{limit,hasMore,nextCursor}}};
}
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1050},acceptDownloads:true});
page.on('pageerror',error=>errors.push(error.message));
// Distinct temporal colors prove the canvas holds the decoded selected frame,
// rather than merely copying currentTime before the asynchronous seek finishes.
async function phoneAt(sourceTime,color){
  await page.waitForFunction(({sourceTime,color})=>{
    const canvas=document.querySelector('#cut-phone-canvas');
    if(!canvas||canvas.dataset.seeking!=='false'||Math.abs(Number(canvas.dataset.sourceTime)-sourceTime)>.05)return false;
    const [red,green,blue]=canvas.getContext('2d').getImageData(canvas.width/2,canvas.height/2,1,1).data;
    return color==='blue'?blue>150&&red<60:color==='green'?green>80&&red<60:red>150&&blue<60;
  },{sourceTime,color});
}
async function seekPhone(outputTime){
  await page.locator('#cut-phone-seek').evaluate((range,value)=>{range.value=String(value);range.dispatchEvent(new Event('input',{bubbles:true}));},outputTime);
}

await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(path==='/api/state'){polls++;stateRequests.push(url);return route.fulfill({json:statePage(url)});}
  if(path==='/api/assistant/metadata/preview'){
    assert.equal(request.headers()['x-watcher-request'],'1');
    const {useAI,...input}=request.postDataJSON();
    assert.equal(useAI,false);
    await textPreviewGate;
    return route.fulfill({json:generateEditorial(input)});
  }
  if(path==='/api/cuts/'+clipId+'/media'&&url.searchParams.get('download')==='1')return route.continue();
  if(path.endsWith('/source')||path.endsWith('/media')){
    const range=request.headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),media.length-1):media.length-1;return route.fulfill({status:206,body:media.subarray(start,end+1),headers:{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${media.length}`,'Content-Length':String(end-start+1)}});}
    return route.fulfill({body:media,contentType:'video/mp4',headers:{'Accept-Ranges':'bytes'}});
  }
  if(path==='/api/cuts/jobs/'+jobId+'/source-status'){
    if(recoveryMode==='fail')return route.fulfill({json:{ready:false,status:'failed',error:'Falha de recuperação simulada.'}});
    const ready=recoveryMode==='ready';if(ready)job.hasSource=true;
    return route.fulfill({json:{ready,status:ready?'review':'downloading',duration:job.duration}});
  }
  if(path.endsWith('/transcript'))return route.fulfill({json:{captions:clip.captions,duration:job.duration,replay:job.replay_data}});
  assert.equal(request.headers()['x-watcher-request'],'1');const body=request.postDataJSON();actions.push({path,body,method:request.method()});
  if(path==='/api/cuts/jobs/'+jobId+'/prepare-source')return route.fulfill({json:{ready:false,status:'queued'}});
  if(path==='/api/cuts')fixture.cuts.jobs.unshift({id:'33333333-3333-4333-8333-333333333333',url:body.url,title:'Novo projeto',status:'queued',created_at:'2026-11-17T14:00:00Z',clips:[]});
  else if(path==='/api/cuts/'+clipId&&request.method()==='PUT'){
    if(['posted','publishing'].includes(clip.status)){
      adjusted={...structuredClone(clip),id:body.versionId,edited_from_cut_id:clip.id,title:body.title,start_seconds:body.start,end_seconds:body.end,framing_options:body.framingOptions,caption_style:body.captionStyle,excluded_ranges:body.excludedRanges,captions:body.captions||clip.captions,revision:1,status:'review',hasMedia:true,delivery_id:null,delivery_status:null,release_url:null,publications:[]};job.clips.push(adjusted);
      return route.fulfill({json:{ok:true,id:adjusted.id,createdVersion:true}});
    }
    Object.assign(clip,{title:body.title,start_seconds:body.start,end_seconds:body.end,framing:body.framing,framing_options:body.framingOptions,caption_style:body.captionStyle,excluded_ranges:body.excludedRanges,captions:body.captions||clip.captions,revision:clip.revision+1,status:'rendering',hasMedia:false});
  }
  else if(path==='/api/cuts/jobs/'+jobId+'/analyze'){job.replay_data.status='available';}
  else if(path==='/api/cuts/'+clipId+'/publish'){Object.assign(clip,{status:'publishing',delivery_id:'qa-delivery',delivery_status:'pending'});}
  else if(path.endsWith('/discard')){
    if(body.confirm!==true)return route.fulfill({status:400,json:{error:'Confirme o descarte.'}});
    if(discardGate)await discardGate;
    if(path==='/api/cuts/'+clipId+'/discard')Object.assign(clip,{status:'discarded',hasMedia:false});
    else{const item=fixture.cuts.jobs.find(item=>path==='/api/cuts/jobs/'+item.id+'/discard');assert(item,'discard target exists');item.status='discarded';}
  }
  else throw new Error('Unexpected API request: '+path);
  return route.fulfill({json:{ok:true}});
});
try{
  await page.goto(base+'/#cuts');
  await page.getByRole('heading',{name:'Gerador de cortes',exact:true}).waitFor();
  assert.equal(await page.locator('#breadcrumb').textContent(),'Gerador de cortes');
  assert.equal(await page.getByText('Projeto já descartado',{exact:true}).count(),0,'discarded projects stay hidden even in stale API data');
  await page.getByLabel('Link do vídeo no YouTube').fill('https://youtu.be/dQw4w9WgXcQ');
  await page.getByRole('button',{name:'Atualizar',exact:true}).click();
  assert.equal(await page.getByLabel('Link do vídeo no YouTube').inputValue(),'https://youtu.be/dQw4w9WgXcQ');
  await page.getByRole('button',{name:'Gerar cortes',exact:true}).click();
  await page.getByText('Novo projeto',{exact:true}).waitFor();
  assert.deepEqual(actions.at(-1),{path:'/api/cuts',method:'POST',body:{url:'https://youtu.be/dQw4w9WgXcQ',count:3,targetSeconds:60,language:'pt'}});

  const player=page.locator('[data-cut-clip="'+clipId+'"] video');
  await player.evaluate(async video=>{video.muted=true;video.loop=true;video.dataset.qa='preserved';await video.play();});
  job.title='Título atualizado durante o preview';
  await page.getByRole('button',{name:'Atualizar',exact:true}).click();
  assert.equal(await player.getAttribute('data-qa'),'preserved');
  assert.equal(await player.evaluate(video=>video.paused),false);
  await player.evaluate(video=>video.pause());
  await page.getByRole('button',{name:'Atualizar',exact:true}).click();
  await page.getByRole('heading',{name:'Título atualizado durante o preview'}).waitFor();

  await page.getByRole('button',{name:'Ajustar',exact:true}).click();
  const cutStart=page.getByLabel('Começo do corte',{exact:true}),cutEnd=page.getByLabel('Fim do corte',{exact:true});
  assert.equal(await cutStart.inputValue(),'00:10');assert.equal(await cutEnd.inputValue(),'00:40');
  const beforeInvalidTime=actions.length;
  await cutStart.fill('09:99');await page.getByRole('button',{name:'Salvar e gerar prévia',exact:true}).click();
  assert.equal(actions.length,beforeInvalidTime,'an invalid time must not submit an edit');
  assert.equal(await page.locator('#cuts-dialog').evaluate(dialog=>dialog.open),true);
  await cutStart.fill('0:09.250');await cutEnd.focus();
  assert.equal(await cutStart.inputValue(),'00:09,250','blur normalizes the time without losing milliseconds');
  await page.getByRole('button',{name:'Adiantar início em 1 segundo',exact:true}).click();assert.equal(await cutStart.inputValue(),'00:10,250');
  await page.getByRole('button',{name:'Voltar início em 1 segundo',exact:true}).click();assert.equal(await cutStart.inputValue(),'00:09,250');
  await cutStart.fill('00:10');await cutEnd.focus();
  await page.waitForFunction(()=>document.querySelector('#cut-source-player')?.readyState>=2);
  await page.locator('#cut-source-player').evaluate(async video=>{video.currentTime=12.345;await new Promise(resolve=>video.addEventListener('seeked',resolve,{once:true}));});
  await page.getByRole('button',{name:'Marcar início aqui',exact:true}).click();assert.equal(await cutStart.inputValue(),'00:12,345');
  await page.locator('#cut-source-player').evaluate(async video=>{video.currentTime=0;await new Promise(resolve=>video.addEventListener('seeked',resolve,{once:true}));});
  await page.getByRole('button',{name:'Marcar início aqui',exact:true}).click();assert.equal(await cutStart.inputValue(),'00:00','marking the beginning must use zero, not the previous seek position');
  await cutStart.fill('00:10');await cutEnd.focus();
  await page.locator('#cut-source-player').evaluate(async video=>{video.currentTime=38.765;await new Promise(resolve=>video.addEventListener('seeked',resolve,{once:true}));});
  await page.getByRole('button',{name:'Marcar fim aqui',exact:true}).click();assert.equal(await cutEnd.inputValue(),'00:38,765');
  await cutEnd.fill('00:40');await cutStart.focus();

  // Playback belongs to the phone itself and uses the same source clock.
  const phone=page.locator('.cuts-phone'),phonePlay=phone.locator('#cut-phone-play'),phoneSeek=phone.locator('#cut-phone-seek');
  assert.equal(await phonePlay.getAttribute('aria-label'),'Reproduzir prévia no celular');
  assert.equal(await phone.locator('#cut-phone-back').getAttribute('aria-label'),'Voltar 5 segundos na prévia');
  assert.equal(await phone.locator('#cut-phone-forward').getAttribute('aria-label'),'Avançar 5 segundos na prévia');
  assert.equal(await phoneSeek.getAttribute('step'),'0.001');
  assert.equal(Number(await phoneSeek.getAttribute('max')),30);
  await cutStart.fill('00:12,345');await cutEnd.focus();await phoneAt(12.345,'red');
  await cutStart.fill('00:10');await cutEnd.focus();await phoneAt(10,'red');
  await seekPhone(0);await phoneAt(10,'red');
  assert.equal(await phone.locator('#cut-phone-source-time').textContent(),'Original 00:10');
  await phone.locator('#cut-phone-back').click();await phoneAt(10,'red');
  await phone.locator('#cut-phone-forward').click();await phoneAt(15,'red');assert.equal(Number(await phoneSeek.inputValue()),5);
  await phone.locator('#cut-phone-back').click();await phoneAt(10,'red');
  await seekPhone(12.345);await phoneAt(22.345,'red');
  assert.equal(await phone.locator('#cut-phone-source-time').textContent(),'Original 00:22,345');
  await phonePlay.click();await page.waitForFunction(()=>!document.querySelector('#cut-source-player').paused);
  await page.waitForTimeout(220);await phonePlay.click();await page.waitForFunction(()=>document.querySelector('#cut-source-player').paused);
  const pausedPhoneTime=await page.locator('#cut-source-player').evaluate(video=>video.currentTime);
  await page.waitForTimeout(220);assert(Math.abs(await page.locator('#cut-source-player').evaluate(video=>video.currentTime)-pausedPhoneTime)<.01,'pause inside the phone must hold the source clock');
  const phoneCanvas=phone.locator('#cut-phone-canvas');
  await phoneCanvas.click({position:{x:40,y:80}});await page.waitForFunction(()=>!document.querySelector('#cut-source-player').paused);
  await phoneCanvas.click({position:{x:40,y:80}});await page.waitForFunction(()=>document.querySelector('#cut-source-player').paused);
  await phone.locator('#cut-phone-mute').click();assert.equal(await page.locator('#cut-source-player').evaluate(video=>video.muted),true);
  await phone.locator('#cut-phone-mute').click();assert.equal(await page.locator('#cut-source-player').evaluate(video=>video.muted),false);
  assert.equal(actions.length,beforeInvalidTime,'phone navigation must not submit or publish anything');

  // The replay curve selects the actual start, rather than centering a window.
  await revealEditorControl(page,'#cut-editor-replay');
  const replay=page.locator('#cut-editor-replay svg');
  await replay.scrollIntoViewIfNeeded();
  assert.equal(await replay.getAttribute('role'),'slider');
  assert.equal(await replay.getAttribute('aria-label'),'Selecionar início do corte no gráfico');
  let replayBox=await replay.boundingBox();assert(replayBox);
  await replay.evaluate(svg=>svg.addEventListener('pointerdown',event=>{svg.dataset.qaPointer=String(event.clientX);},{once:true}));
  await page.mouse.click(replayBox.x+replayBox.width*.75,replayBox.y+replayBox.height*.45);
  const selected=replayTimeAt(Number(await replay.getAttribute('data-qa-pointer')),{left:replayBox.x,width:replayBox.width},job.duration);
  assert.equal(parseTimecode(await cutStart.inputValue()),selected,'the clicked time is the beginning, with no subtraction');
  assert.equal(parseTimecode(await cutEnd.inputValue()),Number((selected+30).toFixed(3)));
  assert.equal(Number(await replay.getAttribute('aria-valuenow')),selected);
  assert.equal(await replay.locator('.cuts-replay-marker').count(),1);
  assert((await page.locator('#cut-replay-selected').textContent()).includes(await cutStart.inputValue()));
  await page.waitForFunction(time=>Math.abs(document.querySelector('#cut-source-player').currentTime-time)<.02,selected);
  await phoneAt(selected,'blue');
  assert.equal(await phone.locator('#cut-phone-source-time').textContent(),'Original '+formatTimecode(selected));
  assert.equal(Number(await phoneSeek.inputValue()),0,'selecting the beginning from replay moves the phone to the beginning too');

  await mkdir('artifacts',{recursive:true});await page.locator('.cuts-replay-details').screenshot({path:'artifacts/cuts-replay-picker.png'});
  const preservedEnd=parseTimecode(await cutEnd.inputValue());
  await replay.scrollIntoViewIfNeeded();replayBox=await replay.boundingBox();assert(replayBox);
  await replay.evaluate(svg=>svg.addEventListener('pointerdown',event=>{svg.dataset.qaPointer=String(event.clientX);},{once:true}));
  await page.mouse.click(replayBox.x+replayBox.width*.25,replayBox.y+replayBox.height*.55);
  const earlier=replayTimeAt(Number(await replay.getAttribute('data-qa-pointer')),{left:replayBox.x,width:replayBox.width},job.duration);
  assert.equal(parseTimecode(await cutStart.inputValue()),earlier);assert.equal(parseTimecode(await cutEnd.inputValue()),preservedEnd,'a later end stays in place');
  await phoneAt(earlier,'red');
  const rapid=await replay.evaluate(svg=>{
    const rect=svg.getBoundingClientRect();
    for(const fraction of [.75,.25])for(const type of ['pointerdown','pointerup'])svg.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:71,pointerType:'mouse',isPrimary:true,button:0,clientX:rect.left+rect.width*fraction,clientY:rect.top+rect.height*.5}));
    return {clientX:rect.left+rect.width*.25,left:rect.left,width:rect.width};
  });
  const finalRapidTime=replayTimeAt(rapid.clientX,{left:rapid.left,width:rapid.width},job.duration);
  await phoneAt(finalRapidTime,'red');
  assert.equal(parseTimecode(await cutStart.inputValue()),finalRapidTime,'the last rapid graph selection wins over stale decoded frames');

  await replay.focus();await replay.press('ArrowRight');assert.equal(parseTimecode(await cutStart.inputValue()),Number((finalRapidTime+.1).toFixed(3)));
  await replay.press('Alt+ArrowRight');assert.equal(parseTimecode(await cutStart.inputValue()),Number((finalRapidTime+.101).toFixed(3)));
  await replay.press('Home');assert.equal(await cutStart.inputValue(),'00:00','the graph itself also supports keyboard selection');
  await replay.scrollIntoViewIfNeeded();replayBox=await replay.boundingBox();assert(replayBox);
  await replay.evaluate(svg=>svg.addEventListener('pointermove',event=>{svg.dataset.qaDrag=String(event.clientX);}));
  await page.mouse.move(replayBox.x+replayBox.width*.3,replayBox.y+replayBox.height*.5);await page.mouse.down();
  await page.mouse.move(replayBox.x+replayBox.width*.6,replayBox.y+replayBox.height*.5,{steps:5});await page.mouse.up();
  const dragged=replayTimeAt(Number(await replay.getAttribute('data-qa-drag')),{left:replayBox.x,width:replayBox.width},job.duration);
  assert.equal(parseTimecode(await cutStart.inputValue()),dragged,'dragging the curve updates the selected beginning');
  const replayRange=page.locator('#cut-replay-position');
  assert.equal(await replayRange.getAttribute('step'),'0.001');
  await replayRange.focus();await replayRange.press('ArrowRight');
  assert.equal(parseTimecode(await cutStart.inputValue()),Number((dragged+.001).toFixed(3)));
  await replayRange.press('Home');assert.equal(await cutStart.inputValue(),'00:00');
  await replayRange.press('End');assert.equal(parseTimecode(await cutStart.inputValue()),179.5);assert.equal(parseTimecode(await cutEnd.inputValue()),180);
  assert.equal(actions.length,beforeInvalidTime,'graph selection edits the draft without posting or saving');
  await revealEditorControl(page,'#cut-edit-start');
  await cutStart.fill('00:10');await cutEnd.fill('00:40');await cutStart.focus();
  await page.getByLabel('Título do corte',{exact:true}).fill('Título revisado');
  const before=polls;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(200);assert(polls>before);
  assert.equal(await page.getByLabel('Título do corte',{exact:true}).inputValue(),'Título revisado');
  await revealEditorControl(page,'#cuts-cues');await page.getByLabel('Texto da legenda 1',{exact:true}).fill('Palavra corrigida, fiel ao áudio.');
  assert.equal(await page.getByLabel('Início da legenda 1',{exact:true}).inputValue(),'00:00,001','caption timestamps use the phone timeline, not the source clock');
  assert.equal(await page.getByLabel('Fim da legenda 1',{exact:true}).inputValue(),'00:03');
  await page.getByLabel('Fim da legenda 1',{exact:true}).fill('00:03,125');
  await revealEditorControl(page,'#cut-framing');await page.getByLabel('Enquadramento',{exact:true}).selectOption('crop');
  await seekPhone(0);await phoneAt(10,'red');
  const zoom=page.getByLabel('Zoom',{exact:false});
  for(const value of ['0.25','0.5','1.5']){
    await zoom.fill(value);
    await page.waitForFunction(value=>{
      const ctx=document.querySelector('#cut-phone-canvas').getContext('2d');
      const pixel=(x,y)=>Array.from(ctx.getImageData(x,y,1,1).data).slice(0,3);
      const black=(x,y)=>pixel(x,y).every(c=>c<20),red=(x,y)=>pixel(x,y)[0]>150;
      return red(360,640)&&(value==='1.5'?red(360,100):black(360,100)&&black(50,640))&&(value==='0.25'?black(240,640):red(240,640));
    },value);
  }
  await page.getByLabel('Foco horizontal').fill('80');await page.getByLabel('Foco vertical').fill('20');await zoom.fill('0.5');
  await revealEditorControl(page,'#cut-font-size');await page.getByLabel('Tamanho da legenda').fill('58');await page.getByLabel('Cor do texto',{exact:true}).fill('#00ffcc');
  await page.getByLabel('Cor de destaque',{exact:true}).fill('#ffcc00');await page.getByLabel('Cor do contorno',{exact:true}).fill('#102030');
  await revealEditorControl(page,'#cut-caption-animation');await page.getByLabel('Animação da legenda').selectOption('karaoke');await page.getByLabel('Posição da legenda').selectOption('top');
  await page.getByLabel('Fundo da legenda').selectOption('box');
  await revealEditorControl(page,'#cut-remove-start');await page.getByLabel('Remover a partir de',{exact:true}).fill('00:18');await page.getByLabel('Remover até',{exact:true}).fill('00:20');
  await page.getByRole('button',{name:'Remover este trecho',exact:true}).click();
  assert.equal(await page.locator('#cut-final-duration').textContent(),'00:28 de vídeo');
  await page.getByRole('button',{name:'Restaurar trecho 1',exact:true}).click();assert.equal(await page.locator('#cut-final-duration').textContent(),'00:30 de vídeo');
  await page.getByRole('button',{name:'Remover este trecho',exact:true}).click();
  assert.equal(Number(await phoneSeek.getAttribute('max')),28);
  assert.equal(await page.getByLabel('Início da legenda 3',{exact:true}).inputValue(),'00:07,500');
  assert.equal(await page.getByLabel('Fim da legenda 3',{exact:true}).inputValue(),'00:08','a caption ending at the junction stays in the previous source segment');
  assert.equal(await page.getByLabel('Texto da legenda 3',{exact:true}).inputValue(),'Antes');
  assert.equal(await page.getByLabel('Início da legenda 4',{exact:true}).inputValue(),'00:09');
  assert.equal(await page.getByLabel('Fim da legenda 4',{exact:true}).inputValue(),'00:11');
  assert.equal(await page.getByLabel('Texto da legenda 4',{exact:true}).inputValue(),'depois agora.');
  // Trimming a cue at a gap must not display its retained words before speech.
  const phoneCaption=phone.locator('#cut-phone-caption');
  await seekPhone(7.75);await phoneAt(17.75,'red');
  assert.equal(await phoneCaption.isVisible(),true);assert.equal(await phone.locator('#cut-phone-caption-text').textContent(),'Antes');
  await seekPhone(8.5);await phoneAt(20.5,'red');
  assert.equal(await phoneCaption.isHidden(),true,'a cropped caption waits for the first retained word after the gap');
  await seekPhone(9.25);await phoneAt(21.25,'red');
  assert.equal(await phoneCaption.isVisible(),true);assert.equal(await phone.locator('#cut-phone-caption-text').textContent(),'depois agora.');
  const captionsEnabled=page.getByRole('checkbox',{name:'Exibir legendas no vídeo',exact:true});
  await revealEditorControl(page,'#cut-captions-enabled');
  assert.equal(await captionsEnabled.isChecked(),true,'existing cuts keep captions enabled');
  await captionsEnabled.uncheck();
  assert.equal(await phoneCaption.isHidden(),true,'disabling captions immediately removes the phone overlay');
  assert.equal(await page.getByLabel('Texto da legenda 1',{exact:true}).inputValue(),'Palavra corrigida, fiel ao áudio.');
  await captionsEnabled.check();assert.equal(await phoneCaption.isVisible(),true,'enabling captions restores the current cue');
  await captionsEnabled.uncheck();
  await seekPhone(8);await phoneAt(20,'red');
  assert.equal(await phone.locator('#cut-phone-source-time').textContent(),'Original 00:20');
  assert.equal(Number(await phoneSeek.inputValue()),8,'scrubbing across a removed interval uses the edited timeline');
  await phone.locator('#cut-phone-back').click();await phoneAt(13,'red');assert.equal(Number(await phoneSeek.inputValue()),3);
  await phone.locator('#cut-phone-forward').click();await phoneAt(20,'red');
  await seekPhone(0);await phoneAt(10,'red');
  await phoneSeek.focus();await phoneSeek.press('End');
  await page.waitForFunction(()=>Math.abs(document.querySelector('#cut-source-player').currentTime-40)<.05);
  assert.equal(Number(await phoneSeek.inputValue()),28);assert.equal(await page.locator('#cut-source-player').evaluate(video=>video.paused),true);
  await page.waitForFunction(()=>document.querySelector('#cut-source-player')?.readyState>=2);
  await page.locator('#cut-source-player').evaluate(async video=>{video.muted=true;video.currentTime=17.9;await new Promise(resolve=>video.addEventListener('seeked',resolve,{once:true}));});
  await page.getByRole('button',{name:'Reproduzir prévia no celular',exact:true}).click();await page.waitForTimeout(700);
  assert(await page.locator('#cut-source-player').evaluate(video=>video.currentTime>=20),'preview must skip the removed interval: '+await page.locator('#cut-source-player').evaluate(v=>JSON.stringify({t:v.currentTime,paused:v.paused,ready:v.readyState,duration:v.duration})));
  await page.getByRole('button',{name:'Pausar prévia no celular',exact:true}).click();
  await page.locator('#cut-source-player').evaluate(async v=>{v.currentTime=14.5;await new Promise(r=>v.addEventListener('seeked',r,{once:true}));});
  await page.locator('#cuts-dialog-form').evaluate(form=>form.scrollTop=0);
  for(const viewport of [{width:1440,height:900},{width:1366,height:768}]){
    await page.setViewportSize(viewport);
    const ratio=await page.locator('#cut-phone-canvas').evaluate(canvas=>{const r=canvas.getBoundingClientRect();return r.width/r.height;});
    assert(Math.abs(ratio-9/16)<.002,'phone canvas should remain 9:16 at '+viewport.width+'x'+viewport.height);
  }
  await page.setViewportSize({width:1440,height:1050});
  await revealEditorControl(page,'#cut-font-size');await page.locator('#cuts-dialog-form').evaluate(form=>form.scrollTop=0);
  await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/cuts-editor-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(await page.locator('#cuts-dialog-form').evaluate(form=>form.scrollWidth>form.clientWidth+1),false);
  assert(Math.abs(await page.locator('#cut-phone-canvas').evaluate(c=>c.getBoundingClientRect().width/c.getBoundingClientRect().height)-9/16)<.002);
  await page.locator('#cuts-dialog-form').evaluate(form=>form.scrollTop=0);await page.screenshot({path:'artifacts/cuts-editor-mobile.png'});
  await revealEditorControl(page,'#cut-caption-animation');await page.locator('[data-editor-tab="cut-editor-captions"]').click();await page.screenshot({path:'artifacts/cuts-editor-subtabs-mobile.png'});
  await page.setViewportSize({width:1440,height:1050});
  await page.getByRole('button',{name:'Salvar e gerar prévia',exact:true}).click();
  await page.getByText('Atualizando prévia',{exact:true}).waitFor();
  assert.equal(actions.at(-1).method,'PUT');assert.equal(actions.at(-1).body.revision,2);assert.equal(actions.at(-1).body.captions[0].text,'Palavra corrigida, fiel ao áudio.');assert.equal(actions.at(-1).body.framing,'crop');
  assert.deepEqual(actions.at(-1).body.framingOptions,{format:'shorts',mode:'crop',focusX:.8,focusY:.2,zoom:.5});
  assert.deepEqual(actions.at(-1).body.captionStyle,{enabled:false,fontSize:58,color:'#00ffcc',highlightColor:'#ffcc00',outlineColor:'#102030',background:'box',position:'top',animation:'karaoke'});
  assert.deepEqual(actions.at(-1).body.excludedRanges,[{start:18,end:20}]);
  assert.equal(actions.at(-1).body.start,10);assert.equal(actions.at(-1).body.end,40);assert.equal(actions.at(-1).body.captions[0].start,10.001);
  assert.equal(actions.at(-1).body.captions[0].end,13.125,'editing a caption at 00:03,125 maps back to the original 00:13,125');
  assert.equal(actions.at(-1).body.captions[0].words,undefined);assert.deepEqual(actions.at(-1).body.captions[1].words,clip.captions[1].words);
  Object.assign(clip,{status:'review',hasMedia:true});await page.getByRole('button',{name:'Atualizar',exact:true}).click();
  await page.getByRole('button',{name:'Ajustar',exact:true}).click();
  assert.equal(await page.getByLabel('Zoom',{exact:false}).inputValue(),'0.5','reopening the editor preserves a saved zoom below 1×');
  await revealEditorControl(page,'#cut-captions-enabled');
  assert.equal(await captionsEnabled.isChecked(),false,'reopening the editor preserves disabled captions');
  assert.equal(await page.getByLabel('Texto da legenda 1',{exact:true}).inputValue(),'Palavra corrigida, fiel ao áudio.');
  await captionsEnabled.check();
  await revealEditorControl(page,'#cut-edit-start');
  await page.getByLabel('Começo do corte',{exact:true}).fill('00:09');await page.getByLabel('Fim do corte',{exact:true}).focus();
  await revealEditorControl(page,'#cuts-cues');assert.equal(await page.getByRole('checkbox',{name:/Usar a transcrição original/}).isChecked(),false);
  await page.getByRole('button',{name:'Salvar e gerar prévia',exact:true}).click();
  await page.getByText('Atualizando prévia',{exact:true}).waitFor();assert.equal('captions' in actions.at(-1).body,false);assert.equal(actions.at(-1).body.useOriginalCaptions,false);
  assert.equal(actions.at(-1).body.captionStyle.enabled,true);
  assert.equal(actions.at(-1).body.start,9);assert.equal(actions.at(-1).body.end,40);
  Object.assign(clip,{status:'review',hasMedia:true});await page.getByRole('button',{name:'Atualizar',exact:true}).click();

  await page.getByRole('button',{name:'Buscar momentos mais revistos',exact:true}).click();
  assert.equal(actions.at(-1).path,'/api/cuts/jobs/'+jobId+'/analyze');assert.equal(job.clips.length,1);
  const graphButton=page.getByRole('button',{name:'Inspecionar momentos mais revistos deste vídeo'}),cardGraph=graphButton.locator('svg');
  await cardGraph.scrollIntoViewIfNeeded();const cardBox=await cardGraph.boundingBox();assert(cardBox);
  await cardGraph.evaluate(svg=>svg.addEventListener('click',event=>{window.__qaCardReplayX=event.clientX;},{once:true}));
  const beforeGraphSelect=actions.length;
  await page.mouse.click(cardBox.x+cardBox.width*.75,cardBox.y+cardBox.height*.45);
  await page.getByRole('heading',{name:'Editar corte',exact:true}).waitFor();
  const clickedCardTime=replayTimeAt(await page.evaluate(()=>window.__qaCardReplayX),{left:cardBox.x,width:cardBox.width},job.duration);
  assert.equal(parseTimecode(await page.getByLabel('Começo do corte',{exact:true}).inputValue()),clickedCardTime,'the card graph also starts precisely at the clicked time');
  assert.equal(actions.length,beforeGraphSelect,'opening a selection from the card must not save it');
  await page.locator('#cuts-dialog .dialog-head [data-cuts-action="close-dialog"]').click();
  clip.publicationText={
    youtube:{title:'Sugestão para YouTube',description:'Descrição para YouTube',hashtags:['Shorts'],tags:['corte']},
    tiktok:{title:'Sugestão para TikTok',description:'Descrição para TikTok',hashtags:['corte'],tags:[]},
  };
  await Promise.all([
    page.waitForResponse(response=>response.url().includes('/api/state')),
    page.getByRole('button',{name:'Atualizar',exact:true}).click(),
  ]);
  const beforePublish=actions.length;
  await page.getByRole('button',{name:'Postar',exact:true}).click();assert.equal(actions.length,beforePublish);
  const platform=page.getByLabel('Onde postar?'),description=page.getByLabel('Descrição',{exact:true});
  assert.equal(await description.inputValue(),'Descrição para YouTube');
  await page.locator('#cut-post-title').fill('Título revisado');
  await platform.selectOption('tiktok');
  assert.equal(await description.inputValue(),'Descrição para TikTok');
  assert.equal(await page.locator('#cut-post-tags').isDisabled(),true);
  await platform.selectOption('youtube');
  assert.equal(await description.inputValue(),'Descrição para YouTube');
  assert.equal(await page.locator('#cut-post-title').inputValue(),'Título revisado');
  delete clip.publicationText;
  const publishFormat=page.getByLabel('Publicar como',{exact:true}),authorize=page.getByRole('button',{name:'Autorizar e enviar',exact:true});
  assert.equal(await publishFormat.inputValue(),'shorts');
  await publishFormat.selectOption('video');
  assert.equal(await authorize.isDisabled(),true,'changing format requires a new reviewed preview');
  assert.equal(await page.locator('#cut-format-change').isVisible(),true);
  await page.locator('#cuts-dialog-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  await page.waitForTimeout(80);assert.equal(actions.length,beforePublish,'a form event cannot upload the previous format');
  await publishFormat.selectOption('shorts');assert.equal(await authorize.isDisabled(),false);
  await publishFormat.selectOption('video');await page.getByRole('button',{name:'Ajustar formato',exact:true}).click();
  const editorFormat=page.getByLabel('Formato no YouTube',{exact:true});
  assert.equal(await editorFormat.inputValue(),'video');assert.equal(actions.length,beforePublish,'choosing a format opens a draft without publishing');
  await revealEditorControl(page,'#cut-framing');await page.getByLabel('Enquadramento',{exact:true}).selectOption('fit');
  await seekPhone(0);await phoneAt(9,'red');
  for(const viewport of [{width:1440,height:1050},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    const dimensions=await page.locator('#cut-phone-canvas').evaluate(canvas=>({width:canvas.width,height:canvas.height,ratio:canvas.getBoundingClientRect().width/canvas.getBoundingClientRect().height}));
    assert.equal(dimensions.width,1920);assert.equal(dimensions.height,1080);assert(Math.abs(dimensions.ratio-16/9)<.002);
    assert.equal(await page.locator('#cuts-dialog-form').evaluate(form=>form.scrollWidth>form.clientWidth+1),false,'horizontal previews fit desktop and mobile');
  }
  await page.setViewportSize({width:1440,height:1050});
  await revealEditorControl(page,'#cut-format');await editorFormat.scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/cuts-editor-horizontal.png'});
  await editorFormat.selectOption('shorts');assert.equal(await page.locator('#cut-phone-canvas').getAttribute('width'),'720');
  await editorFormat.selectOption('video');
  await page.getByRole('button',{name:'Salvar e gerar prévia',exact:true}).click();await page.getByText('Atualizando prévia',{exact:true}).waitFor();
  assert.equal(actions.at(-1).body.framingOptions.format,'video');assert.equal(actions.at(-1).method,'PUT');
  Object.assign(clip,{status:'review',hasMedia:true});await page.getByRole('button',{name:'Atualizar',exact:true}).click();
  await page.getByRole('button',{name:'Ajustar',exact:true}).click();assert.equal(await editorFormat.inputValue(),'video','the saved format persists when reopening');
  await page.locator('#cuts-dialog .dialog-head [data-cuts-action="close-dialog"]').click();
  await page.getByRole('button',{name:'Postar',exact:true}).click();
  assert.equal(await publishFormat.inputValue(),'video');assert.equal(await page.getByLabel('Descrição',{exact:true}).inputValue(),'','regular videos do not get the Shorts description');
  const beforeTextGeneration=actions.length;
  await page.getByRole('checkbox',{name:/Revisei o vídeo e a legenda/}).check();
  const generateText=page.getByRole('button',{name:'Gerar título, descrição e tags',exact:true});
  await Promise.all([page.waitForRequest(request=>request.url().endsWith('/assistant/metadata/preview')),generateText.click()]);
  assert.equal(await generateText.isDisabled(),true);
  assert.equal(await authorize.isDisabled(),true);
  await page.locator('#cut-post-title').fill('Título editado durante a geração');
  releaseTextPreview();
  await page.waitForFunction(()=>Boolean(document.querySelector('#cut-post-tags').value));
  assert.equal(actions.length,beforeTextGeneration,'text generation does not create a publication');
  assert.equal(await page.getByRole('checkbox',{name:/Revisei o vídeo e a legenda/}).isChecked(),false,'generated text requires a new explicit review');
  assert.equal(await page.locator('#cut-post-title').inputValue(),'Título editado durante a geração');
  assert((await page.getByLabel('Descrição',{exact:true}).inputValue()).length>0);
  assert.equal(await page.getByLabel('Canal do YouTube').inputValue(),'');
  await page.getByLabel('Canal do YouTube').selectOption(channelId);
  await page.getByLabel('Visibilidade',{exact:true}).selectOption('public');
  await page.getByRole('checkbox',{name:/Revisei o vídeo e a legenda/}).check();
  await page.getByRole('button',{name:'Autorizar e enviar',exact:true}).click();
  await page.getByText('Na fila de envio',{exact:true}).waitFor();
  assert.equal(actions.at(-1).path,'/api/cuts/'+clipId+'/publish');assert.equal(actions.at(-1).body.revision,5);assert.equal(actions.at(-1).body.format,'video');assert.equal(actions.at(-1).body.channelId,channelId);assert.equal(actions.at(-1).body.visibility,'public');assert.equal(actions.at(-1).body.confirm,true);
  assert.equal(actions.at(-1).body.title,'Título editado durante a geração');
  assert(actions.at(-1).body.youtubeTags.length>0);
  Object.assign(clip,{status:'posted',hasMedia:true,delivery_status:'published',release_url:'https://www.youtube.com/watch?v=qa123'});job.status='completed';await page.getByRole('button',{name:'Atualizar',exact:true}).click();
  await page.getByText('Publicado no YouTube',{exact:true}).waitFor();assert.equal(await page.locator('[data-cut-clip] video').count(),1);
  assert.equal(await page.getByRole('button',{name:'Postar',exact:true}).count(),1,'um corte enviado continua disponível para outro destino');
  // Editing an uploaded cut opens the same controls and saves a separate review version.
  assert.equal(await page.getByRole('button',{name:'Ajustar',exact:true}).count(),1);
  const beforePostedEdit=actions.length,postedSnapshot=structuredClone(clip);
  await page.getByRole('button',{name:'Ajustar',exact:true}).click();
  await page.getByText(/Ao salvar, será criada uma nova versão/).waitFor();
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();assert.equal(actions.length,beforePostedEdit,'cancel does not create a copy');
  await page.getByRole('button',{name:'Ajustar',exact:true}).click();
  await page.getByLabel('Título do corte',{exact:true}).fill('Versão para outra montagem');
  await page.getByRole('button',{name:'Salvar e gerar prévia',exact:true}).click();
  await page.getByRole('heading',{name:'Versão para outra montagem',exact:true}).waitFor();
  assert.deepEqual(clip,postedSnapshot,'the uploaded cut and publication link remain unchanged');
  assert.match(actions.at(-1).body.versionId,/^[a-f0-9-]{36}$/);assert.equal(adjusted.edited_from_cut_id,clipId);
  assert.equal(await page.getByText('Versão ajustada',{exact:true}).count(),1);
  const copyCard=page.locator(`[data-cut-clip="${adjusted.id}"]`);assert.equal(await copyCard.getByRole('button',{name:'Ajustar',exact:true}).count(),1);
  await copyCard.getByRole('button',{name:'Ajustar',exact:true}).click();assert.equal(await page.locator('.cuts-version-notice').count(),0,'an unsent copy stays editable in place');await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  job.clips=[clip];adjusted=null;job.hasSource=false;recoveryMode='hold';await page.getByRole('button',{name:'Atualizar',exact:true}).click();
  await page.getByRole('button',{name:'Ajustar',exact:true}).waitFor();
  const beforeRecovery=actions.filter(action=>action.method==='PUT').length;
  await page.getByRole('button',{name:'Ajustar',exact:true}).click();await page.getByRole('heading',{name:'Recuperar vídeo para ajustar',exact:true}).waitFor();
  await page.getByText(/download usa a melhor qualidade/).waitFor();assert.equal(await page.getByRole('button',{name:'Salvar e gerar prévia',exact:true}).count(),0);
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();await page.waitForTimeout(1200);assert.equal(await page.locator('#cuts-dialog').isVisible(),false,'a cancelled source wait cannot reopen the editor');
  recoveryMode='fail';await page.getByRole('button',{name:'Ajustar',exact:true}).click();await page.getByText('Falha de recuperação simulada.',{exact:true}).waitFor();
  assert.equal(actions.filter(action=>action.method==='PUT').length,beforeRecovery);assert.equal(adjusted,null);
  recoveryMode='ready';await page.getByRole('button',{name:'Tentar recuperar novamente',exact:true}).click();await page.getByRole('heading',{name:'Editar corte',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Título do corte',{exact:true}).inputValue(),clip.title);await phoneAt(clip.start_seconds,clip.start_seconds>=120?'blue':clip.start_seconds>=60?'green':'red');
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();assert.equal(actions.filter(action=>action.method==='PUT').length,beforeRecovery);
  assert.deepEqual(clip,postedSnapshot,'recovering the original does not change the uploaded cut');
  const downloadLink=page.getByRole('link',{name:'Baixar MP4',exact:true});
  assert((await downloadLink.getAttribute('href')).includes('/api/cuts/'+clipId+'/media'));
  const [download]=await Promise.all([page.waitForEvent('download'),downloadLink.click()]);
  assert.deepEqual(await readFile(await download.path()),media,'the posted cut remains downloadable for another platform');

  await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/cuts-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/cuts-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  const postedConfirmation=page.getByRole('alertdialog'),beforePostedDiscard=actions.length;
  await page.getByRole('button',{name:'Excluir arquivo',exact:true}).click();
  await postedConfirmation.getByRole('heading',{name:'Excluir arquivo?',exact:true}).waitFor();
  assert.equal(actions.length,beforePostedDiscard);assert((await postedConfirmation.locator('#confirm-discard-message').textContent()).includes('publicações já existentes'));
  await postedConfirmation.getByRole('button',{name:'Cancelar',exact:true}).click();await postedConfirmation.waitFor({state:'hidden'});
  assert.equal(actions.length,beforePostedDiscard);assert.equal(clip.hasMedia,true);
  await page.getByRole('button',{name:'Excluir arquivo',exact:true}).click();
  await postedConfirmation.getByRole('button',{name:'Excluir arquivo',exact:true}).click();await postedConfirmation.waitFor({state:'hidden'});
  await downloadLink.waitFor({state:'hidden'});assert.equal(actions.at(-1).path,'/api/cuts/'+clipId+'/discard');assert.deepEqual(actions.at(-1).body,{confirm:true});
  assert.equal(clip.release_url,'https://www.youtube.com/watch?v=qa123','manual file deletion keeps the publication link');
  Object.assign(clip,{status:'review',hasMedia:true,delivery_id:null,delivery_status:null,release_url:null});await page.getByRole('button',{name:'Atualizar',exact:true}).click();
  const confirmation=page.getByRole('alertdialog'),beforeDiscard=actions.length;
  await page.getByRole('button',{name:'Descartar',exact:true}).click();
  await confirmation.getByRole('heading',{name:'Descartar corte?',exact:true}).waitFor();
  assert.equal(await confirmation.locator('#confirm-discard-name').textContent(),clip.title);
  assert.equal(actions.length,beforeDiscard,'opening confirmation must not discard a clip');
  await page.screenshot({path:'artifacts/cuts-confirm-discard-mobile.png'});
  await confirmation.getByRole('button',{name:'Cancelar',exact:true}).click();await confirmation.waitFor({state:'hidden'});
  assert.equal(actions.length,beforeDiscard,'cancelling confirmation must not send a request');assert.equal(clip.status,'review');
  await page.getByRole('button',{name:'Descartar',exact:true}).click();await confirmation.waitFor();
  await page.keyboard.press('Escape');await confirmation.waitFor({state:'hidden'});
  assert.equal(actions.length,beforeDiscard,'Escape must not send a discard request');
  await page.getByRole('button',{name:'Descartar',exact:true}).click();await confirmation.waitFor();
  let releaseDiscard;discardGate=new Promise(resolve=>{releaseDiscard=resolve;});
  await confirmation.getByRole('button',{name:'Descartar corte',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#confirm-discard-dialog').getAttribute('aria-busy')==='true');
  assert(await confirmation.getByRole('button',{name:'Cancelar',exact:true}).isDisabled());assert(await confirmation.getByRole('button',{name:'Descartando…',exact:true}).isDisabled());
  await page.keyboard.press('Escape');assert(await confirmation.isVisible(),'confirmation stays locked until submission finishes');
  releaseDiscard();discardGate=null;await confirmation.waitFor({state:'hidden'});await page.getByText('Descartado',{exact:true}).waitFor();
  assert.equal(actions.at(-1).path,'/api/cuts/'+clipId+'/discard');assert.deepEqual(actions.at(-1).body,{confirm:true});assert.equal(await page.getByRole('button',{name:'Postar',exact:true}).count(),0);

  // More than one page stays bounded, and page navigation preserves the draft form.
  for(let i=0;i<11;i++)fixture.cuts.jobs.push({id:'qa-old-'+String(i).padStart(2,'0'),url:'https://youtu.be/dQw4w9WgXcQ',title:'Projeto antigo '+i,status:'queued',created_at:new Date(Date.UTC(2026,10,16,12,0,0)-i*1000).toISOString(),clips:[]});
  await page.getByRole('button',{name:'Atualizar',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-cut-job]').length===10);
  assert.equal(await page.locator('[data-cut-job]').count(),10);
  assert.equal(await page.getByText('Projeto já descartado',{exact:true}).count(),0);
  await page.getByLabel('Link do vídeo no YouTube').fill('https://youtu.be/dQw4w9WgXcQ');
  const nextPage=page.locator('[data-pagination-scope="cuts"][data-pagination-direction="next"]');
  await nextPage.click();await page.getByRole('heading',{name:'Projeto antigo 8',exact:true}).waitFor();
  assert.equal(await page.locator('[data-cut-job]').count(),3);
  assert(stateRequests.at(-1).searchParams.get('cutsCursor'),'next page uses the API cursor');
  assert.equal(await page.getByLabel('Link do vídeo no YouTube').inputValue(),'https://youtu.be/dQw4w9WgXcQ');
  await page.locator('[data-pagination-scope="cuts"][data-pagination-direction="prev"]').click();
  await page.getByRole('heading',{name:'Novo projeto',exact:true}).waitFor();assert.equal(await page.locator('[data-cut-job]').count(),10);
  const projectCard=page.locator('[data-cut-job="33333333-3333-4333-8333-333333333333"]');
  const beforeProjectDiscard=actions.length;
  await projectCard.getByRole('button',{name:'Descartar projeto e liberar arquivos',exact:true}).click();
  await confirmation.getByRole('heading',{name:'Descartar projeto?',exact:true}).waitFor();
  assert.equal(await confirmation.locator('#confirm-discard-name').textContent(),'Novo projeto');
  assert((await confirmation.locator('#confirm-discard-message').textContent()).includes('publicações já existentes'));
  assert.equal(actions.length,beforeProjectDiscard);
  await confirmation.getByRole('button',{name:'Cancelar',exact:true}).click();await confirmation.waitFor({state:'hidden'});assert.equal(actions.length,beforeProjectDiscard);
  await projectCard.getByRole('button',{name:'Descartar projeto e liberar arquivos',exact:true}).click();await confirmation.waitFor();
  await page.keyboard.press('Escape');await confirmation.waitFor({state:'hidden'});assert.equal(actions.length,beforeProjectDiscard);
  await projectCard.getByRole('button',{name:'Descartar projeto e liberar arquivos',exact:true}).click();await confirmation.waitFor();
  await confirmation.getByRole('button',{name:'Descartar projeto',exact:true}).click();await confirmation.waitFor({state:'hidden'});
  await projectCard.waitFor({state:'detached'});
  assert.equal(actions.at(-1).path,'/api/cuts/jobs/33333333-3333-4333-8333-333333333333/discard');assert.deepEqual(actions.at(-1).body,{confirm:true});
  assert.equal(await page.locator('[data-cut-job]').count(),10,'discard refills the page from the API');
  await page.getByRole('button',{name:'Atualizar',exact:true}).click();assert.equal(await page.getByRole('heading',{name:'Novo projeto',exact:true}).count(),0,'discarded projects remain absent after refresh');
  fixture.cuts.jobs.find(item=>item.id==='qa-old-09').status='discarded';
  await page.locator('[data-pagination-scope="cuts"][data-pagination-direction="next"]').click();
  await page.getByRole('heading',{name:'Projeto antigo 10',exact:true}).waitFor();assert.equal(await page.locator('[data-cut-job]').count(),1);
  await page.locator('[data-cut-job="qa-old-10"] [data-cuts-action="discard-job"]').click();await confirmation.waitFor();
  await confirmation.getByRole('button',{name:'Descartar projeto',exact:true}).click();await confirmation.waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelectorAll('[data-cut-job]').length===10);
  assert.equal(stateRequests.at(-1).searchParams.has('cutsCursor'),false,'discarding the last item returns to a populated first page');
  assert.equal(await page.locator('[data-cut-job="qa-old-10"]').count(),0);
  fixture.cuts.dependencies={ready:false,details:['Python de transcrição não está disponível.']};await page.getByRole('button',{name:'Atualizar',exact:true}).click();
  await page.getByText('Preparação necessária',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'Gerar cortes',exact:true}).isDisabled());
  assert.deepEqual(errors,[]);console.log('Cortes UI: frame exato no celular, controles de reprodução/pausa/seek, montagem sem lacunas, replay, estilos, publicação simulada, ajustes após envio, recuperação da fonte, confirmação de descarte, paginação e mobile OK.');
}finally{releaseTextPreview();await browser.close();await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}
