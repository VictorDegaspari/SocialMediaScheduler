import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {pool,event} from './db.js';
import {AppError,errorMessage} from './config.js';
import {nativeChannels} from './native-auth.js';
import {updateYoutubeTitle} from './native-api.js';

export function genericVideoTitle(title:string) {
  const normalized=title.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\.mp4$/i,'');
  return /^(?:.*[\s—–:_-])?(?:video|clip|short|arquivo|file)[\s#_-]*\d+$/i.test(normalized)||/^\d{1,6}$/.test(normalized);
}
const titleSchema=z.string().trim().min(5).max(100).refine(title=>!genericVideoTitle(title),'Descreva o assunto do vídeo; números de arquivo não são títulos.');
const reviewsSchema=z.object({reviews:z.array(z.object({videoId:z.string().uuid(),title:titleSchema,sha256:z.string().regex(/^[a-f0-9]{64}$/),evidence:z.string().trim().min(10).max(2000)}).strict()).min(1).max(100)}).strict();

export async function titleReview(videoId:string,version:string) {
  const {rows:[review]}=await pool.query('SELECT title,sha256,evidence FROM video_title_reviews WHERE video_id=$1 AND source_version=$2',[videoId,version]);
  return review;
}
export async function saveTitleReviews(body:unknown) {
  const {reviews}=reviewsSchema.parse(body),db=await pool.connect();
  try {
    await db.query('BEGIN');
    const watches=new Set<string>();
    for(const review of reviews) {
      const {rows:[video]}=await db.query('SELECT id,watch_id,version,sha256 FROM videos WHERE id=$1 FOR UPDATE',[review.videoId]);
      if(!video)throw new AppError('Vídeo não encontrado.',404);
      if(video.sha256&&video.sha256!==review.sha256)throw new AppError('A revisão não corresponde aos bytes do vídeo enviado.',409);
      await db.query(`INSERT INTO video_title_reviews(video_id,source_version,sha256,title,evidence) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(video_id) DO UPDATE SET source_version=EXCLUDED.source_version,sha256=EXCLUDED.sha256,title=EXCLUDED.title,evidence=EXCLUDED.evidence,reviewed_at=now()`,
        [video.id,video.version,review.sha256,review.title,review.evidence]);
      watches.add(video.watch_id);
    }
    await db.query("UPDATE watches SET last_error=NULL WHERE id=ANY($1::uuid[]) AND last_error LIKE 'Revise o conteúdo de % e defina um título descritivo antes do envio.'",[[...watches]]);
    await db.query(`WITH resolved AS (UPDATE manual_actions a SET resolved_at=now() FROM publication_requests r,publishing_profiles p
      WHERE a.request_id=r.id AND r.profile_id=p.id AND p.watch_id=ANY($1::uuid[]) AND a.kind='title_review' AND a.resolved_at IS NULL RETURNING a.request_id)
      UPDATE publication_requests SET status='active' WHERE id IN(SELECT request_id FROM resolved) AND status='waiting_manual'`,[[...watches]]);
    await db.query('COMMIT');return {saved:reviews.length};
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}

let lastSync=0;
/** Called under the coordinator lock. Retrying a title edit never uploads media. */
export async function syncYoutubeTitles(force=false) {
  if(!force&&Date.now()-lastSync<30_000)return;lastSync=Date.now();
  const {rows}=await pool.query(`SELECT d.id,d.post_id,d.integration_id,d.request_id,v.watch_id,t.title
    FROM deliveries d JOIN videos v ON v.id=d.video_id JOIN video_title_reviews t ON t.video_id=v.id AND t.source_version=v.version AND t.sha256=v.sha256
    WHERE d.provider='youtube' AND d.engine='local' AND d.post_id IS NOT NULL
    AND d.payload#>>'{metadata,title}' IS DISTINCT FROM t.title ORDER BY t.reviewed_at,d.id LIMIT 20`);
  if(!rows.length)return;
  const accounts=await nativeChannels();
  const notified=new Set<string>();
  for(const delivery of rows) {
    const channel=accounts.find(c=>c.id===delivery.integration_id&&!c.disabled);
    let problem:string|null=null;
    if(!channel?.canEditVideos)problem='Autorize a edição de títulos da conta YouTube. Os títulos já foram revisados e serão aplicados após a autorização.';
    else {
      try {
        await updateYoutubeTitle(delivery.post_id,delivery.title,delivery.integration_id.slice('native:youtube:'.length));
        await pool.query(`UPDATE deliveries SET payload=jsonb_set(payload,'{metadata,title}',to_jsonb($2::text)),updated_at=now() WHERE id=$1 AND post_id=$3`,[delivery.id,delivery.title,delivery.post_id]);
        await pool.query(`UPDATE videos SET metadata=jsonb_set(metadata,'{title}',to_jsonb($2::text)),updated_at=now() WHERE id=(SELECT video_id FROM deliveries WHERE id=$1)`,[delivery.id,delivery.title]);
        await event('success','Título atualizado no YouTube: '+delivery.title,delivery.watch_id,undefined,{deliveryId:delivery.id,postId:delivery.post_id});
      }catch(error){problem='Não foi possível atualizar o título no YouTube: '+errorMessage(error);}
    }
    if(problem) {
      const key=delivery.watch_id+':'+delivery.integration_id;
      if(notified.has(key))continue;notified.add(key);
      const {rows:requests}=await pool.query(`SELECT r.id FROM publication_requests r JOIN publishing_profiles p ON p.id=r.profile_id
        WHERE p.watch_id=$1 AND r.provider='youtube' AND (r.id=$2 OR r.config#>>'{target,integrationId}'=$3) ORDER BY r.created_at DESC LIMIT 1`,[delivery.watch_id,delivery.request_id,delivery.integration_id]);
      if(requests[0])await pool.query(`INSERT INTO manual_actions(id,request_id,kind,message,href) VALUES($1,$2,'youtube_titles',$3,$4)
        ON CONFLICT(request_id,kind) DO UPDATE SET message=EXCLUDED.message,href=EXCLUDED.href,resolved_at=NULL
        WHERE (manual_actions.message,manual_actions.href,manual_actions.resolved_at) IS DISTINCT FROM (EXCLUDED.message,EXCLUDED.href,NULL::timestamptz)`,
        [randomUUID(),requests[0].id,problem,'/auth/youtube?edit=1&channel='+encodeURIComponent(delivery.integration_id.slice('native:youtube:'.length))]);
    }
  }
  await pool.query(`UPDATE manual_actions a SET resolved_at=now() FROM publication_requests r,publishing_profiles p WHERE a.request_id=r.id AND r.profile_id=p.id
    AND a.kind='youtube_titles' AND a.resolved_at IS NULL AND NOT EXISTS(SELECT 1 FROM deliveries d JOIN videos v ON v.id=d.video_id
      JOIN video_title_reviews t ON t.video_id=v.id AND t.source_version=v.version AND t.sha256=v.sha256
      WHERE v.watch_id=p.watch_id AND d.provider='youtube' AND d.engine='local' AND d.post_id IS NOT NULL AND d.payload#>>'{metadata,title}' IS DISTINCT FROM t.title)`);
}
