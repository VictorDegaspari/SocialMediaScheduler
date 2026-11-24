import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, rm,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { renderCut, type Cue, type RenderCutInput } from '../src/cuts-media.js';
import { captionStyleSchema, framingOptionsSchema } from '../src/cuts-edit.js';
import { sha256, validateVideo } from '../src/media.js';
import {saveOverlayImage,cutOverlaysSchema} from '../src/cuts-overlays.js';

const dir=await mkdtemp(join(tmpdir(),'watcher-cuts-editor-'));
const source=join(dir,'source.mp4');
execFileSync('ffmpeg',['-v','error','-filter_complex',
  'color=c=red:s=320x180:r=30:d=2[v0];color=c=green:s=320x180:r=30:d=2[v1];color=c=blue:s=320x180:r=30:d=2[v2];[v0][v1][v2]concat=n=3:v=1:a=0,drawbox=x=0:y=0:w=60:h=180:color=yellow:t=fill,drawbox=x=260:y=0:w=60:h=180:color=cyan:t=fill[v];sine=frequency=440:duration=2[a0];sine=frequency=880:duration=2[a1];sine=frequency=1320:duration=2[a2];[a0][a1][a2]concat=n=3:v=0:a=1[a]',
  '-map','[v]','-map','[a]','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',source]);
const style=(input:unknown={})=>captionStyleSchema.parse(input);
const framing=(input:unknown={})=>framingOptionsSchema.parse(input);
const basic:RenderCutInput={start:0,end:2,captions:[{start:0.2,end:1.8,text:'TESTE'}],framing:'fit'};
async function render(input:RenderCutInput){return renderCut(dir,randomUUID(),input);}
function frame(path:string,at:number,filter='crop=720:300:0:900',size='720:1280') {
  return execFileSync('ffmpeg',['-v','error','-ss',String(at),'-i',path,'-vf',`scale=${size},${filter}`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:4*1024*1024});
}
function pixels(bytes:Buffer,match:(r:number,g:number,b:number)=>boolean) {
  let count=0;for(let i=0;i<bytes.length;i+=3)if(match(bytes[i],bytes[i+1],bytes[i+2]))count++;return count;
}
const white=(r:number,g:number,b:number)=>r>120&&g>120&&b>120;
const yellow=(r:number,g:number,b:number)=>r>150&&g>150&&b<100;
test('a marca-d’água permanece no primeiro e no último segundo de um vídeo pronto de 4min32s',async()=>{
  const full=await mkdtemp(join(dir,'full-'));
  const original=join(full,'source.mp4'),duration=272;
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=black:s=90x160:r=2','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t',String(duration),'-threads','1','-c:v','libx264','-c:a','aac',original]);
  const png=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=lime:s=32x32','-frames:v','1','-c:v','png','-threads','1','-f','image2pipe','-']);
  const image=await saveOverlayImage(full,png);
  const overlays=cutOverlaysSchema.parse([{type:'image',id:randomUUID(),imageId:image.id,watermark:true}]);
  const {path}=await renderCut(full,randomUUID(),{start:0,end:duration,maxOutputSeconds:duration,captions:[],captionStyle:style({enabled:false}),framing:'fit',overlays},{preview:true});
  assert.equal((await validateVideo(path,'shorts',duration+.5)).duration,duration);
  for(const at of [1,271])assert(pixels(frame(path,at,'scale=90:160'),(r,g,b)=>g>160&&r<60&&b<60)>100);
});

test('um corte importado sem áudio aceita edição e continua sem faixa sonora',async()=>{
  const silent=await mkdtemp(join(dir,'silent-'));
  execFileSync('ffmpeg',['-v','error','-i',source,'-t','2','-map','0:v:0','-c:v','copy',join(silent,'source.mp4')]);
  const {path}=await renderCut(silent,randomUUID(),{...basic,captions:[],captionStyle:style({enabled:false}),excludedRanges:[{start:.5,end:1}]},{preview:true});
  const info=JSON.parse(execFileSync('ffprobe',['-v','error','-of','json','-show_entries','stream=codec_type:format=duration',path],{encoding:'utf8'}));
  assert.deepEqual(info.streams.map((s:{codec_type:string})=>s.codec_type),['video']);assert.ok(Math.abs(Number(info.format.duration)-1.5)<.05);
});

