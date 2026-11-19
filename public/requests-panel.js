import {mountRequestsView,requestViews as views} from './build/requests-view.js';
import {readCommaSeparated,readEditorialOptions} from './build/editorial-view.js';
import {nativeScheduleModel,readNativeSchedule} from './native-schedule.js';
import {paginationView,resetPagination} from './pagination.js';

let editing=null,view='orders',mounted=null;
let apiClient;
const editorialApi=(path,body)=>apiClient(path,body);
const clearedForms=new Set();
const schedule=nativeScheduleModel({},'request');

export function renderRequests(state) {
  return state.publishing?'<div id="requests-panel"></div>':'<p>Reinicie o serviço para carregar os pedidos.</p>';
}

export function updateRequests(state,{date}) {
  const root=document.querySelector('#requests-panel');if(!root)return;
  if(!state.publishing){destroyRequests();root.outerHTML=renderRequests(state);return;}
  const profileForm=root.querySelector('#publishing-profile-form');
  if(profileForm&&profileForm.dataset.profileId!==(editing||''))clearedForms.add('publishing-profile-form');
  const pagination={requests:paginationView(state.publishing.pagination?.requests,'requests'),actions:paginationView(state.publishing.pagination?.actions,'actions')};
  const next={state,editing,view,pagination,schedule,date,api:editorialApi};
  if(mounted?.root!==root){destroyRequests();mounted={root,...mountRequestsView(root,next)};syncProfileSource();}
  else void mounted.update(next,[...clearedForms]).then(syncProfileSource);
  clearedForms.clear();
}

export function destroyRequests(){mounted?.destroy();mounted=null;}

function selectView(next) {
  if(!views.some(([id])=>id===next))return;
  view=next;mounted?.selectView(next);
}

function syncProfileSource() {
  const source=document.querySelector('#profile-source');if(!source)return;
  for(const field of document.querySelectorAll('[data-profile-source]'))field.hidden=field.dataset.profileSource!==source.value;
}

export function bindRequests({api,refresh,toast}) {
  apiClient=api;
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-requests-view]');if(!button)return;
    selectView(button.dataset.requestsView);
    if(button.getAttribute('role')!=='tab')document.querySelector('#requests-tab-'+view)?.focus();
  });
  document.addEventListener('keydown',event=>{
    const tab=event.target.closest('#requests-panel [role=tab]');if(!tab)return;
    const index=views.findIndex(([id])=>id===view);let next;
    if(event.key==='ArrowRight')next=(index+1)%views.length;
    else if(event.key==='ArrowLeft')next=(index+views.length-1)%views.length;
    else if(event.key==='Home')next=0;
    else if(event.key==='End')next=views.length-1;
    else return;
    event.preventDefault();selectView(views[next][0]);document.querySelector('#requests-tab-'+view).focus();
  });
  document.addEventListener('change',event=>{if(event.target.id==='profile-source')syncProfileSource();});
  document.addEventListener('invalid',event=>{
    if(!event.target.closest('#requests-panel'))return;
    for(let parent=event.target.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
  },true);
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-request-action]');if(!button)return;button.disabled=true;
    try {
      const {requestAction:action,id,resolution}=button.dataset;
      if(action==='edit-profile'||action==='new-profile'){
        editing=action==='edit-profile'?id:null;clearedForms.add('publishing-profile-form');view='profiles';await refresh(true);
        const editor=document.querySelector('#profile-editor');if(editor){editor.open=true;editor.scrollIntoView({block:'nearest',behavior:'smooth'});document.querySelector('#profile-name')?.focus({preventScroll:true});}return;
      }
      if(action==='approval')await api('/accounts/update',{provider:'youtube',id:id.slice('native:youtube:'.length),label:button.dataset.name,autoPublishApproved:button.dataset.approved==='true'});
      else if(action==='login')await api('/browser/profiles/'+id+'/login',{});
      else if(action==='resolve')await api('/assistant/actions/'+id+'/resolve',{confirm:true,resolution});
      else await api('/assistant/requests/'+id+'/'+action,{});
      await refresh(true);toast(action==='login'?'Login aberto no Chrome. Confira a conta e feche a janela ao terminar.':'Pedido atualizado.');
    }catch(error){toast(error.message,true);}finally{button.disabled=false;}
  });
  document.addEventListener('submit',async event=>{
    const form=event.target;if(!['publishing-profile-form','browser-profile-form','publication-request-form'].includes(form.id))return;event.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;
    try {
      const f=new FormData(form);
      if(form.id==='browser-profile-form')await api('/browser/profiles',{name:f.get('name')});
      else if(form.id==='publishing-profile-form') {
        const name=String(f.get('name')),source=f.get('sourceType')||form.querySelector('[name=sourceType]').value;
        await api('/assistant/profiles'+(editing?'/'+editing:''),{name,sourceType:source||null,folderUrls:String(f.get('folderUrls')||'').split(/\n/).map(v=>v.trim()).filter(Boolean),localPath:f.get('localPath')||'',youtubeId:f.get('youtubeId')||null,tiktokProfileId:f.get('tiktokProfileId')||null,
          packDefaults:{titlePrefix:f.get('titlePrefix')||name,description:f.get('description')||'',hashtags:readCommaSeparated(f.get('hashtags')),madeWithAI:f.has('madeWithAI'),youtubeContainsSyntheticMedia:f.has('youtubeSynthetic'),madeForKids:f.has('madeForKids'),youtubeVisibility:'public',editorial:readEditorialOptions(f)}},editing?'PUT':'POST');editing=null;
      }else {
        if(!f.getAll('platforms').length)throw new Error('Selecione pelo menos uma plataforma.');
        const body={profileId:f.get('profileId'),quantity:Number(f.get('quantity')),platforms:f.getAll('platforms'),times:String(f.get('times')).split(',').map(t=>t.trim()).filter(Boolean),timezone:'America/Sao_Paulo',policy:readNativeSchedule(form)};
        const serialized=JSON.stringify(body);let saved;try{saved=JSON.parse(sessionStorage.getItem('watcher-request-submit'));}catch{}
        const requestKey=saved?.body===serialized?saved.key:crypto.randomUUID();sessionStorage.setItem('watcher-request-submit',JSON.stringify({key:requestKey,body:serialized}));
        await api('/assistant/requests',{...body,requestKey});resetPagination('requests');sessionStorage.removeItem('watcher-request-submit');
      }
      clearedForms.add(form.id);
      await refresh(true);toast('Configuração salva. A fila verifica as conexões e os limites automaticamente.');
    }catch(error){toast(error.message,true);}finally{button.disabled=false;}
  });
}
