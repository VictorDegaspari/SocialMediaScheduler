import { test,after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,rm,writeFile,readFile,symlink,rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.ENCRYPTION_KEY ||= '00'.repeat(32);
const {LocalFiles}=await import('../src/local.js');
const temp=await mkdtemp(join(tmpdir(),'watcher-local-'));
const root=join(temp,'media');
await mkdir(join(root,'sub'),{recursive:true});
await writeFile(join(root,'video.mp4'),'video original');
await writeFile(join(root,'video.json'),JSON.stringify({title:'Local'}));
await writeFile(join(root,'sub','outro.MP4'),'subfolder video');
const local=new LocalFiles(root,'/home/test/Meus vídeos');

test('pasta local aceita caminho absoluto ou relativo e respeita recursão',async()=>{
  const folder=await local.folder('/home/test/Meus vídeos');
  assert.equal(folder.id,(await local.folder('.')).id);
  assert.equal(folder.hostPath,'/home/test/Meus vídeos');
  const flat=await local.tree(folder.id,false),recursive=await local.tree(folder.id,true);
  assert.equal(flat.length,2);
  assert.equal(recursive.length,3);
  assert.equal(recursive.find(f=>f.name==='outro.MP4')?.mimeType,'video/mp4');
  assert.equal((await local.folder('sub')).hostPath,'/home/test/Meus vídeos/sub');
});

test('rejeita escapes, links simbólicos e identificadores de outra raiz',async()=>{
  await writeFile(join(temp,'outside.mp4'),'outside');
  await symlink(join(temp,'outside.mp4'),join(root,'link.mp4'));
  await symlink(temp,join(root,'link-folder'));
  await assert.rejects(()=>local.folder('../'),/dentro/);
  await assert.rejects(()=>local.folder('/home/test/Meus vídeos-outside'),/dentro/);
  await assert.rejects(()=>local.folder('link-folder'),/simbólicos/);
  await assert.rejects(()=>local.folder('video.mp4'),/não é uma pasta/);
  const files=await local.tree((await local.folder('.')).id,true);
  assert(!files.some(f=>f.name.startsWith('link')));
  const file=files.find(f=>f.name==='video.mp4')!;
  await assert.rejects(()=>new LocalFiles(root,'/other/root').file(file.id),/configurada mudou/);
  const prefix=file.id.slice(0,file.id.lastIndexOf(':')+1);
  await assert.rejects(()=>local.file(prefix+Buffer.from('../outside.mp4').toString('base64url')),/inválido/);
});

test('lê JSON com limite e copia vídeo sem alterar a origem, removendo cópias parciais',async()=>{
  const files=await local.tree((await local.folder('.')).id,false);
  const video=files.find(f=>f.name==='video.mp4')!,json=files.find(f=>f.name==='video.json')!;
  assert.deepEqual(await local.json(json.id),{title:'Local'});
  const destination=join(temp,'spool.mp4');
  assert.equal(await local.download(video.id,destination,1024),14);
  assert.deepEqual(await readFile(destination),await readFile(join(root,'video.mp4')));
  await assert.rejects(()=>local.download(video.id,destination,2),/limite/);
  await assert.rejects(()=>readFile(destination),{code:'ENOENT'});
  assert.equal((await readFile(join(root,'video.mp4'))).toString(),'video original');
  await writeFile(join(root,'video.json'),'x'.repeat(65537));
  await assert.rejects(()=>local.json(json.id),/64 KiB/);
  await writeFile(join(root,'video.json'),'{invalid');
  await assert.rejects(()=>local.json(json.id),/inválido/);
});

test('identifica alteração, substituição e renomeação do arquivo por versão e caminho',async()=>{
  const folder=await local.folder('.');
  const before=(await local.tree(folder.id,false)).find(f=>f.name==='video.mp4')!;
  await writeFile(join(root,'video.mp4'),'changed content');
  const after=await local.file(before.id);
  assert.equal(after.id,before.id);
  assert.notEqual(after.version,before.version);
  await rename(join(root,'video.mp4'),join(root,'renamed.mp4'));
  await assert.rejects(()=>local.file(before.id),/não encontrado/);
  const renamed=(await local.tree(folder.id,false)).find(f=>f.name==='renamed.mp4')!;
  assert.notEqual(renamed.id,before.id);
  await rm(join(root,'sub'),{recursive:true});
  await assert.rejects(()=>local.folder('sub'),/não encontrado/);
});

after(()=>rm(temp,{recursive:true,force:true}));
