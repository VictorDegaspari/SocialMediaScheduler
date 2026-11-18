import {z} from 'zod';
import {Router} from 'express';
import {AppError} from './config.js';
import {getSetting,setSetting,pool} from './db.js';
import {browserAgentAuthorized,playwrightExtensionTokenSchema as tokenSchema} from './browser-auth.js';

const key='playwrightMcpExtension';
const inputSchema=z.object({extensionToken:z.string().trim().max(4096).optional()}).strict();

async function configuration(){
  const saved=await getSetting<{extensionToken:string}>(key);
  if(saved?.extensionToken)return {extensionToken:saved.extensionToken,source:'input' as const};
  const fallback=tokenSchema.safeParse(process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN);
  return fallback.success?{extensionToken:fallback.data,source:'environment' as const}:null;
}

export async function playwrightMcpState(){
  const config=await configuration();return {configured:!!config,source:config?.source??null};
}

export async function requireTikTokBrowserToken(){
  if(!(await playwrightMcpState()).configured)throw new AppError('Adicione o PLAYWRIGHT_MCP_EXTENSION_TOKEN em Conexões → TikTok antes de configurar ou iniciar o navegador.',409);
}

export async function savePlaywrightMcp(input:unknown){
  const parsed=inputSchema.safeParse(input);
  if(!parsed.success)throw new AppError('Informe apenas o valor do token da extensão Playwright.');
  const token=parsed.data.extensionToken;
  if(token){
    const value=tokenSchema.safeParse(token);
    if(!value.success)throw new AppError('Cole o token da extensão sem espaços ou quebras de linha.');
    await setSetting(key,{extensionToken:value.data});
  }else if(!(await playwrightMcpState()).configured)throw new AppError('Cole o token exibido na extensão Playwright.');
  return playwrightMcpState();
}

export async function removePlaywrightMcp(){
  await pool.query('DELETE FROM settings WHERE key=$1',[key]);return playwrightMcpState();
}

// Only the authenticated launcher receives the secret; public state is metadata.
export async function playwrightMcpEnvironment(){
  const config=await configuration();
  if(!config)throw new AppError('Configure o token da extensão Playwright em Conexões.',409);
  return {PLAYWRIGHT_MCP_EXTENSION_TOKEN:config.extensionToken};
}

export const playwrightMcpRoutes=Router();
playwrightMcpRoutes.get('/api/settings/playwright-mcp',async(_req,res)=>res.json(await playwrightMcpState()));
playwrightMcpRoutes.post('/api/settings/playwright-mcp',async(req,res)=>res.json({ok:true,...await savePlaywrightMcp(req.body)}));
playwrightMcpRoutes.delete('/api/settings/playwright-mcp',async(_req,res)=>res.json({ok:true,...await removePlaywrightMcp()}));
playwrightMcpRoutes.get('/api/browser-agent/playwright-mcp',async(req,res)=>{
  if(!browserAgentAuthorized(req.get('authorization')))return void res.status(401).json({error:'Agente não autorizado.'});
  res.setHeader('Cache-Control','no-store');res.json(await playwrightMcpEnvironment());
});
