import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.ENCRYPTION_KEY||='00'.repeat(32);
const {desktopCallbackAvailable,tiktokLoginMode,validateTiktokCallback,tiktokCodeChallenge}=await import('../src/tiktok-login.js');

test('Desktop aceita apenas localhost ou loopback com porta explícita',()=>{
  for(const url of ['http://localhost:4317','http://127.0.0.1:8000','https://127.0.0.1:443'])assert(desktopCallbackAvailable(url));
  for(const url of ['http://localhost','https://scheduler.example.com','http://localhost.evil.test:4317','http://127.0.0.1:4317/extra','http://localhost:4317?x=1','invalid'])assert(!desktopCallbackAvailable(url));
  assert.doesNotThrow(()=>validateTiktokCallback('desktop','http://localhost:4317'));
  assert.throws(()=>validateTiktokCallback('desktop','https://scheduler.example.com'),/localhost/);
  assert.throws(()=>validateTiktokCallback('web','http://localhost:4317'),/HTTPS/);
  assert.doesNotThrow(()=>validateTiktokCallback('web','https://scheduler.example.com'));
});
test('configuração nova local prefere Desktop e configuração antiga mantém Web',()=>{
  assert.equal(tiktokLoginMode(null,'http://localhost:4317'),'desktop');
  assert.equal(tiktokLoginMode(null,'https://scheduler.example.com'),'web');
  assert.equal(tiktokLoginMode({},'http://localhost:4317'),'web');
  assert.equal(tiktokLoginMode({loginMode:'web'},'http://localhost:4317'),'web');
  assert.equal(tiktokLoginMode({loginMode:'desktop'},'http://localhost:4317'),'desktop');
});
test('PKCE Desktop usa digest hexadecimal e rejeita verificadores fora do contrato',()=>{
  assert.match(tiktokCodeChallenge('a'.repeat(43)),/^[a-f\d]{64}$/);
  assert.throws(()=>tiktokCodeChallenge('a'.repeat(42)));
  assert.throws(()=>tiktokCodeChallenge('a'.repeat(129)));
  assert.throws(()=>tiktokCodeChallenge('!'.repeat(43)));
});
