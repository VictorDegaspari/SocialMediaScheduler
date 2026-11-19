import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { execFileSync, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile, utimes, symlink, readFile,stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';

process.env.ENCRYPTION_KEY ||= '00'.repeat(32);
const { BrowserJournal, nextBrowserVideo, nextPackVideo, prepareTikTokUpload, scheduleTikTokUpload, publishTikTokUpload, confirmTikTokSchedule, clearKnownTikTokDraft, BrowserActionRequired } = await import('../src/browser-tiktok.js');
const {metadataSchema}=await import('../src/domain.js');
const { sha256 } = await import('../src/media.js');
const { manualBrowserLogin, sharedProfileOptions } = await import('../src/browser-login.js');
const directory = await mkdtemp(join(tmpdir(), 'watcher-browser-integration-'));
const media = join(directory, 'media'), work = join(directory, 'work');
await mkdir(media); await mkdir(work);
const journal = new BrowserJournal(join(directory, 'jobs')); await journal.init();
const first = join(media, 'mais-antigo.mp4');
execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','color=c=green:s=64x96:d=1','-c:v','libx264','-pix_fmt','yuv420p',first]);
await writeFile(join(media, 'mais-antigo.json'), JSON.stringify({title:'Teste local',tiktok:{madeWithAI:true}}));
const old = new Date(Date.now()-90_000);
await utimes(first, old, old); await utimes(join(media, 'mais-antigo.json'),old,old);
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});

test('seleciona MP4 estável, conserva origem e IA, ignora links e conteúdo já preparado', async () => {
  const before = await sha256(first);
  await symlink(first, join(media,'link.mp4'));
  const candidate = (await nextBrowserVideo(media, work, journal))!;
  assert.equal(candidate.name, 'mais-antigo.mp4');
  assert.equal(candidate.metadata.tiktok.madeWithAI, true);
  assert.notEqual(candidate.path, first);
  assert.equal(await sha256(first), before);
  await journal.claim(candidate.hash, candidate.name, true);
  assert.equal(await nextBrowserVideo(media,work,journal),undefined);
  await rm(candidate.directory,{recursive:true,force:true});
  await writeFile(join(media,'novo.mp4'),await readFile(first)); // Still being copied: no stability yet.
  assert.equal(await nextBrowserVideo(media,work,journal),undefined);
});

test('se o JSON ainda não está pronto, nenhum arquivo é preparado', async () => {
  await writeFile(join(media,'mais-antigo.json'),JSON.stringify({title:'Aguardando',ready:false}));
  await utimes(join(media,'mais-antigo.json'),old,old);
  assert.equal(await nextBrowserVideo(media,work,journal),undefined);
});
test('pack baixa apenas o próximo vídeo válido, pula incompatíveis e não baixa novamente após reinício',async()=>{
  const {PackSource}=await import('../src/pack-source.js');
  const {PACK_CATALOG_URL}=await import('../src/pack-config.js');
  const original=globalThis.fetch,bytes=await readFile(first),ids=['pack-invalid-001','pack-valid-0002','pack-copy-00003'];
  const downloads:string[]=[];
  globalThis.fetch=async input=>{
    const url=new URL(String(input));
    if(url.href===PACK_CATALOG_URL)return Response.json(ids.map((drive,i)=>({drive,t:'Vídeo '+i,type:'v'})));
    assert.equal(url.hostname,'drive.usercontent.google.com');const id=url.searchParams.get('id')!;downloads.push(id);
    return new Response(id===ids[0]?Buffer.from('invalid media'):bytes,{headers:{'Content-Type':'video/mp4'}});
  };
  const packJournal=new BrowserJournal(join(directory,'pack-jobs'));await packJournal.init();
  try {
    await new PackSource().catalog(true);
    const candidate=await nextPackVideo(work,packJournal);assert(candidate);
    assert.equal(candidate.sourceId,'gta6-pack:'+ids[1]);assert.deepEqual(downloads,ids.slice(0,2));
    assert.equal(candidate.metadata.tiktok.madeWithAI,true);
    const job=await packJournal.claim(candidate.hash,candidate.name,true,candidate.sourceId);assert(job);await packJournal.update(job,'scheduled');
    await rm(candidate.directory,{recursive:true,force:true});
    const restarted=new BrowserJournal(packJournal.directory);
    assert.equal(await nextPackVideo(work,restarted),undefined);assert.deepEqual(downloads,ids,'a cópia idêntica é baixada uma vez e deduplicada por hash');
    assert.equal(await nextPackVideo(work,restarted),undefined);assert.deepEqual(downloads,ids,'nenhum arquivo conhecido é baixado novamente');
  }finally{globalThis.fetch=original;}
});

