import { readFile, readlink, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

export const browserStages = new Set(['browser_duplicate','browser_source_failed','browser_preparing_source','browser_scheduled','browser_published','platform_limit','browser_manual_login','browser_upload_started','browser_review_required','browser_manual_action',
  'login_required','security_check','page_changed','upload_unconfirmed','browser_attempt_failed','browser_agent_failed','browser_job_invalid','browser_no_video']);
export const browserFailureStages = new Set(['browser_source_failed','platform_limit','login_required','security_check','page_changed','upload_unconfirmed','browser_attempt_failed','browser_agent_failed','browser_job_invalid']);
export function browserProgress(line:string){
  if(line.length>65536)return;
  try {
    const value=JSON.parse(line);
    if(!browserStages.has(value.event))return;
    return {stage:String(value.event),...(typeof value.file==='string'?{filename:basename(value.file).replace(/[\x00-\x1f\x7f]/g,'').slice(0,255)}:{}),
      ...(typeof value.uploadMayHaveStarted==='boolean'?{uploadStarted:value.uploadMayHaveStarted}:{}),
      ...(typeof value.hash==='string'&&/^[a-f0-9]{64}$/.test(value.hash)?{hash:value.hash}:{})};
  }catch{return;}
}
function live(pid:number){
  if(!Number.isSafeInteger(pid)||pid<1)return true;
  try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH';}
}
export async function browserProfileBusy(directory:string){
  try {if(live(Number((await readFile(join(directory,'agent.lock'),'utf8')).trim())))return true;}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')return true;}
  try {const target=await readlink(join(directory,'profile','SingletonLock'));return live(Number(target.match(/-(\d+)$/)?.[1]));}
  catch(error){return (error as NodeJS.ErrnoException).code!=='ENOENT';}
}
export async function browserProfileSaved(directory:string){
  for(const file of ['Default/Cookies','Default/Network/Cookies']){
    try{if((await stat(join(directory,'profile',file))).size>0)return true;}catch{}
  }
  return false;
}
