import {timingSafeEqual} from 'node:crypto';
import {z} from 'zod';

export const playwrightExtensionTokenSchema=z.string().trim().min(1).max(4096).regex(/^[^\s\u0000-\u001f\u007f]+$/u);
export function browserAgentAuthorized(header:string|undefined){
  const key=process.env.BROWSER_AGENT_TOKEN||'';
  if(!/^[a-f0-9]{64}$/.test(key)||!header?.startsWith('Bearer '))return false;
  const supplied=Buffer.from(header.slice(7)),expected=Buffer.from(key);
  return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
}
