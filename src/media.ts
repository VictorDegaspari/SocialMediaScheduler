import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AppError } from './config.js';
import type { CutFormat } from './cuts-edit.js';

export async function stripVideoMetadata(input:string,output:string,format:CutFormat|'any'='shorts',maxSeconds=180):Promise<void> {
  if(resolve(input)===resolve(output)) throw new AppError('A limpeza precisa de uma cópia separada do vídeo.');
  try {
    await promisify(execFile)('ffmpeg',[
      '-nostdin','-hide_banner','-loglevel','error','-y','-i',input,
      '-map','0:V:0','-map','0:a?',
      '-map_metadata','-1','-map_metadata:s','-1','-map_chapters','-1',
      '-c','copy','-metadata','encoder=','-metadata:s','encoder=',
      '-fflags','+bitexact',
      '-movflags','+faststart',output
    ],{timeout:120_000,maxBuffer:65536});
    // Stream copy preserves the encoded audio/video and the display rotation.
    // MP4 structural fields remain; this is not an AI-detection bypass.
    await validateVideo(output,format,maxSeconds);
  } catch {
    await rm(output,{force:true}).catch(()=>{});
    throw new AppError('Não foi possível remover os metadados do vídeo. O arquivo original não foi enviado.');
  }
}

export async function sha256(path:string):Promise<string> {
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function validateVideo(path:string,format:CutFormat|'any'='shorts',maxSeconds=180) {
  let stdout:string;
  try {
    // The enclosing list exists in FFmpeg 4.4 (Ubuntu 22.04) and newer releases.
    ({stdout}=await promisify(execFile)('ffprobe',['-v','error','-f','mov','-protocol_whitelist','file','-show_entries','format=duration,format_name:stream=codec_type,width,height:stream_tags=rotate:stream_side_data_list','-of','json',path],{timeout:30_000,maxBuffer:65536}));
  } catch { throw new AppError('Não foi possível ler o vídeo. Verifique se o MP4 está completo e reproduz corretamente.'); }
  const info=JSON.parse(stdout);
  const stream=info.streams?.find((s:{codec_type:string})=>s.codec_type==='video');
  if(!stream || !String(info.format?.format_name).includes('mp4')) throw new AppError('Arquivo não é um vídeo MP4 válido.');
  const duration=Number(info.format?.duration);
  if(!Number.isFinite(duration) || duration<=0 || duration>maxSeconds) throw new AppError(`Envie vídeos com até ${maxSeconds} segundos para este fluxo.`);
  const rotation=Math.abs(Number(stream.side_data_list?.find((d:{rotation?:number})=>d.rotation!==undefined)?.rotation || stream.tags?.rotate || 0)) % 180;
  const width=rotation===90?stream.height:stream.width;
  const height=rotation===90?stream.width:stream.height;
  if(!width || !height) throw new AppError('Não foi possível identificar as dimensões do vídeo.');
  if(format==='shorts'&&width>height) throw new AppError('Para Shorts, o vídeo precisa ser vertical ou quadrado.');
  if(format==='video'&&width<=height) throw new AppError('Para postar como vídeo, gere uma prévia horizontal em Ajustar.');
  return {duration,width,height};
}
