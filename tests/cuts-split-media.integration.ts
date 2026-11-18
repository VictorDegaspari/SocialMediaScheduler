import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {renderCut} from '../src/cuts-media.js';
import {captionStyleSchema,framingOptionsSchema} from '../src/cuts-edit.js';
import {defaultSplitLayout} from '../public/cuts-split-layout.js';
import {sha256,validateVideo} from '../src/media.js';

const dir=await mkdtemp(join(tmpdir(),'watcher-split-media-')),source=join(dir,'source.mp4');
execFileSync('ffmpeg',['-v','error','-filter_complex',
  'color=c=red:s=640x360:r=60:d=1,drawbox=x=0:y=0:w=192:h=108:color=yellow:t=fill[v0];color=c=green:s=640x360:r=60:d=1,drawbox=x=0:y=0:w=192:h=108:color=magenta:t=fill[v1];color=c=blue:s=640x360:r=60:d=1,drawbox=x=0:y=0:w=192:h=108:color=cyan:t=fill[v2];[v0][v1][v2]concat=n=3:v=1:a=0[v];sine=frequency=440:duration=1[a0];sine=frequency=880:duration=1[a1];sine=frequency=1320:duration=1[a2];[a0][a1][a2]concat=n=3:v=0:a=1[a]',
  '-map','[v]','-map','[a]','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',source]);
const hash=await sha256(source);
const layout=()=>{const value=defaultSplitLayout();value.webcam.region={x:0,y:0,width:.3,height:.3};value.content.region={x:.35,y:.3,width:.65,height:.7};return value;};
function sample(path:string,at:number,x:number,y:number){
  return execFileSync('ffmpeg',['-v','error','-ss',String(at),'-i',path,'-vf',`scale=180:320,crop=4:4:${x}:${y},scale=1:1`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);
}
function assertColor(bytes:Buffer,color:'yellow'|'cyan'|'red'|'blue'|'black'){
  const [r,g,b]=bytes;assert.ok(color==='yellow'?r>180&&g>180&&b<45:color==='cyan'?r<45&&g>180&&b>180:color==='red'?r>180&&g<45&&b<45:color==='blue'?r<45&&g<45&&b>180:r<20&&g<20&&b<20,`${color}: ${[r,g,b]}`);
}
function frequency(path:string,at:number){
  const pcm=execFileSync('ffmpeg',['-v','error','-ss',String(at),'-i',path,'-t','0.5','-ac','1','-ar','8000','-f','f32le','-']);let n=0,previous=0;
  for(let i=0;i<pcm.length;i+=4){const value=pcm.readFloatLE(i);if(previous<0&&value>=0)n++;previous=value;}return n/(pcm.length/4/8000);
}

test('both split regions share the source clock, exclusions, captions and 60 fps audio/video',async()=>{
  const {path}=await renderCut(dir,randomUUID(),{start:0,end:3,framing:'fit',framingOptions:framingOptionsSchema.parse({mode:'split',split:layout()}),
    captions:[{start:.3,end:.8,text:'ANTES'},{start:1.3,end:1.8,text:'FORA'},{start:2.3,end:2.8,text:'DEPOIS'}],excludedRanges:[{start:1,end:2}]});
  const info=await validateVideo(path);assert.equal(info.width,1080);assert.equal(info.height,1920);assert.ok(Math.abs(info.duration-2)<.1);
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=avg_frame_rate','-of','json',path],{encoding:'utf8'}));assert.equal(probe.streams[0].avg_frame_rate,'60/1');
  assertColor(sample(path,.2,80,70),'yellow');assertColor(sample(path,.2,80,230),'red');
  assertColor(sample(path,1.2,80,70),'cyan');assertColor(sample(path,1.2,80,230),'blue');
  assert.ok(Math.abs(frequency(path,.2)-440)<15);assert.ok(Math.abs(frequency(path,1.2)-1320)<20);
  const whites=(at:number)=>{const bytes=execFileSync('ffmpeg',['-v','error','-ss',String(at),'-i',path,'-vf','scale=360:640,crop=360:130:0:510','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);let n=0;for(let i=0;i<bytes.length;i+=3)if(bytes[i]>160&&bytes[i+1]>160&&bytes[i+2]>160)n++;return n;};
  assert.ok(whites(1.5)>20,'caption overlays the composed video at the remapped time');assert.equal(whites(1.1),0);
  assert.equal(await sha256(source),hash);execFileSync('ffmpeg',['-v','error','-xerror','-i',path,'-f','null','-']);
});

test('split fit, independent zoom and divider affect only their own panes',async()=>{
  const split=layout();split.topRatio=.4;split.webcam.fit='fit';split.content.zoom=.5;
  const {path}=await renderCut(dir,randomUUID(),{start:0,end:.6,framing:'fit',framingOptions:framingOptionsSchema.parse({mode:'split',split}),captions:[{start:.1,end:.5,text:'TESTE'}],captionStyle:captionStyleSchema.parse({enabled:false})});
  assertColor(sample(path,.2,80,5),'black');assertColor(sample(path,.2,80,60),'yellow');assertColor(sample(path,.2,80,120),'black');
  assertColor(sample(path,.2,80,130),'black');assertColor(sample(path,.2,80,220),'red');assertColor(sample(path,.2,80,310),'black');
  const filled=layout();filled.topRatio=.4;
  const next=await renderCut(dir,randomUUID(),{start:0,end:.6,framing:'fit',framingOptions:framingOptionsSchema.parse({mode:'split',split:filled}),captions:[{start:.1,end:.5,text:'TESTE'}],captionStyle:captionStyleSchema.parse({enabled:false})});
  assertColor(sample(next.path,.2,80,120),'yellow');assertColor(sample(next.path,.2,80,130),'red');
  assert.equal(await sha256(source),hash);
});

after(async()=>{await rm(dir,{recursive:true,force:true});});
