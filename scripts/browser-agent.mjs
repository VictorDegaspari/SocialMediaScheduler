import { spawn } from 'node:child_process';
import { mkdir, chmod, open, readFile, rm, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { appUrl, localMediaDir, logger } from '../src/config.ts';
import {createWriteStream} from 'node:fs';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {sha256} from '../src/media.ts';
import {metadataSchema} from '../src/domain.ts';
import {browserProfileDirectory} from '../src/browser-profiles.ts';
import { packDefaultsSchema } from '../src/pack-config.ts';
import { LocalFiles } from '../src/local.ts';
import { browserProgress, browserProfileBusy, browserProfileSaved, browserFailureStages } from '../src/browser-agent-core.ts';
import {loadPlaywrightMcpEnvironment} from './playwright-mcp.mjs';

const token=process.env.BROWSER_AGENT_TOKEN||'';
if(!/^[a-f0-9]{64}$/.test(token))throw new Error('Execute scripts/start.sh para configurar o agente local.');
const endpoint=new URL(appUrl);
if(!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)||!['http:','https:'].includes(endpoint.protocol))throw new Error('Este agente só se conecta ao painel neste computador.');
const directory=resolve('.browser-data/tiktok'),lockPath=join(directory,'bridge.lock');
await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
let lock;
try{lock=await open(lockPath,'wx',0o600);}catch(error){
  if(error.code!=='EEXIST')throw error;
  const pid=Number((await readFile(lockPath,'utf8')).trim());
  if(!Number.isSafeInteger(pid)||pid<1)throw new Error('Confira a trava do agente local.');
  try{process.kill(pid,0);throw new Error('O agente local já está em execução.');}catch(error){if(error.code!=='ESRCH')throw error;}
  await rm(lockPath);lock=await open(lockPath,'wx',0o600);
}
await lock.writeFile(String(process.pid));
const instanceId=randomUUID(),abort=new AbortController();
const jobSchema=z.object({id:z.string().uuid(),kind:z.enum(['login','upload']),folder:z.string().min(1).max(4096),stripMetadata:z.boolean(),profileId:z.union([z.literal('default'),z.string().uuid()]).optional(),media:z.object({metadata:metadataSchema,assetSha256:z.string().regex(/^[a-f0-9]{64}$/),hash:z.string().regex(/^[a-f0-9]{64}$/),name:z.string().max(500),sourceId:z.string().max(1000)}).strict().optional(),sourceType:z.enum(['local','gta6_pack']).optional(),packDefaults:packDefaultsSchema.optional(),publishAt:z.iso.datetime({offset:true}).optional(),publishNow:z.literal(true).optional()}).strict();
let active,stopped=false,lastSeen=Date.now(),connected=false,lastWarning=0;
async function request(path,body){
  const response=await fetch(appUrl+'/api/browser-agent'+path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
    headers:{'Content-Type':'application/json','X-Watcher-Request':'1',Authorization:'Bearer '+token},body:JSON.stringify({...body,instanceId})});
  if(!response.ok)throw new Error('bridge_'+response.status);
  return response.json();
}
function interrupt(){
  if(!active||active.cancelled)return;
  const task=active;
  task.cancelled=true;
  if(!task.child)return;
  task.child.kill('SIGINT');
  task.killTimer=setTimeout(()=>task.child.kill('SIGKILL'),8000);
  task.killTimer.unref();
}
function stop(){stopped=true;abort.abort();interrupt();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
async function execute(job){
  const task={id:job.id,child:null,started:false,published:false,scheduled:false,duplicate:false,review:false,empty:false,opened:false,failed:false,cancelled:false,progress:Promise.resolve(),done:null};
  active=task;
  try{
    const extension=await loadPlaywrightMcpEnvironment({appUrl,agentToken:token});
    if(job.kind==='upload'&&!job.media&&job.sourceType!=='gta6_pack')await new LocalFiles(localMediaDir,localMediaDir).folder(job.folder);
    if(stopped||task.cancelled){await request('/jobs/'+job.id+'/finish',{result:'cancelled'});return;}
    let prepared;
    if(job.media){const work=join(browserProfileDirectory(job.profileId),'work');await mkdir(work,{recursive:true,mode:0o700});prepared=await mkdtemp(join(work,'prepared-'));task.prepared=prepared;const path=join(prepared,'video.mp4');
      const response=await fetch(appUrl+'/api/browser-agent/jobs/'+job.id+'/media',{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(15*60_000)});if(!response.ok)throw new Error('media_unavailable');let bytes=0;
      await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,_encoding,done){bytes+=chunk.length;done(bytes>1024*1024*1024?new Error('media_limit'):null,chunk);}}),createWriteStream(path,{mode:0o600}));if(await sha256(path)!==job.media.assetSha256)throw new Error('media_changed');
    }
    const args=job.kind==='login'?['--login']:['--once','--folder',job.folder,...(job.stripMetadata?[]:['--keep-metadata']),...(job.publishAt?['--schedule-at',job.publishAt]:[]),...(job.publishNow?['--publish-now']:[]),...(job.sourceType==='gta6_pack'?['--source','gta6_pack','--pack-defaults',JSON.stringify(job.packDefaults||{})]:[])];
    if(job.profileId)args.push('--profile-id',job.profileId);
    if(prepared)args.push('--prepared-file',join(prepared,'video.mp4'),'--prepared-sha',job.media.assetSha256,'--prepared-info',JSON.stringify(job.media));
    const child=spawn(process.execPath,['--import',import.meta.resolve('tsx'),resolve('scripts/tiktok-browser.mjs'),...args],
      {cwd:process.cwd(),env:{...process.env,...extension,LOG_LEVEL:'info'},stdio:['ignore','pipe','ignore'],shell:false});
    task.child=child;
    let buffer='';
    child.stdout.on('data',chunk=>{
      buffer+=chunk.toString();if(buffer.length>131072){buffer='';return;}
      let index;
      while((index=buffer.indexOf('\n'))>=0){
        const progress=browserProgress(buffer.slice(0,index));buffer=buffer.slice(index+1);
        if(!progress)continue;
        if(progress.stage==='browser_upload_started'||progress.uploadStarted)task.started=true;
        if(progress.stage==='browser_duplicate')task.duplicate=true;
        if(progress.stage==='browser_scheduled')task.scheduled=true;
        if(progress.stage==='browser_published')task.published=true;
        if(progress.stage==='browser_review_required')task.review=true;
        if(progress.stage==='browser_no_video')task.empty=true;
        if(progress.stage==='browser_manual_login')task.opened=true;
        if(browserFailureStages.has(progress.stage))task.failed=true;
        if(progress.stage==='browser_manual_action'&&task.failed)continue;
        const update={...progress,uploadStarted:task.started};
        task.progress=task.progress.then(()=>request('/jobs/'+job.id+'/progress',update)).catch(()=>{});
      }
    });
    const code=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',done);});
    await task.progress;
    const result=task.published?'published':task.scheduled?'scheduled':task.duplicate?'duplicate':task.cancelled?(task.started?'unknown':'cancelled'):code!==0||task.failed?(task.started?'unknown':'failed'):
      job.kind==='login'?(task.opened?'done':'failed'):task.review?'review':task.empty?'empty':task.started?'unknown':'failed';
    if(result==='failed'&&!task.failed)await request('/jobs/'+job.id+'/progress',{stage:'browser_agent_failed'}).catch(()=>{});
    for(let attempt=0;attempt<3;attempt++){
      try{await request('/jobs/'+job.id+'/finish',{result});break;}catch{if(attempt<2)await delay(1000);}
    }
  }catch{
    await request('/jobs/'+job.id+'/progress',{stage:'browser_agent_failed',uploadStarted:task.started}).catch(()=>{});
    await request('/jobs/'+job.id+'/finish',{result:task.started?'unknown':'failed'}).catch(()=>{});
  }finally{if(task.prepared)await rm(task.prepared,{recursive:true,force:true});clearTimeout(task.killTimer);if(active===task)active=undefined;}
}
try{
  while(!stopped){
    try{
      const profileRows=await request('/profiles',{});const profiles={};for(const row of profileRows){const path=browserProfileDirectory(row.id);profiles[row.id]={profileSaved:await browserProfileSaved(path),externalBusy:!active&&await browserProfileBusy(path)};}
      const response=await request('/poll',{profiles,profileSaved:await browserProfileSaved(directory),externalBusy:!active&&await browserProfileBusy(directory),
        desktop:!!(process.env.DISPLAY||process.env.WAYLAND_DISPLAY),activeJobId:active?.id||null});
      lastSeen=Date.now();
      if(!connected){logger.info({event:'browser_bridge_connected'},'Agente do Chrome conectado ao painel local.');connected=true;}
      if(response.cancel)interrupt();
      if(response.job&&!active){
        const parsed=jobSchema.safeParse(response.job);
        if(!parsed.success){
          // The command has already been leased. Report rejection before any
          // upload instead of leaving it to expire as a misleading disconnect.
          const id=z.string().uuid().safeParse(response.job.id);
          if(id.success){
            await request('/jobs/'+id.data+'/progress',{stage:'browser_job_invalid'}).catch(()=>{});
            await request('/jobs/'+id.data+'/finish',{result:'failed'}).catch(()=>{});
          }
          logger.warn({event:'browser_job_invalid'},'Tarefa incompatível com o agente local. Atualize e reinicie o agente antes de tentar novamente.');
        }else{
          const job=parsed.data;
          if(stopped)await request('/jobs/'+job.id+'/finish',{result:'cancelled'});
          else{const running=execute(job);active.done=running;}
        }
      }
    }catch{
      connected=false;
      if(active&&Date.now()-lastSeen>12_000)interrupt();
      if(Date.now()-lastWarning>30_000){logger.warn({event:'browser_bridge_unavailable'},'Painel indisponível ou agente não autorizado. Nenhum novo upload será iniciado.');lastWarning=Date.now();}
    }
    await delay(2000,undefined,{signal:abort.signal}).catch(error=>{if(error.name!=='AbortError')throw error;});
  }
}finally{
  interrupt();if(active?.done)await active.done;
  await lock.close();await rm(lockPath,{force:true});
}
