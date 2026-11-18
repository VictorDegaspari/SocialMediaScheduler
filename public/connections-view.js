import {mountConnectionsView} from './build/connections-view.js';

let view=null;

export function renderConnections(){
  return '<div id="connections-panel"></div>';
}

export function updateConnections(state,channels,{icon}){
  const root=document.querySelector('#connections-panel');if(!root)return;
  if(view?.root!==root){
    destroyConnections();view={root,...mountConnectionsView(root,state,channels,icon)};
  }else view.update(state,channels,icon);
}

export function destroyConnections(){view?.destroy();view=null;}

export function bindConnections({api,refresh,toast}) {
  let savingMcp=false;
  async function saveMcp(form,remove=false){
    if(savingMcp)return;savingMcp=true;
    const button=form.querySelector(remove?'[data-playwright-remove]':'[type=submit]');button.disabled=true;
    try{
      await api('/settings/playwright-mcp',remove?{}:{extensionToken:form.elements.namedItem('extensionToken').value||undefined},remove?'DELETE':'POST');
      form.elements.namedItem('extensionToken').value='';await refresh(true);toast(remove?'Token salvo removido. Se houver um token no ambiente, ele será usado.':'Token da extensão salvo. Novas conexões MCP usarão este valor.');
    }catch(error){toast(error.message,true);}finally{savingMcp=false;button.disabled=false;}
  }
  document.addEventListener('submit',event=>{if(event.target.id!=='playwright-mcp-form')return;event.preventDefault();void saveMcp(event.target);});
  document.addEventListener('click',event=>{
    const remove=event.target.closest('[data-playwright-remove]');if(remove){void saveMcp(remove.closest('form'),true);return;}
    const button=event.target.closest('[data-connection-setup]');if(!button)return;
    const detail=document.getElementById(button.dataset.connectionSetup);if(!detail)return;
    detail.open=true;detail.scrollIntoView({block:'nearest',behavior:'smooth'});detail.querySelector('input')?.focus({preventScroll:true});
  });
  document.addEventListener('invalid',event=>{
    if(!event.target.closest('#connections-panel'))return;
    for(let parent=event.target.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
  },true);
}
