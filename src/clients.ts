import { OAuth2Client, type Credentials } from 'google-auth-library';
import { openAsBlob } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError, appUrl, retryAfter } from './config.js';
import { getSetting, setSetting } from './db.js';
import type { Integration } from './domain.js';

export interface GoogleConfig { clientId:string; clientSecret:string; }
export interface PostizConfig { baseUrl:string; apiKey:string; youtubeSchedulingApproved:boolean; }
export interface DriveFile { id:string; name:string; mimeType:string; parents?:string[]; size?:string; version?:string; modifiedTime?:string; capabilities?:{canDownload?:boolean}; }

export async function googleClient() {
  const config = await getSetting<GoogleConfig>('google');
  if (!config) throw new AppError('Cadastre as credenciais OAuth do Google em Conexões.');
  return new OAuth2Client(config.clientId,config.clientSecret,`${appUrl}/auth/google/callback`);
}

export async function driveToken(): Promise<string> {
  const stored = await getSetting<Credentials>('googleTokens');
  if (!stored?.refresh_token) throw new AppError('Conecte sua conta do Google Drive em Conexões.',401);
  const client = await googleClient();
  client.setCredentials(stored);
  try {
    const {token} = await client.getAccessToken();
    if (!token) throw new Error('missing token');
    if (client.credentials.access_token !== stored.access_token || client.credentials.expiry_date !== stored.expiry_date) {
      await setSetting('googleTokens',{...stored,...client.credentials,refresh_token:client.credentials.refresh_token || stored.refresh_token});
    }
    return token;
  } catch {
    throw new AppError('A autorização do Google expirou ou foi revogada. Reconecte sua conta em Conexões.',401);
  }
}

export class GoogleDrive {
  constructor(private token:string) {}
  private async request(path:string,params:Record<string,string> = {},timeout=60_000) {
    const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
    for (const [k,v] of Object.entries(params)) url.searchParams.set(k,v);
    const response = await fetch(url,{headers:{Authorization:`Bearer ${this.token}`},signal:AbortSignal.timeout(timeout)});
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(response.status===401?'Reconecte sua conta Google.':response.status===403?'O Google não permitiu a operação. Verifique acesso, download e quota da conta.':response.status===404?'Pasta ou arquivo não encontrado no Drive para esta conta.':`Google Drive respondeu com erro ${response.status}.`, response.status,false,retryAfter(response));
    }
    return response;
  }
  async file(id:string):Promise<DriveFile> {
    return (await this.request(`files/${encodeURIComponent(id)}`,{fields:'id,name,mimeType,parents,size,version,modifiedTime,capabilities(canDownload)',supportsAllDrives:'true'})).json() as Promise<DriveFile>;
  }
  async list(parent:string):Promise<DriveFile[]> {
    const files:DriveFile[]=[];
    let pageToken='';
    do {
      const response=await this.request('files',{q:`'${parent}' in parents and trashed = false`,pageSize:'1000',fields:'nextPageToken,incompleteSearch,files(id,name,mimeType,parents,size,version,modifiedTime,capabilities(canDownload))',supportsAllDrives:'true',includeItemsFromAllDrives:'true',...(pageToken?{pageToken}:{})});
      const body=await response.json() as {files:DriveFile[];nextPageToken?:string;incompleteSearch?:boolean};
      if(body.incompleteSearch) throw new AppError('A pesquisa do Drive ficou incompleta. Tente uma pasta de uma única unidade.');
      files.push(...body.files);
      if(files.length>5000) throw new AppError('Limite de 5.000 arquivos por varredura. Divida o conteúdo em pastas menores.');
      pageToken=body.nextPageToken || '';
    } while(pageToken);
    return files;
  }
  async tree(root:string,recursive:boolean):Promise<DriveFile[]> {
    return this.treeRoots([root],recursive);
  }
  async treeRoots(roots:string[],recursive:boolean):Promise<DriveFile[]> {
    const queue=[...new Set(roots)], visited=new Set<string>(), files=new Map<string,DriveFile>();
    while(queue.length) {
      const id=queue.shift()!;
      if(visited.has(id)) continue;
      visited.add(id);
      if(visited.size>200) throw new AppError('Limite de 200 subpastas por rotina. Selecione uma pasta menor.');
      for(const file of await this.list(id)) {
        if(file.mimeType==='application/vnd.google-apps.folder') { if(recursive) queue.push(file.id); }
        else files.set(file.id,{...file,parents:[id]});
      }
      if(files.size>5000) throw new AppError('Limite de 5.000 arquivos por rotina. Divida o conteúdo em pastas menores.');
    }
    return [...files.values()];
  }
  async json(id:string):Promise<unknown> {
    const response=await this.request(`files/${encodeURIComponent(id)}`,{alt:'media',supportsAllDrives:'true'});
    let size=0;
    const parts:Uint8Array[]=[];
    for await(const part of Readable.fromWeb(response.body as never)) {
      size+=part.length;
      if(size>65536) { throw new AppError('JSON de metadados excede 64 KiB.'); }
      parts.push(part);
    }
    try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
    catch { throw new AppError('JSON de metadados inválido.'); }
  }
  async download(id:string,path:string,maxBytes:number) {
    const response=await this.request(`files/${encodeURIComponent(id)}`,{alt:'media',supportsAllDrives:'true'},15*60_000);
    let size=0;
    const cap=new Transform({transform(chunk,_encoding,callback){size+=chunk.length;callback(size>maxBytes?new AppError('O vídeo excede o limite de 1 GiB.'):null,chunk);}});
    await pipeline(Readable.fromWeb(response.body as never),cap,createWriteStream(path,{mode:0o600}));
    return size;
  }
}

