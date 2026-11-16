import {createHash} from 'node:crypto';
import {AppError,appUrl} from './config.js';

export type TikTokLoginMode='desktop'|'web';
export function desktopCallbackAvailable(base=appUrl) {
  try {
    const url=new URL(base);
    return /^https?:\/\/(localhost|127\.0\.0\.1):\d+\/?$/i.test(base)
      && ['localhost','127.0.0.1'].includes(url.hostname);
  } catch {return false;}
}
export function tiktokLoginMode(config:{loginMode?:TikTokLoginMode}|null,base=appUrl):TikTokLoginMode {
  // Saved configurations without this field used the Web flow; preserve them.
  return config?config.loginMode||'web':desktopCallbackAvailable(base)?'desktop':'web';
}
export function validateTiktokCallback(mode:TikTokLoginMode,base=appUrl) {
  if(mode==='desktop') {
    if(!desktopCallbackAvailable(base))throw new AppError('O Login Kit Desktop exige localhost ou 127.0.0.1 com uma porta explícita. Use o modo Web para um domínio público.');
  } else if(!base.startsWith('https:'))throw new AppError('O Login Kit Web do TikTok exige callback HTTPS. Para o aplicativo local, selecione Login Kit Desktop e cadastre esse modo no portal TikTok.');
}
export function tiktokCodeChallenge(verifier:string) {
  if(!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))throw new AppError('A autorização Desktop não contém um verificador PKCE válido. Inicie a conexão novamente.');
  // TikTok Desktop requires a SHA256 hex digest, unlike Google's base64url digest.
  return createHash('sha256').update(verifier).digest('hex');
}