test('text and transparent images are encoded together and timed on the final edited timeline',async()=>{
  const bytes=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=lime:s=80x40,format=rgba,colorchannelmixer=aa=0.8','-frames:v','1','-threads','1','-c:v','png','-f','image2pipe','-']);
  const image=await saveOverlayImage(dir,bytes),sourceHash=await sha256(source);
  assert.deepEqual(await readFile(join(dir,'overlay-'+image.id+'.image')),bytes,'the original image bytes are retained');
  const overlays=cutOverlaysSchema.parse([
    {id:randomUUID(),type:'text',text:'FIXO 100%: [ok] \\ {teste}',fontSize:64,color:'#FF00FF',x:.5,y:.8,width:.9},
    {id:randomUUID(),type:'image',imageId:image.id,start:0,end:.8,width:.3,x:.2,y:.1}
  ]);
  const {path}=await render({...basic,captionStyle:style({enabled:false}),overlays});
  const green=(r:number,g:number,b:number)=>g>140&&r<70&&b<70,magenta=(r:number,g:number,b:number)=>r>120&&g<100&&b>120;
  assert(pixels(frame(path,.4,'crop=720:300:0:0'),green)>3000,'transparent image is present before its end');
  assert.equal(pixels(frame(path,1.2,'crop=720:300:0:0'),green),0,'image disappears from the encoded frames');
  assert(pixels(frame(path,.4),magenta)>100&&pixels(frame(path,1.4),magenta)>100,'fixed text remains after the image disappears');
  assert.ok(Math.abs(frequency(path,.3)-440)<15);assert.equal(await sha256(source),sourceHash);
  assert.equal((await validateVideo(path)).width,1080,'overlay composition keeps the full output resolution');
  const timed=cutOverlaysSchema.parse([{...overlays[0],start:2,end:3}]);
  const edited=await render({start:0,end:6,captions:[{start:.2,end:1,text:'Teste'}],framing:'fit',captionStyle:style({enabled:false}),excludedRanges:[{start:2,end:4}],overlays:timed});
  assert.equal(pixels(frame(edited.path,1.5),magenta),0);assert(pixels(frame(edited.path,2.5),magenta)>100,'timing follows the output after removing the middle');assert.equal(pixels(frame(edited.path,3.5),magenta),0);
  assert(!(await readdir(dir)).some(name=>name.includes('.overlay-')),'rendering text files are cleaned up');
});

test('export respects text alignment and multiplies watermark opacity by the original alpha',async()=>{
  const bytes=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=lime:s=80x40,format=rgba,colorchannelmixer=aa=0.8','-frames:v','1','-threads','1','-c:v','png','-f','image2pipe','-']);
  const image=await saveOverlayImage(dir,bytes);
  const overlays=cutOverlaysSchema.parse([
    ...['left','center','right','justify'].map((alignment,index)=>({
      id:randomUUID(),type:'text',text:alignment==='justify'?'Um dois três quatro cinco seis sete.\nFim.':'TEXTO',
      alignment,start:index*.4,end:(index+1)*.4,fontSize:48,color:'#FF00FF',x:.5,y:.18,width:.5
    })),
    ...[.5,1,0].map((opacity,index)=>({
      id:randomUUID(),type:'image',imageId:image.id,watermark:true,opacity,start:index*.4,end:(index+1)*.4,width:.18,x:.92,y:.026
    }))
  ]);
  const {path}=await render({...basic,captionStyle:style({enabled:false}),overlays});
  function textBounds(at:number){
    const image=frame(path,at,'crop=720:260:0:150');
    let left=720,right=0;
    for(let index=0;index<image.length;index+=3){
      if(image[index]<140||image[index+1]>100||image[index+2]<140)continue;
      const x=index/3%720;
      left=Math.min(left,x);right=Math.max(right,x);
    }
    assert(left<right,'aligned text is present on the exported frame');
    return {left,right};
  }
  const left=textBounds(.2),center=textBounds(.6),right=textBounds(1),justified=textBounds(1.4);
  assert(center.left-left.left>50&&right.left-center.left>50,'horizontal alignment repositions the text in the same box');
  assert(justified.left<190&&justified.right>525,'the wrapped paragraph reaches both edges of the box');
  const sample=(at:number)=>frame(path,at,'crop=2:2:602:62,scale=1:1')[1];
  const translucent=sample(.2),full=sample(.6);
  assert(translucent>75&&translucent<135,'50% opacity compounds with the PNG alpha');
  assert(full>165&&full<225,'100% opacity keeps the alpha from the file');
  assert(sample(1)<20,'0% makes the watermark invisible');
});

