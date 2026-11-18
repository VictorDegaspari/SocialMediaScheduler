import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const {stripVideoMetadata,validateVideo,sha256}=await import('../src/media.js');
const dir=await mkdtemp(join(tmpdir(),'watcher-metadata-test-'));
const source=join(dir,'original.mp4');
const tagged=join(dir,'tagged.mp4');
const cleaned=join(dir,'cleaned.mp4');
const chapters=join(dir,'chapters.txt');
execFileSync('ffmpeg',['-loglevel','error','-f','lavfi','-i','color=c=blue:s=64x96:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',source]);
await writeFile(chapters,';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=Private chapter\n');
execFileSync('ffmpeg',['-loglevel','error','-i',source,'-i',chapters,'-map','0:v','-map','0:a','-c','copy','-map_chapters','1','-metadata','title=Private title','-metadata','comment=Private comment','-metadata','artist=Private author','-metadata','creation_time=2024-01-01T12:00:00Z','-metadata:s:v:0','title=Private stream','-metadata:s:a:0','language=por','-movflags','+use_metadata_tags',tagged]);

function probe(path:string){return JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-show_chapters','-of','json',path],{encoding:'utf8'}));}
function packets(path:string){
  const info=JSON.parse(execFileSync('ffprobe',['-v','error','-show_packets','-show_entries','packet=stream_index,data_hash','-show_data_hash','sha256','-of','json',path],{encoding:'utf8'}));
  return info.packets.filter((p:{stream_index:number})=>p.stream_index<2).map((p:{stream_index:number;data_hash:string})=>[p.stream_index,p.data_hash]);
}

test('remove tags e capítulos sem alterar os pacotes de áudio/vídeo ou o original',async()=>{
  const before=await sha256(tagged);
  const input=probe(tagged);
  assert.equal(input.format.tags.title,'Private title');
  assert.equal(input.chapters.length,1);
  await stripVideoMetadata(tagged,cleaned);
  const output=probe(cleaned);
  for(const key of ['title','comment','artist','creation_time','encoder'])assert.equal(output.format.tags?.[key],undefined,key);
  assert.equal(output.chapters.length,0);
  for(const stream of output.streams){
    assert.equal(stream.tags?.title,undefined);
    assert.equal(stream.tags?.creation_time,undefined);
    assert.equal(stream.tags?.encoder,undefined);
  }
  assert.deepEqual(output.streams.map((s:{codec_type:string})=>s.codec_type),['video','audio']);
  assert.deepEqual(packets(cleaned),packets(tagged),'compressed audio/video packets must stay identical');
  assert.equal(await sha256(tagged),before,'the source must be untouched');
});

test('preserva a orientação de vídeos com matriz de rotação',async()=>{
  const horizontal=join(dir,'horizontal.mp4'),rotated=join(dir,'rotated.mp4'),out=join(dir,'rotated-clean.mp4');
  execFileSync('ffmpeg',['-loglevel','error','-f','lavfi','-i','color=c=red:s=96x64:d=1','-c:v','libx264',horizontal]);
  execFileSync('ffmpeg',['-loglevel','error','-i',horizontal,'-c','copy','-metadata:s:v:0','rotate=90',rotated]);
  const before=await validateVideo(rotated);
  assert.equal(before.width,64);assert.equal(before.height,96);
  await stripVideoMetadata(rotated,out);
  assert.deepEqual(await validateVideo(out),before);
});

test('aceita vídeo horizontal somente quando o formato de vídeo comum é solicitado',async()=>{
  const horizontal=join(dir,'regular-video.mp4');
  execFileSync('ffmpeg',['-loglevel','error','-f','lavfi','-i','color=c=red:s=96x54:d=1','-c:v','libx264',horizontal]);
  await assert.rejects(()=>validateVideo(horizontal),/vertical ou quadrado/);
  const info=await validateVideo(horizontal,'video');assert.equal(info.width,96);assert.equal(info.height,54);
  await assert.rejects(()=>validateVideo(source,'video'),/prévia horizontal/);
});

test('falha na limpeza não substitui o original e remove a saída incompleta',async()=>{
  const bad=join(dir,'bad.mp4'),out=join(dir,'bad-clean.mp4');
  await writeFile(bad,'not a video');
  await assert.rejects(()=>stripVideoMetadata(bad,out),/Não foi possível remover/);
  assert.equal(await readFile(bad,'utf8'),'not a video');
  await assert.rejects(()=>readFile(out));
  await assert.rejects(()=>stripVideoMetadata(tagged,tagged),/cópia separada/);
});

after(async()=>{await rm(dir,{recursive:true,force:true});});
