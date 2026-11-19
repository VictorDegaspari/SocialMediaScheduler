import {connectedAccount,updateAccountTokens} from './connected-accounts.js';
import { OAuth2Client, type Credentials } from 'google-auth-library';
import { AppError, appUrl, retryAfter,decrypt } from './config.js';
import { getSetting,getSettings, setSetting, pool } from './db.js';
import { postizClient, type GoogleConfig } from './clients.js';
import type { Integration } from './domain.js';
import {desktopCallbackAvailable,tiktokLoginMode,type TikTokLoginMode} from './tiktok-login.js';

export const youtubeScopes=['https://www.googleapis.com/auth/youtube.upload','https://www.googleapis.com/auth/youtube.readonly'];
export const youtubeEditScope='https://www.googleapis.com/auth/youtube.force-ssl';
export const youtubeEditAuthorized=(scope:string='')=>[youtubeEditScope,'https://www.googleapis.com/auth/youtube','https://www.googleapis.com/auth/youtubepartner'].some(s=>scope.split(' ').includes(s));
export const tiktokScopes=['user.info.basic','video.upload'];
export interface YoutubeConfig extends GoogleConfig {autoPublishApproved:boolean;}
export interface TiktokConfig {clientKey:string;clientSecret:string;loginMode?:TikTokLoginMode;}
export interface NativeAccount {id:string;name:string;}
export interface YoutubeTokens extends Credentials {channelId:string;}
export interface TikTokens {access_token:string;refresh_token:string;open_id:string;scope:string;expires_at:number;refresh_expires_at:number;}

export async function publisherEngine():Promise<'local'|'postiz'> {return await getSetting<'local'|'postiz'>('publisherEngine') || 'local';}
export async function youtubeClient() {
  const config=await getSetting<YoutubeConfig>('youtubeConfig');
  if(!config) throw new AppError('Configure o aplicativo OAuth do YouTube em Conexões.');
  return new OAuth2Client(config.clientId,config.clientSecret,`${appUrl}/auth/youtube/callback`);
}
export async function youtubeToken(expectedChannelId?:string,{edit=false}={}) {
  const saved=expectedChannelId?await connectedAccount('youtube',expectedChannelId):null;
  if(saved?.disabled)throw new AppError('Esta conta YouTube foi desconectada. Reconecte a mesma conta.',401);
  const stored:YoutubeTokens|null=saved?.tokens||await getSetting<YoutubeTokens>('youtubeTokens');
  const account:NativeAccount|null=saved?{id:saved.external_id,name:saved.name}:await getSetting<NativeAccount>('youtubeAccount');
  if(!stored?.refresh_token || !youtubeScopes.every(s=>stored.scope?.split(' ').includes(s))) throw new AppError('Autorize o YouTube com permissão de envio e leitura do canal.',401);
  if(!account || stored.channelId!==account.id || (expectedChannelId && stored.channelId!==expectedChannelId))throw new AppError('O token YouTube não pertence ao canal desta entrega. Reconecte a mesma conta.',401);
  if(edit&&!youtubeEditAuthorized(stored.scope))throw new AppError('Autorize a edição de vídeos neste canal para cancelar o agendamento.',403);
  const client=saved?new OAuth2Client(saved.config.clientId,saved.config.clientSecret,`${appUrl}/auth/youtube/callback`):await youtubeClient();client.setCredentials(stored);
  try {
    const {token}=await client.getAccessToken();
    if(!token) throw new Error('missing token');
    if(client.credentials.access_token!==stored.access_token || client.credentials.expiry_date!==stored.expiry_date) {
      const tokens={...stored,...client.credentials,refresh_token:client.credentials.refresh_token||stored.refresh_token};
      if(saved)await updateAccountTokens('youtube',saved.external_id,tokens);else await setSetting('youtubeTokens',tokens);
    }
    return token;
  } catch {throw new AppError('A autorização do YouTube expirou ou foi revogada. Reconecte o canal.',401);}
}

