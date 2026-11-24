import {createHash,randomUUID} from 'node:crypto';
import {link,mkdir,open,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import type {Request} from 'express';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {AppError,dataDir} from './config.js';
import {pool} from './db.js';
import {validateVideo} from './media.js';
import {availableCutBytes} from './cuts-media.js';
import {MAX_CUT_SOURCE_SECONDS} from './cuts-source-limits.js';

export const cutDirectory=(id:string)=>join(dataDir,'cuts',z.string().uuid().parse(id));
export const cutJobLock=(id:string)=>'drive-watcher:cuts:'+id;

// Hold this transaction lock through creation so concurrent imports and YouTube projects share capacity.
export async function requireCutProjectSlot(db:PoolClient){
  await db.query('SELECT pg_advisory_xact_lock(74839130)');
  const {rows:[count]}=await db.query(`SELECT count(*)::int AS n FROM cut_jobs j WHERE status NOT IN ('discarded','importing')
    AND (source_removed_at IS NULL OR EXISTS(SELECT 1 FROM cuts c WHERE c.job_id=j.id AND c.local_file IS NOT NULL))`);
  if(count.n>=10)throw new AppError('Há 10 projetos com arquivos guardados no gerador. Exclua um projeto anterior para liberar espaço.',409);
}

async function receiveOriginal(req:Request,dir:string){
  const declared=Number(req.get('content-length')||0),hash=createHash('sha256');
  async function* checkedChunks(){
    let size=0,nextCheck=0;
    for await(const chunk of req){
      if(size+chunk.length>nextCheck){
        const available=await availableCutBytes(dir);
        if(available<Math.max(declared-size,chunk.length))throw new AppError('Espaço insuficiente para importar o MP4.',507);
        nextCheck=size+Math.min(available,8*1024*1024);
      }
      size+=chunk.length;hash.update(chunk);yield chunk;
    }
    if(!size||declared&&declared!==size)throw new AppError('O arquivo não chegou completo. Selecione o MP4 novamente.');
  }
  const file=await open(join(dir,'incoming.mp4'),'wx',0o600);
  try{await file.writeFile(checkedChunks());}finally{await file.close();}
  return hash.digest('hex');
}

// The job lock protects both a live transfer and its final DB commit. On restart,
// only a still-uncommitted import can have its staging files removed.
async function removeIncompleteImport(db:PoolClient,id:string){
  const row=await db.query("SELECT id FROM cut_jobs WHERE id=$1 AND status='importing' AND url IS NULL",[id]);
  if(!row.rowCount)return;
  await rm(cutDirectory(id),{recursive:true,force:true});
  await db.query("DELETE FROM cut_jobs WHERE id=$1 AND status='importing'",[id]);
}

export async function recoverCutImports(db:PoolClient){
  const {rows}=await db.query("SELECT id FROM cut_jobs WHERE status='importing' AND url IS NULL");
  for(const {id} of rows){
    const key=cutJobLock(id);
    if(!(await db.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS ok',[key])).rows[0].ok)continue;
    try{await removeIncompleteImport(db,id);}finally{await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);}
  }
}

export async function importReadyCut(req:Request,title:string){
  if(!req.is(['video/mp4','application/octet-stream']))throw new AppError('Selecione um arquivo MP4.',415);
  const id=randomUUID(),clipId=randomUUID(),dir=cutDirectory(id),key=cutJobLock(id);
  const db=await pool.connect();
  try{
    await db.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[key]);
    await db.query("INSERT INTO cut_jobs(id,url,status,title,clip_count,target_seconds) VALUES($1,NULL,'importing',$2,1,60)",[id,title]);
    await mkdir(dir,{recursive:true});
    const hash=await receiveOriginal(req,dir);
    const source=join(dir,'incoming.mp4'),info=await validateVideo(source,'any',MAX_CUT_SOURCE_SECONDS);
    if(info.duration<.5)throw new AppError('O corte precisa ter pelo menos meio segundo.');
    const duration=Math.round(info.duration*1000)/1000,format=info.width>info.height?'video':'shorts';

    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['cut-import:'+hash]);
    const {rows:[existing]}=await db.query(`SELECT j.id,c.id AS "clipId" FROM cut_jobs j JOIN cuts c ON c.job_id=j.id
      WHERE j.upload_sha256=$1 AND j.status<>'discarded' AND c.status<>'discarded'
      ORDER BY c.created_at DESC,c.id LIMIT 1 FOR SHARE OF j,c`,[hash]);
    if(existing){
      const directory=cutDirectory(existing.id);
      await mkdir(directory,{recursive:true});
      await link(source,join(directory,'source.mp4')).catch(error=>{if(error.code!=='EEXIST')throw error;});
      await db.query('UPDATE cut_jobs SET source_removed_at=NULL WHERE id=$1 AND source_removed_at IS NOT NULL',[existing.id]);
      await db.query('COMMIT');
      return {...existing,reused:true};
    }
    await requireCutProjectSlot(db);
    // Rendering replaces the review file by rename, preserving the unedited source.
    await link(source,join(dir,clipId+'.mp4'));
    await rename(source,join(dir,'source.mp4'));
    await db.query("UPDATE cut_jobs SET status='review',duration=$2,transcript='[]',upload_sha256=$3,updated_at=now() WHERE id=$1",[id,duration,hash]);
    await db.query(`INSERT INTO cuts(id,job_id,title,start_seconds,end_seconds,output_duration,max_output_seconds,reason,status,local_file,caption_style,framing_options)
      VALUES($1,$2,$3,0,$4,$4,greatest(180,$4::double precision),'Corte pronto importado.','review',$5,$6,$7)`,
      [clipId,id,title,duration,clipId+'.mp4',{enabled:false},{format,mode:'fit'}]);
    await db.query('COMMIT');
    return {id,clipId,reused:false};
  }catch(error){
    await db.query('ROLLBACK');
    if((error as NodeJS.ErrnoException).code==='ENOSPC')throw new AppError('Espaço insuficiente para importar o MP4.',507);
    throw error;
  }finally{
    try{await removeIncompleteImport(db,id);}
    finally{try{await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);}finally{db.release();}}
  }
}
