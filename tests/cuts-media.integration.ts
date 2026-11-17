import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderCut } from '../src/cuts-media.js';
import { sha256, validateVideo } from '../src/media.js';

const dir=await mkdtemp(join(tmpdir(),'watcher-cuts-render-'));
const source=join(dir,'source.mp4');
execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=320x180:r=30:d=4','-f','lavfi','-i','sine=frequency=440:duration=4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',source]);
const captions=[{start:1.2,end:2.6,text:'Português fiel: ação, café e você!'}];

test('renders a true vertical H264/AAC preview with burnt-in, time-shifted captions and preserves source',async()=>{
  const before=await sha256(source);
  const {path}=await renderCut(dir,'11111111-1111-4111-8111-111111111111',{start:1,end:3,captions,framing:'fit'});
  const info=await validateVideo(path);
  assert.equal(info.width,720);assert.equal(info.height,1280);
  assert.ok(Math.abs(info.duration-2)<0.1);
  const streams=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_name','-of','json',path],{encoding:'utf8'})).streams;
  assert.deepEqual(streams.map((s:{codec_name:string})=>s.codec_name),['h264','aac']);
  const frame=(at:string)=>execFileSync('ffmpeg',['-v','error','-ss',at,'-i',path,'-vf','crop=620:280:50:800','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);
  // The source is a flat blue field with black fit padding. Caption pixels
  // appear only during 0.2–1.6 seconds of the resulting clip.
  assert.notDeepEqual(frame('0.05'),frame('0.5'));
  assert.equal(await sha256(source),before);
  assert.ok((await stat(path)).size>1000);
  assert.ok(!(await readdir(dir)).some(name=>name.endsWith('.ass')||name.includes('.rendering.')));
});

test('crop preview tolerates literal ASS control characters without treating them as styles',async()=>{
  const {path}=await renderCut(dir,'22222222-2222-4222-8222-222222222222',{start:0,end:2,captions:[{start:0,end:2,text:'Texto {\\p1} m 0 0 l 100 100 \\N literal'}],framing:'crop'});
  const info=await validateVideo(path);
  assert.equal(info.width,720);assert.equal(info.height,1280);
});

test('failed rerender leaves the previous preview intact',async()=>{
  const id='11111111-1111-4111-8111-111111111111',path=join(dir,`${id}.mp4`),before=await sha256(path);
  await assert.rejects(()=>renderCut(dir,id,{start:20,end:22,captions:[{start:20,end:22,text:'Fora da origem.'}],framing:'fit'}));
  assert.equal(await sha256(path),before);
  assert.ok(!(await readdir(dir)).some(name=>name.endsWith('.ass')||name.includes('.rendering.')));
});

after(async()=>{await rm(dir,{recursive:true,force:true});});