test('redactions cover only the chosen rectangle and follow the edited timeline after an exclusion',async()=>{
  const region={type:'redaction',x:0,y:.5,width:.35,height:.2};
  const overlays=cutOverlaysSchema.parse([
    {...region,id:randomUUID(),effect:'blur',start:2.4,end:2.9},
    {...region,id:randomUUID(),effect:'bar',start:3,end:3.6}
  ]);
  const {path}=await render({start:0,end:6,captions:[{start:.2,end:1,text:'Teste'}],framing:'fit',
    captionStyle:style({enabled:false}),excludedRanges:[{start:2,end:4}],overlays});
  const sample=(time:number,x:number,y=640)=>frame(path,time,`crop=2:2:${x}:${y},scale=1:1`);
  const original=sample(2.2,130),blurred=sample(2.6,130),outside=sample(2.6,310);
  assert(original[0]>180&&original[1]>180&&original[2]<60,'the yellow side of the source edge is intact before the effect');
  assert(blurred[2]>85&&blurred[1]<original[1]-40,'the blur blends the yellow and blue sides inside the rectangle');
  assert(outside[2]>210&&outside[0]<40,'the neighboring blue video remains intact');
  for(const x of [130,180])assert(sample(3.2,x).every(value=>value<18),'the bar covers the original pixels completely');
  assert(sample(3.2,310)[2]>210&&sample(3.2,130,478)[1]>180,'the bar stays within its width and height');
  assert(sample(3.8,130)[1]>180,'the image returns after the timed effects');
  assert(Math.abs(frequency(path,2.4)-1320)<20,'only the picture is altered');
});

function yellowCenter(bytes:Buffer) {
  let count=0,total=0;
  for(let i=0;i<bytes.length;i+=3)if(yellow(bytes[i],bytes[i+1],bytes[i+2])){count++;total+=(i/3)%720;}
  assert.ok(count>30,'a spoken word should be highlighted');return total/count;
}
function frequency(path:string,seek:number) {
  const pcm=execFileSync('ffmpeg',['-v','error','-ss',String(seek),'-i',path,'-t','0.8','-map','0:a:0','-ac','1','-ar','8000','-f','f32le','-'],{maxBuffer:1024*1024});
  let crossings=0,previous=0;
  for(let i=0;i<pcm.length;i+=4){const sample=pcm.readFloatLE(i);if(previous<0&&sample>=0)crossings++;previous=sample;}
  return crossings/(pcm.length/4/8000);
}

test('internal removals concatenate video, audio and caption times without keeping the discarded interval',async()=>{
  const captions:Cue[]=[{start:0.4,end:1.4,text:'ANTES'},{start:2.4,end:3.4,text:'REMOVIDO'},{start:4.4,end:5.4,text:'DEPOIS'}];
  const {path}=await render({start:0,end:6,captions,framing:'fit',excludedRanges:[{start:2,end:4}]});
  const info=await validateVideo(path);assert.ok(Math.abs(info.duration-4)<0.1);
  const red=frame(path,0.2,'crop=80:80:320:600,scale=1:1'),blue=frame(path,2.2,'crop=80:80:320:600,scale=1:1');
  assert.ok(red[0]>200&&red[1]<30&&red[2]<30,'first retained video is red');
  assert.ok(blue[2]>200&&blue[0]<30&&blue[1]<30,'removed green video is skipped and blue follows');
  assert.ok(Math.abs(frequency(path,0.3)-440)<15,'first audio segment stays 440 Hz');
  assert.ok(Math.abs(frequency(path,2.3)-1320)<20,'discarded 880 Hz audio is skipped too');
  assert.ok(pixels(frame(path,2.8),white)>100,'the last caption appears at its new output time');
  assert.equal(pixels(frame(path,2.1),white),0,'a discarded caption does not stay in the gap');
  execFileSync('ffmpeg',['-v','error','-xerror','-i',path,'-f','null','-']);
});

test('caption colors, sizes, fade and pop animations are visible in the encoded frames',async()=>{
  const small=await render({...basic,captionStyle:style({color:'#FF0000',fontSize:28})});
  const large=await render({...basic,captionStyle:style({color:'#00FF00',fontSize:64,background:'box'})});
  const red=pixels(frame(small.path,0.8),(r,g,b)=>r>150&&g<100&&b<100);
  const green=pixels(frame(large.path,0.8),(r,g,b)=>g>150&&r<100&&b<100);
  assert.ok(red>80);assert.ok(green>red*2,'larger type occupies more pixels in the selected color');
  for(const animation of ['fade','pop'] as const) {
    const animated=await render({...basic,captionStyle:style({fontSize:64,animation})});
    const entering=pixels(frame(animated.path,0.23),white),steady=pixels(frame(animated.path,0.8),white);
    assert.ok(steady>200);assert.ok(entering<steady*0.8,`${animation} visibly enters over time`);
  }
});

