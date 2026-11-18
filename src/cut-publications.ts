import {requireTikTokBrowserToken} from './playwright-mcp.js';
import {randomUUID} from 'node:crypto';
import {stat} from 'node:fs/promises';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {AppError} from './config.js';
import {pool} from './db.js';
import {metadataSchema} from './domain.js';
import {nativeChannels} from './native-auth.js';
import {sha256,validateVideo} from './media.js';
import {framingOptionsSchema} from './cuts-edit.js';
import {stageCutUpload} from './cuts-upload-files.js';
import {tiktokCaption} from './tiktok-caption.js';

export const cutPublishSchema=z.object({
  channelId:z.string().min(1).max(200),title:z.string().trim().min(1).max(100),description:z.string().max(4900).default(''),
  visibility:z.enum(['private','unlisted','public']).default('private'),madeForKids:z.boolean().default(false),containsSyntheticMedia:z.boolean().default(false),
  tiktok:metadataSchema.shape.tiktok.optional(),confirm:z.literal(true),revision:z.number().int().positive(),format:z.enum(['shorts','video']).optional()
});

export async function cutDestinations(){
  const [channels,profiles]=await Promise.all([nativeChannels(),pool.query('SELECT id,name FROM browser_profiles ORDER BY created_at,id')]);
  return [...channels.filter(channel=>channel.identifier==='youtube'),...profiles.rows.map(profile=>({id:'browser:tiktok:'+profile.id,name:profile.name,identifier:'tiktok-browser',disabled:false}))];
}

/** The caller holds the cuts job lock until the delivery and upload copy commit. */
export async function publishCut(db:PoolClient,job:{id:string;title:string|null;url:string},clip:any,dir:string,input:z.infer<typeof cutPublishSchema>){
  if(!clip)throw new AppError('Corte não encontrado.',404);
  if(clip.revision!==input.revision)throw new AppError('A prévia mudou. Confira a versão atual antes de postar.',409);
  const channel=(await cutDestinations()).find(channel=>channel.id===input.channelId&&!channel.disabled);
  if(!channel)throw new AppError('Conecte e selecione a conta que deve receber este corte.',409);
  const tiktok=channel.identifier==='tiktok-browser';
  const {rows:[existing]}=await db.query('SELECT id FROM deliveries WHERE video_id=$1 AND integration_id=$2',[clip.id,channel.id]);
  if(existing)return {deliveryId:existing.id,reused:true};
  if(tiktok)await requireTikTokBrowserToken();
  if(!['review','failed','posted','publishing'].includes(clip.status)||!clip.local_file)throw new AppError('Aguarde uma prévia pronta para autorizar o envio.',409);
  const format=framingOptionsSchema.parse(clip.framing_options||{}).format;
  if(input.format&&input.format!==format)throw new AppError('O formato escolhido precisa de uma nova prévia. Ajuste o corte e confira antes de postar.',409);
  if(tiktok&&(!input.tiktok||input.tiktok.privacyLevel!=='PUBLIC_TO_EVERYONE'))throw new AppError('Confira a publicação pública e as declarações do TikTok antes de postar.');
  const source=join(dir,clip.id+'.mp4');await validateVideo(source,format);
  const hash=await sha256(source),deliveryId=randomUUID(),filename=deliveryId+'.native.mp4';
  const metadata=metadataSchema.parse({title:input.title,description:input.description,hashtags:!tiktok&&format==='shorts'?['Shorts']:[],
    youtube:{visibility:input.visibility,madeForKids:input.madeForKids,containsSyntheticMedia:input.containsSyntheticMedia},...(tiktok?{tiktok:input.tiktok}:{})});
  if(tiktok){try{tiktokCaption(metadata);}catch{throw new AppError('A legenda do TikTok excede 2.200 caracteres.');}}
  await db.query(`INSERT INTO watches(id,name,folder_id,folder_url,source_type,enabled,initialized,managed_by_cuts,next_scan_at,next_upload_at)
    VALUES($1,$2,$3,$4,'local',true,true,true,'9999-12-31','9999-12-31') ON CONFLICT(id) DO NOTHING`,[job.id,'Cortes · '+(job.title||'YouTube').slice(0,80),'cuts:'+job.id,job.url]);
  await db.query(`INSERT INTO videos(id,watch_id,file_id,name,parent_id,status,sha256,metadata,size)
    VALUES($1::uuid,$2::uuid,$1::text,$3,$2::text,'sent',$4,$5,$6) ON CONFLICT(id) DO NOTHING`,[clip.id,job.id,input.title+'.mp4',hash,JSON.stringify(metadata),(await stat(source)).size]);
  const {rows:[video]}=await db.query('SELECT sha256 FROM videos WHERE id=$1',[clip.id]);
  if(video.sha256!==hash)throw new AppError('O arquivo mudou desde o primeiro envio. Gere uma nova versão do corte antes de postar.',409);
  await db.query(`INSERT INTO deliveries(id,video_id,integration_id,provider,engine,status,payload,local_file,approved_at)
    VALUES($1,$2,$3,$4,$5,'pending',$6,$7,now())`,[deliveryId,clip.id,channel.id,tiktok?'tiktok':'youtube',tiktok?'browser':'local',
    JSON.stringify({metadata,channelName:channel.name,assetSha256:hash,stripMetadata:false,automatic:false,nativeSchedule:false,cutRevision:clip.revision,...(tiktok?{publishNow:true,manualPublication:true}:{})}),filename]);
  const {rows:[claim]}=await db.query(`INSERT INTO content_claims(sha256,integration_id,delivery_id) VALUES($1,$2,$3)
    ON CONFLICT(sha256,integration_id) DO UPDATE SET sha256=EXCLUDED.sha256 RETURNING delivery_id`,[hash,channel.id,deliveryId]);
  if(claim.delivery_id!==deliveryId)throw new AppError('Este mesmo vídeo já foi registrado para essa conta. Confira o histórico.',409);
  await stageCutUpload({jobId:job.id,clipId:clip.id,deliveryId,sha256:hash,source});
  await db.query(`UPDATE cuts SET title=CASE WHEN delivery_id IS NULL THEN $2 ELSE title END,status='publishing',
    delivery_id=coalesce(delivery_id,$3),error=NULL,updated_at=now() WHERE id=$1`,[clip.id,input.title,deliveryId]);
  return {deliveryId,reused:false};
}
