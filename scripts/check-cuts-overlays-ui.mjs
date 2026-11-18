import {revealEditorControl} from './cuts-ui-tabs.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,rm,mkdtemp,mkdir} from 'node:fs/promises';
import {resolve,extname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';

const dir=await mkdtemp(join(tmpdir(),'watcher-overlay-ui-')),root=resolve('public');
const videoPath=join(dir,'source.mp4');
execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=red:s=320x180:r=25:d=8','-f','lavfi','-i','sine=frequency=440:duration=8','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-threads','1','-shortest',videoPath]);
const video=await readFile(videoPath),png=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=lime:s=80x40','-frames:v','1','-threads','1','-c:v','png','-f','image2pipe','-']);
const clip={id:'22222222-2222-4222-8222-222222222222',title:'Teste de elementos',revision:1,start_seconds:1,end_seconds:7,captions:[{start:1,end:3,text:'Legenda antes'},{start:4,end:7,text:'Legenda depois'}],excluded_ranges:[{start:3,end:4}],caption_style:{enabled:false},framing:'fit',overlays:[]};
const job={id:'11111111-1111-4111-8111-111111111111',duration:8,replay_data:{status:'unavailable',points:[]}};
const html='<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/cuts-editor.css"><body><dialog id="cuts-dialog" class="cuts-dialog" data-mode="edit"><div class="dialog-head"><h2>Editar corte</h2></div><form id="cuts-dialog-form"></form></dialog><script type="module" src="/fixture.js"></script></body></html>';
const js=`import {createCutEditor} from '/cuts-editor.js';
const clip=${JSON.stringify(clip)},job=${JSON.stringify(job)};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
window.reopen=overlays=>{window.editor?.destroy();window.editor=createCutEditor({clip:{...clip,overlays},job,esc,api:async()=>({captions:clip.captions})});};
window.reopen([]);document.querySelector('#cuts-dialog').showModal();
document.querySelector('#cuts-dialog-form').addEventListener('submit',event=>{event.preventDefault();try{window.saved=window.editor.read();window.saveError=null;}catch(error){window.saveError=error.message;}});`;
let uploads=0,imageGets=0,holdUpload=false,releaseUpload,uploadedImage=png;
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname;
    if(path==='/favicon.ico'){res.statusCode=204;res.end();return;}
    if(path==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
    if(path==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return;}
    if(path.endsWith('/source')){
      const match=req.headers.range?.match(/bytes=(\d+)-(\d*)/);res.setHeader('Content-Type','video/mp4');res.setHeader('Accept-Ranges','bytes');
      if(match){const start=Number(match[1]),end=match[2]?Math.min(video.length-1,Number(match[2])):video.length-1;res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${video.length}`);res.end(video.subarray(start,end+1));}else res.end(video);return;
    }
    if(path.endsWith('/images')&&req.method==='POST'){
      assert.equal(req.headers['x-watcher-request'],'1');const chunks=[];for await(const chunk of req)chunks.push(chunk);uploadedImage=Buffer.concat(chunks);assert.deepEqual(uploadedImage.subarray(0,8),png.subarray(0,8));if(uploads)assert.deepEqual(uploadedImage,png);
      uploads++;if(holdUpload)await new Promise(resolve=>releaseUpload=resolve);
      res.statusCode=201;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'33333333-3333-4333-8333-333333333333',width:80,height:40,url:'/api/cuts/jobs/'+job.id+'/images/33333333-3333-4333-8333-333333333333'}));return;
    }
    if(path.includes('/images/')){imageGets++;res.setHeader('Content-Type','image/png');res.end(uploadedImage);return;}
    const file=resolve(root,'.'+path);assert(file.startsWith(root+'/'));res.setHeader('Content-Type',({'.css':'text/css','.js':'text/javascript'})[extname(file)]||'text/plain');res.end(await readFile(file));
  }catch(error){errors.push(error.message);res.statusCode=500;res.end();}
});
const errors=[];await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1100},permissions:['clipboard-read','clipboard-write']});const page=await context.newPage();page.setDefaultTimeout(10_000);page.on('pageerror',e=>errors.push(e.message));
async function range(id,value){await page.locator(id).evaluate((e,v)=>{e.value=String(v);e.dispatchEvent(new Event('input',{bubbles:true}));},value);}
async function seek(time){
  await range('#cut-phone-seek',time);await page.waitForFunction(()=>document.querySelector('#cut-phone-canvas').dataset.seeking==='false');
  await page.waitForFunction(time=>Math.abs(Number(document.querySelector('#cut-phone-seek').value)-time)<.05,time);
}
async function green(){return page.locator('#cut-phone-canvas').evaluate(canvas=>{const data=canvas.getContext('2d').getImageData(0,0,canvas.width,Math.floor(canvas.height*.3)).data;let n=0;for(let i=0;i<data.length;i+=4)if(data[i]<80&&data[i+1]>150&&data[i+2]<80)n++;return n;});}
try{
  await page.goto(base);await page.waitForFunction(()=>document.querySelector('#cut-phone-canvas')?.dataset.seeking==='false');
  await revealEditorControl(page,'#cut-overlays');
  await page.getByRole('button',{name:'Adicionar texto',exact:true}).click();
  const text=page.getByLabel('Texto sobre o vídeo',{exact:true}),literal='<img src=x onerror=alert(1)> & "ação"';
  await text.fill(literal);await text.evaluate(e=>e.setSelectionRange(4,4));await text.press('X');
  assert.equal(await text.inputValue(),literal.slice(0,4)+'X'+literal.slice(4));
  assert(await text.evaluate(e=>document.activeElement===e&&e.selectionStart===5),'reactive updates preserve focus and the caret');
  await page.waitForFunction(value=>document.querySelector('.cuts-overlay-item>span:nth-child(2)').textContent.startsWith(value),literal.slice(0,4)+'X'+literal.slice(4));
  assert.equal(await page.locator('#cut-overlay-list img').count(),0,'overlay text remains literal HTML');
  await text.fill('Texto fixo 100%');
  await page.getByRole('tab',{name:'Posição e tamanho',exact:true}).click();
  await page.getByRole('tab',{name:'Posição e tamanho',exact:true}).press('End');
  await page.getByRole('checkbox',{name:'Durante todo o vídeo',exact:true}).uncheck();
  assert.equal(await page.getByRole('tab',{name:'Duração',exact:true}).getAttribute('aria-selected'),'true','editing controls preserves the selected tab');
  await page.getByRole('checkbox',{name:'Durante todo o vídeo',exact:true}).check();
  await range('#cut-overlay-y',70);await range('#cut-overlay-color','#FF00FF');
  await revealEditorControl(page,'#cut-overlay-text');
  await page.getByLabel('Texto sobre o vídeo',{exact:true}).focus();
  await page.evaluate(async base64=>{const data=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));await navigator.clipboard.write([new ClipboardItem({'image/png':new Blob([data],{type:'image/png'})})]);},png.toString('base64'));
  await page.keyboard.press('Control+V');await page.getByText('Imagem adicionada. Ajuste a posição e a duração.',{exact:true}).waitFor();
  assert.equal(uploads,1,'Ctrl+V uploads the clipboard image');assert.equal(await page.locator('.cuts-overlay-item').count(),2);
  await revealEditorControl(page,'#cut-overlay-always');await page.getByRole('checkbox',{name:'Durante todo o vídeo',exact:true}).uncheck();
  await page.getByLabel('Aparece em (segundos)').fill('0.5');await page.getByLabel('Some em (segundos)').fill('1.5');
  await seek(.2);assert.equal(await green(),0);await seek(.8);await page.waitForFunction(()=>document.querySelector('#cut-phone-canvas').dataset.sourceTime==='1.8');assert(await green()>1000,'image appears at the selected time');
  const canvas=page.locator('#cut-phone-canvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();
  const point={x:box.x+box.width*.5,y:box.y+box.height*.1+box.height*.03};
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+box.width*.1,point.y+box.height*.08,{steps:4});await page.mouse.up();
  assert(await page.locator('#cut-source-player').evaluate(v=>v.paused),'moving an overlay does not play the video');
  assert(Number(await page.locator('#cut-overlay-x').inputValue())>50,'drag changes horizontal position');
  await seek(1.8);assert.equal(await green(),0,'image disappears in the live preview');
  await page.getByRole('button',{name:'Salvar e gerar prévia',exact:true}).click();await page.waitForFunction(()=>window.saved);
  const saved=await page.evaluate(()=>window.saved);assert.equal(saved.overlays.length,2);assert.equal(saved.overlays[0].text,'Texto fixo 100%');assert.equal(saved.overlays[0].end,null);assert.equal(saved.overlays[1].start,.5);assert.equal(saved.overlays[1].end,1.5);assert(saved.overlays[1].x>.5);assert.equal(saved.start,1);assert.deepEqual(saved.excludedRanges,[{start:3,end:4}]);
  await page.evaluate(overlays=>window.reopen(overlays),saved.overlays);await page.waitForFunction(()=>document.querySelector('#cut-phone-canvas').dataset.seeking==='false');
  await revealEditorControl(page,'#cut-overlay-text');
  assert.deepEqual(await page.evaluate(()=>window.editor.read().overlays),saved.overlays,'reopening preserves the complete overlay payload');
  assert.equal(await page.locator('.cuts-overlay-item').count(),2);assert.equal(await page.getByLabel('Texto sobre o vídeo',{exact:true}).inputValue(),'Texto fixo 100%');assert(imageGets>=1);assert.equal(uploads,1,'reopening reuses the saved image');
  await page.getByRole('button',{name:/Imagem.*0.5 s/}).click();await revealEditorControl(page,'#cut-overlay-end');await page.getByLabel('Some em (segundos)').fill('99');
  const error=await page.evaluate(()=>{try{window.editor.read();return null;}catch(e){return e.message;}});assert.match(error,/duração final/);
  await page.getByRole('checkbox',{name:'Durante todo o vídeo',exact:true}).check();await seek(4.5);assert(await green()>1000,'a fixed image remains visible after the removed interval');
  await page.getByRole('button',{name:'Remover elemento',exact:true}).click();assert.equal(await page.locator('.cuts-overlay-item').count(),1);
  holdUpload=true;await page.locator('#cut-overlay-file').setInputFiles({name:'imagem.png',mimeType:'image/png',buffer:png});await page.waitForFunction(()=>document.querySelector('#cut-overlay-status').textContent==='Enviando imagem…');
  assert.match(await page.evaluate(()=>{try{window.editor.read();return '';}catch(e){return e.message;}}),/Aguarde o envio/);
  while(!releaseUpload)await new Promise(resolve=>setTimeout(resolve,20));releaseUpload();await page.getByText('Imagem adicionada. Ajuste a posição e a duração.',{exact:true}).waitFor();
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});assert(await page.locator('#cuts-dialog-form').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'overlay controls overflow at '+width);}
  await page.setViewportSize({width:1440,height:1100});await seek(.8);await page.locator('#cut-overlays').scrollIntoViewIfNeeded();await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/cuts-overlays-desktop.png'});
  const count=uploads;await page.evaluate(()=>{window.editor.destroy();document.querySelector('#cuts-dialog').close();});await page.keyboard.press('Control+V');assert.equal(uploads,count,'closed editors do not capture clipboard images');
  assert.deepEqual(errors,[]);console.log('Textos e imagens: Ctrl+V real, arquivo, duração, montagem, arraste, exportação de dados, reabertura, remoção, uploads pendentes e telas móveis validados.');
}catch(error){console.error({uploads,errors,status:await page.locator('#cut-overlay-status').textContent()});throw error;}
finally{releaseUpload?.();await browser.close();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