test('upload e legenda funcionam pelo DOM sem clicar em Publicar', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`<input type="file" accept="video/*" hidden><div id="form"></div><script>
      window.published=0; window.files=[];
      document.querySelector('input').onchange=e=>{
        window.files=[...e.target.files].map(f=>f.name);
        document.querySelector('#form').innerHTML='<div contenteditable="true" role="textbox"></div><button disabled onclick="window.published++">Publicar</button>';
        setTimeout(()=>document.querySelector('button').disabled=false,100);
      };
    </script>`);
    const order: string[] = [];
    const result = await prepareTikTokUpload(page, first, 'Legenda do vídeo', {
      timeout:5000,onBeforeUpload:async()=>{order.push('claim');},onUploadStarted:()=>{order.push('transfer');}
    });
    assert.equal(result.status,'review');
    assert.deepEqual(order,['claim','transfer']);
    assert.deepEqual(await page.evaluate(()=>({files:(window as any).files,published:(window as any).published})), {files:['mais-antigo.mp4'],published:0});
    assert.equal(await page.getByRole('textbox').innerText(),'Legenda do vídeo');
  } finally {await page.close();}
});

test('CAPTCHA e login interrompem a rotina antes da seleção do arquivo', async () => {
  const page = await browser.newPage();
  try {
    let claims = 0;
    const options = {timeout:500,onBeforeUpload:async()=>{claims++;},onUploadStarted:()=>{throw new Error('Não deve iniciar.');}};
    await page.setContent('<input type="file" accept="video/*"><iframe title="captcha" srcdoc="Verifique para continuar"></iframe>');
    await assert.rejects(()=>prepareTikTokUpload(page,first,'Teste',options),error=>error instanceof BrowserActionRequired && error.code==='security_check');
    await page.setContent('<input type="file" accept="video/*"><div role="dialog"><h2>Entrar no TikTok</h2></div>');
    await assert.rejects(()=>prepareTikTokUpload(page,first,'Teste',options),error=>error instanceof BrowserActionRequired && error.code==='login_required');
    assert.equal(claims,0);
  } finally {await page.close();}
});

test('uma interface diferente não é confundida com upload pronto', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<input type="file" accept="video/*"><p>Processamento não confirmado</p>');
    let started=false;
    await assert.rejects(()=>prepareTikTokUpload(page,first,'Teste',{timeout:400,onBeforeUpload:async()=>{},onUploadStarted:()=>{started=true;}}),error=>error instanceof BrowserActionRequired && error.code==='page_changed');
    assert.equal(started,true); // Controller must retain an unknown claim, not retry.
  } finally {await page.close();}
});

test('agendamento nativo seleciona a data reservada, aplica IA e exige confirmação após o clique',async()=>{
  const page=await browser.newPage();
  const date=new Date(Math.ceil((Date.now()+86400_000)/60_000)*60_000),meta=metadataSchema.parse({title:'Lote',tiktok:{privacyLevel:'PUBLIC_TO_EVERYONE',madeWithAI:true}});
  try {
    await page.setContent(`<label><input type="radio" name="timing">Schedule</label><select aria-label="Who can watch this video"><option>Only me</option><option>Everyone</option></select><input type="date"><input type="time"><label><input type="checkbox" checked>Allow comments</label><label><input type="checkbox" checked>Allow duet</label><label><input type="checkbox" checked>Allow stitch</label><label><input type="checkbox">AI-generated content</label><button onclick="document.querySelector('#result').textContent='Video scheduled successfully'">Schedule</button><p id="result"></p>`);
    const result=await scheduleTikTokUpload(page,date,meta,2000);
    assert.equal(result.status,'scheduled');assert.equal(result.publishAt,date.toISOString());
    const {DateTime}=await import('luxon');
    assert.equal(await page.locator('input[type=date]').inputValue(),DateTime.fromJSDate(date).setZone('America/Sao_Paulo').toISODate());
    assert.equal(await page.locator('input[type=time]').inputValue(),DateTime.fromJSDate(date).setZone('America/Sao_Paulo').toFormat('HH:mm'));
    assert(await page.getByRole('checkbox',{name:'AI-generated content'}).isChecked());
    assert.equal(await page.getByRole('checkbox',{name:'Allow comments'}).isChecked(),false);
    assert.equal(await page.getByRole('combobox',{name:'Who can watch this video'}).inputValue(),'Everyone');
    await page.locator('#result').evaluate(el=>el.textContent='');
    await page.getByRole('button',{name:'Schedule',exact:true}).evaluate(el=>el.removeAttribute('onclick'));
    await assert.rejects(()=>scheduleTikTokUpload(page,date,meta,400),error=>error instanceof BrowserActionRequired&&error.code==='upload_unconfirmed');
  }finally{await page.close();}
});
test('limite remoto, data vencida e seletor desconhecido impedem confirmação de agendamento',async()=>{
  const page=await browser.newPage(),meta=metadataSchema.parse({title:'Teste',tiktok:{privacyLevel:'PUBLIC_TO_EVERYONE'}});
  try {
    await page.setContent('<p>Daily upload limit reached</p>');
    await assert.rejects(()=>scheduleTikTokUpload(page,new Date(Math.ceil((Date.now()+86400_000)/60_000)*60_000),meta,400),error=>error instanceof BrowserActionRequired&&error.code==='platform_limit');
    await page.setContent('<button>Publicar</button>');
    await assert.rejects(()=>scheduleTikTokUpload(page,new Date(Date.now()-1000),meta,400),/janela/);
    await assert.rejects(()=>scheduleTikTokUpload(page,new Date(Math.ceil((Date.now()+86400_000)/60_000)*60_000),meta,400),/privacidade|controle de agendamento/);
  }finally{await page.close();}
});

