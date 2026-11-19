import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { downloadCutSource, renderCut } from '../src/cuts-media.js';
import { captionStyleSchema, framingOptionsSchema } from '../src/cuts-edit.js';
import { sha256, validateVideo } from '../src/media.js';

const dir=await mkdtemp(join(tmpdir(),'watcher-cuts-render-'));
const source=join(dir,'source.mp4');
execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=320x180:r=30:d=4','-f','lavfi','-i','sine=frequency=440:duration=4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',source]);
const captions=[{start:1.2,end:2.6,text:'Português fiel: ação, café e você!'}];
const noCaptions=captionStyleSchema.parse({enabled:false});

test('renders a true vertical H264/AAC preview with burnt-in, time-shifted captions and preserves source',async()=>{
  const before=await sha256(source);
  const {path}=await renderCut(dir,'11111111-1111-4111-8111-111111111111',{start:1,end:3,captions,framing:'fit'});
  const info=await validateVideo(path);
  assert.equal(info.width,1080);assert.equal(info.height,1920);
  assert.ok(Math.abs(info.duration-2)<0.1);
  const streams=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_name','-of','json',path],{encoding:'utf8'})).streams;
  assert.deepEqual(streams.map((s:{codec_name:string})=>s.codec_name),['h264','aac']);
  const frame=(at:string)=>execFileSync('ffmpeg',['-v','error','-ss',at,'-i',path,'-vf','scale=720:1280,crop=620:280:50:800','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);
  // The source is a flat blue field with black fit padding. Caption pixels
  // appear only during 0.2–1.6 seconds of the resulting clip.
  assert.notDeepEqual(frame('0.05'),frame('0.5'));
  assert.equal(await sha256(source),before);
  assert.ok((await stat(path)).size>1000);
  assert.ok(!(await readdir(dir)).some(name=>name.endsWith('.ass')||name.includes('.rendering.')));
});

test('review encoding uses a smaller canvas and a separate preview file',async()=>{
  const {path}=await renderCut(dir,randomUUID(),{start:1,end:3,captions,framing:'fit'},{preview:true});
  const {width,height}=await validateVideo(path);
  assert.deepEqual({width,height},{width:180,height:320});
  assert.ok(!path.endsWith('.master.mp4'));
});

test('crop preview tolerates literal ASS control characters without treating them as styles',async()=>{
  const {path}=await renderCut(dir,'22222222-2222-4222-8222-222222222222',{start:0,end:2,captions:[{start:0,end:2,text:'Texto {\\p1} m 0 0 l 100 100 \\N literal'}],framing:'crop'});
  const info=await validateVideo(path);
  assert.equal(info.width,1080);assert.equal(info.height,1920);
});

test('failed rerender leaves the previous preview intact',async()=>{
  const id='11111111-1111-4111-8111-111111111111',path=join(dir,`${id}.mp4`),before=await sha256(path);
  await assert.rejects(()=>renderCut(dir,id,{start:20,end:22,captions:[{start:20,end:22,text:'Fora da origem.'}],framing:'fit'}));
  assert.equal(await sha256(path),before);
  assert.ok(!(await readdir(dir)).some(name=>name.endsWith('.ass')||name.includes('.rendering.')));
});

test('exports both orientations and split layout at 4K and 59.94 fps while keeping the original source',async()=>{
  const qualityDir=await mkdtemp(join(dir,'4k-')),source=join(qualityDir,'source.mp4');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=3840x2160:r=60000/1001:d=0.6','-f','lavfi','-i','sine=frequency=440:duration=0.6','-c:v','libx264','-preset','ultrafast','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-shortest',source]);
  const before=await sha256(source);
  for(const format of ['shorts','video'] as const)for(const mode of ['crop','split'] as const){
    const {path}=await renderCut(qualityDir,randomUUID(),{start:0,end:0.5,captions:[{start:0.01,end:0.49,text:'Qualidade original.'}],framing:mode==='split'?'fit':'crop',framingOptions:{format,mode,focusX:0.5,focusY:0.5,zoom:1},captionStyle:noCaptions});
    const info=await validateVideo(path,format);
    assert.deepEqual([info.width,info.height],format==='shorts'?[2160,3840]:[3840,2160]);
    const video=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=r_frame_rate,nb_frames','-of','json',path],{encoding:'utf8'})).streams[0];
    assert.equal(video.r_frame_rate,'60000/1001');
    assert.equal(Number(video.nb_frames),30,'high-frame-rate motion is not halved during export');
  }
  assert.equal(await sha256(source),before);
});

test('Full HD 60 fps export preserves decoded fine detail and audio',async()=>{
  const qualityDir=await mkdtemp(join(dir,'detail-')),source=join(qualityDir,'source.mp4');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=1080x1920:r=60:d=0.5','-f','lavfi','-i','sine=frequency=440:duration=0.5','-c:v','libx264','-preset','ultrafast','-crf','0','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-b:a','320k','-shortest',source]);
  const {path}=await renderCut(qualityDir,randomUUID(),{start:0,end:0.5,captions:[{start:0.01,end:0.49,text:'Detalhes.'}],framing:'fit',captionStyle:noCaptions});
  const scores=execFileSync('ffmpeg',['-v','error','-i',source,'-i',path,'-lavfi','[0:v][1:v]ssim=stats_file=-','-f','null','-'],{encoding:'utf8'});
  const similarity=[...scores.matchAll(/All:([\d.]+)/g)].map(match=>Number(match[1]));
  assert.equal(similarity.length,30,'all 60 fps frames remain available');
  const mean=similarity.reduce((sum,value)=>sum+value,0)/similarity.length;
  assert.ok(mean>0.99,`decoded SSIM ${mean} must retain fine detail before platform compression`);
  const audio=execFileSync('ffmpeg',['-v','error','-i',path,'-map','0:a:0','-ac','1','-ar','8000','-f','f32le','-']);
  let crossings=0,previous=0;
  for(let i=0;i<audio.length;i+=4){const sample=audio.readFloatLE(i);if(previous<0&&sample>=0)crossings++;previous=sample;}
  assert.ok(Math.abs(crossings/(audio.length/4/8000)-440)<10,'the exported audio keeps the original tone');
});

test('download selects the best source streams without resolution or codec restrictions and remuxes losslessly',async()=>{
  const downloadDir=await mkdtemp(join(dir,'download-')),high=join(downloadDir,'original.webm');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=3840x2160:r=60:d=0.15','-f','lavfi','-i','sine=frequency=440:duration=0.15','-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','8','-threads','2','-b:v','1M','-c:a','libopus','-shortest',high]);
  const formats=[
    {format_id:'compatible',url:source,ext:'mp4',width:320,height:180,fps:30,vcodec:'avc1',acodec:'mp4a',tbr:200},
    {format_id:'best-video',url:high,ext:'webm',width:3840,height:2160,fps:60,vcodec:'vp9',acodec:'none',vbr:1000},
    {format_id:'compatible-audio',url:source,ext:'m4a',vcodec:'none',acodec:'mp4a',abr:128,asr:44100},
    {format_id:'best-audio',url:high,ext:'webm',vcodec:'none',acodec:'opus',abr:256,asr:48000}
  ];
  const fixture=join(downloadDir,'downloader.py');
  const metadata={id:'dQw4w9WgXcQ',title:'Origem máxima',duration:0.15,extractor:'fixture',formats:formats.map(format=>({...format,url:'file://'+format.url}))};
  const metadataFile=join(downloadDir,'downloader.json');
  await writeFile(metadataFile,JSON.stringify(metadata));
  const unrelated=join(downloadDir,'arquivo-esparso');
  await writeFile(unrelated,'');
  await truncate(unrelated,3*1024**3);
  const previousPython=process.env.CUTS_PYTHON;
  const interpreter=execFileSync(previousPython||'python3',['-c','import sys; print(sys.executable)'],{encoding:'utf8'}).trim();
  // Replace only remote I/O. The installed yt-dlp parses our real CLI options
  // and selects formats from synthetic metadata; FFmpeg remuxes real streams.
  await writeFile(fixture,`#!${interpreter}
import json, subprocess, sys, time
from pathlib import Path
import yt_dlp
info = json.loads(Path(__file__).with_suffix('.json').read_text())
if '--dump-single-json' in sys.argv:
    print(json.dumps(info))
else:
    options = yt_dlp.parse_options(sys.argv[3:]).ydl_opts
    assert options.get('max_filesize') is None
    time.sleep(0.5)
    with yt_dlp.YoutubeDL(options) as downloader:
        selected = downloader.process_ie_result(info, download=False)
        streams = selected.get('requested_formats') or [selected]
        args = ['ffmpeg', '-v', 'error']
        for stream in streams:
            args += ['-i', stream['url']]
        args += ['-map', '0:v:0', '-map', ('1' if len(streams) > 1 else '0') + ':a:0', '-c', 'copy', downloader.prepare_filename(selected)]
        subprocess.run(args, check=True)
`,{mode:0o700});
  try {
    process.env.CUTS_PYTHON=fixture;
    await downloadCutSource('https://youtu.be/dQw4w9WgXcQ',downloadDir);
    const downloaded=join(downloadDir,'source.mp4');
    const streams=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_name,width,height,r_frame_rate','-of','json',downloaded],{encoding:'utf8'})).streams;
    assert.equal(streams[0].codec_name,'vp9');assert.equal(streams[1].codec_name,'opus');
    assert.equal(streams[0].width,3840);assert.equal(streams[0].height,2160);assert.equal(streams[0].r_frame_rate,'60/1');
    const packets=(path:string)=>JSON.parse(execFileSync('ffprobe',['-v','error','-show_packets','-show_entries','packet=stream_index,data_hash','-show_data_hash','sha256','-of','json',path],{encoding:'utf8'})).packets;
    for(const stream of [0,1]) {
      const hashes=(path:string)=>packets(path).filter((packet:{stream_index:number})=>packet.stream_index===stream).map((packet:{data_hash:string})=>packet.data_hash);
      assert.deepEqual(hashes(downloaded),hashes(high),'original encoded source packets survive the MP4 remux');
    }
    await downloadCutSource('https://youtu.be/dQw4w9WgXcQ',downloadDir,undefined,'review');
    const preview=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',downloaded],{encoding:'utf8'})).streams[0];
    assert.deepEqual(preview,{width:320,height:180});
    await writeFile(metadataFile,JSON.stringify({...metadata,requested_formats:[{filesize:Number.MAX_SAFE_INTEGER}]}));
    await assert.rejects(()=>downloadCutSource('https://youtu.be/dQw4w9WgXcQ',downloadDir),/Espaço insuficiente no disco para baixar a fonte/);
    assert.equal((await stat(unrelated)).size,3*1024**3,'disk checks leave existing files alone');
  }finally {
    if(previousPython===undefined)delete process.env.CUTS_PYTHON;else process.env.CUTS_PYTHON=previousPython;
  }
});

test('a live pode fornecer um trecho com a imagem e o áudio originais e sem o quadro anterior ao início',async()=>{
  const downloadDir=await mkdtemp(join(dir,'window-'));
  const video=join(downloadDir,'video.mp4'),audio=join(downloadDir,'audio.m4a'),fixture=join(downloadDir,'downloader.py');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=red:s=160x90:r=60:d=4',
    '-f','lavfi','-i','color=c=blue:s=160x90:r=60:d=7',
    '-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-c:v','libx264',
    '-g','720','-sc_threshold','0','-pix_fmt','yuv420p',video]);
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=d=11:r=48000','-c:a','aac',audio]);
  await writeFile(join(downloadDir,'downloader.json'),JSON.stringify({
    id:'dQw4w9WgXcQ',title:'Live de teste',duration:18000,live_status:'was_live',
    formats:[
      {format_id:'video',url:'file://'+video,ext:'mp4',protocol:'https',width:160,height:90,fps:60,vcodec:'avc1',acodec:'none'},
      {format_id:'audio',url:'file://'+audio,ext:'m4a',protocol:'https',vcodec:'none',acodec:'aac'},
    ],
  }));
  const previousPython=process.env.CUTS_PYTHON;
  const interpreter=execFileSync(previousPython||'python3',['-c','import sys; print(sys.executable)'],{encoding:'utf8'}).trim();
  await writeFile(fixture,`#!${interpreter}
import json, sys
from pathlib import Path
import yt_dlp
info = json.loads(Path(__file__).with_suffix('.json').read_text())
if '--dump-single-json' in sys.argv:
    print(json.dumps({**info, 'filesize': 9007199254740991}))
else:
    options = yt_dlp.parse_options(sys.argv[3:]).ydl_opts
    options['enable_file_urls'] = True
    with yt_dlp.YoutubeDL(options) as downloader:
        downloader.process_ie_result(info, download=True)
`,{mode:0o700});
  try {
    process.env.CUTS_PYTHON=fixture;
    const result=await downloadCutSource('https://youtu.be/dQw4w9WgXcQ',downloadDir,{start:4.5,end:7.5});
    assert.ok(Math.abs(result.duration-3)<.1);
    const file=join(downloadDir,'source.mp4');
    const {streams}=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries',
      'stream=codec_name,width,height,r_frame_rate,start_time','-of','json',file],{encoding:'utf8'}));
    assert.equal(streams[0].codec_name,'h264');assert.equal(streams[1].codec_name,'aac');
    assert.equal(streams[0].width,160);assert.equal(streams[0].height,90);assert.equal(streams[0].r_frame_rate,'60/1');
    assert.ok(streams.every((stream:{start_time:string})=>Math.abs(Number(stream.start_time))<.05));
    const first=execFileSync('ffmpeg',['-v','error','-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);
    assert.ok(first[0]<10&&first[1]<10&&first[2]>240,'the first presented frame comes from the selected window');
    const firstPart=join(downloadDir,'first-part');
    await downloadCutSource('https://youtu.be/dQw4w9WgXcQ',firstPart,{start:1.25,end:2});
    const {path}=await renderCut(downloadDir,randomUUID(),{
      start:1.25,end:5.25,captions:[{start:1.4,end:1.7,text:'Antes'},{start:4.8,end:5.2,text:'Depois'}],
      framing:'fit',framingOptions:framingOptionsSchema.parse({format:'video'}),captionStyle:noCaptions,excludedRanges:[{start:2,end:4.5}]
    },{sourceParts:[{path:join(firstPart,'source.mp4'),seek:0},{path:file,seek:0}]});
    assert.ok(path.endsWith('.master.mp4'));
    const frame=(at:string)=>execFileSync('ffmpeg',['-v','error','-ss',at,'-i',path,'-vf','scale=2:2','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);
    assert.ok(frame('0.1')[0]>240&&frame('0.85')[2]>240,'the final export joins only the retained original sections');
    assert.ok(Math.abs((await validateVideo(path,'video')).duration-1.5)<.06);
    const fps=execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=r_frame_rate','-of','csv=p=0',path],{encoding:'utf8'});
    assert.equal(fps.trim(),'60/1');
  }finally {
    if(previousPython===undefined)delete process.env.CUTS_PYTHON;else process.env.CUTS_PYTHON=previousPython;
  }
});

after(async()=>{await rm(dir,{recursive:true,force:true});});
