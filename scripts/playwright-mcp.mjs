import {spawn} from 'node:child_process';
import {dirname,resolve,delimiter} from 'node:path';
import {pathToFileURL} from 'node:url';

export async function loadPlaywrightMcpEnvironment({appUrl,agentToken},request=fetch){
  let endpoint;try{endpoint=new URL(appUrl);}catch{throw new Error('Configure APP_URL com o endereço do painel.');}
  const local=['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname);
  if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash||(!local&&endpoint.protocol!=='https:')||!['http:','https:'].includes(endpoint.protocol))throw new Error('Configure APP_URL com o endereço local do painel ou uma URL HTTPS.');
  if(!/^[a-f0-9]{64}$/.test(agentToken||''))throw new Error('Configure o agente local com scripts/start.sh antes de iniciar o MCP.');
  const url=endpoint.href.replace(/\/$/,'')+'/api/browser-agent/playwright-mcp';
  let response;
  try{response=await request(url,{headers:{Authorization:'Bearer '+agentToken},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10_000)});}
  catch{throw new Error('Não foi possível consultar o painel para iniciar o Playwright MCP.');}
  if(!response.ok)throw new Error(response.status===409?'Cole o token da extensão em Conexões → TikTok.':'Não foi possível carregar a configuração do Playwright MCP. Verifique o painel e a chave do agente.');
  let config;try{config=await response.json();}catch{throw new Error('O painel retornou uma configuração inválida para o Playwright MCP.');}
  const token=config?.PLAYWRIGHT_MCP_EXTENSION_TOKEN;
  if(typeof token!=='string'||!token||token.length>4096||/[\s\u0000-\u001f\u007f]/u.test(token))throw new Error('A configuração da extensão Playwright está inválida. Salve o token novamente em Conexões.');
  return {PLAYWRIGHT_MCP_EXTENSION_TOKEN:token};
}

export function playwrightMcpLaunchEnvironment(extension,inherited=process.env){
  const environment={...inherited,...extension,PATH:dirname(process.execPath)+delimiter+(inherited.PATH||'')};
  for(const name of ['BROWSER_AGENT_TOKEN','ENCRYPTION_KEY','POSTGRES_PASSWORD','DATABASE_URL','REDIS_URL'])delete environment[name];
  return environment;
}

async function main(){
  const extension=await loadPlaywrightMcpEnvironment({appUrl:process.env.APP_URL||'http://localhost:4317',agentToken:process.env.BROWSER_AGENT_TOKEN});
  // The secret goes through the child environment, never argv, files or stdout.
  const child=spawn(process.platform==='win32'?'npx.cmd':'npx',['--yes','@playwright/mcp@0.0.85','--extension',...process.argv.slice(2)],{
    stdio:'inherit',env:playwrightMcpLaunchEnvironment(extension)
  });
  const interrupt=()=>child.kill('SIGINT'),stop=()=>child.kill('SIGTERM');
  process.on('SIGINT',interrupt);process.on('SIGTERM',stop);
  child.once('error',()=>{process.stderr.write('Não foi possível iniciar o Playwright MCP. Verifique Node.js e npx.\n');process.exitCode=1;});
  child.once('exit',code=>{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',stop);process.exitCode=code??1;});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
}
