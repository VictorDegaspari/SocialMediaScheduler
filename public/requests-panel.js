import {readNativeSchedule} from './native-schedule.js';
import {resetPagination} from './pagination.js';
import {requestActions,requestList,requestForm,requestProfiles,requestAccounts} from './requests-view.js';

let editing=null,view='orders';
const clearedForms=new Set();
const views=[['orders','Pedidos'],['profiles','Perfis'],['accounts','Contas']];

export function renderRequests(state,helpers) {
  const p=state.publishing;if(!p)return '<p>Reinicie o serviço para carregar os pedidos.</p>';
  return `<div id="requests-panel"><div class="page-head requests-page-head"><div><h1>Pedidos e contas</h1><p class="subtitle">Agende seus vídeos e acompanhe os pedidos.</p></div></div>
    <div class="requests-tabs" role="tablist" aria-label="Pedidos e contas">${views.map(([id,label])=>`<button type="button" role="tab" id="requests-tab-${id}" aria-controls="requests-view-${id}" aria-selected="${view===id}" tabindex="${view===id?'0':'-1'}" data-requests-view="${id}">${label}${id==='profiles'?`<span class="requests-tab-count">${p.profiles.length}</span>`:''}</button>`).join('')}</div>
    <section id="requests-view-orders" role="tabpanel" aria-labelledby="requests-tab-orders" ${view!=='orders'?'hidden':''}><div class="requests-layout"><div class="requests-main">${requestActions(p,helpers)}${requestList(p,helpers)}</div>${requestForm(p,helpers,!!state.connections.playwrightMcp?.configured)}</div></section>
    <section id="requests-view-profiles" role="tabpanel" aria-labelledby="requests-tab-profiles" ${view!=='profiles'?'hidden':''}>${requestProfiles(state,editing,helpers)}</section>
    <section id="requests-view-accounts" role="tabpanel" aria-labelledby="requests-tab-accounts" ${view!=='accounts'?'hidden':''}>${requestAccounts(state,helpers)}</section></div>`;
}

// Polling also refreshes orders while forms and expanded details keep their state.
export function updateRequests(state,helpers) {
  const panel=document.querySelector('#requests-panel'),drafts=[];
  for(const form of panel.querySelectorAll('form')) {
    if(clearedForms.has(form.id))continue;
    if(form.id==='publishing-profile-form'&&form.dataset.profileId!==(editing||''))continue;
    drafts.push({id:form.id,fields:Array.from(form.elements).filter(e=>e.name).map(e=>({name:e.name,type:e.type,value:e.value,checked:e.checked}))});
  }
  const details=Array.from(panel.querySelectorAll('details')).map(e=>({id:e.id,open:e.open}));
  const keepProfile=drafts.some(f=>f.id==='publishing-profile-form');
  const active=document.activeElement,focusId=panel.contains(active)?active.id:null;
  panel.outerHTML=renderRequests(state,helpers);
  for(const draft of drafts) {
    const form=document.getElementById(draft.id);if(!form)continue;
    for(const field of draft.fields) {
      const input=Array.from(form.elements).find(e=>e.name===field.name&&(field.type!=='checkbox'||e.value===field.value));
      if(!input)continue;
      if(field.type==='checkbox')input.checked=field.checked;
      else if(input.tagName!=='SELECT'||Array.from(input.options).some(o=>o.value===field.value))input.value=field.value;
    }
  }
  for(const {id,open} of details) {
    if(['profile-editor','profile-defaults'].includes(id)&&!keepProfile)continue;
    const detail=document.getElementById(id);if(detail)detail.open=open;
  }
  clearedForms.clear();syncProfileSource();
  if(focusId)document.getElementById(focusId)?.focus({preventScroll:true});
}

function selectView(next) {
  if(!views.some(([id])=>id===next))return;
  view=next;
  for(const tab of document.querySelectorAll('#requests-panel [role=tab]')) {
    const selected=tab.dataset.requestsView===view;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;
  }
  for(const panel of document.querySelectorAll('#requests-panel [role=tabpanel]'))panel.hidden=panel.id!=='requests-view-'+view;
}

function syncProfileSource() {
  const source=document.querySelector('#profile-source');if(!source)return;
  for(const field of document.querySelectorAll('[data-profile-source]'))field.hidden=field.dataset.profileSource!==source.value;
}

export function bindRequests({api,refresh,toast}) {
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
          packDefaults:{titlePrefix:f.get('titlePrefix')||name,description:f.get('description')||'',hashtags:String(f.get('hashtags')||'').split(',').map(t=>t.trim()).filter(Boolean),madeWithAI:f.has('madeWithAI'),youtubeContainsSyntheticMedia:f.has('youtubeSynthetic'),madeForKids:f.has('madeForKids'),youtubeVisibility:'public'}},editing?'PUT':'POST');editing=null;
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
