import {mountWorkspaceModal} from './build/workspace-view.js';

let pending=false,stylesReady;

function loadStyles(){
  if(stylesReady)return stylesReady;
  const existing=document.querySelector('link[data-cuts-styles]');
  const stylesheet=existing||document.createElement('link');
  if(!existing){
    stylesheet.rel='stylesheet';
    stylesheet.href=new URL('./cuts-list.css',import.meta.url).href;
  }
  stylesReady=stylesheet.sheet?Promise.resolve():new Promise(resolve=>{
    stylesheet.addEventListener('load',resolve,{once:true});
    stylesheet.addEventListener('error',resolve,{once:true});
  });
  if(!existing)document.head.append(stylesheet);
  return stylesReady;
}

/** Resolve only after an explicit choice; submit stays visible and locked in flight. */
export async function confirmDiscard(options){
  if(pending)return false;
  pending=true;
  const previousFocus=document.activeElement;
  await loadStyles();
  return new Promise((resolve,reject)=>{
    let modal;
    const finish=(confirmed,error)=>{
      modal?.destroy();
      pending=false;
      if(error)reject(error);else resolve(confirmed);
      requestAnimationFrame(()=>{
        if(previousFocus?.isConnected&&!previousFocus.disabled)previousFocus.focus();
      });
    };
    try{
      modal=mountWorkspaceModal('discardConfirmation',{...options,onFinish:finish});
      modal.dialog.showModal();
      modal.dialog.querySelector('[data-confirm-cancel]').focus();
    }catch(error){finish(false,error);}
  });
}
