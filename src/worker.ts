import { randomUUID, createHash } from 'node:crypto';
import { mkdir, rm, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import { pool, redis, event, getSetting, setSetting, type Watch } from './db.js';
import { postizClient, type DriveFile, type PostizConfig } from './clients.js';
import { sourceFor } from './sources.js';
import { metadataSchema, buildPost, nextRun, type Metadata, type Integration } from './domain.js';
import { AppError, dataDir, errorMessage } from './config.js';
import { sha256, validateVideo, stripVideoMetadata } from './media.js';
import { LocalPublisher } from './local-publisher.js';
import { publisherEngine } from './native-auth.js';
import {publicationRequests} from './publication-requests.js';
import { browserBridge } from './browser-bridge.js';
import {syncYoutubeTitles} from './video-titles.js';

const MAX_VIDEO_BYTES=1024*1024*1024;
type Sidecar={file:DriveFile;data:unknown;error?:string};
interface Video {
  id:string; file_id:string; name:string; version:string; size:string; metadata:Metadata;
  media:{id:string;path:string}|null; media_stripped_metadata:boolean; sha256:string|null; attempts:number;
  json_file_id:string|null; json_version:string|null;
}

export class Worker {
  readonly native=new LocalPublisher();
  private stopping=false;
  private recovered=false;
  lastTick:Date|null=null;
  private jsonCache=new Map<string,{at:number;bytes:number;data:unknown}>();
  private jsonCacheBytes=0;
  async stop() {this.stopping=true;}
  async tick() {
    const lock=await pool.connect();
    try {
      const acquired=await lock.query('SELECT pg_try_advisory_lock(74839121) AS acquired');
      if(!acquired.rows[0].acquired) return;
      try {
        if(!this.recovered) {
          await pool.query("UPDATE deliveries SET status='unknown',error='Serviço reiniciado durante o envio. Confira o Postiz antes de repetir.' WHERE status='submitting' AND engine='postiz'");
          await pool.query("UPDATE videos SET status='ready' WHERE status='uploading'");
          await mkdir(dataDir,{recursive:true});
          for(const file of await readdir(dataDir)) if(/^[0-9a-f-]+(?:\.clean)?\.mp4$/.test(file)) await rm(join(dataDir,file),{force:true});
          this.recovered=true;
        }
        // Recovery skips deliveries whose upload lock is still held by a transfer.
        await this.native.recover();
        this.lastTick=new Date();
        if(redis.status==='ready') await redis.set('watcher:heartbeat',this.lastTick.toISOString(),'EX',60).catch(()=>{});
        await setSetting('heartbeat',this.lastTick.toISOString());
        await browserBridge.tick();
        if(await getSetting<boolean>('paused')) return;
        await publicationRequests.tick(this.native);
        const {rows:watches}=await pool.query<Watch>('SELECT * FROM watches WHERE enabled=true ORDER BY created_at');
        for(const watch of watches) {
          if(this.stopping) break;
          if(new Date(watch.next_scan_at).getTime()<=Date.now()) {
            try { await this.scan(watch); }
            catch(error) {
              const message=errorMessage(error);
              const delay=Math.max(watch.scan_minutes,(error instanceof AppError?error.retryAfterMs || 0:0)/60_000);
              await pool.query('UPDATE watches SET last_error=$2,next_scan_at=now()+($3*interval \'1 minute\') WHERE id=$1',[watch.id,message,delay]);
              await event('error',message,watch.id);
              continue;
            }
          }
          if(!watch.controlled_by_requests&&(watch.mode==='native_schedule'||new Date(watch.next_upload_at).getTime()<=Date.now())) {
            if(await publisherEngine()==='local')await this.native.prepareNext(watch);
            else if(watch.mode==='native_schedule')await pool.query('UPDATE watches SET last_error=$2 WHERE id=$1',[watch.id,'Agendamento nativo exige o motor local.']);
            else await this.sendNext(watch);
          }
        }
        if(!this.stopping) {await this.reconcile();await this.native.reconcile();await syncYoutubeTitles();}
        await pool.query("DELETE FROM oauth_states WHERE expires_at<now()");
        await pool.query("DELETE FROM events WHERE created_at<now()-interval '90 days'");
      } finally { await lock.query('SELECT pg_advisory_unlock(74839121)'); }
    } finally { lock.release(); }
  }

  async scan(watch:Watch) {
    const source=await sourceFor(watch);
    const folder=await source.file(watch.folder_id);
    if(folder.mimeType!=='application/vnd.google-apps.folder') throw new AppError('O link cadastrado não aponta para uma pasta.');
    const files=await source.tree(watch.folder_id,watch.recursive);
    const videos=files.filter(f=>f.mimeType==='video/mp4' && /\.mp4$/i.test(f.name));
    const jsonFiles=files.filter(f=>/\.json$/i.test(f.name));
    const jsonData=new Map<string,Sidecar>();
    for(const file of jsonFiles) {
      const version=file.version||file.modifiedTime;
      const key=JSON.stringify([watch.id,file.id,version]),cached=this.jsonCache.get(key);
      try {
        const data=version&&cached&&Date.now()-cached.at<3600_000?cached.data:await source.json(file.id);
        jsonData.set(file.id,{file,data});
        if(version&&(!cached||Date.now()-cached.at>=3600_000)) {
          const bytes=Buffer.byteLength(JSON.stringify(data)??'null');
          if(cached){this.jsonCache.delete(key);this.jsonCacheBytes-=cached.bytes;}
          this.jsonCache.set(key,{at:Date.now(),bytes,data});this.jsonCacheBytes+=bytes;
          while(this.jsonCache.size>10000||this.jsonCacheBytes>32*1024*1024){const oldest=this.jsonCache.keys().next().value!;this.jsonCacheBytes-=this.jsonCache.get(oldest)!.bytes;this.jsonCache.delete(oldest);}
        }
      }
      catch(error) { if(error instanceof AppError && error.status===401) throw error; jsonData.set(file.id,{file,data:null,error:errorMessage(error)}); }
    }
    const ids=videos.map(file=>file.id);
    const {rows:existing}=await pool.query('SELECT * FROM videos WHERE watch_id=$1 AND file_id=ANY($2::text[])',[watch.id,ids]);
    const previousFiles=new Map(existing.map(row=>[row.file_id,row]));
    const byId=new Map<string,Sidecar[]>();
    const byName=new Map<string,Sidecar[]>();
    const key=(parent:string|undefined,value:string)=>JSON.stringify([parent,value]);
    for(const json of jsonData.values()) {
      const parent=json.file.parents?.[0],id=(json.data as {videoFileId?:string}|null)?.videoFileId;
      if(id){const k=key(parent,id);byId.set(k,[...(byId.get(k)||[]),json]);}
      const k=key(parent,json.file.name.toLowerCase());byName.set(k,[...(byName.get(k)||[]),json]);
    }
    const updates:Record<string,unknown>[]=[];
    let found=0;
    for(const file of videos) {
      const previous=previousFiles.get(file.id);
      // Files already handed to Postiz, or excluded during baseline, are immutable here.
      if(previous && ['baseline','sent','unknown','duplicate','removed'].includes(previous.status)) continue;
      const idMatches=byId.get(key(file.parents?.[0],file.id))||[];
      const matches=idMatches.length?idMatches:byName.get(key(file.parents?.[0],file.name.replace(/\.mp4$/i,'.json').toLowerCase()))||[];
      const sidecar=matches.length===1?matches[0]:null;
      let metadata:Metadata|null=null;
      let issue:string|null=null;
      let status='waiting';
      if(matches.length>1) issue='Mais de um JSON corresponde ao vídeo. Informe videoFileId em um único JSON.';
      else if(sidecar?.error) issue=sidecar.error;
      else if(!sidecar && watch.require_metadata) issue='Aguardando o JSON com o mesmo nome do vídeo.';
      else {
        const defaults=watch.controlled_by_requests?watch.metadata_defaults||{}:{};
        const parsed=metadataSchema.safeParse(sidecar?.data || {...defaults,title:[defaults.title,file.name.replace(/\.mp4$/i,'')].filter(Boolean).join(' — ').slice(0,100)});
        if(!parsed.success) issue='JSON inválido: '+parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ').slice(0,500);
        else if(parsed.data.videoFileId && parsed.data.videoFileId!==file.id) issue='O videoFileId do JSON não corresponde ao vídeo.';
        else if(!parsed.data.ready) issue='JSON marcado como ready=false.';
        else { metadata=parsed.data;status='ready'; }
      }
      if(file.capabilities?.canDownload===false) {status='waiting';issue='A conta não tem permissão para baixar este vídeo.';}
      if((!Number(file.size)&&!(watch.source_type==='gta6_pack'&&file.size===undefined)) || Number(file.size)>MAX_VIDEO_BYTES) {status='waiting';issue='Tamanho inválido ou acima de 1 GiB.';}
      if(!watch.initialized && !watch.import_existing) {status='baseline';issue='Arquivo já existia na primeira leitura. Não será enviado automaticamente.';}
      const version=file.version || file.modifiedTime || '';
      const changed=previous && (previous.version!==version || previous.json_version!==(sidecar?.file.version || sidecar?.file.modifiedTime || null));
      // Invalid media and exhausted safe retries only become eligible after source changes.
      if(previous?.status==='failed' && !changed) continue;
      // An unchanged listing must not reset safe retry backoff or churn updated_at.
      if(previous?.status==='retry'&&!changed&&status==='ready'){status='retry';issue=previous.error;}
      const row={id:previous?.id||randomUUID(),watch_id:watch.id,file_id:file.id,name:file.name,parent_id:file.parents?.[0]||watch.folder_id,
        version,size:String(file.size||0),modified_at:file.modifiedTime?new Date(file.modifiedTime).toISOString():null,metadata,status,error:issue,
        json_file_id:sidecar?.file.id||null,json_version:sidecar?.file.version||sidecar?.file.modifiedTime||null};
      if(!previous||Object.entries(row).some(([field,value])=>!isDeepStrictEqual(field==='modified_at'&&previous[field]?new Date(previous[field]).toISOString():previous[field],value)))updates.push(row);
      if(!previous) found++;
    }
    // Bound statement/parameter size and let PostgreSQL compare the final values too.
    for(let offset=0;offset<updates.length;offset+=250) {
      await pool.query(`INSERT INTO videos(id,watch_id,file_id,name,parent_id,version,size,modified_at,metadata,status,error,json_file_id,json_version)
        SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,watch_id uuid,file_id text,name text,parent_id text,version text,size bigint,
          modified_at timestamptz,metadata jsonb,status text,error text,json_file_id text,json_version text)
        ON CONFLICT(watch_id,file_id) DO UPDATE SET name=EXCLUDED.name,parent_id=EXCLUDED.parent_id,
          stable_since=CASE WHEN videos.version IS DISTINCT FROM EXCLUDED.version OR videos.json_version IS DISTINCT FROM EXCLUDED.json_version THEN now() ELSE videos.stable_since END,
          media=CASE WHEN videos.version IS DISTINCT FROM EXCLUDED.version THEN NULL ELSE videos.media END,
          sha256=CASE WHEN videos.version IS DISTINCT FROM EXCLUDED.version THEN NULL ELSE videos.sha256 END,
          attempts=CASE WHEN videos.version IS DISTINCT FROM EXCLUDED.version OR videos.json_version IS DISTINCT FROM EXCLUDED.json_version THEN 0 ELSE videos.attempts END,
          retry_at=CASE WHEN videos.version IS DISTINCT FROM EXCLUDED.version OR videos.json_version IS DISTINCT FROM EXCLUDED.json_version THEN NULL ELSE videos.retry_at END,
          version=EXCLUDED.version,size=EXCLUDED.size,modified_at=EXCLUDED.modified_at,metadata=EXCLUDED.metadata,
          json_file_id=EXCLUDED.json_file_id,json_version=EXCLUDED.json_version,status=EXCLUDED.status,error=EXCLUDED.error,updated_at=now()
          WHERE videos.status NOT IN ('baseline','sent','unknown','duplicate','removed') AND
            (videos.name,videos.parent_id,videos.version,videos.size,videos.modified_at,videos.metadata,videos.json_file_id,videos.json_version,videos.status,videos.error)
            IS DISTINCT FROM (EXCLUDED.name,EXCLUDED.parent_id,EXCLUDED.version,EXCLUDED.size,EXCLUDED.modified_at,EXCLUDED.metadata,EXCLUDED.json_file_id,EXCLUDED.json_version,EXCLUDED.status,EXCLUDED.error)`,
        [JSON.stringify(updates.slice(offset,offset+250))]);
    }
    await pool.query("UPDATE videos SET status='removed',error='Arquivo removido da pasta ou sem acesso.',updated_at=now() WHERE watch_id=$1 AND status IN ('ready','waiting','retry','failed') AND NOT(file_id=ANY($2::text[]))",[watch.id,ids]);
    await pool.query("UPDATE watches SET initialized=true,last_scan_at=now(),last_error=NULL,next_scan_at=now()+($2*interval '1 minute') WHERE id=$1",[watch.id,watch.scan_minutes]);
    await event('info',`Pasta verificada: ${videos.length} vídeo(s), ${found} novo(s).`,watch.id);
  }

  private async sendNext(watch:Watch) {
    if(!watch.integration_ids.length) return;
    const {rows}=await pool.query<Video>(`SELECT * FROM videos WHERE watch_id=$1 AND status IN ('ready','retry')
      AND stable_since<=now()-interval '30 seconds' AND (retry_at IS NULL OR retry_at<=now())
      ORDER BY created_at,file_id LIMIT 1`,[watch.id]);
    const video=rows[0];
    if(!video) return;
    let spool:string|undefined;
    let cleanedSpool:string|undefined;
    try {
      const config=await getSetting<PostizConfig>('postiz');
      if(!config) throw new AppError('Configure o Postiz em Conexões.');
      const postiz=await postizClient();
      const channels=await postiz.integrations();
      const selected=watch.integration_ids.map(id=>channels.find(c=>c.id===id));
      if(selected.some(c=>!c || c.disabled)) throw new AppError('Um canal selecionado está desabilitado ou não existe mais no Postiz.');
      const targets=(selected as Integration[]).filter(c=>!video.metadata.targets || video.metadata.targets.includes(c.identifier as never) || (c.identifier==='tiktok-business' && video.metadata.targets.includes('tiktok')));
      if(!targets.length) throw new AppError('Os destinos do JSON não correspondem aos canais desta rotina.');
      if(watch.mode==='schedule' && targets.some(c=>c.identifier==='youtube') && !config.youtubeSchedulingApproved) throw new AppError('Confirme a autorização do canal YouTube em Conexões antes de habilitar agendamentos.');
      const stripMetadata=watch.strip_metadata!==false;
      if(!video.media || !video.sha256 || video.media_stripped_metadata!==stripMetadata) {
        const source=await sourceFor(watch);
        await pool.query("UPDATE videos SET status='uploading',updated_at=now() WHERE id=$1",[video.id]);
        spool=join(dataDir,`${video.id}.mp4`);
        const bytes=await source.download(video.file_id,spool,MAX_VIDEO_BYTES);
        if(bytes!==Number(video.size)&&!(watch.source_type==='gta6_pack'&&Number(video.size)===0)) throw new AppError('O tamanho do vídeo mudou. Aguarde uma nova verificação.');
        await validateVideo(spool);
        const latest=await source.file(video.file_id);
        if((latest.version || latest.modifiedTime || '')!==video.version) throw new AppError('O vídeo mudou durante a leitura. Aguarde uma nova verificação.');
        if(video.json_file_id) {
          const latestJson=await source.file(video.json_file_id);
          if((latestJson.version || latestJson.modifiedTime || '')!==video.json_version) throw new AppError('O JSON mudou durante a leitura. Aguarde uma nova verificação.');
        }
        // Keep deduplication based on the original bytes, regardless of this option.
        video.sha256=await sha256(spool);
        // Never reuse an original upload when the routine requires a cleaned copy.
        const known=await pool.query('SELECT v.media FROM videos v WHERE sha256=$1 AND media_stripped_metadata=$2 AND media IS NOT NULL LIMIT 1',[video.sha256,stripMetadata]);
        if(known.rows[0]?.media) video.media=known.rows[0].media;
        else {
          let uploadPath=spool;
          if(stripMetadata) {
            cleanedSpool=join(dataDir,`${video.id}.clean.mp4`);
            await stripVideoMetadata(spool,cleanedSpool);
            if((await stat(cleanedSpool)).size>MAX_VIDEO_BYTES) throw new AppError('O vídeo após a limpeza excede o limite de 1 GiB.');
            uploadPath=cleanedSpool;
            await event('info','Metadados do arquivo removidos antes do upload.',watch.id,video.id);
          }
          video.media=await postiz.upload(uploadPath);
        }
        await pool.query('UPDATE videos SET media=$2,sha256=$3,media_stripped_metadata=$4,status=\'ready\',updated_at=now() WHERE id=$1',[video.id,JSON.stringify(video.media),video.sha256,stripMetadata]);
      }
      for(const channel of targets) {
        // Finish the current video's destinations before graceful shutdown.
        // Stopping midway must not mark unprocessed destinations as delivered.
        const mode=channel.identifier==='youtube'?watch.mode:'draft';
        const plannedAt=new Date(Date.now()+2*60_000);
        const payload=buildPost(video.metadata,channel,video.media!,mode,plannedAt);
        const deliveryId=randomUUID();
        await pool.query(`INSERT INTO deliveries(id,video_id,integration_id,provider,planned_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(video_id,integration_id) DO NOTHING`,[deliveryId,video.id,channel.id,channel.identifier,plannedAt]);
        const {rows:[delivery]}=await pool.query('SELECT * FROM deliveries WHERE video_id=$1 AND integration_id=$2',[video.id,channel.id]);
        if(delivery.status!=='pending') continue;
        await pool.query('INSERT INTO content_claims(sha256,integration_id,delivery_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[video.sha256,channel.id,delivery.id]);
        const {rows:[claim]}=await pool.query('SELECT delivery_id FROM content_claims WHERE sha256=$1 AND integration_id=$2',[video.sha256,channel.id]);
        if(claim.delivery_id!==delivery.id) {
          await pool.query("UPDATE deliveries SET status='duplicate',error='Conteúdo idêntico já registrado para este canal.',updated_at=now() WHERE id=$1",[delivery.id]);
          continue;
        }
        await pool.query("UPDATE deliveries SET status='submitting',planned_at=$2,payload_hash=$3,error=NULL,updated_at=now() WHERE id=$1",[delivery.id,plannedAt,createHash('sha256').update(JSON.stringify(payload)).digest('hex')]);
        let postId:string;
        try { postId=await postiz.create(payload); }
        catch(error) {
          const ambiguous=!(error instanceof AppError) || error.ambiguous;
          const transient=error instanceof AppError && error.status===429;
          await pool.query('UPDATE deliveries SET status=$2,error=$3,updated_at=now() WHERE id=$1',[delivery.id,ambiguous?'unknown':transient?'pending':'failed',ambiguous?'Resultado desconhecido. Confira o Postiz antes de repetir.':errorMessage(error)]);
          if(transient) throw error;
          await event('error',ambiguous?'Envio sem confirmação. Reenvio automático bloqueado.':errorMessage(error),watch.id,video.id);
          continue;
        }
        // If this write fails, leave submitting for restart reconciliation rather than replaying.
        await pool.query('UPDATE deliveries SET status=$2,post_id=$3,error=NULL,updated_at=now() WHERE id=$1',[delivery.id,mode==='draft'?'draft':'scheduled',postId]);
        await event('success',`${channel.name}: ${mode==='draft'?'rascunho criado':'publicação enviada ao agendamento'}.`,watch.id,video.id,{postId});
      }
      const {rows:deliveries}=await pool.query('SELECT status FROM deliveries WHERE video_id=$1',[video.id]);
      const unknown=deliveries.some(d=>['unknown','submitting'].includes(d.status));
      const failed=deliveries.some(d=>d.status==='failed');
      await pool.query('UPDATE videos SET status=$2,error=$3,updated_at=now() WHERE id=$1',[video.id,unknown?'unknown':failed?'failed':'sent',unknown?'Confira os envios sem confirmação no Postiz.':failed?'Um destino foi recusado. Confira o histórico.':null]);
      await pool.query('UPDATE watches SET next_upload_at=$2,last_error=NULL WHERE id=$1',[watch.id,nextRun(watch,new Date())]);
    } catch(error) {
      const message=errorMessage(error);
      const attempts=video.attempts+1;
      const retry=!(error instanceof AppError) || error.status===429 || error.status>=500;
      const minutes=Math.max(Math.min(30,Math.pow(2,attempts)),(error instanceof AppError?error.retryAfterMs || 0:0)/60_000);
      await pool.query("UPDATE videos SET status=$2,error=$3,attempts=$4,retry_at=now()+($5*interval '1 minute'),updated_at=now() WHERE id=$1",[video.id,retry && attempts<5?'retry':'failed',message,attempts,minutes]);
      await pool.query('UPDATE watches SET last_error=$2 WHERE id=$1',[watch.id,message]);
      await event('error',message,watch.id,video.id);
    } finally {
      if(spool) await rm(spool,{force:true}).catch(()=>{});
      if(cleanedSpool) await rm(cleanedSpool,{force:true}).catch(()=>{});
    }
  }

  private lastReconcile=0;
  private async reconcile() {
    if(Date.now()-this.lastReconcile<60_000) return;
    this.lastReconcile=Date.now();
    const {rows}=await pool.query("SELECT * FROM deliveries WHERE engine='postiz' AND status IN ('scheduled','draft') AND post_id IS NOT NULL ORDER BY updated_at LIMIT 100");
    if(!rows.length) return;
    try {
      const start=new Date(Math.min(...rows.map(r=>new Date(r.planned_at).getTime()))-24*60*60_000);
      const end=new Date(Math.max(Date.now(),...rows.map(r=>new Date(r.planned_at).getTime()))+24*60*60_000);
      const posts=await (await postizClient()).posts(start,end);
      for(const delivery of rows) {
        const post=posts.find(p=>p.id===delivery.post_id && p.integration?.id===delivery.integration_id);
        if(!post) continue; // A manually deleted draft must never be recreated.
        const status=post.state==='PUBLISHED'?'published':post.state==='ERROR'?'failed':post.state==='DRAFT'?'draft':'scheduled';
        await pool.query('UPDATE deliveries SET status=$2,release_url=$3,error=$4,updated_at=now() WHERE id=$1',[delivery.id,status,post.releaseURL || null,post.error?'O Postiz reportou um erro. Consulte o post antes de repetir.':null]);
      }
    } catch(error) { await event('warning',`Não foi possível atualizar o histórico Postiz: ${errorMessage(error)}`); }
  }
}
