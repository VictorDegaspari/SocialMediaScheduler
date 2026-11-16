import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { resolve } from 'node:path';
import pino from 'pino';

export const port = Number(process.env.PORT || 4317);
export const appUrl = (process.env.APP_URL || `http://localhost:${port}`).replace(/\/$/, '');
export const dataDir = resolve(process.env.DATA_DIR || './data');
export const localMediaDir = resolve(process.env.LOCAL_MEDIA_DIR || './media');
export const localMediaHostDir = resolve(process.env.LOCAL_MEDIA_HOST_DIR || localMediaDir);
const key = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex');
if (key.length !== 32) throw new Error('ENCRYPTION_KEY precisa ter 64 caracteres hexadecimais. Execute scripts/start.sh.');
export const logger = pino({ level: process.env.LOG_LEVEL || 'info', redact: ['token', 'secret', 'authorization', 'password', 'access_token', 'refresh_token', 'clientSecret', 'session', 'req.headers.authorization'] });

export function encrypt(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(b => b.toString('base64')).join('.');
}

export function decrypt<T>(value: string): T {
  const [iv, tag, body] = value.split('.').map(s => Buffer.from(s, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString());
}

export class AppError extends Error {
  constructor(message: string, public status = 400, public ambiguous = false, public retryAfterMs?:number) { super(message); }
}

export function retryAfter(response:Response):number|undefined {
  const value=response.headers.get('retry-after');
  if(!value)return undefined;
  const milliseconds=/^\d+$/.test(value)?Number(value)*1000:Date.parse(value)-Date.now();
  return Number.isFinite(milliseconds)?Math.max(0,milliseconds):undefined;
}

export function errorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error && /fetch failed|ECONN|ENOTFOUND|timeout|aborted/i.test(error.message)) return 'Não foi possível alcançar o serviço. Verifique a conexão e tente novamente.';
  return 'A operação falhou. Consulte o histórico e verifique a configuração.';
}
