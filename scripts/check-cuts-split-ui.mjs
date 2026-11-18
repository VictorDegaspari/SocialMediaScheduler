import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';

const temp=await mkdtemp(join(tmpdir(),'watcher-split-ui-')),root=resolve('public');
execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=red:s=640x360:r=30:d=3','-vf',"drawbox=c=green:t=fill:enable='gte(t,1)*lt(t,2)',drawbox=c=blue:t=fill:enable='gte(t,2)',drawbox=x=0:y=0:w=192:h=108:c=yellow:t=fill:enable='lt(t,1)',drawbox=x=0:y=0:w=192:h=108:c=magenta:t=fill:enable='gte(t,1)*lt(t,2)',drawbox=x=0:y=0:w=192:h=108:c=cyan:t=fill:enable='gte(t,2)'",'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',join(temp,'source.mp4')]);
const media=await readFile(join(temp,'source.mp4'));
const clip={id:'22222222-2222-4222-8222-222222222222',job_id:'11111111-1111-4111-8111-111111111111',title:'Reação com webcam',start_seconds:0,end_seconds:3,captions:[{start:.1,end:.8,text:'ANTES'},{start:2.1,end:2.8,text:'DEPOIS'}],revision:1,framing:'fit',framing_options:{mode:'fit'},caption_style:{enabled:false},excluded_ranges:[{start:1,end:2}]};
const job={id:clip.job_id,duration:3,title:'Fonte sintética',replay_data:{status:'unavailable',points:[]}};
const html='<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/cuts-list.css"><link rel="stylesheet" href="/cuts-editor.css"><body><dialog id="cuts-dialog" class="cuts-dialog" data-mode="edit"><div class="dialog-head"><h2>Ajustar reação</h2></div><form id="cuts-dialog-form"></form></dialog><script type="module" src="/fixture.js"></script></body></html>';
const fixture=`import {createCutEditor} from '/cuts-editor.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
window.openEditor=(saved=${JSON.stringify(clip)})=>{window.editor?.destroy();window.editor=createCutEditor({clip:saved,job:${JSON.stringify(job)},esc,api:async()=>({captions:${JSON.stringify(clip.captions)},duration:3})});};
window.openEditor();document.querySelector('#cuts-dialog').showModal();
document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();window.saved=window.editor.read();});`;
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname;
    if(path==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
    if(path==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(fixture);return;}
    if(path.startsWith('/api/cuts/jobs/')){
      res.setHeader('Content-Type','video/mp4');res.setHeader('Accept-Ranges','bytes');
      const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');
      if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),media.length-1):media.length-1;res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${media.length}`,'Content-Length':end-start+1});res.end(media.subarray(start,end+1));return;}
      res.end(media);return;
    }
    const pathOnDisk=resolve(root,'.'+path);if(!pathOnDisk.startsWith(root+'/'))throw new Error('Not found');
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css'})[extname(path)]||'text/plain');res.end(await readFile(pathOnDisk));
  }catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(10_000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const read=()=>page.evaluate(()=>window.editor.read());
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.015,`${actual} expected ${expected}`);
async function region(key,value){
  await page.locator(`[data-split-pane="${key}"]`).click();
  for(const property of ['width','height','x','y']){const field=page.locator(`#split-${key}-${property}`);await field.fill(String(value[property]*100));await field.press('Tab');}
}
async function range(id,value){await page.locator(id).evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},value);}
async function colors(top,bottom){
  await page.waitForFunction(({top,bottom})=>{
    const canvas=document.querySelector('#cut-phone-canvas');if(canvas.dataset.seeking!=='false')return false;
    const ctx=canvas.getContext('2d'),sample=y=>Array.from(ctx.getImageData(canvas.width/2,canvas.height*y,1,1).data).slice(0,3);
    const matches=(value,wanted)=>value.every((channel,index)=>Math.abs(channel-wanted[index])<35);
    return matches(sample(.2),top)&&matches(sample(.75),bottom);
  },{top,bottom});
}
async function dragSource(from,to){
  const canvas=page.locator('#cut-split-source');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();
  await page.mouse.move(box.x+box.width*from.x,box.y+box.height*from.y);await page.mouse.down();await page.mouse.move(box.x+box.width*to.x,box.y+box.height*to.y,{steps:6});await page.mouse.up();
}
try{
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.locator('#cut-framing').selectOption('split');
  assert.equal(await page.locator('#cut-split-controls').isVisible(),true);
  await region('content',{x:.35,y:.3,width:.65,height:.7});await region('webcam',{x:0,y:0,width:.3,height:.3});
  await colors([255,255,0],[255,0,0]);assert.equal((await read()).framingOptions.split.topRatio,.5);
  assert.equal(await page.locator('#cut-phone-canvas').getAttribute('data-source-time'),'0','source zero is decoded');
  await range('#cut-phone-seek',1.2);await colors([0,255,255],[0,0,255]);
  near(Number(await page.locator('#cut-split-source').getAttribute('data-source-time')),2.2);
  await range('#cut-phone-seek',0);await colors([255,255,0],[255,0,0]);
  const content=(await read()).framingOptions.split.content;
  await dragSource({x:.15,y:.15},{x:.2,y:.2});let saved=await read();near(saved.framingOptions.split.webcam.region.x,.05);near(saved.framingOptions.split.webcam.region.y,.05);
  await dragSource({x:.35,y:.35},{x:.4,y:.4});saved=await read();near(saved.framingOptions.split.webcam.region.width,.35);
  await dragSource({x:.6,y:.5},{x:.9,y:.9});saved=await read();near(saved.framingOptions.split.webcam.region.x,.6);near(saved.framingOptions.split.webcam.region.height,.4);
  const sourceCanvas=page.locator('#cut-split-source');await sourceCanvas.focus();await sourceCanvas.press('ArrowLeft');await sourceCanvas.press('Shift+ArrowLeft');saved=await read();near(saved.framingOptions.split.webcam.region.x,.59);near(saved.framingOptions.split.webcam.region.width,.29);
  await dragSource({x:.72,y:.7},{x:1,y:1});saved=await read();assert.ok(saved.framingOptions.split.webcam.region.x+saved.framingOptions.split.webcam.region.width<=1.000001);assert.deepEqual(saved.framingOptions.split.content,content);
  await page.locator('[data-split-fields="webcam"] [data-split-action="reset"]').click();await region('webcam',{x:0,y:0,width:.3,height:.3});
  await page.locator('#split-webcam-fit').selectOption('fit');await page.waitForFunction(()=>document.querySelector('#cut-phone-canvas').getContext('2d').getImageData(360,20,1,1).data[0]<20);
  await range('#split-webcam-zoom',.5);assert.equal((await read()).framingOptions.split.webcam.zoom,.5);assert.deepEqual((await read()).framingOptions.split.content,content);
  await page.locator('#split-webcam-fit').selectOption('crop');await range('#split-webcam-zoom',1);await colors([255,255,0],[255,0,0]);
  const divider=page.getByRole('separator',{name:'Divisão entre webcam e vídeo'});await divider.scrollIntoViewIfNeeded();const screen=await page.locator('.cuts-phone-screen').boundingBox(),box=await divider.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(screen.x+screen.width/2,screen.y+screen.height*.4,{steps:5});await page.mouse.up();near((await read()).framingOptions.split.topRatio,.4);
  await divider.focus();await divider.press('ArrowDown');near((await read()).framingOptions.split.topRatio,.41);
  await page.getByRole('button',{name:'Metade para cada parte'}).click();assert.equal((await read()).framingOptions.split.topRatio,.5);
  await range('#cut-split-ratio',35);assert.equal((await read()).framingOptions.split.topRatio,.35);
  await range('#split-webcam-focusX',.8);await page.getByRole('button',{name:'Salvar e gerar prévia',exact:true}).click();
  const body=await page.evaluate(()=>window.saved);assert.equal(body.framingOptions.mode,'split');assert.equal(body.framing,'fit');assert.equal(body.framingOptions.split.webcam.focusX,.8);assert.deepEqual(body.excludedRanges,[{start:1,end:2}]);
  await page.evaluate(({clip,body})=>window.openEditor({...clip,framing_options:body.framingOptions}),{clip,body});
  assert.deepEqual((await read()).framingOptions,body.framingOptions);await colors([255,255,0],[255,0,0]);
  for(const viewport of [{width:390,height:844},{width:320,height:568},{width:844,height:390}]){
    await page.setViewportSize(viewport);await page.locator('#cut-split-source').scrollIntoViewIfNeeded();
    const widths=await page.evaluate(()=>({body:document.documentElement.scrollWidth-innerWidth,form:document.querySelector('form').scrollWidth-document.querySelector('form').clientWidth}));assert.ok(widths.body<=1&&widths.form<=1,JSON.stringify({viewport,widths}));
    await region('content',{x:.35,y:.3,width:.65,height:.7});await region('webcam',{x:0,y:0,width:.3,height:.3});
  }
  await page.setViewportSize({width:1440,height:1050});await page.locator('#cut-split-controls').scrollIntoViewIfNeeded();await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/cuts-split-editor.png'});
  await page.locator('#cut-framing').selectOption('fit');assert.equal(await page.locator('#cut-split-controls').isVisible(),false);assert.equal(await divider.isVisible(),false);
  await page.locator('#cut-framing').selectOption('split');assert.deepEqual((await read()).framingOptions.split.content,content);
  assert.deepEqual(errors,[]);
  console.log('Split editor: decoded source zero/gaps, independent crops, move/resize, keyboard, fit/zoom, divider, save/reopen and mobile widths validated.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}
