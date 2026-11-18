import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadPlaywrightMcpEnvironment,playwrightMcpLaunchEnvironment} from '../scripts/playwright-mcp.mjs';

const options={appUrl:'http://localhost:4317',agentToken:'a'.repeat(64)};
test('MCP process receives the chosen extension token without application credentials',()=>{
  const inherited={PLAYWRIGHT_MCP_EXTENSION_TOKEN:'old-env-token',BROWSER_AGENT_TOKEN:'agent-secret',ENCRYPTION_KEY:'encryption-secret',DATABASE_URL:'database-secret',POSTGRES_PASSWORD:'database-password',REDIS_URL:'redis-secret',DISPLAY:':0',PATH:'/usr/bin'};
  const result=playwrightMcpLaunchEnvironment({PLAYWRIGHT_MCP_EXTENSION_TOKEN:'input-token'},inherited);
  assert.equal(result.PLAYWRIGHT_MCP_EXTENSION_TOKEN,'input-token');assert.equal(result.DISPLAY,':0');
  for(const key of ['BROWSER_AGENT_TOKEN','ENCRYPTION_KEY','POSTGRES_PASSWORD','DATABASE_URL','REDIS_URL'])assert.equal(result[key],undefined);
  assert.equal(inherited.PLAYWRIGHT_MCP_EXTENSION_TOKEN,'old-env-token','the launcher does not change the parent process');
});
test('MCP launcher obtains the current stored token through the authenticated endpoint',async()=>{
  let current='saved-extension-token';
  const request=async(url:string,input:any)=>{
    assert.equal(url,'http://localhost:4317/api/browser-agent/playwright-mcp');
    assert.equal(input.headers.Authorization,'Bearer '+options.agentToken);assert.equal(input.redirect,'error');assert.equal(input.cache,'no-store');
    return {ok:true,status:200,json:async()=>({PLAYWRIGHT_MCP_EXTENSION_TOKEN:current,BROWSER_AGENT_TOKEN:'must-not-forward'})};
  };
  assert.deepEqual(await loadPlaywrightMcpEnvironment(options,request),{PLAYWRIGHT_MCP_EXTENSION_TOKEN:'saved-extension-token'});
  current='updated-from-input';assert.deepEqual(await loadPlaywrightMcpEnvironment(options,request),{PLAYWRIGHT_MCP_EXTENSION_TOKEN:current});
});
test('launcher rejects unsafe endpoints and reports configuration errors without exposing credentials',async()=>{
  for(const appUrl of ['http://remote.example','https://user:password@example.com','file:///tmp/panel','not a URL']){
    await assert.rejects(()=>loadPlaywrightMcpEnvironment({...options,appUrl},()=>{throw new Error('should not request');}));
  }
  await assert.rejects(()=>loadPlaywrightMcpEnvironment({...options,agentToken:'extension-token'},()=>{throw new Error('should not request');}),/agente local/);
  const secret='secret-that-must-not-appear';
  const check=(error:Error)=>{assert(!error.message.includes(secret));return true;};
  await assert.rejects(()=>loadPlaywrightMcpEnvironment(options,async()=>({ok:false,status:401,json:async()=>{throw new Error(secret);}})),check);
  await assert.rejects(()=>loadPlaywrightMcpEnvironment(options,async()=>({ok:true,status:200,json:async()=>{throw new Error(secret);}})),check);
  await assert.rejects(()=>loadPlaywrightMcpEnvironment(options,async()=>{throw new Error(secret);}),check);
  await assert.rejects(()=>loadPlaywrightMcpEnvironment(options,async()=>({ok:true,status:200,json:async()=>({PLAYWRIGHT_MCP_EXTENSION_TOKEN:secret+'\ninvalid'})})),check);
  await assert.rejects(()=>loadPlaywrightMcpEnvironment(options,async()=>({ok:false,status:409})),/Cole o token/);
});
