import {pool,getSetting} from './db.js';
import {encrypt,decrypt,AppError} from './config.js';

export type Provider='youtube'|'tiktok';
export async function saveConnectedAccount(provider:Provider,externalId:string,name:string,tokens:unknown,config:unknown) {
  await pool.query(`INSERT INTO connected_accounts(provider,external_id,name,tokens,config) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(provider,external_id) DO UPDATE SET name=EXCLUDED.name,tokens=EXCLUDED.tokens,config=EXCLUDED.config,disabled=false,updated_at=now()`,
    [provider,externalId,name,encrypt(tokens),encrypt(config)]);
}
export async function connectedAccount(provider:Provider,id:string) {
  const {rows:[row]}=await pool.query('SELECT * FROM connected_accounts WHERE provider=$1 AND external_id=$2',[provider,id]);
  return row?{...row,tokens:decrypt<any>(row.tokens),config:decrypt<any>(row.config)}:null;
}
export async function updateAccountTokens(provider:Provider,id:string,tokens:unknown) {
  await pool.query('UPDATE connected_accounts SET tokens=$3,updated_at=now() WHERE provider=$1 AND external_id=$2',[provider,id,encrypt(tokens)]);
}
export async function listConnectedAccounts() {
  const {rows}=await pool.query('SELECT provider,external_id,name,label,disabled FROM connected_accounts ORDER BY created_at');
  return rows.map(row=>({id:`native:${row.provider}:${row.external_id}`,provider:row.provider,externalId:row.external_id,name:row.label||row.name,disabled:row.disabled}));
}
export async function migrateConnectedAccounts() {
  for(const provider of ['youtube','tiktok'] as const) {
    const account=await getSetting<{id:string;name:string}>(provider+'Account'),tokens=await getSetting<any>(provider+'Tokens'),config=await getSetting<any>(provider+'Config');
    if(account&&tokens&&config)await pool.query(`INSERT INTO connected_accounts(provider,external_id,name,tokens,config) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT DO NOTHING`,[provider,account.id,account.name,encrypt(tokens),encrypt(config)]);
  }
}
export async function youtubeAutoApproved(channel:string) {
  const account=await connectedAccount('youtube',channel.replace(/^native:youtube:/,''));
  if(account)return !account.disabled&&!!account.config.autoPublishApproved;
  return !!(await getSetting<{autoPublishApproved:boolean}>('youtubeConfig'))?.autoPublishApproved;
}
export async function disconnectAccount(provider:Provider,id:string) {
  const result=await pool.query('UPDATE connected_accounts SET disabled=true,tokens=$3 WHERE provider=$1 AND external_id=$2',[provider,id,encrypt({})]);
  const legacy=await getSetting<{id:string}>(provider+'Account');
  if(legacy?.id===id)await pool.query('DELETE FROM settings WHERE key=ANY($1::text[])',[[provider+'Tokens',provider+'Account']]);
  if(!result.rowCount&&legacy?.id!==id)throw new AppError('Conta não encontrada.',404);
}
