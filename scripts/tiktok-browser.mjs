import { chromium } from 'playwright-core';
import { parseArgs } from 'node:util';
import { mkdir, chmod, open, readFile, rm, realpath, writeFile } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {browserProfileDirectory} from '../src/browser-profiles.ts';
import {metadataSchema} from '../src/domain.ts';
import {sha256} from '../src/media.ts';
import { logger } from '../src/config.ts';
import { nextRun, watchSchema } from '../src/domain.ts';
import { manualBrowserLogin, sharedProfileOptions } from '../src/browser-login.ts';
import { BrowserJournal, BrowserActionRequired, tiktokCaption, nextBrowserVideo, nextPackVideo, prepareTikTokUpload, scheduleTikTokUpload, publishTikTokUpload, browserJobLabel, TIKTOK_UPLOAD_URL } from '../src/browser-tiktok.ts';

const {values:args}=parseArgs({options:{
  login:{type:'boolean'},watch:{type:'boolean'},once:{type:'boolean'},status:{type:'boolean'},
  'run-now':{type:'boolean'},'publish-now':{type:'boolean'},'keep-metadata':{type:'boolean'},help:{type:'boolean'},
  'profile-id':{type:'string'},'prepared-file':{type:'string'},'prepared-info':{type:'string'},'prepared-sha':{type:'string'},
  'schedule-at':{type:'string'},source:{type:'string'},'pack-defaults':{type:'string'},folder:{type:'string'},at:{type:'string'},'every-minutes':{type:'string'}
},strict:true});
if(args.help){
  console.log(`TikTok pelo navegador — experimental, com revisão final\n\n  npm run tiktok:login                     Login manual no Chrome, sem Playwright\n  npm run tiktok:browser -- --once           Selecionar próximo MP4 e enviar agora\n  npm run tiktok:browser -- --watch --run-now Monitorar agora e depois às 08:00/20:00\n  npm run tiktok:browser -- --watch --every-minutes 120\n  npm run tiktok:browser -- --status         Histórico local dos uploads\n\nOpções: --folder caminho (padrão: media/), --at 08:00,20:00, --keep-metadata\nNo login, prefira o QR code do TikTok e feche as janelas desse perfil ao terminar.\nNo upload, confira conta, legenda, rótulos e publique manualmente.\nNo modo padrão, a publicação depende da sua revisão. Uma publicação imediata automática exige mídia previamente preparada e autorização específica.`);
  process.exit(0);
}
if([args.login,args.watch,args.once,args.status].filter(Boolean).length>1)throw new Error('Escolha somente --login, --watch, --once ou --status.');
if(args['schedule-at']&&(!args.once||!/^\d{4}-\d{2}-\d{2}T/.test(args['schedule-at'])||!Number.isFinite(Date.parse(args['schedule-at']))))throw new Error('Use --schedule-at com uma data ISO válida e --once.');
if(args['publish-now']&&(!args.once||!args['prepared-file']||args['schedule-at']))throw new Error('Publicação imediata exige --once, mídia previamente revisada e ausência de agendamento.');
if(args.source&&!['local','gta6_pack'].includes(args.source))throw new Error('Origem de vídeos inválida.');
const packDefaults=args['pack-defaults']?JSON.parse(args['pack-defaults']):{};
if(args.at&&args['every-minutes'])throw new Error('Escolha horários diários ou intervalo.');
const configuration=watchSchema.parse({name:'TikTok navegador',sourceType:'local',
  cadence:args['every-minutes']?'interval':'daily',intervalMinutes:Number(args['every-minutes']||720),
  times:(args.at||'08:00,20:00').split(',').map(v=>v.trim()),timezone:'America/Sao_Paulo'});
