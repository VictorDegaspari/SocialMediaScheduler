import {createHash,randomUUID} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {rm,readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {z} from 'zod';
import {AppError,retryAfter,dataDir} from './config.js';
import {metadataSchema,type Metadata} from './domain.js';
import {completeMetadata} from './editorial.js';
import type {DriveFile} from './clients.js';
import {PACK_ROOT,PACK_CATALOG_URL,packDefaultsSchema,packYoutubeSynthetic,type PackDefaults} from './pack-config.js';

const entry=z.object({t:z.string().trim().min(1).max(500),drive:z.string().regex(/^[\w-]{10,200}$/),type:z.enum(['v','img']).default('v')});
export type PackVideo=z.infer<typeof entry>;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function parsePackCatalog(value:unknown):PackVideo[] {
  if(!Array.isArray(value)||value.length>10000)throw new AppError('O catálogo do pack retornou um formato desconhecido.');
  const videos:PackVideo[]=[],ids=new Set<string>();
  for(const raw of value) {
    if(raw?.type==='img')continue;
    const parsed=entry.safeParse(raw);
    if(!parsed.success)throw new AppError('O catálogo do pack mudou de formato. Confira a origem antes de continuar.');
    if(!ids.has(parsed.data.drive)){ids.add(parsed.data.drive);videos.push(parsed.data);}
  }
  if(!videos.length||videos.length>5000)throw new AppError('O catálogo precisa conter entre 1 e 5.000 vídeos acessíveis.');
  return videos;
}
export function packMetadata(video:PackVideo,defaults:PackDefaults):Metadata {
  const meta=metadataSchema.parse({title:[defaults.titlePrefix,video.t].filter(Boolean).join(' ').slice(0,100),description:defaults.description,hashtags:defaults.hashtags,
    youtube:{visibility:defaults.youtubeVisibility,madeForKids:defaults.madeForKids,containsSyntheticMedia:packYoutubeSynthetic(defaults)},
    tiktok:{privacyLevel:'PUBLIC_TO_EVERYONE',madeWithAI:defaults.madeWithAI}});
  return completeMetadata(meta,{sourceTitle:video.t,titlePrefix:defaults.titlePrefix,options:defaults.editorial});
}
async function request(url:string,timeout=30_000) {
  let response:Response;
  try {response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(timeout)});}
  catch {throw new AppError('Não foi possível acessar o pack ou o arquivo no Drive. A tentativa será retomada.',503);}
  if(response.status>=400) {
    await response.body?.cancel();
    throw new AppError(response.status===403||response.status===401?'O Drive recusou o acesso. Confira se o vídeo pode ser baixado pela sua conta.':`A origem dos vídeos respondeu ${response.status}.`,response.status,false,retryAfter(response));
  }
  return response;
}
/** Only the catalog's public Drive IDs are accepted; arbitrary remote URLs are never fetched. */
export class PackSource {
  private static cached:{at:number;videos:PackVideo[]}|undefined;
  private static blockedUntil=0;
  private defaults:PackDefaults;
  private indexed:PackVideo[]|undefined;
  private entries=new Map<string,PackVideo>();
  private derived=new WeakMap<PackVideo,{metadata:Metadata;version:string}>();
  constructor(defaults:unknown={}){this.defaults=packDefaultsSchema.parse(defaults);}
  async catalog(force=false) {
    if(force||!PackSource.cached||Date.now()-PackSource.cached.at>60_000) {
      try {
      const response=await request(PACK_CATALOG_URL);
      if(response.status!==200||!response.headers.get('content-type')?.includes('application/json')){await response.body?.cancel();throw new AppError('O catálogo do pack não está disponível. Abra o site e confira seu acesso.');}
      const parts:Buffer[]=[];let size=0;
      for await(const part of Readable.fromWeb(response.body as never)) {size+=part.length;if(size>2*1024*1024)throw new AppError('O catálogo do pack excedeu o tamanho permitido.');parts.push(part);}
      let data:unknown;try{data=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new AppError('O catálogo do pack não retornou JSON válido.');}
      const videos=parsePackCatalog(data),at=Date.now();
      const directory=join(dataDir,'source-cache'),path=join(directory,'gta6-catalog.json');
      const temporary=path+'.'+randomUUID()+'.tmp';
      // Persistence is a best-effort optimization; read-only CLI installations
      // can still use a successfully fetched catalog in memory.
      try {await mkdir(directory,{recursive:true,mode:0o700});await writeFile(temporary,JSON.stringify({source:PACK_CATALOG_URL,fetchedAt:at,videos}),{mode:0o600});await rename(temporary,path);}
      catch {} finally {await rm(temporary,{force:true}).catch(()=>{});}
      PackSource.cached={at,videos};
      } catch(error) {
        // A previous authorized catalog keeps known downloads available during
        // transient hosting outages. Never mask access denial or format changes.
        if(force||!(error instanceof AppError)||!(error.status===429||error.status>=500))throw error;
        try {
          const path=join(dataDir,'source-cache','gta6-catalog.json');
          if((await stat(path)).size>2*1024*1024)throw error;
          const saved=JSON.parse(await readFile(path,'utf8'));
          if(saved.source!==PACK_CATALOG_URL||!Number.isFinite(saved.fetchedAt)||Date.now()-saved.fetchedAt>7*86400_000||saved.fetchedAt>Date.now())throw error;
          PackSource.cached={at:Date.now(),videos:parsePackCatalog(saved.videos)};
        }catch{throw error;}
      }
    }
    return PackSource.cached.videos;
  }
  private id(video:PackVideo,json=false){return 'gta6-pack:'+video.drive+(json?':json':'');}
  private details(video:PackVideo) {
    let details=this.derived.get(video);
    if(!details){const metadata=packMetadata(video,this.defaults);details={metadata,version:digest({video,metadata})};this.derived.set(video,details);}
    return details;
  }
  private async lookup(id:string,jsonOnly=false) {
    const catalog=await this.catalog();
    if(this.indexed!==catalog){this.entries=new Map(catalog.map(video=>[video.drive,video]));this.indexed=catalog;}
    const match=/^gta6-pack:([\w-]+)(:json)?$/.exec(id);
    return match&&(!jsonOnly||match[2])?this.entries.get(match[1]):undefined;
  }
  private info(video:PackVideo,json=false):DriveFile {
    return {id:this.id(video,json),name:video.t.replace(/[\/\\\x00-\x1f]/g,' ').slice(0,100)+'--'+video.drive+(json?'.json':'.mp4'),parents:[PACK_ROOT],mimeType:json?'application/json':'video/mp4',
      version:json?this.details(video).version:digest(video),capabilities:{canDownload:true}};
  }
  async file(id:string):Promise<DriveFile> {
    if(id===PACK_ROOT)return {id:PACK_ROOT,name:'Pack GTA 6',mimeType:'application/vnd.google-apps.folder'};
    const video=await this.lookup(id);
    if(!video)throw new AppError('Este vídeo não está no catálogo autorizado do pack.',404);
    return this.info(video,id.endsWith(':json'));
  }
  async tree(root:string,_recursive:boolean) {
    if(root!==PACK_ROOT)throw new AppError('Catálogo do pack inválido.');
    return (await this.catalog()).flatMap(v=>[this.info(v),this.info(v,true)]);
  }
  async json(id:string) {
    const video=await this.lookup(id,true);
    if(!video)throw new AppError('Metadados do pack não encontrados.',404);
    return this.details(video).metadata;
  }
  async download(id:string,path:string,maxBytes:number) {
    const file=await this.file(id);
    if(file.mimeType!=='video/mp4')throw new AppError('Selecione um vídeo do pack.');
    if(PackSource.blockedUntil>Date.now())throw new AppError('A origem pediu para aguardar antes de baixar outros vídeos.',429,false,PackSource.blockedUntil-Date.now());
    const drive=id.slice('gta6-pack:'.length);
    let url=`https://drive.usercontent.google.com/download?id=${encodeURIComponent(drive)}&export=download&confirm=t`;
    try {
      let response:Response|undefined;
      for(let redirects=0;redirects<6;redirects++) {
        const target=new URL(url);
        if(target.protocol!=='https:'||target.username||target.password||(target.port&&target.port!=='443')||!(['drive.google.com','drive.usercontent.google.com'].includes(target.hostname)||target.hostname.endsWith('.googleusercontent.com')))
          throw new AppError('O Drive retornou um endereço de download não permitido.');
        response=await request(target.href,15*60_000);
        if(response.status>=300&&response.status<400) {const location=response.headers.get('location');await response.body?.cancel();if(!location)throw new AppError('O Drive não informou o endereço do arquivo.');url=new URL(location,target).href;continue;}
        break;
      }
      if(response?.status!==200)throw new AppError('O Drive não confirmou o download do vídeo.');
      const type=response.headers.get('content-type')||'';
      if(type.includes('text/')||type.includes('application/json')) {
        await response.body?.cancel();throw new AppError('O Drive exibiu uma página de acesso, confirmação ou limite em vez do vídeo. Confira o download no site.',403);
      }
      if(Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel();throw new AppError('O vídeo do pack excede o limite de tamanho permitido.');}
      let size=0;
      const cap=new Transform({transform(chunk,_encoding,callback){size+=chunk.length;callback(size>maxBytes?new AppError('O vídeo do pack excede o limite de tamanho permitido.'):null,chunk);}});
      await pipeline(Readable.fromWeb(response.body as never),cap,createWriteStream(path,{mode:0o600}));
      if(!size)throw new AppError('O Drive retornou um arquivo vazio.');
      return size;
    } catch(error) {
      await rm(path,{force:true});
      if(error instanceof AppError&&(error.status===429||error.status===503))PackSource.blockedUntil=Date.now()+Math.max(60_000,error.retryAfterMs||0);
      throw error;
    }
  }
}
