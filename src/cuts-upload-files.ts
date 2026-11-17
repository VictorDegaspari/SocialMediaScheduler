import {constants} from 'node:fs';
import {copyFile,lstat,mkdir,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {z} from 'zod';
import {AppError,dataDir,logger} from './config.js';
import {pool} from './db.js';
import {sha256} from './media.js';

const uuid=z.string().uuid();
const manifestSchema=z.object({version:z.literal(1),jobId:uuid,clipId:uuid,deliveryId:uuid,sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const idPattern='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const jobPattern=new RegExp('^'+idPattern+'$');
const manifestPattern=new RegExp('^publish\\.('+idPattern+')\\.json$');
const cutsRoot=()=>join(dataDir,'cuts');
const manifestsRoot=()=>join(dataDir,'cuts-publish-manifests');

/** Call while holding the cuts job lock and before committing its delivery. */
export async function stageCutUpload(input:{jobId:string;clipId:string;deliveryId:string;sha256:string;source:string}) {
  const manifest=manifestSchema.parse({version:1,jobId:input.jobId,clipId:input.clipId,deliveryId:input.deliveryId,sha256:input.sha256});
  const directory=join(manifestsRoot(),manifest.jobId);
  if(resolve(input.source)!==resolve(cutsRoot(),manifest.jobId,manifest.clipId+'.mp4'))throw new AppError('A cópia de publicação precisa pertencer ao corte selecionado.');
  const filename=manifest.deliveryId+'.native.mp4',path=join(dataDir,filename);
  const manifestPath=join(directory,'publish.'+manifest.deliveryId+'.json');
  const temporary=join(directory,'publish.'+manifest.deliveryId+'.part');
  await mkdir(directory,{recursive:true});
  // Keep provenance outside the disposable preview/source directory, so a job
  // discard cannot remove proof before rollback/crash recovery takes place.
  // Persist it before creating any bytes outside this staging directory.
  // A later sweep acquires the same DB lock to distinguish rollback from a
  // still-uncommitted upload; filename or age alone never authorize deletion.
  await writeFile(manifestPath,JSON.stringify(manifest),{flag:'wx',mode:0o600,flush:true});
  await copyFile(input.source,temporary,constants.COPYFILE_EXCL);
  if(await sha256(temporary)!==manifest.sha256)throw new AppError('A prévia mudou durante a preparação do envio. Reabra o corte antes de postar.',409);
  try {await lstat(path);throw new AppError('Já existe uma cópia para esta tentativa de publicação.',409);}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  await rename(temporary,path);
  return {filename,path,manifestPath};
}

async function removeOwnedFile(path:string,expectedHash?:string):Promise<boolean> {
  try {
    const file=await lstat(path);
    if(!file.isFile()||(expectedHash&&await sha256(path)!==expectedHash))return false;
    await rm(path,{force:true});return true;
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return true;throw error;}
}

/** Recover files created by a rolled-back/crashed cuts publication transaction. */
export async function sweepCutUploadFiles():Promise<{recovered:number;failed:number}> {
  const result={recovered:0,failed:0};
  let jobs;
  try {jobs=await readdir(manifestsRoot(),{withFileTypes:true});}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return result;throw error;}
  for(const job of jobs.filter(entry=>entry.isDirectory()&&jobPattern.test(entry.name))) {
    const directory=join(manifestsRoot(),job.name);
    let manifests;
    try {manifests=(await readdir(directory,{withFileTypes:true})).filter(entry=>entry.isFile()&&manifestPattern.test(entry.name));}
    catch{result.failed++;continue;}
    // Ordinary previews have no markers, so they require no database work.
    if(!manifests.length)continue;
    const db=await pool.connect();
    try {
      await db.query('BEGIN');
      const {rows:[lock]}=await db.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS ok',['drive-watcher:cuts:'+job.name]);
      if(!lock.ok){await db.query('ROLLBACK');continue;}
      for(const entry of manifests) {
        try {
          const manifestPath=join(directory,entry.name);
          if((await lstat(manifestPath)).size>4096)continue;
          const parsed=manifestSchema.safeParse(JSON.parse(await readFile(manifestPath,'utf8')));
          if(!parsed.success||parsed.data.jobId!==job.name||entry.name!=='publish.'+parsed.data.deliveryId+'.json')continue;
          const manifest=parsed.data,filename=manifest.deliveryId+'.native.mp4';
          const {rows:[delivery]}=await db.query('SELECT video_id,local_file FROM deliveries WHERE id=$1',[manifest.deliveryId]);
          if(delivery) {
            // A committed delivery owns its bytes, including pending/review and
            // uncertain sessions. The regular publication cleanup handles it.
            if(delivery.video_id!==manifest.clipId||(delivery.local_file!==null&&delivery.local_file!==filename))continue;
          }else {
            // The job lock rules out an in-flight transaction. Hash proof also
            // prevents deleting a different file placed at the generated path.
            if(!await removeOwnedFile(join(dataDir,filename),manifest.sha256))continue;
            result.recovered++;
          }
          if(!await removeOwnedFile(join(directory,'publish.'+manifest.deliveryId+'.part')))continue;
          await rm(manifestPath,{force:true});
        }catch{result.failed++;}
      }
      await db.query('COMMIT');
    }catch{await db.query('ROLLBACK').catch(()=>{});result.failed++;}
    finally {db.release();}
  }
  if(result.failed)logger.warn({event:'cuts_upload_cleanup_failed',failed:result.failed},'A recuperação das cópias de cortes será retomada no próximo ciclo.');
  return result;
}
