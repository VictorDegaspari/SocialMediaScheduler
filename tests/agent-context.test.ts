import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {indexSource,selectSource,outlineSource,bounded,run,readProjectFile} from '../scripts/agent-context.mjs';

const fixture=`import {sideEffect} from './never-execute.js';
export type Item={id:string};
export class Queue { async state(limit=20){return [limit];} }
export function editor(){const title='ação {braces}';function seek(time){return time+1;}return {read(){return title;}};}
router.get('/items/:id',async(req,res)=>{const item={id:req.params.id};res.json(item);});
document.addEventListener('click',()=>first());document.addEventListener('click',()=>second());
throw new Error('inspection must not execute this');`;

test('AST seleciona métodos, closures e handlers em código compacto sem executar imports',()=>{
  const index=indexSource(fixture,'fixture.ts');
  assert.deepEqual(index.imports,['./never-execute.js']);
  assert.equal(selectSource(fixture,'fixture.ts','Queue.state').text,'async state(limit=20){return [limit];}');
  assert.equal(selectSource(fixture,'fixture.ts','editor.seek').text,'function seek(time){return time+1;}');
  assert.equal(selectSource(fixture,'fixture.ts','editor.read').text,'read(){return title;}');
  assert.match(selectSource(fixture,'fixture.ts','GET /items/:id').text,/^router\.get\('/);
  assert.equal(selectSource(fixture,'fixture.ts','editor.title').text,"title='ação {braces}'");
  const dynamic="router.get(`/oauth/${provider}`,async(req,res)=>res.json({ok:true}));";
  assert.equal(selectSource(dynamic,'fixture.ts','GET /oauth/${provider}').text,dynamic.slice(0,-1));
  assert.throws(()=>selectSource(fixture,'fixture.ts','missing'),/Unknown symbol/);
});

test('AST de componentes Vue preserva símbolos e posições do script sem interpretar o template',()=>{
  const component='<!-- <script>const phantom=1;</script> --><template><p>{{ title }}</p></template>\n<script setup lang="ts">\nconst title="ação";\nfunction seek(time:number){return time+1;}\n</script>\n<style>p{color:red}</style>';
  const selection=selectSource(component,'fixture.vue','seek');
  assert.equal(selection.text,'function seek(time:number){return time+1;}');
  assert.equal(selection.line,4);
  assert.deepEqual(indexSource(component,'fixture.vue').symbols.map(symbol=>symbol.label),['title','seek']);
});

test('outline preserva fronteiras de escopo; pesquisa encontra símbolos internos sem seus corpos',()=>{
  const top=outlineSource(fixture,'fixture.ts');
  assert(top.symbols.some(item=>item.name==='Queue'));
  assert(!top.symbols.some(item=>item.name==='Queue.state'));
  assert.deepEqual(outlineSource(fixture,'fixture.ts',{selector:'Queue'}).symbols.map(item=>item.name),['Queue.state']);
  assert.deepEqual(outlineSource(fixture,'fixture.ts',{match:'seek'}).symbols.map(item=>item.name),['editor.seek']);
  assert.deepEqual(outlineSource(fixture,'fixture.ts',{match:'editor'}).symbols.map(item=>item.name),['editor']);
  assert.deepEqual(outlineSource(fixture,'fixture.ts',{match:'editor.seek'}).symbols.map(item=>item.name),['editor.seek']);
  assert.deepEqual(outlineSource(fixture,'fixture.ts',{selector:'Queue',match:'seek'}).symbols,[]);
  const seek=selectSource(fixture,'fixture.ts','editor.seek');
  assert.equal(fixture.slice(seek.start,seek.end),seek.text);assert.equal(seek.line,4);
  assert.match(selectSource('/** Keep source timestamps. */\nfunction align(){return 1;}','fixture.js','align').text,/^\/\*\* Keep source timestamps/);
});

test('handlers repetidos na mesma linha recebem seletores únicos com coluna',()=>{
  const handlers=outlineSource(fixture,'fixture.ts').symbols.filter(item=>item.name.startsWith('on document.click'));
  assert.equal(handlers.length,2);assert.equal(new Set(handlers.map(item=>item.name)).size,2);
  assert.match(selectSource(fixture,'fixture.ts',handlers[0].name).text,/first\(\)/);
  assert.match(selectSource(fixture,'fixture.ts',handlers[1].name).text,/second\(\)/);
});

test('limite de contexto recusa trechos grandes sem truncar silenciosamente',()=>{
  assert.equal(bounded('á'.repeat(200),200).length,200);
  assert.throws(()=>bounded('sensitive-marker'+'.'.repeat(200),200),error=>{
    assert.match((error as Error).message,/Nothing was truncated/);
    assert(!(error as Error).message.includes('sensitive-marker'));return true;
  });
  for(const invalid of [0,199,32_001,NaN,Infinity,200.5])assert.throws(()=>bounded('x',invalid),/--max-chars/);
});

test('leituras excluem credenciais, artefatos, caminhos externos e binários',async()=>{
  for(const path of ['.env','artifacts/video.mp4','../outside.ts','src/../../outside.ts','src/.secret.json','node_modules/typescript/package.json','website/assets/preview.png'])
    await assert.rejects(readProjectFile(path),/Only|excluded/);
  const file=await readProjectFile('package.json');assert.equal(JSON.parse(file.text).name,'drive-watcher');
});

test('symlinks dentro do código não permitem ler arquivos externos',async()=>{
  const project=fileURLToPath(new URL('../',import.meta.url)),local=await mkdtemp(join(project,'scripts','ctx-fixture-')),external=await mkdtemp(join(tmpdir(),'ctx-external-'));
  try{
    await writeFile(join(external,'example.ts'),'private sentinel');
    await symlink(join(external,'example.ts'),join(local,'example.ts'));
    await assert.rejects(readProjectFile('scripts/'+local.split('/').at(-1)+'/example.ts'),/Symlink/);
  }finally{await Promise.all([rm(local,{recursive:true,force:true}),rm(external,{recursive:true,force:true})]);}
});

test('manifesto mantém arquivos, dependências e módulos src/public cobertos',async()=>{
  assert.match(await run(['check']),/^OK \d+ areas, \d+ referenced files/);
  const map=await run(['map','editor']);assert.match(map,/public\/cuts-editor\.js/);assert.match(map,/tests\/cuts-playback\.test\.ts/);
  assert(!map.includes('src/local-publisher.ts'),'dependent areas are not loaded eagerly');
  const commands=await run(['checks','pagination']);
  assert.match(commands,/test-integration\.sh tests\/pagination\.integration\.ts tests\/requests-pages\.integration\.ts/);
  assert.match(await run(['checks','sources']),/test-ui\.sh # includes QA setup\/cleanup/);
  const accountChecks=await run(['checks','accounts']);
  assert.match(accountChecks,/test-ui\.sh.*native MP4 fixture/);assert(!accountChecks.includes('node-local.sh scripts/check-native-ui.mjs'));
  await assert.rejects(run(['map','unknown']),/Unknown area/);
});

test('CLI limita a saída e lê símbolos atuais sem importar o servidor com efeitos',async()=>{
  const outline=await run(['outline','src/server.ts','--match=/api/state']);
  assert.match(outline,/GET \/api\/state/);assert(!outline.includes('res.json'));
  const selection=await run(['show','public/cuts-editor.js#createCutEditor.seekSource']);
  assert.match(selection,/function seekSource/);assert(!selection.includes('PRÉVIA PARA CELULAR'));
  await assert.rejects(run(['show','src/server.ts','--max-chars=200']),/Nothing was truncated/);
  await assert.rejects(run(['show','.env']),/Only/);
  await assert.rejects(run(['outline','package.json']),/Outline supports/);
  for(const args of [['map','--bad=1'],['map','editor','unexpected'],['show'],['checks'],['check','editor'],['map','--max-chars=Infinity']])
    await assert.rejects(run(args));
});
