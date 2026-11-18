import {requireTikTokBrowserToken} from './playwright-mcp.js';
import {pool,event} from './db.js';
import {AppError} from './config.js';
import {cleanupPublishedMedia} from './media-cleanup.js';

export async function retryDelivery(id:string){
  const db=await pool.connect();let videoId:string;
  try{
    await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(74839200)');
    const {rows:[row]}=await db.query('SELECT * FROM deliveries WHERE id=$1 FOR UPDATE',[id]);
    if(!row||!['local','browser'].includes(row.engine))throw new AppError('Envio não encontrado.',404);
    if(row.post_id||!['failed','retry','unknown'].includes(row.status))throw new AppError('Este envio já está na fila ou já terminou. Atualize o histórico para conferir o resultado.',409);
    if(row.request_id&&(await db.query("SELECT id FROM publication_requests WHERE id=$1 AND status='cancelled'",[row.request_id])).rowCount)throw new AppError('O pedido deste vídeo foi cancelado. Crie um novo pedido para continuar.',409);
    if(!row.approved_at)throw new AppError('Este vídeo ainda precisa de revisão e aprovação antes de entrar na fila.',409);
    if(!row.local_file)throw new AppError('A cópia preparada não está disponível. Prepare uma nova prévia do vídeo para continuar.',409);
    if(row.engine==='browser'){
      await requireTikTokBrowserToken();
      if(row.status==='unknown'||row.session||row.upload_started_at||(await db.query('SELECT id FROM browser_commands WHERE delivery_id=$1 AND upload_started',[id])).rowCount)throw new AppError('O upload anterior pode ter começado. Confira rascunhos, agendados e publicados no TikTok Studio antes de reenviar.',409);
      if((await db.query("SELECT id FROM browser_commands WHERE delivery_id=$1 AND status IN ('pending','running','cancel_requested')",[id])).rowCount)throw new AppError('Este vídeo já tem uma tarefa no navegador. Aguarde o encerramento ou cancele essa tarefa.',409);
    }
    await db.query("UPDATE deliveries SET status='pending',retry_at=now(),attempts=0,error=NULL,updated_at=now() WHERE id=$1",[id]);
    videoId=row.video_id;await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
  await event('info','Nova tentativa solicitada para este vídeo. A conta, a aprovação e a mídia foram preservadas.',undefined,videoId);
}

export async function cancelDelivery(id:string){
  const db=await pool.connect();let status:'cancelled'|'cancel_requested'='cancelled',videoId:string;
  try{
    await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(74839200)');
    const {rows:[row]}=await db.query('SELECT * FROM deliveries WHERE id=$1 FOR UPDATE',[id]);
    if(!row||!['local','browser'].includes(row.engine))throw new AppError('Envio não encontrado.',404);
    if(row.status==='cancelled'){await db.query('COMMIT');return {status};}
    if(row.post_id||row.session||!['preparing','review','pending','retry','failed','submitting'].includes(row.status))throw new AppError('Este envio já começou ou exige conferência na plataforma. Confira o histórico antes de continuar.',409);
    const {rows:active}=await db.query("SELECT id FROM browser_commands WHERE delivery_id=$1 AND status IN ('running','cancel_requested')",[id]);
    if(row.engine==='browser'&&active.length){
      status='cancel_requested';
      await db.query("UPDATE browser_commands SET status='cancel_requested',progress_at=CASE WHEN status='running' THEN now() ELSE progress_at END,message='Cancelamento deste vídeo solicitado. Aguardando o navegador encerrar.' WHERE delivery_id=$1 AND status IN ('running','cancel_requested')",[id]);
      await db.query("UPDATE deliveries SET error='Cancelamento solicitado. Aguardando o navegador encerrar.',updated_at=now() WHERE id=$1",[id]);
    }else{
      if(row.status==='submitting'||row.engine==='browser'&&(row.upload_started_at||(await db.query('SELECT id FROM browser_commands WHERE delivery_id=$1 AND upload_started',[id])).rowCount))throw new AppError('O upload já começou. Confira o resultado na plataforma antes de cancelar.',409);
      await db.query("UPDATE deliveries SET status='cancelled',error=NULL,retry_at=NULL,updated_at=now() WHERE id=$1",[id]);
      await db.query("UPDATE browser_commands SET status='cancelled',message='Vídeo cancelado antes do upload.',finished_at=now(),lease_until=NULL WHERE delivery_id=$1 AND status IN ('pending','failed') AND NOT upload_started",[id]);
      await db.query('DELETE FROM content_claims WHERE delivery_id=$1',[id]);
    }
    videoId=row.video_id;await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
  if(status==='cancelled')await cleanupPublishedMedia(id);
  await event('info',status==='cancelled'?'Envio deste vídeo cancelado. O original foi preservado.':'Cancelamento deste vídeo solicitado ao navegador.',undefined,videoId);
  return {status};
}

export async function cancelQueuedVideo(id:string){
  const db=await pool.connect();let watchId:string;
  try{
    await db.query('BEGIN');
    // The worker selects and prepares source videos under this same lock.
    const {rows:[lock]}=await db.query('SELECT pg_try_advisory_xact_lock(74839121) AS acquired');
    if(!lock.acquired)throw new AppError('Uma verificação está em andamento. Aguarde alguns instantes e tente cancelar novamente.',409);
    const {rows:[row]}=await db.query(`UPDATE videos v SET status='cancelled',retry_at=NULL,error=NULL,updated_at=now()
      WHERE v.id=$1 AND v.status IN ('waiting','ready','retry','failed') AND NOT EXISTS(SELECT 1 FROM deliveries d WHERE d.video_id=v.id)
      RETURNING v.watch_id`,[id]);
    if(!row)throw new AppError('Este vídeo já tem envios. Cancele cada destino pelo histórico.',409);
    watchId=row.watch_id;await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
  await event('info','Vídeo retirado da fila. O arquivo original foi preservado.',watchId,id);
}
