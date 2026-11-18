import {saveConnectedAccount,disconnectAccount,connectedAccount} from './connected-accounts.js';
import { Router } from 'express';
import { randomBytes,createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError,appUrl,dataDir,encrypt,decrypt } from './config.js';
import { pool,getSetting,setSetting,event } from './db.js';
import { metadataSchema } from './domain.js';
import {sha256} from './media.js';
import {tiktokCaption} from './tiktok-caption.js';
import {genericVideoTitle} from './video-titles.js';
import {join} from 'node:path';
import { youtubeStatus } from './native-api.js';
import {cleanupPublishedMedia} from './media-cleanup.js';
import {tiktokLoginMode,validateTiktokCallback,tiktokCodeChallenge,type TikTokLoginMode} from './tiktok-login.js';
import { youtubeClient,youtubeScopes,youtubeEditScope,youtubeEditAuthorized,tiktokScopes,exchangeTikToken,tiktokRequest,providerFetch,nativeChannels,type YoutubeConfig,type TiktokConfig,type NativeAccount } from './native-auth.js';

export const nativeRoutes=Router();
const uuid=z.string().uuid();
nativeRoutes.post('/api/settings/publisher',async(req,res)=>{
  const input=z.object({engine:z.enum(['local','postiz'])}).parse(req.body);
  await setSetting('publisherEngine',input.engine);
  await event('info',input.engine==='local'?'Motor local ativado: Node, BullMQ e Redis.':'Integração Postiz selecionada.');
  res.json({ok:true});
});
nativeRoutes.post('/api/settings/youtube',async(req,res)=>{
  const input=z.object({clientId:z.string().trim().min(10).max(500),clientSecret:z.string().max(1000).optional(),autoPublishApproved:z.boolean().default(false)}).parse(req.body);
  const existing=await getSetting<YoutubeConfig>('youtubeConfig');
  const current=await getSetting<NativeAccount>('youtubeAccount');
  const secret=input.clientSecret||existing?.clientSecret;if(!secret)throw new AppError('Informe o Client Secret do aplicativo YouTube.');
  if(existing && (input.clientId!==existing.clientId || secret!==existing.clientSecret))await pool.query("DELETE FROM settings WHERE key IN ('youtubeTokens','youtubeAccount')");
  await setSetting('youtubeConfig',{clientId:input.clientId,clientSecret:secret,autoPublishApproved:input.autoPublishApproved});
  if(current){const connected=await connectedAccount('youtube',current.id);if(connected)await pool.query("UPDATE connected_accounts SET config=$2 WHERE provider='youtube' AND external_id=$1",[current.id,encrypt({...connected.config,autoPublishApproved:input.autoPublishApproved})]);}
  res.json({ok:true});
});
nativeRoutes.post('/api/settings/tiktok',async(req,res)=>{
  const input=z.object({clientKey:z.string().trim().min(5).max(500),clientSecret:z.string().max(1000).optional(),loginMode:z.enum(['desktop','web']).optional()}).parse(req.body);
  const existing=await getSetting<TiktokConfig>('tiktokConfig');
  const loginMode=input.loginMode||tiktokLoginMode(existing);
  if(loginMode==='desktop')validateTiktokCallback(loginMode);
  const secret=input.clientSecret||existing?.clientSecret;if(!secret)throw new AppError('Informe o Client Secret do aplicativo TikTok.');
  if(existing && (input.clientKey!==existing.clientKey || secret!==existing.clientSecret || loginMode!==tiktokLoginMode(existing)))await pool.query("DELETE FROM settings WHERE key IN ('tiktokTokens','tiktokAccount')");
  await setSetting('tiktokConfig',{clientKey:input.clientKey,clientSecret:secret,loginMode});res.json({ok:true});
});
for(const provider of ['youtube','tiktok']) {
  nativeRoutes.post(`/api/settings/${provider}/disconnect`,async(_req,res)=>{
    // Explicit local disconnection; revoke app permissions in the platform account separately.
    const current=await getSetting<NativeAccount>(provider+'Account');
    if(current)await disconnectAccount(provider as 'youtube'|'tiktok',current.id);
    await event('info',`${provider==='youtube'?'YouTube':'TikTok'} desconectado deste computador.`);res.json({ok:true});
  });
  nativeRoutes.get(`/auth/${provider}`,async(req,res)=>{
    if(req.get('host')!==new URL(appUrl).host)return void res.redirect(new URL(req.originalUrl,appUrl).href);
    const state=randomBytes(32).toString('hex');
    let url:string,verifier:string|undefined,loginMode:TikTokLoginMode|undefined;
    const editMetadata=provider==='youtube'&&req.query.edit==='1';
    const expectedChannelId=editMetadata?(req.query.channel?z.string().regex(/^[\w-]{6,200}$/).parse(req.query.channel):(await getSetting<NativeAccount>('youtubeAccount'))?.id):undefined;
    if(provider==='youtube') {
      const client=await youtubeClient(),codes=await client.generateCodeVerifierAsync();verifier=codes.codeVerifier;
      url=client.generateAuthUrl({access_type:'offline',prompt:'consent select_account',scope:editMetadata?[...youtubeScopes,youtubeEditScope]:youtubeScopes,include_granted_scopes:true,state,code_challenge:codes.codeChallenge,code_challenge_method:'S256' as never});
    } else {
      const config=await getSetting<TiktokConfig>('tiktokConfig');if(!config)throw new AppError('Configure o aplicativo TikTok em Conexões.');
      loginMode=tiktokLoginMode(config);validateTiktokCallback(loginMode);
      const params=new URLSearchParams({client_key:config.clientKey,scope:tiktokScopes.join(','),response_type:'code',redirect_uri:`${appUrl}/auth/tiktok/callback`,state});
      if(loginMode==='desktop') {
        verifier=randomBytes(32).toString('base64url');
        params.set('code_challenge',tiktokCodeChallenge(verifier));params.set('code_challenge_method','S256');
      }
      url='https://www.tiktok.com/v2/auth/authorize/?'+params;
    }
    await pool.query("INSERT INTO oauth_states(hash,verifier,expires_at) VALUES($1,$2,now()+interval '10 minutes')",[createHash('sha256').update(state).digest('hex'),encrypt({provider,verifier,loginMode,editMetadata,expectedChannelId})]);
    res.cookie(provider+'_oauth',state,{httpOnly:true,sameSite:'lax',secure:appUrl.startsWith('https:'),maxAge:600_000,path:`/auth/${provider}/callback`});
    res.redirect(url);
  });
  nativeRoutes.get(`/auth/${provider}/callback`,async(req,res)=>{
    const state=z.string().regex(/^[a-f0-9]{64}$/).safeParse(req.query.state);
    const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith(provider+'_oauth='))?.slice(provider.length+'_oauth='.length);
    res.clearCookie(provider+'_oauth',{path:`/auth/${provider}/callback`});
    const redirect=(status:string)=>res.redirect(`/?nativeOAuth=${provider}-${status}#connections`);
    if(!state.success || cookie!==state.data)return void redirect('invalid');
    const {rows:[row]}=await pool.query('DELETE FROM oauth_states WHERE hash=$1 AND expires_at>now() RETURNING verifier',[createHash('sha256').update(state.data).digest('hex')]);
    if(!row || req.query.error || typeof req.query.code!=='string')return void redirect('denied');
    try {
      const saved=decrypt<{provider:string;verifier?:string;loginMode?:TikTokLoginMode;editMetadata?:boolean;expectedChannelId?:string}>(row.verifier);
      if(saved.provider!==provider)throw new Error('wrong provider');
      if(provider==='youtube') {
        const client=await youtubeClient(),{tokens}=await client.getToken({code:req.query.code,codeVerifier:saved.verifier});
        if(!tokens.refresh_token || !tokens.access_token)throw new Error('missing offline access');
        const info=await client.getTokenInfo(tokens.access_token);
        if(!youtubeScopes.every(s=>info.scopes.includes(s)))throw new Error('missing scopes');
        if(saved.editMetadata&&!youtubeEditAuthorized(info.scopes.join(' ')))throw new Error('missing title editing scope');
        const response=await providerFetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',{headers:{Authorization:`Bearer ${tokens.access_token}`}},'YouTube');
        const data=await response.json();
        if(!Array.isArray(data.items)||data.items.length!==1||!data.items[0].id)throw new Error('channel not found');
        if(saved.expectedChannelId&&data.items[0].id!==saved.expectedChannelId)throw new Error('different channel');
        const old=await connectedAccount('youtube',data.items[0].id),config=await getSetting<YoutubeConfig>('youtubeConfig');
        await saveConnectedAccount('youtube',data.items[0].id,data.items[0].snippet?.title||'Meu YouTube',{...tokens,scope:info.scopes.join(' '),channelId:data.items[0].id},saved.editMetadata?{...config,autoPublishApproved:old?.config.autoPublishApproved??config?.autoPublishApproved}:config);
        await pool.query(`INSERT INTO settings(key,value) VALUES('youtubeTokens',$1),('youtubeAccount',$2)
          ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,[encrypt({...tokens,scope:info.scopes.join(' '),channelId:data.items[0].id}),encrypt({id:data.items[0].id,name:data.items[0].snippet?.title||'Meu YouTube'} satisfies NativeAccount)]);
      } else {
        const config=await getSetting<TiktokConfig>('tiktokConfig');if(!config)throw new Error('missing config');
        const loginMode=tiktokLoginMode(config);validateTiktokCallback(loginMode);
        if((saved.loginMode||'web')!==loginMode)throw new Error('login mode changed');
        const params:Record<string,string>={code:req.query.code,grant_type:'authorization_code',redirect_uri:`${appUrl}/auth/tiktok/callback`};
        if(loginMode==='desktop') {
          if(typeof saved.verifier!=='string')throw new Error('missing PKCE');
          tiktokCodeChallenge(saved.verifier);params.code_verifier=saved.verifier;
        }
        const tokens=await exchangeTikToken(config,params);
        const info=await tiktokRequest('/v2/user/info/?fields=open_id,display_name',tokens.access_token);
        if(info?.user?.open_id!==tokens.open_id || typeof info.user.display_name!=='string')throw new Error('account mismatch');
        await saveConnectedAccount('tiktok',tokens.open_id,info.user.display_name,tokens,config);
        await pool.query(`INSERT INTO settings(key,value) VALUES('tiktokTokens',$1),('tiktokAccount',$2)
          ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,[encrypt(tokens),encrypt({id:tokens.open_id,name:info.user.display_name} satisfies NativeAccount)]);
      }
      await event('success',`${provider==='youtube'?'YouTube':'TikTok'} conectado diretamente, com permissões verificadas.`);
      return void redirect('success');
    } catch {await event('error',`Não foi possível conectar ${provider}. Confira o aplicativo, as permissões e o callback OAuth.`);return void redirect('failed');}
  });
}
nativeRoutes.get('/api/native/deliveries/:id',async(req,res)=>{
  const {rows:[row]}=await pool.query("SELECT id,engine,provider,status,payload,local_file,error FROM deliveries WHERE id=$1 AND engine IN ('local','browser')",[uuid.parse(req.params.id)]);
  if(!row)throw new AppError('Envio local não encontrado.',404);
  res.json({id:row.id,engine:row.engine,provider:row.provider,status:row.status,payload:row.payload,hasMedia:!!row.local_file,error:row.error});
});
nativeRoutes.get('/api/native/deliveries/:id/media',async(req,res)=>{
  const {rows:[row]}=await pool.query("SELECT local_file FROM deliveries WHERE id=$1 AND engine IN ('local','browser')",[uuid.parse(req.params.id)]);
  if(!row?.local_file || !/^[\da-f-]+\.native\.mp4$/.test(row.local_file))throw new AppError('Cópia local não disponível.',404);
  res.setHeader('Cache-Control','no-store');res.sendFile(row.local_file,{root:dataDir});
});
nativeRoutes.post('/api/native/deliveries/:id/approve',async(req,res)=>{
  const id=uuid.parse(req.params.id),input=z.object({confirm:z.literal(true),metadata:metadataSchema,publishNow:z.literal(true).optional()}).parse(req.body);
  if(!input.metadata.ready)throw new AppError('Marque o vídeo como pronto antes de aprovar.');
  const {rows:[row]}=await pool.query("SELECT * FROM deliveries WHERE id=$1 AND status='review' AND (engine='local' OR engine='browser' AND request_id IS NULL AND payload->>'manualPublication'='true')",[id]);
  if(!row)throw new AppError('Este envio não está aguardando revisão.');
  if(row.engine==='browser'){
    if(!input.publishNow||!row.integration_id.startsWith('browser:tiktok:'))throw new AppError('Confirme a publicação imediata neste perfil.');
    if(!(await pool.query('SELECT id FROM browser_profiles WHERE id=$1',[row.integration_id.slice('browser:tiktok:'.length)])).rowCount)throw new AppError('O perfil selecionado não está mais disponível.',409);
    if(input.metadata.tiktok.privacyLevel!=='PUBLIC_TO_EVERYONE'||input.metadata.tiktok.commercialContent||input.metadata.tiktok.ownBrand)throw new AppError('Confira a publicação pública e as declarações do TikTok.');
    if(genericVideoTitle(input.metadata.title))throw new AppError('Escreva um título que descreva o conteúdo antes de postar.');
    try{tiktokCaption(input.metadata);}catch{throw new AppError('A legenda do TikTok excede 2.200 caracteres.');}
    if(!row.local_file||await sha256(join(dataDir,row.local_file))!==row.payload.assetSha256)throw new AppError('O arquivo da prévia mudou. Prepare o vídeo novamente.',409);
  }else if(!(await nativeChannels()).some(c=>c.id===row.integration_id&&!c.disabled))throw new AppError('Conecte a mesma conta antes de aprovar o envio.');
  const payload={...row.payload,metadata:input.metadata,automatic:false,...(row.engine==='browser'?{publishNow:true}:{})};
  const result=await pool.query("UPDATE deliveries SET payload=$2,status='pending',approved_at=now(),error=NULL,retry_at=NULL,updated_at=now() WHERE id=$1 AND status='review'",[id,JSON.stringify(payload)]);
  if(!result.rowCount)throw new AppError('Este envio já foi aprovado ou alterado.');
  await event('info','Envio aprovado para a fila local.',undefined,row.video_id);res.json({ok:true});
});
nativeRoutes.post('/api/native/deliveries/:id/retry',async(req,res)=>{
  const id=uuid.parse(req.params.id);
  const result=await pool.query("UPDATE deliveries SET status='pending',retry_at=now(),attempts=0,error=NULL,updated_at=now() WHERE id=$1 AND engine='local' AND status IN ('failed','unknown') AND approved_at IS NOT NULL AND post_id IS NULL AND local_file IS NOT NULL RETURNING video_id",[id]);
  if(!result.rowCount)throw new AppError('Este envio não pode ser retomado. Confira o vídeo na conta da plataforma.');
  await event('info','Retomada solicitada; a sessão existente será consultada antes de enviar bytes.',undefined,result.rows[0].video_id);res.json({ok:true});
});
nativeRoutes.post('/api/native/deliveries/:id/cancel',async(req,res)=>{
  const id=uuid.parse(req.params.id);
  const db=await pool.connect();let row;
  try{
    await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(74839200)');
    const result=await db.query(`UPDATE deliveries d SET status='cancelled',local_file=NULL,error=NULL,updated_at=now()
      WHERE d.id=$1 AND (d.engine='local' OR d.engine='browser' AND d.request_id IS NULL AND d.payload->>'manualPublication'='true')
      AND d.status IN ('preparing','review','pending','retry','failed') AND d.session IS NULL AND d.post_id IS NULL AND (d.engine='local' OR d.upload_started_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM browser_commands b WHERE b.delivery_id=d.id AND (b.upload_started OR b.status IN ('running','cancel_requested')))
      RETURNING d.video_id`,[id]);
    row=result.rows[0];if(!row)throw new AppError('Somente envios que ainda não iniciaram uma sessão podem ser cancelados.');
    await db.query("UPDATE browser_commands SET status='cancelled',finished_at=now() WHERE delivery_id=$1 AND status='pending'",[id]);
    await db.query('DELETE FROM content_claims WHERE delivery_id=$1',[id]);await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
  // Filename is generated from the UUID, never accepted from the request.
  const {rm}=await import('node:fs/promises');const {join}=await import('node:path');
  await rm(join(dataDir,id+'.native.mp4'),{force:true});
  await event('info','Envio local cancelado antes do upload.',undefined,row.video_id);res.json({ok:true});
});
nativeRoutes.post('/api/native/deliveries/:id/link',async(req,res)=>{
  const id=uuid.parse(req.params.id),{postId}=z.object({postId:z.string().regex(/^[\w-]{6,100}$/)}).parse(req.body);
  const {rows:[row]}=await pool.query("SELECT * FROM deliveries WHERE id=$1 AND engine='local' AND provider='youtube' AND status='unknown'",[id]);
  if(!row)throw new AppError('Envio YouTube sem confirmação não encontrado.');
  if(!(await nativeChannels()).some(c=>c.id===row.integration_id&&!c.disabled))throw new AppError('Reconecte a mesma conta YouTube antes de vincular.');
  const status=await youtubeStatus(postId,row.integration_id.slice('native:youtube:'.length));
  if(!status)throw new AppError('O vídeo não foi encontrado no canal selecionado.');
  await pool.query('UPDATE deliveries SET status=$2,post_id=$3,error=NULL,release_url=$4,updated_at=now() WHERE id=$1 AND status=\'unknown\'',[id,status,postId,'https://www.youtube.com/watch?v='+encodeURIComponent(postId)]);
  await cleanupPublishedMedia(id);
  await event('success','Envio reconciliado com vídeo verificado no canal YouTube.',undefined,row.video_id);res.json({ok:true});
});

nativeRoutes.post('/api/accounts/disconnect',async(req,res)=>{
  const {provider,id}=z.object({provider:z.enum(['youtube','tiktok']),id:z.string().min(1).max(200)}).parse(req.body);
  await disconnectAccount(provider,id);res.json({ok:true});
});
nativeRoutes.post('/api/accounts/update',async(req,res)=>{
  const input=z.object({provider:z.enum(['youtube','tiktok']),id:z.string().min(1).max(200),label:z.string().trim().min(1).max(100),autoPublishApproved:z.boolean().optional()}).parse(req.body);
  const account=await connectedAccount(input.provider,input.id);if(!account)throw new AppError('Conta não encontrada.',404);
  await pool.query('UPDATE connected_accounts SET label=$3,config=$4 WHERE provider=$1 AND external_id=$2',[input.provider,input.id,input.label,encrypt({...account.config,...(input.autoPublishApproved!==undefined?{autoPublishApproved:input.autoPublishApproved}:{})})]);res.json({ok:true});
});
