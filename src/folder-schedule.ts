import type {PoolClient} from 'pg';
import {AppError,errorMessage} from './config.js';
import {event,pool} from './db.js';
import {cleanupPublishedMedia} from './media-cleanup.js';
import {cancelYoutubeSchedule} from './native-api.js';
import {cursorFields,keysetClause,pageLimit,paginateRows,type PageOptions} from './pagination.js';

const nativeSchedule="d.engine='local' AND d.provider='youtube' AND d.integration_id LIKE 'native:youtube:%' AND d.payload->>'nativeSchedule'='true'";
const localReservation="d.post_id IS NULL AND d.session IS NULL AND d.upload_started_at IS NULL AND d.status IN ('preparing','review','pending','retry','failed')";
const remoteSchedule="d.post_id IS NOT NULL AND d.status IN ('processing','scheduled')";
const canCancel=`(${nativeSchedule} AND ((${localReservation}) OR (${remoteSchedule})))`;
const folderDeliveries=`FROM deliveries d JOIN videos v ON v.id=d.video_id WHERE v.watch_id=$1 AND d.request_id IS NULL AND d.planned_at>clock_timestamp()
  AND (d.status='scheduled' OR (${nativeSchedule} AND d.status IN ('preparing','review','pending','retry','failed','submitting','unknown','processing')))`;
type Queryable=Pick<typeof pool,'query'>;
type ScheduledDelivery={id:string;title:string;integration_id:string;post_id:string|null;planned_at:Date};
export type FolderScheduleEntry={id:string;title:string;provider:string;engine:string;status:string;channel:string;plannedAt:string;cancellable:boolean};
export type FolderScheduleCancellation={cancelled:number;issues:{title:string;message:string;authorizeChannel?:string}[]};

async function findFolder(id:string,db:Queryable){
  if(!(await db.query('SELECT id FROM watches WHERE id=$1 AND NOT controlled_by_requests AND NOT managed_by_cuts',[id])).rowCount)
    throw new AppError('Pasta não encontrada.',404);
}

export async function listFolderSchedule(id:string,page:PageOptions){
  await findFolder(id,pool);
  const values:unknown[]=[id];
  const where=keysetClause(page,'d.planned_at','d.id',values,'uuid','asc'),limit=pageLimit(page,values);
  const [entries,counts]=await Promise.all([
    pool.query(`SELECT d.id,COALESCE(d.payload->'metadata'->>'title',v.name) AS title,d.provider,d.engine,d.status,
      COALESCE(d.payload->>'channelName',d.integration_id) AS channel,d.planned_at AS "plannedAt",COALESCE(${canCancel},false) AS cancellable,
      ${cursorFields('d.planned_at','d.id')} ${folderDeliveries}${where} ORDER BY d.planned_at,d.id${limit}`,values),
    pool.query(`SELECT count(*) FILTER (WHERE ${canCancel})::int AS cancellable ${folderDeliveries}`,[id])
  ]);
  return {...paginateRows(entries.rows,page),cancellable:counts.rows[0].cancellable as number};
}

async function cancelScheduledDelivery(db:PoolClient,folderId:string,id:string){
  await db.query('BEGIN');
  try{
    const key='drive-watcher:upload-delivery:'+id;
    const locked=await db.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS ok',[key]);
    if(!locked.rows[0].ok)throw new AppError('O envio está em andamento. Confira o estado e tente novamente.',409);
    const {rows:[delivery]}=await db.query<ScheduledDelivery>(`SELECT d.id,d.integration_id,d.post_id,d.planned_at,v.name AS title
      ${folderDeliveries} AND d.id=$2 AND ${canCancel} FOR UPDATE OF d`,[folderId,id]);
    if(!delivery)throw new AppError('O agendamento mudou enquanto a operação estava em andamento.',409);
    if(delivery.post_id)await cancelYoutubeSchedule(delivery.post_id,delivery.integration_id.slice('native:youtube:'.length),delivery.planned_at);
    await db.query("UPDATE deliveries SET status='cancelled',retry_at=NULL,error=NULL,updated_at=now() WHERE id=$1",[id]);
    if(!delivery.post_id)await db.query('DELETE FROM content_claims WHERE delivery_id=$1',[id]);
    await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}
}

export async function cancelFolderSchedule(folderId:string){
  const db=await pool.connect(),key='drive-watcher:cancel-folder:'+folderId;
  const cancelled:string[]=[],issues:FolderScheduleCancellation['issues']=[];
  let acquired=false;
  try{
    await findFolder(folderId,db);
    acquired=(await db.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS ok',[key])).rows[0].ok;
    if(!acquired)throw new AppError('Já existe um cancelamento em andamento para esta pasta.',409);
    const {rows}=await db.query<{id:string;title:string;integration_id:string;has_post:boolean}>(`SELECT d.id,d.integration_id,d.post_id IS NOT NULL AS has_post,COALESCE(d.payload->'metadata'->>'title',v.name) AS title
      ${folderDeliveries} AND ${canCancel} ORDER BY d.planned_at,d.id`,[folderId]);
    for(const item of rows){
      try{await cancelScheduledDelivery(db,folderId,item.id);cancelled.push(item.id);}
      catch(error){
        const issue:FolderScheduleCancellation['issues'][number]={title:item.title,message:errorMessage(error)};
        if(item.has_post&&error instanceof AppError&&[401,403].includes(error.status))issue.authorizeChannel=item.integration_id.slice('native:youtube:'.length);
        issues.push(issue);
      }
    }
  }finally{
    try{if(acquired)await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);}finally{db.release();}
  }
  for(const id of cancelled)await cleanupPublishedMedia(id);
  if(cancelled.length||issues.length)await event(issues.length?'warning':'info',
    `${cancelled.length} agendamento(s) cancelado(s) na pasta. ${issues.length} envio(s) aguardam conferência.`,folderId);
  return {cancelled:cancelled.length,issues};
}
