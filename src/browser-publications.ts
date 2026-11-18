import {Router} from 'express';
import {randomUUID} from 'node:crypto';
import {mkdir,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {pool} from './db.js';
import {AppError,dataDir,errorMessage,logger} from './config.js';
import {metadataSchema} from './domain.js';
import {sourceFor} from './sources.js';
import {sha256,validateVideo} from './media.js';
import {cursorFields,keysetClause,pageLimit,paginateRows,parsePagination} from './pagination.js';

const preparationKey=(videoId:string,account:string)=>'drive-watcher:browser-publication:'+videoId+':'+account;
const assetPath=(id:string)=>join(dataDir,id+'.native.mp4');
const partialPath=(id:string)=>join(dataDir,id+'.preparing.mp4');
const maxBytes=1024*1024*1024;

/** A committed preparation owns its files; the session lock proves whether its writer is still alive. */
export async function recoverBrowserPreparations(){
  const {rows}=await pool.query("SELECT id,video_id,integration_id FROM deliveries WHERE engine='browser' AND status='preparing' AND payload->>'manualPublication'='true' AND approved_at IS NULL AND session IS NULL AND post_id IS NULL");
  for(const row of rows){
    const db=await pool.connect(),key=preparationKey(row.video_id,row.integration_id);let locked=false;
    try{
      locked=(await db.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS ok',[key])).rows[0].ok;
      if(!locked)continue;
      if(!(await db.query("SELECT id FROM deliveries WHERE id=$1 AND status='preparing' AND approved_at IS NULL",[row.id])).rowCount)continue;
      await rm(partialPath(row.id),{force:true});await rm(assetPath(row.id),{force:true});
      await db.query("UPDATE deliveries SET status='failed',local_file=NULL,error='A preparação foi interrompida. Selecione o vídeo novamente para revisar.',updated_at=now() WHERE id=$1 AND status='preparing'",[row.id]);
    }catch{logger.warn({event:'browser_preparation_cleanup_failed',deliveryId:row.id},'A recuperação da prévia será retomada no próximo ciclo.');}
    finally{if(locked)await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);db.release();}
  }
}

async function prepareVideo(videoId:string,profileId:string,version:string){
  const db=await pool.connect(),account='browser:tiktok:'+profileId,key=preparationKey(videoId,account);let locked=false,deliveryId='';
  try{
    locked=(await db.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS ok',[key])).rows[0].ok;
    if(!locked)throw new AppError('Este vídeo já está sendo preparado. Aguarde a conclusão.',409);
    const {rows:[profile]}=await db.query('SELECT id,name FROM browser_profiles WHERE id=$1',[profileId]);
    if(!profile)throw new AppError('Perfil TikTok não encontrado.',404);
    const {rows:[video]}=await db.query(`SELECT v.*,row_to_json(w) AS watch FROM videos v JOIN watches w ON w.id=v.watch_id
      WHERE v.id=$1 AND w.managed_by_cuts=false`,[videoId]);
    if(!video)throw new AppError('Vídeo não encontrado nesta pasta.',404);
    if(video.version!==version)throw new AppError('O vídeo mudou. Atualize a lista antes de revisar.',409);
    const metadata=metadataSchema.parse(video.metadata??{title:video.name.replace(/\.mp4$/i,'').slice(0,100)||'Meu vídeo'});
    if(!metadata.ready||metadata.targets&&!metadata.targets.includes('tiktok'))throw new AppError('Os metadados deste vídeo não autorizam preparação para o TikTok.');
    const {rows:[existing]}=await db.query('SELECT * FROM deliveries WHERE video_id=$1 AND integration_id=$2',[video.id,account]);
    if(existing){
      if(existing.engine==='browser'&&existing.payload?.manualPublication&&existing.status==='review'&&existing.local_file)return {id:existing.id,reused:true};
      if(existing.approved_at&&existing.status!=='cancelled'||existing.upload_started_at||existing.post_id||existing.request_id||existing.session||!existing.payload?.manualPublication||!['failed','cancelled'].includes(existing.status))throw new AppError('Este vídeo já tem um envio para esse perfil. Confira o histórico antes de continuar.',409);
    }
    const source=await sourceFor(video.watch),before=await source.file(video.file_id),currentVersion=before.version||before.modifiedTime||'';
    if(currentVersion!==version&&video.watch.source_type!=='gta6_pack')throw new AppError('O arquivo mudou. Verifique a pasta novamente antes de revisar.',409);
    if(video.json_file_id&&video.watch.source_type!=='gta6_pack'){
      const json=await source.file(video.json_file_id);
      if((json.version||json.modifiedTime||'')!==video.json_version)throw new AppError('As informações do vídeo mudaram. Verifique a pasta novamente antes de revisar.',409);
    }
    deliveryId=existing?.id||randomUUID();
    const payload={metadata,channelName:profile.name,manualPublication:true,sourceVersion:version,automatic:false,nativeSchedule:false,stripMetadata:false};
    if(existing)await db.query("UPDATE deliveries SET status='preparing',payload=$2,local_file=NULL,approved_at=NULL,error=NULL,updated_at=now() WHERE id=$1",[deliveryId,JSON.stringify(payload)]);
    else await db.query("INSERT INTO deliveries(id,video_id,integration_id,provider,engine,status,payload) VALUES($1,$2,$3,'tiktok','browser','preparing',$4)",[deliveryId,video.id,account,JSON.stringify(payload)]);
    await mkdir(dataDir,{recursive:true});
    const size=await source.download(video.file_id,partialPath(deliveryId),maxBytes);
    if(Number(video.size)!==size&&!(video.watch.source_type==='gta6_pack'&&Number(video.size)===0))throw new AppError('O tamanho do vídeo mudou. Atualize a pasta antes de revisar.',409);
    await validateVideo(partialPath(deliveryId),'any');
    const hash=await sha256(partialPath(deliveryId)),after=await source.file(video.file_id);
    if((after.version||after.modifiedTime||'')!==currentVersion||video.sha256&&video.sha256!==hash||currentVersion!==version&&video.sha256!==hash)throw new AppError('O conteúdo mudou. Atualize a pasta antes de revisar.',409);
    await db.query('BEGIN');
    try{
      const {rows:[current]}=await db.query('SELECT version FROM videos WHERE id=$1 FOR UPDATE',[video.id]);
      if(current.version!==version)throw new AppError('A origem mudou durante a preparação. Atualize a lista.',409);
      await db.query('INSERT INTO content_claims(sha256,integration_id,delivery_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[hash,account,deliveryId]);
      const {rows:[claim]}=await db.query('SELECT delivery_id FROM content_claims WHERE sha256=$1 AND integration_id=$2',[hash,account]);
      if(claim.delivery_id!==deliveryId)throw new AppError('Este mesmo vídeo já foi registrado para esse perfil. Confira o histórico.',409);
      await rename(partialPath(deliveryId),assetPath(deliveryId));
      const result=await db.query("UPDATE deliveries SET status='review',local_file=$2,payload=$3,error=NULL,updated_at=now() WHERE id=$1 AND status='preparing'",[deliveryId,deliveryId+'.native.mp4',JSON.stringify({...payload,assetSha256:hash})]);
      if(!result.rowCount)throw new AppError('A preparação foi cancelada antes da revisão.',409);
      await db.query('UPDATE videos SET sha256=coalesce(sha256,$2) WHERE id=$1',[video.id,hash]);
      await db.query('COMMIT');
    }catch(error){await db.query('ROLLBACK');throw error;}
    return {id:deliveryId,reused:false};
  }catch(error){
    if(deliveryId){
      await rm(partialPath(deliveryId),{force:true});await rm(assetPath(deliveryId),{force:true});
      await db.query("UPDATE deliveries SET status='failed',local_file=NULL,error=$2,updated_at=now() WHERE id=$1 AND status='preparing'",[deliveryId,error instanceof AppError?error.message:errorMessage(error)]);
    }
    throw error;
  }finally{if(locked)await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);db.release();}
}

export const browserPublicationRoutes=Router();
browserPublicationRoutes.get('/api/browser/videos',async(req,res)=>{
  const page=parsePagination(req.query,{scope:'browserVideos'}),values:unknown[]=[];
  const {rows}=await pool.query(`SELECT v.id,v.name,v.version,v.metadata->>'title' AS title,w.name AS folder,${cursorFields('v.created_at','v.id')}
    FROM videos v JOIN watches w ON w.id=v.watch_id WHERE w.managed_by_cuts=false AND v.status<>'removed'
    AND coalesce((v.metadata->>'ready')::boolean,true) AND (v.metadata->'targets' IS NULL OR v.metadata->'targets' ? 'tiktok')
    ${keysetClause(page,'v.created_at','v.id',values)} ORDER BY v.created_at DESC,v.id DESC${pageLimit(page,values)}`,values);
  res.json(paginateRows(rows,page));
});
browserPublicationRoutes.post('/api/browser/videos/:id/prepare',async(req,res)=>{
  const id=z.string().uuid().parse(req.params.id),input=z.object({profileId:z.string().min(1).max(40),version:z.string().max(1000)}).parse(req.body);
  res.status(201).json(await prepareVideo(id,input.profileId,input.version));
});
