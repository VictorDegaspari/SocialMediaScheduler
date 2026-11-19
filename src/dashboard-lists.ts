import { Router } from 'express';
import {z} from 'zod';
import { pool } from './db.js';
import { cursorFields, keysetClause, pageLimit, paginateRows, parsePagination, type PageOptions } from './pagination.js';
import {cancelFolderSchedule,listFolderSchedule} from './folder-schedule.js';

export async function listWatches(page:PageOptions){
  const values:unknown[]=[];
  const where=keysetClause(page,'w.created_at','w.id',values),limit=pageLimit(page,values);
  const {rows}=await pool.query(`SELECT w.*,
    (SELECT count(*)::int FROM videos v WHERE v.watch_id=w.id AND v.status IN ('ready','waiting','retry')) +
    (SELECT count(*)::int FROM deliveries d JOIN videos v ON v.id=d.video_id WHERE v.watch_id=w.id AND d.engine IN ('local','browser') AND d.status IN ('preparing','review','pending','retry','submitting')) AS pending_count,
    ${cursorFields('w.created_at','w.id')}
    FROM watches w WHERE w.controlled_by_requests=false AND w.managed_by_cuts=false${where}
    ORDER BY w.created_at DESC,w.id DESC${limit}`,values);
  return paginateRows(rows,page);
}

export async function listEvents(page:PageOptions){
  const values:unknown[]=[];
  const where=keysetClause(page,'e.created_at','e.id',values,'bigint'),limit=pageLimit(page,values);
  const {rows}=await pool.query(`SELECT e.id,e.level,e.message,e.created_at,w.name AS watch_name,${cursorFields('e.created_at','e.id')}
    FROM events e LEFT JOIN watches w ON w.id=e.watch_id WHERE true${where}
    ORDER BY e.created_at DESC,e.id DESC${limit}`,values);
  return paginateRows(rows,page);
}

export async function listVideos(page:PageOptions){
  const values:unknown[]=[];
  const where=keysetClause(page,'v.updated_at','v.id',values),limit=pageLimit(page,values);
  const {rows}=await pool.query(`SELECT v.id,v.name,v.status,v.error,v.attempts,v.retry_at AS "retryAt",v.created_at,w.name AS watch_name,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'engine',d.engine,'provider',d.provider,'status',d.status,'postId',d.post_id,'url',d.release_url,'error',d.error,'plannedAt',d.planned_at,'manualPublication',d.payload->'manualPublication','channelName',d.payload->>'channelName',
      'attempts',d.attempts,'retryAt',d.retry_at,'hasMedia',d.local_file IS NOT NULL,'hasSession',d.session IS NOT NULL,'uploadStarted',d.upload_started_at IS NOT NULL,'approved',d.approved_at IS NOT NULL)) FROM deliveries d WHERE d.video_id=v.id),'[]') AS deliveries,
    ${cursorFields('v.updated_at','v.id')}
    FROM videos v JOIN watches w ON w.id=v.watch_id WHERE true${where}
    ORDER BY v.updated_at DESC,v.id DESC${limit}`,values);
  return paginateRows(rows,page);
}

export async function dashboardStats(){
  const {rows:[stats]}=await pool.query(`SELECT
    (SELECT count(*)::int FROM watches WHERE controlled_by_requests=false AND managed_by_cuts=false) AS watches,
    (SELECT count(*)::int FROM watches WHERE controlled_by_requests=false AND managed_by_cuts=false AND enabled) AS active_watches,
    EXISTS(SELECT 1 FROM watches WHERE controlled_by_requests=false AND managed_by_cuts=false AND source_type IN ('local','gta6_pack')) AS local_source_ready,
    (SELECT count(*)::int FROM videos WHERE status IN ('ready','waiting','retry','uploading')) +
    (SELECT count(*)::int FROM deliveries WHERE engine IN ('local','browser') AND status IN ('preparing','review','pending','retry','submitting')) AS pending,
    (SELECT count(*)::int FROM deliveries WHERE status IN ('draft','scheduled','published','processing','private','unlisted','inbox','completed')) AS sent,
    (SELECT count(*)::int FROM deliveries WHERE status IN ('unknown','failed')) AS attention`);
  return stats;
}

export const dashboardRoutes=Router();
dashboardRoutes.get('/api/watches',async(req,res)=>res.json(await listWatches(parsePagination(req.query,{scope:'watches'}))));
dashboardRoutes.get('/api/watches/:id/schedule',async(req,res)=>{
  const id=z.string().uuid().parse(req.params.id);
  res.json(await listFolderSchedule(id,parsePagination(req.query,{scope:'agendamentos-'+id,defaultLimit:12})));
});
dashboardRoutes.post('/api/watches/:id/schedule/cancel',async(req,res)=>{
  const id=z.string().uuid().parse(req.params.id);
  z.object({confirm:z.literal(true)}).strict().parse(req.body);
  res.json(await cancelFolderSchedule(id));
});
dashboardRoutes.get('/api/events',async(req,res)=>res.json(await listEvents(parsePagination(req.query,{scope:'events',idType:'bigint'}))));
dashboardRoutes.get('/api/videos',async(req,res)=>res.json(await listVideos(parsePagination(req.query,{scope:'videos'}))));
