import {lstat,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {dataDir,logger} from './config.js';
import {pool} from './db.js';

const nativeFilename=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.native\.mp4$/;
const acceptedStatuses=new Set(['processing','scheduled','published','private','unlisted','inbox','completed','failed']);
export interface RetainedDelivery {
  id:string;engine:string;status:string;post_id:string|null;local_file:string|null;
  session:string|null;upload_started_at:unknown;payload?:{manualConfirmed?:boolean}|null;browser_confirmed?:boolean;
}

/** Upload confirmation or an explicit, safe discard is required; age is never proof. */
export function canRemovePreparedMedia(delivery:RetainedDelivery):boolean {
  if(!['local','browser'].includes(delivery.engine))return false;
  if(acceptedStatuses.has(delivery.status)&&!!delivery.post_id)return true;
  if(delivery.engine==='browser'&&['scheduled','completed'].includes(delivery.status)
    &&(delivery.browser_confirmed||delivery.payload?.manualConfirmed===true))return true;
  if(delivery.status==='cancelled'&&delivery.payload?.manualConfirmed===true)return true;
  return ['cancelled','duplicate'].includes(delivery.status)&&!delivery.session&&!delivery.upload_started_at&&!delivery.post_id;
}

const facts=`SELECT d.id,d.engine,d.status,d.post_id,d.local_file,d.session,d.upload_started_at,
  jsonb_build_object('manualConfirmed',d.payload->'manualConfirmed') AS payload,
  EXISTS(SELECT 1 FROM browser_commands b WHERE b.delivery_id=d.id AND b.upload_started
  AND ((b.status='scheduled' AND b.phase='browser_scheduled') OR
    (b.status='completed' AND b.phase='browser_published' AND b.config->>'publishNow'='true'))) AS browser_confirmed
  FROM deliveries d`;

/**
 * Remove application-owned copies only. Scan filenames as well as retained DB
 * references so a crash between confirmation and unlink cannot leak old files.
 * Errors remain maintenance errors: an accepted upload must never be retried.
 */
export async function cleanupPublishedMedia(deliveryId?:string):Promise<{removed:number;failed:number}> {
  const result={removed:0,failed:0};
  try {
    let ids:string[]=[];
    if(!deliveryId) {
      try {ids=(await readdir(dataDir)).filter(name=>nativeFilename.test(name)).map(name=>name.slice(0,-'.native.mp4'.length));}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    }
    const {rows}=await pool.query<RetainedDelivery>(facts+(deliveryId?' WHERE d.id=$1':` WHERE d.engine IN ('local','browser')
      AND d.status IN ('processing','scheduled','published','private','unlisted','inbox','completed','failed','cancelled','duplicate')
      AND (d.local_file IS NOT NULL OR d.id=ANY($1::uuid[]))`),[deliveryId||ids]);
    for(const delivery of rows) {
      if(!canRemovePreparedMedia(delivery))continue;
      const filename=delivery.local_file||delivery.id+'.native.mp4';
      if(!nativeFilename.test(filename))continue;
      try {
        // Independent destinations usually have independent files. Preserve any
        // legacy/shared file still required by another review or upload session.
        const {rows:references}=await pool.query<RetainedDelivery>(facts+' WHERE d.local_file=$1',[filename]);
        if(references.some(reference=>!canRemovePreparedMedia(reference)))continue;
        const path=join(dataDir,filename);
        let exists=false;
        try {const info=await lstat(path);if(!info.isFile())continue;exists=true;}
        catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
        if(exists)await rm(path,{force:true});
        // Clear references only after successful unlink; failures retry next cycle.
        await pool.query('UPDATE deliveries SET local_file=NULL WHERE local_file=$1',[filename]);
        if(exists)result.removed++;
      }catch{result.failed++;}
    }
  }catch{result.failed++;}
  if(result.failed)logger.warn({event:'media_cleanup_failed',failed:result.failed},'A limpeza de cópias enviadas será retomada no próximo ciclo.');
  if(result.removed)logger.info({event:'media_cleanup',removed:result.removed},'Cópias locais de envios confirmados removidas.');
  return result;
}