test('captions can be removed from the encoded video and restored without losing text or source',async()=>{
  const id=randomUUID(),sourceHash=await sha256(source),captions=structuredClone(basic.captions);
  const initial=await renderCut(dir,id,basic);
  assert.ok(pixels(frame(initial.path,0.8),white)>100,'existing cuts still show captions by default');
  const hidden=await renderCut(dir,id,{...basic,captionStyle:style({enabled:false,animation:'karaoke',background:'box'})});
  assert.equal(pixels(frame(hidden.path,0.8),white),0,'the replacement MP4 contains no burnt-in caption');
  assert.deepEqual(hidden.warnings,[],'disabled captions do not generate karaoke alignment warnings');
  assert.ok(Math.abs((await validateVideo(hidden.path)).duration-2)<0.1);
  assert.ok(Math.abs(frequency(hidden.path,0.3)-440)<15,'removing captions preserves the audio');
  assert.deepEqual(basic.captions,captions);
  const restored=await renderCut(dir,id,{...basic,captionStyle:style({enabled:true})});
  assert.ok(pixels(frame(restored.path,0.8),white)>100,'the same saved caption can be rendered again');
  assert.equal(await sha256(source),sourceHash);
});

test('regular videos render in 16:9 with framing, captions and edited audio preserved',async()=>{
  const captions:Cue[]=[{start:0.4,end:1.4,text:'ANTES'},{start:4.4,end:5.4,text:'DEPOIS'}];
  const sourceHash=await sha256(source);
  for(const mode of ['fit','crop','blur'] as const){
    const {path}=await render({start:0,end:6,captions,framing:mode,framingOptions:framing({format:'video',mode,zoom:mode==='crop'?0.5:1}),excludedRanges:[{start:2,end:4}]});
    const info=await validateVideo(path,'video');
    assert.equal(info.width,1920);assert.equal(info.height,1080);assert.ok(Math.abs(info.duration-4)<0.1);
    assert.ok(pixels(frame(path,0.8,'crop=1000:300:460:780','1920:1080'),white)>100,'captions appear in the horizontal MP4');
    assert.ok(Math.abs(frequency(path,2.3)-1320)<20,'the removed interval stays out of the horizontal audio');
    if(mode==='fit'){
      const left=frame(path,0.2,'crop=80:80:80:500,scale=1:1','1920:1080'),right=frame(path,0.2,'crop=80:80:1760:500,scale=1:1','1920:1080');
      assert.ok(left[0]>180&&left[1]>180&&left[2]<40,'the full source keeps its left yellow edge');
      assert.ok(right[0]<40&&right[1]>180&&right[2]>180,'the full source keeps its right cyan edge');
    }
  }
  const hidden=await render({...basic,framingOptions:framing({format:'video'}),captionStyle:style({enabled:false})});
  assert.equal(pixels(frame(hidden.path,0.8,'crop=1000:300:460:780','1920:1080'),white),0,'captions can also be disabled for a regular video');
  assert.equal(await sha256(source),sourceHash);
});

test('karaoke follows real word timestamps and corrected captions without alignment stay static',async()=>{
  const captions:Cue[]=[{start:0.2,end:2.8,text:'UM DOIS TRÊS',words:[{start:0.2,end:0.8,text:'UM'},{start:1,end:1.6,text:'DOIS'},{start:1.8,end:2.8,text:'TRÊS'}]}];
  const result=await render({start:0,end:3,captions,framing:'fit',captionStyle:style({fontSize:48,animation:'karaoke'})});
  assert.deepEqual(result.warnings,[]);
  const centers=[0.4,1.2,2].map(at=>yellowCenter(frame(result.path,at)));
  assert.ok(centers[0]<centers[1]&&centers[1]<centers[2],'highlight moves to the word spoken at that timestamp');
  assert.equal(pixels(frame(result.path,0.9),yellow),0,'a pause does not invent a spoken word');
  const fallback=await render({...basic,captionStyle:style({animation:'karaoke'})});
  assert.equal(fallback.warnings.length,1);assert.equal(pixels(frame(fallback.path,0.8),yellow),0);
});