test('recusa do Google, inclusive em popup, interrompe o upload antes de selecionar o arquivo', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    let started = false;
    const options = {timeout:500,onBeforeUpload:async()=>{started=true;},onUploadStarted:()=>{started=true;}};
    await page.setContent('<input type="file" accept="video/*"><p>This browser or app may not be secure.</p>');
    await assert.rejects(()=>prepareTikTokUpload(page,first,'Teste',options),error=>error instanceof BrowserActionRequired && error.code==='login_required');
    await page.setContent('<input type="file" accept="video/*">');
    const popup = await page.context().newPage();
    await popup.route('https://accounts.google.com/**',route=>route.fulfill({contentType:'text/html',body:'Login de teste, sem chamadas ao Google'}));
    await popup.goto('https://accounts.google.com/signin');
    await assert.rejects(()=>prepareTikTokUpload(page,first,'Teste',options),error=>error instanceof BrowserActionRequired && error.code==='login_required');
    assert.equal(started,false);
  } finally {await page.context().close();}
});

test('perfil autenticado pelo Chrome comum pode ser reaberto para upload sem exportar cookies', async () => {
  // A local server stands in for completed manual authentication; no real account is accessed.
  let loginVisited = false;
  const server = createServer((req,res)=>{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    if(req.url==='/login'){
      loginVisited = true;
      res.setHeader('Set-Cookie','fixture_session=local-test; HttpOnly; SameSite=Lax; Max-Age=3600; Path=/');
      res.end('<p>Sessão local de teste estabelecida.</p>');
    }else res.end((req.headers.cookie||'').includes('fixture_session=local-test')?'<p>Sessão preservada</p>':'<p>Sem sessão</p>');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port = (server.address() as {port:number}).port;
  const profile = join(directory,'manual-profile');
  const executable = join(directory,'test-chrome.mjs');
  // Only the test adds headless/dump-dom so native Chrome closes without user interaction.
  await writeFile(executable,`#!/usr/bin/env node
import {spawn} from 'node:child_process';
const child=spawn(process.env.CHROME_PATH||'/usr/bin/google-chrome',['--headless','--dump-dom','--no-sandbox',...process.argv.slice(2)],{stdio:'ignore'});
process.once('SIGTERM',()=>child.kill('SIGTERM'));
child.once('error',()=>process.exit(1));
child.once('close',code=>process.exit(code||0));
`,{mode:0o700});
  let resumed;
  try {
    await manualBrowserLogin(profile,{executablePath:executable,url:`http://127.0.0.1:${port}/login`,signal:AbortSignal.timeout(15_000)});
    assert.equal(loginVisited,true,'o Chrome comum deve carregar a página de autenticação local');
    resumed=await chromium.launchPersistentContext(profile,{...sharedProfileOptions,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
    const page=resumed.pages()[0]||await resumed.newPage();
    await page.goto(`http://127.0.0.1:${port}/account`);
    assert.equal(await page.locator('body').innerText(),'Sessão preservada');
  } finally {await resumed?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('CLI sem vídeo não abre navegador e Ctrl+C encerra a espera sem aguardar 30 segundos', async () => {
  const cliDirectory = join(directory, 'cli'), empty = join(cliDirectory,'empty');
  await mkdir(empty,{recursive:true});
  const command = ['--import',import.meta.resolve('tsx'),resolve('scripts/tiktok-browser.mjs')];
  const options = {cwd:cliDirectory,env:{...process.env,PLAYWRIGHT_MCP_EXTENSION_TOKEN:'test-extension-token',ENCRYPTION_KEY:'00'.repeat(32)}};
  const {stdout} = await promisify(execFile)(process.execPath,[...command,'--once','--folder',empty],{...options,timeout:5000});
  assert.match(stdout,/browser_no_video/);
  let interruptedAt = 0;
  const child = spawn(process.execPath,[...command,'--watch','--run-now','--folder',empty],{...options,timeout:5000});
  child.stdout.on('data',chunk=>{if(String(chunk).includes('browser_no_video')&&!interruptedAt){interruptedAt=Date.now();child.kill('SIGINT');}});
  const code = await new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  assert(interruptedAt>0,'a rotina deve chegar à espera por vídeo');
  assert.equal(code,0);
  assert(Date.now()-interruptedAt<2000,'a interrupção deve ser imediata');
});
test('CLI blocks browser startup when the mandatory extension token is missing',async()=>{
  const cliDirectory=join(directory,'cli-no-token');await mkdir(cliDirectory,{recursive:true});
  const env={...process.env,ENCRYPTION_KEY:'00'.repeat(32),PLAYWRIGHT_MCP_EXTENSION_TOKEN:''};
  await assert.rejects(()=>promisify(execFile)(process.execPath,['--import',import.meta.resolve('tsx'),resolve('scripts/tiktok-browser.mjs'),'--login'],{cwd:cliDirectory,env,timeout:5000}),error=>{
    assert.match((error as any).stderr,/PLAYWRIGHT_MCP_EXTENSION_TOKEN/);return true;
  });
  await assert.rejects(()=>stat(join(cliDirectory,'.browser-data')),'the rejected command does not create a browser profile');
});

for(const scheduled of [false,true])test(scheduled?'agendamento por pasta inicia o Playwright com vídeo elegível':'Enviar próximo agora inicia o Playwright com vídeo elegível',async()=>{
  const root=join(directory,scheduled?'cli-scheduled':'cli-next'),media=join(root,'media');await mkdir(media,{recursive:true});
  const source=join(media,'video.mp4'),sidecar=join(media,'video.json'),marker=join(root,'opened'),chrome=join(root,'fake-chrome');
  await writeFile(source,await readFile(first));
  await writeFile(sidecar,JSON.stringify({title:'Vídeo de teste',tiktok:{privacyLevel:'PUBLIC_TO_EVERYONE'}}));
  const stable=new Date(Date.now()-60_000);await utimes(source,stable,stable);await utimes(sidecar,stable,stable);
  const originalHash=await sha256(source);
  await writeFile(chrome,'#!/bin/sh\nprintf opened > "$CHROME_TEST_MARKER"\nexit 1\n',{mode:0o700});
  await assert.rejects(()=>promisify(execFile)(process.execPath,['--import',import.meta.resolve('tsx'),resolve('scripts/tiktok-browser.mjs'),'--once','--folder',media,
    ...(scheduled?['--schedule-at',new Date(Date.now()+86400000).toISOString()]:[])],{
    cwd:root,env:{...process.env,CHROME_PATH:chrome,CHROME_TEST_MARKER:marker,PLAYWRIGHT_MCP_EXTENSION_TOKEN:'test-extension-token',ENCRYPTION_KEY:'00'.repeat(32)},timeout:10000}),error=>{
      const output=(error as {stdout:string}).stdout;
      assert.match(output,/browser_preparing_source/);assert.match(output,/browser_attempt_failed/);
      assert.doesNotMatch(output,/browser_source_failed|browser_upload_started|browser_no_video/);return true;
    });
  assert.equal(await readFile(marker,'utf8'),'opened','o executável deve ser iniciado automaticamente pelo Playwright');
  assert.equal(await sha256(source),originalHash,'a tentativa preserva o vídeo original');
  assert.deepEqual(await (await import('node:fs/promises')).readdir(join(root,'.browser-data/tiktok/work')),[],'a cópia temporária é removida após a falha simulada');
});

test('login abre o Chrome sem depender da pasta de vídeos',async()=>{
  const root=join(directory,'login-without-media');await mkdir(root);
  const blocked=join(root,'not-a-directory'),chrome=join(root,'fake-chrome'),marker=join(root,'opened');
  await writeFile(blocked,'a origem não é usada no login');
  await writeFile(chrome,'#!/bin/sh\nprintf opened > "$CHROME_TEST_MARKER"\n',{mode:0o700});
  const {stdout}=await promisify(execFile)(process.execPath,['--import',import.meta.resolve('tsx'),resolve('scripts/tiktok-browser.mjs'),'--login','--folder',join(blocked,'videos')],{
    cwd:root,env:{...process.env,CHROME_PATH:chrome,CHROME_TEST_MARKER:marker,PLAYWRIGHT_MCP_EXTENSION_TOKEN:'test-extension-token',ENCRYPTION_KEY:'00'.repeat(32)},timeout:5000});
  assert.match(stdout,/browser_manual_login/);assert.equal(await readFile(marker,'utf8'),'opened');
});

test('agente executa tarefa do painel e rejeita origem fora da pasta local autorizada',async()=>{
  const {randomUUID}=await import('node:crypto');
  const root=join(directory,'agent-workspace'),empty=join(root,'media');
  await mkdir(empty,{recursive:true});await symlink(resolve('scripts'),join(root,'scripts'));
  const jobs=[{id:randomUUID(),kind:'upload',folder:empty,stripMetadata:true},{id:randomUUID(),kind:'upload',folder:directory,stripMetadata:true}];
  const results:string[]=[],stages:string[]=[],testKey='2'.repeat(64);
  let sent=0,finishAll:()=>void;
  const completed=new Promise<void>(resolve=>{finishAll=resolve;});
  const server=createServer(async(req,res)=>{
    try{
      assert.equal(req.headers.authorization,'Bearer '+testKey);
      if(req.url==='/api/browser-agent/playwright-mcp'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({PLAYWRIGHT_MCP_EXTENSION_TOKEN:'test-extension-token'}));return;}
      assert.equal(req.headers['x-watcher-request'],'1');
      let text='';for await(const chunk of req)text+=chunk;
      const body=JSON.parse(text);let response:unknown={ok:true};
      if(req.url==='/api/browser-agent/profiles')response=[{id:'default'}];
      else if(req.url==='/api/browser-agent/poll')response={job:!body.activeJobId&&sent<jobs.length?jobs[sent++]:null,cancel:false};
      else if(req.url?.endsWith('/progress'))stages.push(body.stage);
      else if(req.url?.endsWith('/finish')){results.push(body.result);if(results.length===2)finishAll();}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(response));
    }catch{res.writeHead(400).end();}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=(server.address() as {port:number}).port;
  const child=spawn(process.execPath,['--import',import.meta.resolve('tsx'),resolve('scripts/browser-agent.mjs')],{
    cwd:root,env:{...process.env,APP_URL:`http://127.0.0.1:${port}`,BROWSER_AGENT_TOKEN:testKey,ENCRYPTION_KEY:'00'.repeat(32),
      LOCAL_MEDIA_DIR:empty,LOCAL_MEDIA_HOST_DIR:empty,LOG_LEVEL:'silent'},stdio:'ignore'});
  const closed=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  const timer=setTimeout(()=>child.kill('SIGTERM'),12_000);
  try{
    await Promise.race([completed,closed.then(()=>{throw new Error('O agente encerrou antes de concluir as tarefas.');})]);
    assert.deepEqual(results,['empty','failed']);assert(stages.includes('browser_no_video'));assert(stages.includes('browser_agent_failed'));
  }finally{
    clearTimeout(timer);child.kill('SIGINT');await closed;await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});

test('agente informa tarefa incompatível antes do upload e continua recebendo tarefas',async()=>{
  const {randomUUID}=await import('node:crypto');
  const root=join(directory,'agent-invalid-job'),media=join(root,'media');await mkdir(media,{recursive:true});await symlink(resolve('scripts'),join(root,'scripts'));
  const invalidId=randomUUID(),validId=randomUUID(),key='6'.repeat(64);
  const jobs=[{id:invalidId,kind:'upload',folder:media,stripMetadata:true,publishNow:'invalid'},{id:validId,kind:'upload',folder:media,stripMetadata:true}];
  const results:{id:string,result:string}[]=[],stages:{id:string,stage:string}[]=[];let sent=0,finished:()=>void;
  const completed=new Promise<void>(done=>{finished=done;});
  const server=createServer(async(req,res)=>{
    try{
      assert.equal(req.headers.authorization,'Bearer '+key);
      let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};let response:unknown={ok:true};
      if(req.url==='/api/browser-agent/playwright-mcp')response={PLAYWRIGHT_MCP_EXTENSION_TOKEN:'test-extension-token'};
      else if(req.url==='/api/browser-agent/profiles')response=[{id:'default'}];
      else if(req.url==='/api/browser-agent/poll')response={job:!body.activeJobId&&sent<jobs.length?jobs[sent++]:null,cancel:false};
      else if(req.url?.endsWith('/progress'))stages.push({id:req.url.split('/')[4]!,stage:body.stage});
      else if(req.url?.endsWith('/finish')){results.push({id:req.url.split('/')[4]!,result:body.result});if(results.length===2)finished();}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(response));
    }catch{res.writeHead(400).end();}
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const child=spawn(process.execPath,['--import',import.meta.resolve('tsx'),resolve('scripts/browser-agent.mjs')],{cwd:root,env:{...process.env,APP_URL:'http://127.0.0.1:'+(server.address() as {port:number}).port,BROWSER_AGENT_TOKEN:key,ENCRYPTION_KEY:'00'.repeat(32),LOCAL_MEDIA_DIR:media,LOCAL_MEDIA_HOST_DIR:media,LOG_LEVEL:'silent'},stdio:'ignore'});
  const closed=new Promise<number|null>((done,reject)=>{child.once('close',done);child.once('error',reject);});const timer=setTimeout(()=>child.kill('SIGTERM'),12000);
  try{
    await Promise.race([completed,closed.then(()=>{throw new Error('O agente deixou uma tarefa sem resultado.');})]);
    assert.deepEqual(results,[{id:invalidId,result:'failed'},{id:validId,result:'empty'}]);
    assert(stages.some(s=>s.id===invalidId&&s.stage==='browser_job_invalid'));
    assert(!stages.some(s=>s.id===invalidId&&s.stage==='browser_upload_started'));
  }finally{clearTimeout(timer);child.kill('SIGINT');await closed;await new Promise<void>(done=>server.close(()=>done()));}
});

for(const commercial of [false,true])test(commercial?'publicação comercial imediata chega ao Chrome do Playwright após conferir a cópia':'agente recebe cópia privada do backend, confere hash e usa diretório do perfil correto',async()=>{
  const {randomUUID,createHash}=await import('node:crypto');const {browserProfileDirectory}=await import('../src/browser-profiles.js');
  const root=join(directory,commercial?'commercial-agent':'prepared-agent'),media=join(root,'media'),profileId=randomUUID(),jobId=randomUUID(),key='5'.repeat(64),bytes=await readFile(first),hash=createHash('sha256').update(bytes).digest('hex');
  await mkdir(media,{recursive:true});await symlink(resolve('scripts'),join(root,'scripts'));
  const blocked=join(root,'unavailable-source');await writeFile(blocked,'a cópia preparada dispensa acesso à origem');
  const marker=join(root,'chrome-opened'),chrome=join(root,'fake-chrome');
  if(commercial)await writeFile(chrome,'#!/bin/sh\nprintf opened > "$CHROME_TEST_MARKER"\nexit 1\n',{mode:0o700});
  let sent=false,downloaded=false,finished:()=>void;const stages:string[]=[],completed=new Promise<void>(done=>{finished=done;});
  const server=createServer(async(req,res)=>{
    try {
      assert.equal(req.headers.authorization,'Bearer '+key);
      if(req.url==='/api/browser-agent/playwright-mcp'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({PLAYWRIGHT_MCP_EXTENSION_TOKEN:'test-extension-token'}));return;}
      if(req.url==='/api/browser-agent/jobs/'+jobId+'/media'){assert.equal(req.method,'GET');downloaded=true;res.setHeader('Content-Type','video/mp4');res.end(bytes);return;}
      let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);let response:unknown={ok:true};
      if(req.url==='/api/browser-agent/profiles')response=[{id:profileId}];
      else if(req.url==='/api/browser-agent/poll'){
        response={job:!sent&&!body.activeJobId?{id:jobId,kind:'upload',folder:join(blocked,'videos'),stripMetadata:true,profileId,...(commercial?{publishNow:true}:{publishAt:new Date(Date.now()+86400000).toISOString()}),media:{metadata:metadataSchema.parse({title:'Teste privado',tiktok:{privacyLevel:commercial?'PUBLIC_TO_EVERYONE':null,commercialContent:commercial,ownBrand:commercial}}),hash,assetSha256:hash,name:'video.mp4',sourceId:'source-video-01'}}:null,cancel:false};sent=true;
      }else if(req.url?.endsWith('/progress'))stages.push(body.stage);
      else if(req.url?.endsWith('/finish')){assert.equal(body.result,'failed');finished();}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(response));
    }catch{res.writeHead(400).end();}
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const child=spawn(process.execPath,['--import',import.meta.resolve('tsx'),resolve('scripts/browser-agent.mjs')],{cwd:root,env:{...process.env,...(commercial?{CHROME_PATH:chrome,CHROME_TEST_MARKER:marker}:{}),APP_URL:'http://127.0.0.1:'+(server.address() as {port:number}).port,BROWSER_AGENT_TOKEN:key,ENCRYPTION_KEY:'00'.repeat(32),LOCAL_MEDIA_DIR:media,LOCAL_MEDIA_HOST_DIR:media,LOG_LEVEL:'silent'},stdio:'ignore'});
  const closed=new Promise<number|null>((done,reject)=>{child.once('close',done);child.once('error',reject);});const timer=setTimeout(()=>child.kill('SIGTERM'),12000);
  try {
    await Promise.race([completed,closed.then(()=>{throw new Error('O agente não concluiu a conferência.');})]);
    assert(downloaded);
    if(commercial){assert.equal(await readFile(marker,'utf8'),'opened');assert(!stages.includes('page_changed'),'declarações comerciais não impedem abrir o Chrome');}
    else assert(stages.includes('page_changed'),'a cópia deve passar pelo hash antes de recusar os metadados de privacidade, sem abrir TikTok');
    assert(stages.includes('browser_preparing_source'));
    const files=await import('node:fs/promises');assert((await files.stat(browserProfileDirectory(profileId,join(root,'.browser-data/tiktok')))).isDirectory());
  }finally{clearTimeout(timer);child.kill('SIGINT');await closed;await new Promise<void>(done=>server.close(()=>done()));}
});

after(async()=>{await browser.close();await rm(directory,{recursive:true,force:true});});


test('publicação imediata desmarca IA, confirma uma vez e não aceita confirmação antiga',async()=>{
  const page=await browser.newPage(),meta=metadataSchema.parse({title:'Gameplay revisado',tiktok:{privacyLevel:'PUBLIC_TO_EVERYONE',madeWithAI:false}});
  try {
    await page.setContent(`<select aria-label="Who can watch this video"><option>Everyone</option></select><label><input type="radio" name="timing">Now</label><label><input type="checkbox" checked>Allow comments</label><label><input type="checkbox" checked>Allow duet</label><label><input type="checkbox" checked>Allow stitch</label><label><input type="checkbox" checked>AI-generated content</label><button onclick="window.posts=(window.posts||0)+1;document.querySelector('#result').textContent='Video published successfully'">Post</button><p id="result"></p>`);
    assert.equal((await publishTikTokUpload(page,meta,1000)).status,'published');
    assert.equal(await page.getByRole('checkbox',{name:'AI-generated content'}).isChecked(),false);
    assert.equal(await page.evaluate(()=>(window as any).posts),1);
    await assert.rejects(()=>publishTikTokUpload(page,meta,400),/confirmação antiga/);
    assert.equal(await page.evaluate(()=>(window as any).posts),1);
    await page.locator('#result').evaluate(el=>el.textContent='');
    await page.getByRole('button',{name:'Post',exact:true}).evaluate(el=>el.removeAttribute('onclick'));
    await assert.rejects(()=>publishTikTokUpload(page,meta,400),error=>error instanceof BrowserActionRequired&&error.code==='upload_unconfirmed');
    await page.getByRole('checkbox',{name:'AI-generated content'}).evaluate(el=>el.remove());
    await assert.rejects(()=>publishTikTokUpload(page,meta,400),/declaração de IA/);
  }finally{await page.close();}
});

for(const [ownBrand,commercialContent] of [[true,false],[false,true],[true,true],[false,false]])test(`publicação imediata confere marca=${ownBrand} e parceria=${commercialContent} no Studio`,async()=>{
  const page=await browser.newPage(),metadata=metadataSchema.parse({title:'Vídeo comercial revisado',tiktok:{privacyLevel:'PUBLIC_TO_EVERYONE',ownBrand,commercialContent,madeWithAI:true,allowComment:true}});
  try{
    await page.setContent(`<select aria-label="Who can watch this video"><option>Only me</option><option>Everyone</option></select>
      <label><input type="checkbox">Allow comments</label><label><input type="checkbox" checked>Allow duet</label><label><input type="checkbox" checked>Allow stitch</label><label><input type="checkbox">AI-generated content</label>
      <label><input id="disclosure" type="checkbox" role="switch" checked onchange="document.querySelector('#brands').hidden=!this.checked">Disclose commercial content</label>
      <div id="brands"><label><input id="own" type="checkbox" ${ownBrand?'':'checked'}>Your brand</label><label><input id="paid" type="checkbox" ${commercialContent?'':'checked'}>Branded content</label></div>
      <button onclick="window.posts=(window.posts||0)+1;window.selection={disclosure:document.querySelector('#disclosure').checked,own:document.querySelector('#own').checked,paid:document.querySelector('#paid').checked};document.querySelector('#result').textContent='Video published successfully'">Post</button><p id="result"></p>`);
    assert.equal((await publishTikTokUpload(page,metadata,1500)).status,'published');
    const state=await page.evaluate(()=>({posts:(window as any).posts,selection:(window as any).selection}));
    assert.equal(state.posts,1);assert.equal(state.selection.disclosure,ownBrand||commercialContent);
    if(ownBrand||commercialContent)assert.deepEqual(state.selection,{disclosure:true,own:ownBrand,paid:commercialContent});
    assert.equal(await page.getByRole('checkbox',{name:'AI-generated content'}).isChecked(),true);assert.equal(await page.getByRole('checkbox',{name:'Allow comments'}).isChecked(),true);
    assert.equal(await page.getByRole('checkbox',{name:'Allow duet'}).isChecked(),false);assert.equal(await page.getByRole('checkbox',{name:'Allow stitch'}).isChecked(),false);
  }finally{await page.close();}
});

test('declaração comercial ausente ou ambígua não autoriza clicar em Publicar',async()=>{
  const page=await browser.newPage(),metadata=metadataSchema.parse({title:'Parceria revisada',tiktok:{privacyLevel:'PUBLIC_TO_EVERYONE',commercialContent:true}});
  const permissions='<select aria-label="Who can watch this video"><option>Everyone</option></select><label><input type="checkbox">Allow comments</label><label><input type="checkbox">Allow duet</label><label><input type="checkbox">Allow stitch</label><label><input type="checkbox">AI-generated content</label><button onclick="window.posts=(window.posts||0)+1">Post</button>';
  try{
    for(const controls of ['', '<label><input type="checkbox" role="switch">Disclose commercial content</label><label><input type="checkbox">Your brand</label>', '<label><input type="checkbox" role="switch">Disclose commercial content</label><label><input type="checkbox">Your brand</label><label><input type="checkbox">Your brand</label><label><input type="checkbox">Branded content</label>']){
      await page.setContent(permissions+controls);
      await assert.rejects(()=>publishTikTokUpload(page,metadata,500),error=>error instanceof BrowserActionRequired&&error.code==='page_changed');
      assert.equal(await page.evaluate(()=>(window as any).posts||0),0);
    }
    await assert.rejects(()=>scheduleTikTokUpload(page,new Date(Math.ceil((Date.now()+86400_000)/60_000)*60_000),metadata,500),/declarações comerciais/);
  }finally{await page.close();}
});

test('Studio atual usa combobox sem nome, rádio estilizado, calendário e horário somente leitura',async()=>{
  const {DateTime}=await import('luxon');
  const target=DateTime.now().setZone('America/Sao_Paulo').plus({days:1}).set({hour:19,minute:0,second:0,millisecond:0});
  const today=target.minus({days:1}),page=await browser.newPage();
  try {
    await page.setContent(`<style>.tiktok-timepicker-invisible{display:none}.calendar-wrapper{display:none}</style>
      <span>When to post</span><button role="combobox">Everyone</button>
      <label><input id="schedule" type="radio" name="timing" value="schedule">Schedule<span onclick="event.preventDefault()"></span></label>
      <input id="date" type="text" readonly value="${today.toISODate()}"><input id="time" type="text" readonly value="15:30">
      <div class="calendar-wrapper"><span class="month-title">${target.setLocale('en-US').toFormat('LLLL')}</span><span class="year-title">${target.year}</span><div class="days-wrapper">${Array.from({length:target.daysInMonth!},(_,i)=>`<span class="day valid">${i+1}</span>`).join('')}</div></div>
      <div class="tiktok-timepicker-time-picker-container tiktok-timepicker-invisible">${Array.from({length:24},(_,i)=>`<span class="tiktok-timepicker-left">${String(i).padStart(2,'0')}</span>`).join('')}<span class="tiktok-timepicker-right">00</span></div>
      <button id="more">Show more</button><section id="options" hidden><label><input type="checkbox" checked>Comment</label><label><input type="checkbox" disabled>Reuse of content</label>
      <div data-e2e="aigc_container"><span>AI-generated content</span><div onclick="this.querySelector('input').checked=!this.querySelector('input').checked"><input role="switch" type="checkbox" aria-hidden="true" checked></div></div>
      <div data-e2e="disclose_content_container"><div onclick="this.querySelector('input').checked=!this.querySelector('input').checked"><input role="switch" type="checkbox" checked></div></div></section>
      <button onclick="document.querySelector('#result').textContent='Video scheduled successfully'">Schedule</button><p id="result"></p>
      <script>
      const d=document.querySelector('#date'),t=document.querySelector('#time'),calendar=document.querySelector('.calendar-wrapper'),picker=document.querySelector('.tiktok-timepicker-time-picker-container');
      document.querySelector('#more').onclick=()=>{document.querySelector('#options').hidden=false;document.querySelector('#more').remove()};
      d.onclick=()=>calendar.style.display='block';
      for(const day of calendar.querySelectorAll('.day'))day.onclick=()=>{d.value='${target.toFormat('yyyy-MM')}-'+day.textContent.padStart(2,'0');calendar.style.display='none'};
      t.onclick=()=>picker.classList.toggle('tiktok-timepicker-invisible');
      for(const hour of picker.querySelectorAll('.tiktok-timepicker-left'))hour.onclick=()=>t.value=hour.textContent+':'+t.value.split(':')[1];
      picker.querySelector('.tiktok-timepicker-right').onclick=()=>t.value=t.value.split(':')[0]+':00';
      </script>`);
    const metadata=metadataSchema.parse({title:'Gameplay revisado',tiktok:{privacyLevel:'PUBLIC_TO_EVERYONE',madeWithAI:false}});
    assert.equal((await scheduleTikTokUpload(page,target.toJSDate(),metadata,2000)).status,'scheduled');
    assert.equal(await page.locator('#date').inputValue(),target.toISODate());assert.equal(await page.locator('#time').inputValue(),'19:00');
    assert.equal(await page.locator('[data-e2e=aigc_container] input').isChecked(),false);
    assert.equal(await page.locator('[data-e2e=disclose_content_container] input').isChecked(),false);
    assert.equal(await page.getByRole('checkbox',{name:'Comment',exact:true}).isChecked(),false);
  }finally{await page.close();}
});


test('confirma redirecionamento do Studio apenas com legenda, alarme e data exatos',async()=>{
  const {DateTime}=await import('luxon');
  const when=DateTime.now().setZone('America/Sao_Paulo').plus({days:1}).set({hour:19,minute:0,second:0,millisecond:0});
  const metadata=metadataSchema.parse({title:'Gameplay revisado para confirmação',tiktok:{privacyLevel:'PUBLIC_TO_EVERYONE',madeWithAI:false}});
  const page=await browser.newPage(),label=when.setLocale('en-US').toFormat('MMM d, h:mm a')+' (GMT-3) Sao Paulo';
  try {
    await page.route('https://www.tiktok.com/tiktokstudio/content',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<div data-tt="components_RowLayout_FlexRow"><a data-tt="components_PostInfoCell_a" href="/@namadruga.gameplays/video/123456789">Gameplay revisado para confirmação</a><div class="icon-label"><span data-icon="Alarm"></span>${label}</div><button disabled>Everyone</button></div>`}));
    await page.goto('https://www.tiktok.com/tiktokstudio/content');
    const confirmed=await confirmTikTokSchedule(page,when.toJSDate(),metadata);assert.equal(confirmed?.postId,'123456789');
    assert.equal(confirmed?.publishAt,when.toJSDate().toISOString());
    assert.equal(await confirmTikTokSchedule(page,when.plus({hours:1}).toJSDate(),metadata),undefined,'uma hora diferente não confirma o pedido');
    await page.locator('[data-icon=Alarm]').evaluate(el=>el.remove());
    assert.equal(await confirmTikTokSchedule(page,when.toJSDate(),metadata),undefined,'uma publicação sem o alarme de agendamento não confirma');
  }finally{await page.close();}
});


test('rascunho é descartado somente quando sua legenda completa pertence ao histórico do agente',async()=>{
 const page=await browser.newPage();
 const fixture=`<p id="notice">A video you were editing wasn’t saved. Continue editing?</p><button id="continue" onclick="document.querySelector('#editing').hidden=false;this.remove();document.querySelector('#notice').remove()">Continue</button><div id="editing" hidden><div contenteditable="true" role="textbox">Legenda de uma publicação conferida #gta6</div><button onclick="window.discards=(window.discards||0)+1;document.querySelector('#editing').setAttribute('aria-hidden','true');document.querySelector('#confirm').hidden=false">Discard</button></div><div id="confirm" role="dialog" hidden><p>Discard this post?</p><button onclick="window.discards++;document.querySelector('#editing').hidden=true;document.querySelector('#confirm').hidden=true">Discard</button></div>`;
 try {
  await page.setContent(fixture);
  await assert.rejects(()=>clearKnownTikTokDraft(page,[]),/não está no histórico/);
  assert.equal(await page.evaluate(()=>(window as any).discards||0),0,'rascunho desconhecido é preservado');
  await page.setContent(fixture);
  assert.equal(await clearKnownTikTokDraft(page,['Legenda de uma publicação conferida #gta6']),true);
  assert.equal(await page.evaluate(()=>(window as any).discards),2);
  assert.equal(await page.locator('#editing').isVisible(),false);
 }finally{await page.close();}
});
