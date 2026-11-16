import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {browserProgress,browserProfileBusy,browserProfileSaved} from '../src/browser-agent-core.js';

const temp=await mkdtemp(join(tmpdir(),'watcher-agent-'));
test('progresso compartilhado com o painel filtra campos privados e linhas não reconhecidas',()=>{
  assert.equal(browserProgress('not json'),undefined);assert.equal(browserProgress(JSON.stringify({event:'private_debug',access_token:'secret'})),undefined);
  assert.deepEqual(browserProgress(JSON.stringify({event:'browser_upload_started',file:'/private/path/video.mp4',hash:'a'.repeat(64),access_token:'secret',msg:'confidential'})),
    {stage:'browser_upload_started',filename:'video.mp4',hash:'a'.repeat(64)});
});
test('detecta perfil ocupado sem ler credenciais e não considera perfil salvo como login validado',async()=>{
  assert.equal(await browserProfileBusy(temp),false);assert.equal(await browserProfileSaved(temp),false);
  await writeFile(join(temp,'agent.lock'),String(process.pid));assert.equal(await browserProfileBusy(temp),true);
  await rm(join(temp,'agent.lock'));await mkdir(join(temp,'profile','Default'),{recursive:true});
  await symlink('machine-'+process.pid,join(temp,'profile','SingletonLock'));assert.equal(await browserProfileBusy(temp),true);
  await writeFile(join(temp,'profile','Default','Cookies'),'opaque test database');assert.equal(await browserProfileSaved(temp),true);
});
after(()=>rm(temp,{recursive:true,force:true}));
