let dialog,pending=false,stylesReady;

function getDialog(){
  if(dialog)return dialog;
  const stylesheet=document.createElement('link');
  stylesheet.rel='stylesheet';stylesheet.href=new URL('./cuts-list.css',import.meta.url).href;
  stylesReady=new Promise(resolve=>{stylesheet.addEventListener('load',resolve,{once:true});stylesheet.addEventListener('error',resolve,{once:true});});
  document.head.append(stylesheet);
  dialog=document.createElement('dialog');
  dialog.id='confirm-discard-dialog';dialog.className='confirm-discard-dialog';
  dialog.setAttribute('role','alertdialog');
  dialog.setAttribute('aria-labelledby','confirm-discard-title');
  dialog.setAttribute('aria-describedby','confirm-discard-name confirm-discard-message');
  dialog.innerHTML='<div class="confirm-discard-content"><h2 id="confirm-discard-title"></h2><p id="confirm-discard-name"></p><p id="confirm-discard-message"></p><div class="dialog-footer"><button class="button" type="button" data-confirm-cancel>Cancelar</button><button class="button danger" type="button" data-confirm-submit></button></div></div>';
  document.body.append(dialog);return dialog;
}

/** Resolve only after an explicit choice; submit stays visible and locked in flight. */
export async function confirmDiscard({kind,name,onConfirm,confirmLabel}){
  if(pending)return false;
  pending=true;
  const previousFocus=document.activeElement,modal=getDialog(),project=kind==='project',cancel=modal.querySelector('[data-confirm-cancel]'),submit=modal.querySelector('[data-confirm-submit]');
  await stylesReady;
  const label=confirmLabel||(project?'Descartar projeto':'Descartar corte');
  modal.querySelector('#confirm-discard-title').textContent=label+'?';
  modal.querySelector('#confirm-discard-name').textContent=name||(project?'Vídeo do YouTube':'Corte sugerido');
  modal.querySelector('#confirm-discard-message').textContent=project?'O projeto sairá da lista e suas cópias locais de vídeo serão removidas. O histórico de auditoria e as publicações já existentes serão preservados.':'As cópias locais deste corte serão removidas. Se for o último corte do projeto, o vídeo original também será removido. O histórico de auditoria e as publicações já existentes serão preservados.';
  cancel.disabled=false;submit.disabled=false;submit.textContent=label;modal.removeAttribute('aria-busy');
  return new Promise((resolve,reject)=>{
    let busy=false,settled=false;
    const cleanup=()=>{pending=false;modal.removeEventListener('cancel',onCancel);modal.removeEventListener('close',onClose);cancel.removeEventListener('click',onCancelClick);submit.removeEventListener('click',onSubmit);};
    const finish=(value,error)=>{if(settled)return;settled=true;cleanup();if(error)reject(error);else resolve(value);requestAnimationFrame(()=>{if(previousFocus?.isConnected&&!previousFocus.disabled)previousFocus.focus();});};
    const onClose=()=>finish(false);
    const onCancel=event=>{event.preventDefault();if(!busy)modal.close('cancelled');};
    const onCancelClick=()=>{if(!busy)modal.close('cancelled');};
    const onSubmit=async()=>{
      if(busy)return;busy=true;cancel.disabled=true;submit.disabled=true;submit.textContent=confirmLabel?'Excluindo…':'Descartando…';modal.setAttribute('aria-busy','true');
      try{await onConfirm();finish(true);modal.close('confirmed');}
      catch(error){finish(false,error);modal.close('failed');}
    };
    modal.addEventListener('cancel',onCancel);modal.addEventListener('close',onClose);cancel.addEventListener('click',onCancelClick);submit.addEventListener('click',onSubmit);
    try{modal.showModal();cancel.focus();}catch(error){finish(false,error);}
  });
}