test('mobile framing honors pan and zoom, while blurred fill preserves the entire foreground',async()=>{
  const captions:Cue[]=[{start:1,end:1.8,text:'Teste'}];
  const left=await render({...basic,captions,framing:'crop',framingOptions:framing({mode:'crop',focusX:0,zoom:1.8})});
  const right=await render({...basic,captions,framing:'crop',framingOptions:framing({mode:'crop',focusX:1,zoom:1.8})});
  const a=frame(left.path,0.2,'crop=80:80:320:600,scale=1:1'),b=frame(right.path,0.2,'crop=80:80:320:600,scale=1:1');
  assert.ok(a[0]>180&&a[1]>180&&a[2]<40,'left focus keeps the yellow edge');
  assert.ok(b[0]<40&&b[1]>180&&b[2]>180,'right focus keeps the cyan edge');
  const blurred=await render({...basic,captions,framing:'blur',framingOptions:framing({mode:'blur'})});
  const background=frame(blurred.path,0.2,'crop=80:80:320:100,scale=1:1');
  assert.ok(background[0]>80,'the portrait padding is filled with blurred source pixels');
  const foreground=frame(blurred.path,0.2,'crop=20:80:10:600,scale=1:1');
  assert.ok(foreground[0]>180&&foreground[1]>180&&foreground[2]<50,'the original left edge remains visible in the foreground');
});

test('zooming out reveals source edges with black padding and keeps the selected focus',async()=>{
  const captions:Cue[]=[{start:1,end:1.8,text:'Teste'}];
  const sample=(path:string,x:number,y:number)=>frame(path,0.2,`crop=8:8:${x}:${y},scale=1:1`);
  const black=(bytes:Buffer)=>bytes.every(value=>value<20);
  const half=await render({...basic,captions,framing:'crop',framingOptions:framing({mode:'crop',zoom:0.5,focusX:0})});
  assert.ok(black(sample(half.path,360,100)),'zooming out leaves space above the image');
  assert.ok(black(sample(half.path,360,1200)),'zooming out leaves space below the image');
  assert.ok(sample(half.path,360,640)[0]>180,'the center of the source remains visible');
  const left=sample(half.path,20,640);assert.ok(yellow(left[0],left[1],left[2]),'left focus reveals the source edge instead of stretching the center');
  const quarter=await render({...basic,captions,framing:'crop',framingOptions:framing({mode:'crop',zoom:0.25})});
  assert.ok(black(sample(quarter.path,20,640)),'further zooming out also leaves space at the sides');
  const fullLeft=sample(quarter.path,90,640);assert.ok(yellow(fullLeft[0],fullLeft[1],fullLeft[2]),'the full left edge is visible');
  const cyan=sample(quarter.path,630,640);assert.ok(cyan[0]<40&&cyan[1]>180&&cyan[2]>180,'the full right edge is visible too');
  const corner=await render({...basic,captions,framing:'crop',framingOptions:framing({mode:'crop',zoom:0.25,focusX:1,focusY:1})});
  assert.ok(black(sample(corner.path,20,1000)),'horizontal focus positions the smaller image on the right');
  assert.ok(black(sample(corner.path,360,600)),'vertical focus positions the smaller image at the bottom');
  const bottomRight=sample(corner.path,700,1200);assert.ok(bottomRight[0]<40&&bottomRight[1]>180&&bottomRight[2]>180);
  const blurred=await render({...basic,captions,framing:'blur',framingOptions:framing({mode:'blur',zoom:0.25})});
  assert.ok(sample(blurred.path,360,100)[0]>80,'switching to blurred fill keeps the background covered after zooming out');
});

test('invalid removal through a corrected caption cannot overwrite a complete preview',async()=>{
  const id=randomUUID(),result=await renderCut(dir,id,basic),before=await sha256(result.path);
  await assert.rejects(()=>renderCut(dir,id,{...basic,excludedRanges:[{start:0.8,end:1}]}),/alinhamento de palavras/);
  assert.equal(await sha256(result.path),before);
  assert.ok(!(await readdir(dir)).some(name=>name.endsWith('.ass')||name.includes('.rendering.')));
});

test('many fractional trims do not accumulate audio gaps or lose the final retained segment',async()=>{
  const gaps=Array.from({length:19},(_,i)=>({start:i*0.25+0.105,end:(i+1)*0.25}));
  const {path}=await render({start:0,end:4.855,captions:[{start:0.01,end:0.08,text:'Teste'}],framing:'fit',excludedRanges:gaps});
  const info=await validateVideo(path);assert.ok(Math.abs(info.duration-2.1)<0.1);
  const blue=frame(path,1.9,'crop=80:80:320:600,scale=1:1');
  assert.ok(blue[2]>200&&blue[0]<30&&blue[1]<30,'the last retained section arrives at the mapped output time');
  assert.ok(Math.abs(frequency(path,1.8)-1320)<30,'the final retained audio has no accumulated padding gap');
});

after(async()=>{await rm(dir,{recursive:true,force:true});});