export class Postiz {
  constructor(private config:PostizConfig) {}
  async request(path:string,options:RequestInit={},mutation=false) {
    let response:Response;
    try {
      response=await fetch(this.config.baseUrl.replace(/\/$/,'')+path,{...options,headers:{Authorization:this.config.apiKey,...options.headers},signal:AbortSignal.timeout(path==='/upload'?15*60_000:60_000)});
    } catch { throw new AppError('Postiz não respondeu. Verifique o endereço e sua conexão.',502,mutation); }
    if(!response.ok) {
      const status=response.status;
      let detail='';
      try { const body=await response.json() as Record<string,unknown>; const msg=body.msg || body.message; if(typeof msg==='string' && msg.length<350) detail=msg.replace(/https?:\/\/\S+/g,'[endereço]'); } catch {}
      detail=detail.replaceAll(this.config.apiKey,'[segredo]');
      throw new AppError(`Postiz respondeu ${status}${detail?`: ${detail}`:'. Verifique o acesso e a configuração.'}`,status,mutation && (status>=500 || status===408),retryAfter(response));
    }
    try { return await response.json(); }
    catch { throw new AppError('Postiz retornou uma resposta inválida.',502,mutation); }
  }
  async integrations():Promise<Integration[]> {
    const rows=await this.request('/integrations');
    if(!Array.isArray(rows)) throw new AppError('O endereço informado não retornou a lista de canais Postiz.');
    return rows.filter(c=>['youtube','tiktok','tiktok-business'].includes(c.identifier)).map(c=>({id:c.id,name:c.name,identifier:c.identifier,disabled:!!c.disabled,profile:c.profile}));
  }
  async upload(path:string) {
    const form=new FormData();
    form.set('file',await openAsBlob(path,{type:'video/mp4'}),'video.mp4');
    form.set('adjust','false');
    const media=await this.request('/upload',{method:'POST',body:form});
    if(typeof media.id!=='string' || typeof media.path!=='string') throw new AppError('O upload não retornou id e path válidos.');
    return {id:media.id as string,path:media.path as string};
  }
  async create(payload:unknown):Promise<string> {
    const response=await this.request('/posts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},true);
    if(!Array.isArray(response) || response.length!==1 || typeof response[0]?.postId!=='string') throw new AppError('Criação com resultado desconhecido. Confira o calendário do Postiz.',502,true);
    return response[0].postId;
  }
  async posts(start:Date,end:Date) {
    const query=new URLSearchParams({startDate:start.toISOString(),endDate:end.toISOString()});
    const result=await this.request(`/posts?${query}`);
    if(!Array.isArray(result.posts)) throw new AppError('Lista de posts inválida.');
    return result.posts as Array<{id:string;state:string;error?:string;releaseURL?:string;integration?:{id:string}}>;
  }
}

export async function postizClient() {
  const config=await getSetting<PostizConfig>('postiz');
  if(!config) throw new AppError('Configure o Postiz em Conexões.');
  return new Postiz(config);
}
