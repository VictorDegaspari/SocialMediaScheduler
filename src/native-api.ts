import { open,stat } from 'node:fs/promises';
import { AppError,retryAfter } from './config.js';
import { providerFetch,tiktokRequest,youtubeToken,tiktokToken } from './native-auth.js';
import type { Metadata } from './domain.js';
import {youtubeTagLength} from './editorial.js';

const CHUNK=8*1024*1024;
export interface UploadSession {provider:'youtube'|'tiktok';url:string;size:number;publishId?:string;chunkSize?:number;chunks?:number;finalizing?:boolean;publishAt?:string;}
export type SaveSession=(session:UploadSession)=>Promise<void>;
function uploadUrl(value:string,provider:'youtube'|'tiktok') {
  let url:URL;
  try {url=new URL(value);} catch {throw new AppError('A plataforma retornou uma sessão de upload inválida.',502);}
  const suffix=provider==='youtube'?'.googleapis.com':'.tiktokapis.com';
  if(url.protocol!=='https:' || !url.hostname.endsWith(suffix) || url.username || url.password || (url.port && url.port!=='443')) throw new AppError('A plataforma retornou um endereço de upload não permitido.',502);
  return url.href;
}
export function youtubeBody(meta:Metadata,publishAt?:Date) {
  if(publishAt&&(!Number.isFinite(publishAt.getTime())||publishAt.getTime()<=Date.now()))throw new AppError('A data de publicação do YouTube precisa estar no futuro.');
  if(publishAt&&meta.youtube.visibility!=='public')throw new AppError('Agendamento nativo do YouTube exige visibilidade public no JSON; o vídeo fica privado até a data escolhida.');
  const description=[meta.description,meta.hashtags.map(t=>'#'+t.replace(/^#+/,'').replace(/\s+/g,'')).join(' ')].filter(Boolean).join('\n\n');
  if(Buffer.byteLength(description,'utf8')>5000 || /[<>]/.test(meta.title+description) || youtubeTagLength(meta.youtube.tags)>500) throw new AppError('Título, descrição ou tags excedem os limites do YouTube.');
  return {snippet:{title:meta.title,description,tags:meta.youtube.tags,categoryId:'22'},status:{privacyStatus:publishAt?'private':meta.youtube.visibility,...(publishAt?{publishAt:publishAt.toISOString()}:{}),selfDeclaredMadeForKids:meta.youtube.madeForKids,containsSyntheticMedia:meta.youtube.containsSyntheticMedia}};
}
export function tiktokChunks(size:number) {if(!Number.isSafeInteger(size)||size<=0)throw new AppError('Tamanho de vídeo inválido.');const chunkSize=Math.min(CHUNK,size);return {chunkSize,chunks:Math.max(1,Math.floor(size/chunkSize))};}
async function piece(path:string,start:number,length:number) {
  const file=await open(path,'r');
  try {
    const buffer=Buffer.alloc(length);let offset=0;
    while(offset<length){const read=await file.read(buffer,offset,length-offset,start+offset);if(!read.bytesRead)throw new AppError('A cópia local está incompleta. O envio foi interrompido.');offset+=read.bytesRead;}
    return buffer;
  } finally {await file.close();}
}
async function youtubeResult(response:Response) {
  let body:any;try{body=await response.json();}catch{throw new AppError('YouTube não confirmou o ID. A sessão será consultada novamente.',503);}
  if(typeof body.id!=='string' || !/^[\w-]{6,100}$/.test(body.id))throw new AppError('YouTube retornou um resultado sem identificação. Confira o canal antes de repetir.',502,true);
  return body.id as string;
}
export async function uploadYoutube(path:string,meta:Metadata,session:UploadSession|null,save:SaveSession,expectedChannelId?:string,publishAt?:Date) {
  const token=await youtubeToken(expectedChannelId),size=(await stat(path)).size;
  if(session && (session.provider!=='youtube' || session.size!==size)) throw new AppError('A cópia local não corresponde à sessão de upload.',409,true);
  let offset=0;
  if(!session) {
    const response=await providerFetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=false',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Upload-Content-Type':'video/mp4','X-Upload-Content-Length':String(size)},body:JSON.stringify(youtubeBody(meta,publishAt))},'YouTube');
    session={provider:'youtube',url:uploadUrl(response.headers.get('location')||'','youtube'),size,...(publishAt?{publishAt:publishAt.toISOString()}:{})};
    await response.body?.cancel();await save(session);
  } else {
    // A committed final chunk can be recovered here without videos.insert again.
    let response:Response;
    try {response=await providerFetch(uploadUrl(session.url,'youtube'),{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Length':'0','Content-Range':`bytes */${size}`}},'YouTube');}
    catch(error) {if(error instanceof AppError && [404,410].includes(error.status))throw new AppError('A sessão do YouTube expirou. Confira se o vídeo foi criado antes de reenviar.',409,true);throw error;}
    if(response.status===200 || response.status===201)return youtubeResult(response);
    if(response.status!==308)throw new AppError('O YouTube não confirmou a posição do upload.',502,true);
    const range=response.headers.get('range');
    if(range && !/^bytes=0-\d+$/.test(range))throw new AppError('O YouTube retornou uma posição de upload inválida.',502,true);
    offset=range?Number(range.split('-')[1])+1:0;
    await response.body?.cancel();
    const delay=retryAfter(response);if(delay)throw new AppError('YouTube pediu para aguardar antes de retomar o upload.',429,false,delay);
  }
  while(offset<size) {
    if(session.publishAt&&Date.parse(session.publishAt)<=Date.now()+60_000)throw new AppError('O horário reservado está próximo ou passou. Confira a sessão no YouTube antes de reagendar.',409,true);
    const end=Math.min(size,offset+CHUNK);
    if(end===size){session.finalizing=true;await save(session);}
    const bytes=await piece(path,offset,end-offset);
    const response=await providerFetch(uploadUrl(session.url,'youtube'),{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'video/mp4','Content-Length':String(bytes.length),'Content-Range':`bytes ${offset}-${end-1}/${size}`},body:bytes},'YouTube');
    if(response.status===200 || response.status===201)return youtubeResult(response);
    if(response.status!==308)throw new AppError('YouTube não confirmou o bloco enviado. A sessão será consultada novamente.',503);
    const range=response.headers.get('range'),next=range&&/^bytes=0-\d+$/.test(range)?Number(range.split('-')[1])+1:0;
    await response.body?.cancel();
    const delay=retryAfter(response);if(delay)throw new AppError('YouTube pediu para aguardar antes de retomar o upload.',429,false,delay);
    if(next!==end)throw new AppError('YouTube ainda não confirmou o bloco completo. A sessão será consultada novamente.',503);
    offset=end;
  }
  throw new AppError('O upload terminou sem confirmação do vídeo. Confira o canal antes de repetir.',409,true);
}
export async function youtubeStatus(id:string,channelId?:string) {
  const token=await youtubeToken(channelId);
  const response=await providerFetch('https://www.googleapis.com/youtube/v3/videos?part=snippet,status,processingDetails&id='+encodeURIComponent(id),{headers:{Authorization:`Bearer ${token}`}},'YouTube');
  const result=await response.json();const item=result.items?.find((v:any)=>v.id===id && (!channelId || v.snippet?.channelId===channelId));
  if(!item)return null;
  if(['failed','rejected','deleted'].includes(item.status?.uploadStatus) || item.processingDetails?.processingStatus==='failed')return 'failed';
  if(item.status?.privacyStatus==='private'&&item.status?.publishAt&&Date.parse(item.status.publishAt)>Date.now())return 'scheduled';
  if(item.status?.uploadStatus!=='processed')return 'processing';
  return item.status?.privacyStatus==='public'?'published':item.status?.privacyStatus==='unlisted'?'unlisted':'private';
}
export function youtubeTitleBody(video:any,title:string) {
  if(!title.trim()||title.trim().length>100||!video.id||!video.snippet?.categoryId)throw new AppError('Título ou metadados do vídeo inválidos.');
  const snippet:Record<string,unknown>={title:title.trim(),categoryId:video.snippet.categoryId,description:video.snippet.description||''};
  for(const field of ['tags','defaultLanguage','defaultAudioLanguage'])if(video.snippet[field]!==undefined)snippet[field]=video.snippet[field];
  return {id:video.id,snippet};
}
export async function updateYoutubeTitle(id:string,title:string,channelId:string) {
  const token=await youtubeToken(channelId),headers={Authorization:`Bearer ${token}`};
  const read=async()=>{
    const response=await providerFetch('https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id='+encodeURIComponent(id),{headers},'YouTube');
    const data=await response.json(),video=data.items?.find((v:any)=>v.id===id&&v.snippet?.channelId===channelId);
    if(!video)throw new AppError('O vídeo não pertence ao canal conectado ou não está disponível.',404);
    return video;
  };
  const before=await read();
  if(before.snippet.title!==title) {
    const response=await providerFetch('https://www.googleapis.com/youtube/v3/videos?part=snippet',{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(youtubeTitleBody(before,title))},'YouTube');
    await response.body?.cancel();
  }
  const after=await read();if(after.snippet.title!==title)throw new AppError('O YouTube ainda não confirmou o novo título.',503);
  return {id:after.id,title:after.snippet.title};
}
export function youtubeDisclosureBody(video:any,containsSyntheticMedia:boolean,now=new Date()) {
  const current=video.status;
  if(!video.id||!current||!['public','private','unlisted'].includes(current.privacyStatus))throw new AppError('Não foi possível verificar a privacidade atual do vídeo.');
  if(current.publishAt&&(current.privacyStatus!=='private'||!Number.isFinite(Date.parse(current.publishAt))||Date.parse(current.publishAt)<=now.getTime()))
    throw new AppError('A data atual precisa ser conferida antes de atualizar a declaração do vídeo.',409);
  const status:Record<string,unknown>={privacyStatus:current.privacyStatus,containsSyntheticMedia};
  for(const field of ['publishAt','license','embeddable','publicStatsViewable','selfDeclaredMadeForKids'])if(current[field]!==undefined)status[field]=current[field];
  return {id:video.id,status};
}
export async function updateYoutubeDisclosure(id:string,containsSyntheticMedia:boolean,channelId:string) {
  const token=await youtubeToken(channelId),headers={Authorization:`Bearer ${token}`};
  const read=async()=>{
    const response=await providerFetch('https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id='+encodeURIComponent(id),{headers},'YouTube');
    const data=await response.json(),video=data.items?.find((v:any)=>v.id===id&&v.snippet?.channelId===channelId);
    if(!video)throw new AppError('O vídeo não pertence ao canal conectado ou não está disponível.',404);
    return video;
  };
  const before=await read(),body=youtubeDisclosureBody(before,containsSyntheticMedia);
  const response=await providerFetch('https://www.googleapis.com/youtube/v3/videos?part=status',{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)},'YouTube');
  await response.body?.cancel();
  const after=await read();
  if(after.status.privacyStatus!==before.status.privacyStatus||after.status.publishAt!==before.status.publishAt)throw new AppError('A privacidade ou a data retornada exige conferência.',409);
  // Some responses omit this writeable field. Do not infer a value from omission.
  return {id,apiAccepted:true,containsSyntheticMedia,reportedSyntheticMedia:after.status.containsSyntheticMedia??null,privacyStatus:after.status.privacyStatus,publishAt:after.status.publishAt||null};
}
export async function tiktokStatus(id:string,expectedOpenId?:string) {return tiktokRequest('/v2/post/publish/status/fetch/',await tiktokToken(expectedOpenId),{publish_id:id});}
export async function uploadTiktok(path:string,session:UploadSession|null,save:SaveSession,expectedOpenId?:string) {
  const token=await tiktokToken(expectedOpenId),size=(await stat(path)).size;
  if(session && (session.provider!=='tiktok' || session.size!==size))throw new AppError('A cópia local não corresponde à sessão TikTok.',409,true);
  let offset=0;
  if(!session) {
    const {chunkSize,chunks}=tiktokChunks(size);
    const data=await tiktokRequest('/v2/post/publish/inbox/video/init/',token,{source_info:{source:'FILE_UPLOAD',video_size:size,chunk_size:chunkSize,total_chunk_count:chunks}});
    if(typeof data?.publish_id!=='string')throw new AppError('TikTok não retornou uma identificação do envio.',502);
    session={provider:'tiktok',url:uploadUrl(data.upload_url,'tiktok'),size,publishId:data.publish_id,chunkSize,chunks};
    await save(session);
  } else {
    const status=await tiktokStatus(session.publishId!,expectedOpenId);
    if(['SEND_TO_USER_INBOX','PUBLISH_COMPLETE','PROCESSING_DOWNLOAD'].includes(status.status))return session.publishId!;
    if(status.status==='FAILED')throw new AppError('TikTok recusou este envio. Consulte o aplicativo antes de iniciar outra tentativa.',400);
    if(status.status!=='PROCESSING_UPLOAD' || !Number.isSafeInteger(status.uploaded_bytes))throw new AppError('TikTok não confirmou a posição do upload. Confira a conta antes de repetir.',409,true);
    offset=status.uploaded_bytes;
    if(offset===size)return session.publishId!;
    if(offset<0 || offset>size || offset%session.chunkSize!!==0)throw new AppError('TikTok retornou uma posição de upload ambígua.',409,true);
  }
  while(offset<size) {
    const chunkSize=session.chunkSize!,chunks=session.chunks!;
    const end=offset/chunkSize===chunks-1?size:offset+chunkSize;
    if(end===size){session.finalizing=true;await save(session);}
    const bytes=await piece(path,offset,end-offset);
    const response=await providerFetch(uploadUrl(session.url,'tiktok'),{method:'PUT',headers:{'Content-Type':'video/mp4','Content-Length':String(bytes.length),'Content-Range':`bytes ${offset}-${end-1}/${size}`},body:bytes},'TikTok');
    await response.body?.cancel();offset=end;
  }
  return session.publishId!;
}