const cadence={cadence:configuration.cadence,interval_minutes:configuration.intervalMinutes,times:configuration.times,timezone:configuration.timezone};
const privateDirectory=browserProfileDirectory(args['profile-id']),profile=join(privateDirectory,'profile');
const journal=new BrowserJournal(join(privateDirectory,'jobs'));
const folder=resolve(args.folder||'media'),work=join(privateDirectory,'work');
for(const directory of [privateDirectory,profile,folder,work]){await mkdir(directory,{recursive:true,mode:0o700});}
await chmod(privateDirectory,0o700);
await journal.init();
if(args.status){for(const job of await journal.list())console.log(JSON.stringify(browserJobLabel(job)));process.exit(0);}
// Prevent two commands from selecting the same profile and racing file claims.
const lockPath=join(privateDirectory,'agent.lock');
let lock;
try{lock=await open(lockPath,'wx',0o600);}catch(error){
  if(error.code!=='EEXIST')throw error;
  const pid=Number(await readFile(lockPath,'utf8'));
  if(!Number.isSafeInteger(pid)||pid<1)throw new Error('Lock inválido. Confira .browser-data/tiktok/agent.lock manualmente.');
  try{process.kill(pid,0);throw new Error('Já existe uma rotina TikTok pelo navegador em execução.');}
  catch(error){if(error.code!=='ESRCH')throw error;}
  await rm(lockPath);lock=await open(lockPath,'wx',0o600);
}
await lock.writeFile(String(process.pid));
let context,stopped=false;
const abort=new AbortController();
const stop=()=>{stopped=true;abort.abort();void context?.close().catch(()=>{});};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
async function browser(){
  const current=await chromium.launchPersistentContext(profile,{
    ...sharedProfileOptions,
    executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:false,slowMo:args['publish-now']?100:0,
    viewport:{width:1360,height:900},timezoneId:'America/Sao_Paulo',acceptDownloads:false,chromiumSandbox:true
  });
  context=current;
  if(stopped){await current.close();throw new Error('Rotina interrompida.');}
  return current;
}
async function waitForClose(current){
  if(current.browser()?.isConnected()===false)return;
  await new Promise(resolve=>current.once('close',resolve));
}
async function attempt(){
  logger.info({event:'browser_preparing_source'},'Consultando a origem e preparando o próximo vídeo.');
  let candidate;
  try {if(args['prepared-file']) {
    const path=await realpath(args['prepared-file']),root=await realpath(work),rel=relative(root,path);
    if(rel.startsWith('..')||isAbsolute(rel)||await sha256(path)!==args['prepared-sha'])throw new Error('Cópia preparada inválida.');
    const info=JSON.parse(args['prepared-info']||'{}');
    if(!/^[a-f0-9]{64}$/.test(info.hash))throw new Error('Hash da origem inválido.');
    const metadata=metadataSchema.parse(info.metadata);
    if(await journal.get(info.hash)){logger.info({event:'browser_duplicate'},'Conteúdo já registrado neste perfil.');return true;}
    candidate={...info,metadata,caption:tiktokCaption(metadata),path,directory:dirname(path)};
  } else candidate=args.source==='gta6_pack'?await nextPackVideo(work,journal,packDefaults,!args['keep-metadata']):await nextBrowserVideo(folder,work,journal,!args['keep-metadata']);}
  catch {logger.warn({event:'browser_source_failed'},'Não foi possível preparar o vídeo da origem. Confira acesso, download e formato.');process.exitCode=1;return true;}
  if(!candidate){logger.info({event:'browser_no_video',folder},'Nenhum MP4 novo e estável. Salve seus vídeos na pasta media/; arquivos de teste em artifacts/ não entram na fila.');return false;}
  if(stopped){await rm(candidate.directory,{recursive:true,force:true});return false;}
  let job,started=false,current;
  try{
    if((args['schedule-at']||args['publish-now'])&&candidate.metadata.tiktok.privacyLevel!=='PUBLIC_TO_EVERYONE')throw new BrowserActionRequired('page_changed','Este vídeo precisa de privacidade pública explícita antes da publicação.');
    if(args['schedule-at']&&(candidate.metadata.tiktok.commercialContent||candidate.metadata.tiktok.ownBrand))throw new BrowserActionRequired('page_changed','Este agendamento exige revisão das declarações comerciais no Chrome.');
    current=await browser();
    const page=current.pages()[0]||await current.newPage();
    await page.goto(TIKTOK_UPLOAD_URL,{waitUntil:'domcontentloaded',timeout:60_000});
    await prepareTikTokUpload(page,candidate.path,candidate.caption,{
      knownDraftCaptions:(await journal.list()).flatMap(job=>typeof job.caption==='string'&&job.caption.length<=2200?[job.caption]:[]),
      onBeforeUpload:async()=>{
        if(stopped)throw new Error('Rotina interrompida antes do upload.');
        job=await journal.claim(candidate.hash,candidate.name,candidate.metadata.tiktok.madeWithAI,candidate.sourceId,candidate.caption);
        if(!job)throw new Error('Este conteúdo já está no histórico. Confira antes de repetir.');
      },onUploadStarted:()=>{started=true;logger.info({event:'browser_upload_started',file:candidate.name,hash:candidate.hash},'Arquivo selecionado no TikTok Studio.');}
    });
    if(args['publish-now']) {
      await publishTikTokUpload(page,candidate.metadata);
      await journal.update(job,'published');
      logger.info({event:'browser_published',file:candidate.name,hash:candidate.hash},'Publicação confirmada pelo TikTok Studio.');
      await page.waitForTimeout(1500);
      await current.close();return true;
    }
    if(args['schedule-at']) {
      const result=await scheduleTikTokUpload(page,new Date(args['schedule-at']),candidate.metadata);
      await journal.update(job,'scheduled',result.publishAt);
      logger.info({event:'browser_scheduled',file:candidate.name,hash:candidate.hash},'Agendamento confirmado pelo TikTok Studio.');
      await page.waitForTimeout(1500);
      await current.close();return true;
    }
    await journal.update(job,'review');
    logger.info({event:'browser_review_required',file:candidate.name,hash:candidate.hash,madeWithAI:candidate.metadata.tiktok.madeWithAI},
      'Upload preparado. Confira conta, prévia, legenda, privacidade e indicação de IA. Clique em Publicar no navegador se estiver correto e depois feche a janela.');
    await waitForClose(current);
    return true;
  }catch(error){
    if(job){if(started)await journal.update(job,'unknown');else await journal.releaseBeforeUpload(job.hash);}
    if(started&&current) {
      const page=current.pages()[0];
      if(page) {
        await page.screenshot({path:join(privateDirectory,'last-upload-error.png')}).catch(()=>{});
        const text=await page.locator('body').innerText().catch(()=>'');
        const inputs=await page.locator('input[readonly]').evaluateAll(es=>es.map(e=>({value:e.value,type:e.type}))).catch(()=>[]);
        await writeFile(join(privateDirectory,'last-upload-error.json'),JSON.stringify({at:new Date().toISOString(),reason:error.message,text:text.slice(0,20000),inputs},null,2),{mode:0o600}).catch(()=>{});
      }
    }
    logger.warn({event:error instanceof BrowserActionRequired?error.code:'browser_attempt_failed',file:candidate.name,uploadMayHaveStarted:started},
      error instanceof BrowserActionRequired?error.message:'A preparação não foi confirmada. Confira o navegador e o histórico antes de tentar novamente.');
    if(current){logger.info({event:'browser_manual_action'},'A janela permanece aberta para sua conferência. Feche-a após resolver a pendência.');await waitForClose(current);}
    return true;
  }finally{
    await current?.close().catch(()=>{});context=undefined;
    await rm(candidate.directory,{recursive:true,force:true});
  }
}
try{
  // No automatic recovery/retry after a crash during a file transfer.
  for(const job of await journal.list())if(job.status==='preparing')await journal.update(job,'unknown');
  if(args.login){
    await manualBrowserLogin(profile,{signal:abort.signal,onOpen:()=>{
      logger.info({event:'browser_manual_login'},'Chrome aberto sem controle do Playwright. Faça login manualmente no TikTok; prefira o QR code. Confira a conta e feche todas as janelas desse perfil. A sessão será preservada localmente para o upload.');
    }});
  }else if(!args.watch){await attempt();}
  else{
    let due=args['run-now']?new Date():nextRun(cadence,new Date());
    logger.info({event:'browser_watching',folder,nextAt:due.toISOString(),timezone:cadence.timezone,cadence:cadence.cadence},'Rotina experimental ativa. Uma transferência por oportunidade, com revisão final no navegador.');
    let emptyLogged=false;
    while(!stopped){
      if(Date.now()>=due.getTime()){
        if(await attempt()){due=nextRun(cadence,new Date());emptyLogged=false;logger.info({event:'browser_next_run',nextAt:due.toISOString()},'Próxima oportunidade calculada.');}
        // Slow down empty scans, including the initial run-now. No browser opens until a video exists.
        else{emptyLogged=true;}
      }
      await delay(emptyLogged?30_000:1000,undefined,{signal:abort.signal}).catch(error=>{if(error.name!=='AbortError')throw error;});
    }
  }
}catch(error){if(!stopped){logger.error({event:'browser_agent_failed',reason:error instanceof BrowserActionRequired?error.code:'local_error'},'Não foi possível executar a rotina. Confira Node 22+, Google Chrome, FFmpeg, sessão gráfica, permissões e o perfil do navegador.');process.exitCode=1;}}
finally{await context?.close().catch(()=>{});await lock.close();await rm(lockPath,{force:true});}
