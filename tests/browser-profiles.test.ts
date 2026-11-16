import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserProfileDirectory} from '../src/browser-profiles.js';
test('perfis TikTok preservam o perfil antigo e isolam cookies, histórico e arquivos por ID',()=>{
  const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
  assert.equal(browserProfileDirectory('default','/private/tiktok'),'/private/tiktok');
  assert.equal(browserProfileDirectory(first,'/private/tiktok'),'/private/tiktok/accounts/'+first);
  assert.notEqual(browserProfileDirectory(first),browserProfileDirectory(second));
  for(const invalid of ['../../default','../profile','/tmp/accounts','not-a-profile'])assert.throws(()=>browserProfileDirectory(invalid));
});