/** Never include URLs, bodies or provider credentials in error messages/logs. */
export async function providerFetch(url:string,options:RequestInit={},provider='Plataforma') {
  let response:Response;
  // A resumable upload uses HTTP 308 for progress, including without Location.
  // Fetch's redirect:error rejects 308 before the uploader can inspect Range.
  // Manual mode returns it without following redirects or forwarding credentials.
  try {response=await fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(120_000)});}
  catch {throw new AppError(`${provider} não confirmou a operação. A sessão será consultada antes de retomar.`,503);}
  if(!response.ok && response.status!==308) {
    if(provider==='YouTube') {
      const body=await response.json().catch(()=>null);
      const reasons=body?.error?.errors?.map((e:{reason?:string})=>e.reason)||[];
      if(reasons.some((r:string)=>['uploadLimitExceeded','quotaExceeded','dailyLimitExceeded'].includes(r)))
        throw new AppError('O YouTube atingiu o limite de uploads ou a cota da API. Novos envios deste canal aguardam 24 horas.',429,false,Math.max(86400_000,retryAfter(response)||0));
    }
    if(!response.bodyUsed)await response.body?.cancel();
    throw new AppError(`${provider} respondeu ${response.status}. Confira autorização, limites e configuração.`,response.status,false,retryAfter(response));
  }
  return response;
}
export async function tiktokRequest(path:string,token:string,body?:unknown) {
  const response=await providerFetch('https://open.tiktokapis.com'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})},'TikTok');
  const result=await response.json() as {data:any;error?:{code:string}};
  if(result.error?.code!=='ok') {
    const code=result.error?.code;
    throw new AppError(code==='scope_not_authorized'?'TikTok: a permissão video.upload não foi autorizada.':'TikTok recusou a operação. Confira permissões e limites no portal do aplicativo.',code==='rate_limit_exceeded'?429:code==='access_token_invalid'?401:400);
  }
  return result.data;
}
export async function exchangeTikToken(config:TiktokConfig,params:Record<string,string>):Promise<TikTokens> {
  const response=await providerFetch('https://open.tiktokapis.com/v2/oauth/token/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_key:config.clientKey,client_secret:config.clientSecret,...params})},'TikTok OAuth');
  const data=await response.json();
  if(!data.access_token || !data.refresh_token || !data.open_id || !Number.isFinite(data.expires_in) || !Number.isFinite(data.refresh_expires_in) || !tiktokScopes.every(s=>String(data.scope||'').split(',').includes(s))) throw new AppError('O TikTok não concedeu os tokens e as permissões necessárias.',401);
  return {access_token:data.access_token,refresh_token:data.refresh_token,open_id:data.open_id,scope:data.scope,expires_at:Date.now()+data.expires_in*1000,refresh_expires_at:Date.now()+data.refresh_expires_in*1000};
}
export async function tiktokToken(expectedOpenId?:string) {
  // Refresh tokens rotate; serialize refreshes across HTTP and worker processes.
  const lock=await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock(74839123)');
    const saved=expectedOpenId?await connectedAccount('tiktok',expectedOpenId):null;
    if(saved?.disabled)throw new AppError('Esta conta TikTok foi desconectada. Reconecte a mesma conta.',401);
    const stored:TikTokens|null=saved?.tokens||await getSetting<TikTokens>('tiktokTokens');
    const config:TiktokConfig|null=saved?.config||await getSetting<TiktokConfig>('tiktokConfig');
    if(!stored || !config || !tiktokScopes.every(s=>stored.scope.split(',').includes(s))) throw new AppError('Conecte o TikTok e autorize video.upload.',401);
    if(expectedOpenId && stored.open_id!==expectedOpenId)throw new AppError('O token TikTok não pertence à conta desta entrega. Reconecte a mesma conta.',401);
    if(stored.expires_at>Date.now()+60_000) return stored.access_token;
    if(stored.refresh_expires_at<=Date.now()) throw new AppError('A autorização do TikTok expirou. Reconecte sua conta.',401);
    const refreshed=await exchangeTikToken(config,{grant_type:'refresh_token',refresh_token:stored.refresh_token});
    if(refreshed.open_id!==stored.open_id) throw new AppError('A conta TikTok retornada não corresponde à conta conectada.',401);
    if(saved)await updateAccountTokens('tiktok',saved.external_id,refreshed);else await setSetting('tiktokTokens',refreshed);
    return refreshed.access_token;
  } finally {await lock.query('SELECT pg_advisory_unlock(74839123)');lock.release();}
}
export async function nativeChannels():Promise<(Integration&{autoPublishApproved?:boolean;canEditVideos?:boolean})[]> {
  const [settings,stored]=await Promise.all([getSettings<any>(['youtubeAccount','tiktokAccount','youtubeTokens','tiktokTokens','youtubeConfig','tiktokConfig']),
    pool.query('SELECT * FROM connected_accounts ORDER BY created_at')]);
  const {youtubeAccount:youtube,tiktokAccount:tiktok,youtubeTokens:ytTokens,tiktokTokens:ttTokens,youtubeConfig:ytConfig,tiktokConfig:ttConfig}=settings;
  const legacy=[youtube&&ytTokens?.refresh_token?{id:'native:youtube:'+youtube.id,name:youtube.name,identifier:'youtube',disabled:!ytConfig||ytTokens.channelId!==youtube.id||!youtubeScopes.every(s=>ytTokens.scope?.split(' ').includes(s))}:null,
    tiktok&&ttTokens?.refresh_token?{id:'native:tiktok:'+tiktok.id,name:tiktok.name,identifier:'tiktok',disabled:!ttConfig||ttTokens.open_id!==tiktok.id||ttTokens.refresh_expires_at<=Date.now()||!tiktokScopes.every(s=>ttTokens.scope.split(',').includes(s))}:null].filter((c):c is Integration=>!!c);
  const channels:(Integration&{autoPublishApproved?:boolean;canEditVideos?:boolean})[]=[];
  for(const row of stored.rows) {
    const tokens=decrypt<any>(row.tokens),config=decrypt<any>(row.config);
    const scopes=row.provider==='youtube'?youtubeScopes:tiktokScopes;
    const authorized=row.provider==='youtube'?scopes.every(s=>tokens.scope?.split(' ').includes(s)):scopes.every(s=>tokens.scope?.split(',').includes(s));
    channels.push({id:`native:${row.provider}:${row.external_id}`,name:row.label||row.name,identifier:row.provider,
      autoPublishApproved:row.provider==='youtube'&&!row.disabled&&!!config.autoPublishApproved,
      canEditVideos:row.provider==='youtube'&&!row.disabled&&youtubeEditAuthorized(tokens.scope),
      disabled:row.disabled||!tokens.refresh_token||!authorized||(row.provider==='youtube'?tokens.channelId!==row.external_id:tokens.open_id!==row.external_id||tokens.refresh_expires_at<=Date.now())});
  }
  return [...channels,...legacy.filter(c=>!channels.some(saved=>saved.id===c.id)).map(c=>({...c,autoPublishApproved:c.identifier==='youtube'&&!!ytConfig?.autoPublishApproved,canEditVideos:c.identifier==='youtube'&&youtubeEditAuthorized(ytTokens?.scope)}))];
}
export async function publishingChannels() {return await publisherEngine()==='local'?nativeChannels():(await postizClient()).integrations();}
export async function nativeConnectionState() {
  const [youtube,tiktok,ytAccount,ttAccount,channels]=await Promise.all([getSetting<YoutubeConfig>('youtubeConfig'),getSetting<TiktokConfig>('tiktokConfig'),getSetting<NativeAccount>('youtubeAccount'),getSetting<NativeAccount>('tiktokAccount'),nativeChannels()]);
  const loginMode=tiktokLoginMode(tiktok);
  return {accounts:channels,engine:await publisherEngine(),youtube:{configured:!!youtube,connected:channels.some(c=>c.identifier==='youtube'&&!c.disabled),clientId:youtube?.clientId||'',autoPublishApproved:youtube?.autoPublishApproved||false,account:ytAccount?.name||'',callbackUrl:`${appUrl}/auth/youtube/callback`},
    tiktok:{configured:!!tiktok,connected:channels.some(c=>c.identifier==='tiktok'&&!c.disabled),clientKey:tiktok?.clientKey||'',account:ttAccount?.name||'',callbackUrl:`${appUrl}/auth/tiktok/callback`,loginMode,desktopAvailable:desktopCallbackAvailable(),httpsRequired:loginMode==='web'&&!appUrl.startsWith('https:')}};
}
