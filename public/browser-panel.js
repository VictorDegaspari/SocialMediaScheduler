import {readPackDefaults} from './pack-source.js';
import {readNativeSchedule} from './native-schedule.js';
import {resetPagination} from './pagination.js';

export function bindBrowserPanel({api,refresh,toast}){
  function body(form){
    const f=new FormData(form);
    return {sourceType:f.get('sourceType'),packDefaults:readPackDefaults(form),mode:f.get('mode'),nativeSchedule:readNativeSchedule(form),folder:f.get('folder'),cadence:f.get('cadence'),intervalMinutes:Number(f.get('intervalMinutes')),
      times:String(f.get('times')).split(',').map(v=>v.trim()).filter(Boolean),stripMetadata:f.has('stripMetadata'),enabled:f.has('enabled')};
  }
  document.addEventListener('change',event=>{
    if(event.target.id==='browser-source'){const pack=event.target.value==='gta6_pack';document.querySelector('#browser-pack-fields').hidden=!pack;document.querySelector('#browser-local-folder').hidden=pack;}
    if(event.target.id==='browser-mode')document.querySelector('#browser-native-fields').hidden=event.target.value!=='native_schedule';
    if(event.target.id!=='browser-cadence')return;
    document.querySelector('#browser-daily').hidden=event.target.value!=='daily';
    document.querySelector('#browser-interval').hidden=event.target.value!=='interval';
  });
  document.addEventListener('submit',async event=>{
    if(event.target.id!=='browser-config-form')return;
    event.preventDefault();const button=event.target.querySelector('[type="submit"]');button.disabled=true;
    try{await api('/browser/config',body(event.target));await refresh(true);toast('Pasta e horários do navegador salvos.');}
    catch(error){toast(error.message,true);}finally{button.disabled=false;}
  });
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-browser-action]');if(!button)return;
    button.disabled=true;
    try{
      const action=button.dataset.browserAction;
      if(action==='refresh')await refresh(true);
      else if(action==='resume'){await api('/scheduler',{paused:false});await refresh(true);}
      else if(action==='retry-job'||action==='cancel-job'){
        const result=await api('/browser/jobs/'+button.dataset.id+'/'+(action==='retry-job'?'retry':'cancel'),{});await refresh(true);
        toast(action==='retry-job'?'Nova tentativa solicitada para este vídeo.':result.status==='cancel_requested'?'Cancelamento solicitado. Aguardando o navegador encerrar.':'Vídeo cancelado. O arquivo original foi preservado.');
      }
      else{
        if(action==='run'){
          const form=document.querySelector('#browser-config-form');if(!form.reportValidity())return;
          await api('/browser/config',body(form));
        }
        await api('/browser/'+action,{});if(['login','run'].includes(action))resetPagination('browser');await refresh(true);
        toast({login:'Login solicitado. Confira o Chrome no seu computador.',run:'Envio solicitado. Acompanhe o andamento abaixo.',pause:'Novos envios automáticos pausados.',stop:'Interrupção solicitada. Confira o Chrome se o upload já começou.'}[action]);
      }
    }catch(error){toast(error.message,true);}finally{button.disabled=false;}
  });
}
