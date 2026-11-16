import { createHash } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { lstat, open, readdir, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError, localMediaDir, localMediaHostDir } from './config.js';
import type { DriveFile } from './clients.js';

const FOLDER='application/vnd.google-apps.folder';
const inside=(root:string,path:string)=>{const rel=relative(root,path);return rel!=='..' && !rel.startsWith('..'+sep) && !isAbsolute(rel);};

/** Only the configured, read-only media directory is visible to this adapter. */
export class LocalFiles {
  private prefix:string;
  constructor(private root=localMediaDir,private hostRoot=localMediaHostDir) {
    this.root=resolve(root);this.hostRoot=resolve(hostRoot);
    // Changing the mounted root cannot silently repoint an existing routine.
    this.prefix='local:'+createHash('sha256').update(this.hostRoot).digest('hex').slice(0,16)+':';
  }
  private id(path:string) {return this.prefix+Buffer.from(path).toString('base64url');}
  private path(id:string) {
    if(!id.startsWith(this.prefix)) throw new AppError('A pasta local configurada mudou. Crie outra rotina para a nova pasta.');
    const encoded=id.slice(this.prefix.length);
    if(!/^[\w-]*$/.test(encoded)) throw new AppError('Identificador de arquivo local inválido.');
    const path=Buffer.from(encoded,'base64url').toString('utf8');
    if(this.id(path)!==id || path.includes('\0') || isAbsolute(path) || path.split(sep).some(p=>p==='..' || p==='.')) throw new AppError('Caminho local inválido.');
    return path;
  }
  private async checkedPath(path:string) {
    try {
      // Reject symlinks, including directory links, before following any path.
      await realpath(this.root);
      let current=this.root;
      for(const part of path.split(sep).filter(Boolean)) {
        current=join(current,part);
        if((await lstat(current)).isSymbolicLink()) throw new AppError('Links simbólicos não são aceitos nas pastas de vídeos.');
      }
      return current;
    } catch(error) {
      if(error instanceof AppError) throw error;
      const code=(error as NodeJS.ErrnoException).code;
      if(code==='ENOENT' || code==='ENOTDIR') throw new AppError('Pasta ou arquivo local não encontrado. Confira o caminho e o volume do Docker.',404);
      if(code==='EACCES' || code==='EPERM') throw new AppError('Sem permissão de leitura na pasta local. Verifique as permissões dos arquivos.',403);
      throw error;
    }
  }
  private async info(path:string):Promise<DriveFile> {
    const file=await this.checkedPath(path);
    const info=await lstat(file,{bigint:true});
    if(!info.isDirectory() && !info.isFile()) throw new AppError('Selecione uma pasta ou um arquivo regular.');
    return {id:this.id(path),name:basename(file),parents:path?[this.id(dirname(path)==='.'?'':dirname(path))]:[],
      mimeType:info.isDirectory()?FOLDER:/\.mp4$/i.test(path)?'video/mp4':/\.json$/i.test(path)?'application/json':'application/octet-stream',
      size:String(info.size),version:[info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':'),
      modifiedTime:new Date(Number(info.mtimeMs)).toISOString(),capabilities:{canDownload:true}};
  }
  async folder(input:string) {
    if(input.includes('\0')) throw new AppError('Caminho local inválido.');
    const hostPath=resolve(this.hostRoot,input.trim() || '.');
    if(!inside(this.hostRoot,hostPath)) throw new AppError(`Escolha uma pasta dentro de ${this.hostRoot}. Para usar outra pasta, configure LOCAL_MEDIA_DIR no .env e reinicie o serviço.`);
    const path=relative(this.hostRoot,hostPath);
    const folder=await this.info(path);
    if(folder.mimeType!==FOLDER) throw new AppError('O caminho informado não é uma pasta local.');
    return {...folder,name:basename(hostPath),hostPath};
  }
  async file(id:string) {return this.info(this.path(id));}
  async tree(root:string,recursive:boolean):Promise<DriveFile[]> {
    const queue=[this.path(root)], files:DriveFile[]=[];
    let folders=0;
    while(queue.length) {
      if(++folders>200) throw new AppError('Limite de 200 subpastas por rotina. Selecione uma pasta menor.');
      const path=queue.shift()!;
      const entries=await readdir(await this.checkedPath(path),{withFileTypes:true});
      for(const entry of entries) {
        if(entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) continue;
        const child=join(path,entry.name);
        if(entry.isDirectory()) {if(recursive)queue.push(child);}
        else files.push(await this.info(child));
        if(files.length>5000 || queue.length+folders>200) throw new AppError('Limite de 5.000 arquivos e 200 subpastas por rotina. Selecione uma pasta menor.');
      }
    }
    return files;
  }
  private async openFile(id:string) {
    const path=await this.checkedPath(this.path(id));
    const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try {
      if(!(await file.stat()).isFile()) throw new AppError('O caminho não aponta para um arquivo regular.');
      // On Ubuntu, also verify the opened descriptor to catch a parent replaced by a symlink.
      if(process.platform==='linux' && !inside(await realpath(this.root),await realpath(`/proc/self/fd/${file.fd}`))) throw new AppError('O arquivo está fora da pasta local configurada.');
      return file;
    } catch(error) {await file.close();throw error;}
  }
  async json(id:string):Promise<unknown> {
    const file=await this.openFile(id);
    try {
      if((await file.stat()).size>65536) throw new AppError('JSON de metadados excede 64 KiB.');
      const buffer=Buffer.alloc(65537);
      let size=0;
      while(size<buffer.length) {const read=await file.read(buffer,size,buffer.length-size,null);if(!read.bytesRead)break;size+=read.bytesRead;}
      if(size>65536) throw new AppError('JSON de metadados excede 64 KiB.');
      try {return JSON.parse(buffer.subarray(0,size).toString('utf8'));}
      catch {throw new AppError('JSON de metadados inválido.');}
    } finally {await file.close();}
  }
  async download(id:string,destination:string,maxBytes:number) {
    const file=await this.openFile(id);
    let size=0;
    try {
      if((await file.stat()).size>maxBytes) throw new AppError('O vídeo excede o limite de tamanho permitido.');
      const cap=new Transform({transform(chunk,_encoding,callback){size+=chunk.length;callback(size>maxBytes?new AppError('O vídeo excede o limite de tamanho permitido.'):null,chunk);}});
      await pipeline(file.createReadStream({autoClose:false}),cap,createWriteStream(destination,{mode:0o600}));
      return size;
    } catch(error) {await rm(destination,{force:true});throw error;}
    finally {await file.close();}
  }
}
