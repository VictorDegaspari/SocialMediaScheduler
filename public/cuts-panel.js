import {createCutEditor,cutFormats} from './cuts-editor.js';
import {replayTimeAt} from './cuts-replay.js';
import {confirmDiscard} from './confirm-dialog.js';
import {paginationView,resetPagination} from './pagination.js';
import {cutDestinationOptions,readTiktokFields} from './cut-publish.js';
import {mountCutEditorialView,readCommaSeparated} from './build/editorial-view.js';
import {clearWorkspace,drawWorkspace,mountWorkspaceModal} from './build/workspace-view.js';
const jobLabels={queued:'Na fila',downloading:'Baixando vídeo',transcribing:'Transcrevendo áudio',selecting:'Selecionando momentos',rendering:'Gerando prévias',review:'Pronto para revisar',failed:'Precisa de atenção',discarded:'Descartado',completed:'Concluído'};
let current={jobs:[],channels:[],dependencies:{ready:false,details:[]}},editing=null,services;
const jobSnapshots=new WeakMap();
const path=id=>'/cuts/'+encodeURIComponent(id);
function safeLink(value){try{const url=new URL(value);return url.protocol==='https:'?url.href:'#';}catch{return '#';}}
function remember(state){current=state.cuts||{jobs:[],channels:[],dependencies:{ready:false,details:['Reinicie o serviço para carregar o gerador de cortes.']}};}
function visibleJobs(){return (current.jobs||[]).filter(job=>job.status!=='discarded');}
function stableJobs(root,jobs){
  const previous=jobSnapshots.get(root);
  const cards=new Map([...root.querySelectorAll('[data-cut-job]')].map(node=>[node.dataset.cutJob,node]));
  const snapshots=new Map();
  for(const job of jobs){
    const card=cards.get(job.id);
    // Keep the version being reviewed or played until the user is done with it.
    const inUse=card&&(editing?.jobId===job.id||[...card.querySelectorAll('video')].some(video=>!video.paused));
    const prior=inUse&&previous?.get(job.id);
    snapshots.set(job.id,prior?{...prior,clips:prior.clips.map(clip=>{
      const next=job.clips.find(candidate=>candidate.id===clip.id&&candidate.revision===clip.revision);
      return next?{...clip,finalReady:next.finalReady,export_status:next.export_status,export_error:next.export_error}:clip;
    })}:job);
  }
  jobSnapshots.set(root,snapshots);
  return [...snapshots.values()];
}

export function updateCuts(root,state,h,view='projects'){
  remember(state);
  const pending=root.querySelector('#cuts-create-form [type="submit"]')?.dataset.busy;
  drawWorkspace(root,'cuts',{
    jobs:stableJobs(root,visibleJobs()),dependencies:current.dependencies,pagination:paginationView(current.pagination,'cuts'),
    date:h.date,safeLink,importFile,view,createDisabled:Boolean(pending)||!current.dependencies?.ready,
  });
}

async function importFile(file){
  const title=file.name.replace(/\.mp4$/i,'').trim().slice(0,100)||'Corte importado';
  const view=location.hash;
  const response=await fetch('/api/cuts/import?'+new URLSearchParams({title}),{
    method:'POST',headers:{'Content-Type':'video/mp4','X-Watcher-Request':'1'},body:file,
  });
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'Não foi possível importar o MP4.');
  resetPagination('cuts');resetPagination('cutFolders');
  const targetView=view==='#cuts/new'?'#cuts':view;
  if(location.hash===view&&targetView!==view)location.hash=targetView;
  const updated=await services.refresh(true);
  if(!updated||location.hash!==targetView||editing){
    services.toast('O corte está disponível no Gerador de cortes.');return;
  }
  const {clip}=findClip(result.clipId);
  if(['review','failed','posted','publishing'].includes(clip.status))await openEditor(clip.id);
  else services.toast('O corte está em processamento. Acompanhe a prévia no projeto.');
}

function findClip(id){for(const job of current.jobs||[]){const clip=(job.clips||[]).find(c=>c.id===id);if(clip)return {job,clip};}throw new Error('Este corte não está mais disponível. Atualize o painel.');}
async function openEditor(id,seek,format){
  const {clip,job}=findClip(id);destroyReview();
  document.querySelectorAll('#cuts-dialog-form video').forEach(video=>video.pause());
  if(job.hasSource===false){
    const session=editing={mode:'preparing',id,jobId:job.id,seek,format};
    const dialog=document.querySelector('#cuts-dialog'),form=document.querySelector('#cuts-dialog-form');
    document.querySelector('#cuts-dialog-title').textContent='Recuperar vídeo para ajustar';dialog.dataset.mode='edit';
    clearWorkspace(form);
    drawWorkspace(form,'cutSource',{id,sourceQuality:job.source_quality});
    if(!dialog.open)dialog.showModal();
    try{
      let source=await services.api('/cuts/jobs/'+encodeURIComponent(job.id)+'/prepare-source',{});
      while(editing===session&&dialog.open&&!source.ready){
        if(source.status==='failed')throw new Error(source.error||'Não foi possível recuperar o vídeo original. Tente novamente.');
        form.querySelector('#cut-source-preparation').textContent=(jobLabels[source.status]||'Recuperando vídeo original')+'… Você poderá ajustar assim que a fonte estiver pronta.';
        await new Promise(resolve=>setTimeout(resolve,1000));
        if(editing!==session||!dialog.open)return;
        source=await services.api('/cuts/jobs/'+encodeURIComponent(job.id)+'/source-status');
      }
      if(editing!==session||!dialog.open)return;
      job.hasSource=true;job.duration=source.duration;
    }catch(error){
      if(editing!==session||!dialog.open)return;
      const alert=form.querySelector('#cut-source-preparation-error');alert.textContent=error.message;alert.hidden=false;
      form.querySelector('#cut-source-preparation').textContent='A recuperação não terminou. O corte anterior foi preservado.';form.querySelector('#cut-source-prepare-retry').hidden=false;return;
    }
  }
  editing={mode:'edit',id,jobId:job.id,revision:clip.revision,versionId:crypto.randomUUID()};
  document.querySelector('#cuts-dialog-title').textContent='Editar corte';
  document.querySelector('#cuts-dialog').dataset.mode='edit';
  editing.editor=createCutEditor({clip:format?{...clip,framing_options:{...clip.framing_options,format}}:clip,job,api:services.api});
  if(!document.querySelector('#cuts-dialog').open)document.querySelector('#cuts-dialog').showModal();
  if(format)editing.editor.reveal('#cut-format');
  if(seek!==undefined){editing.editor.selectReplayStart(seek);editing.editor.reveal('.cuts-replay-details');}
}
function drawCutPublication(form,session,platform,clip){
  const selected=form.elements.namedItem('channelId')?.value;
  const destinations=cutDestinationOptions(clip,current.channels||[],platform);
  drawWorkspace(form,'cutPublish',{clip:session.clip,platform,cutFormats,destinations});
  form.elements.namedItem('channelId').value=destinations.some(option=>option.value===selected)?selected:'';
  session.canPublish=destinations.some(option=>!option.disabled);
}

function openPublish(id,platform='youtube'){
  const {clip,job}=findClip(id),format=clip.framing_options?.format||'shorts';
  destroyReview();
  const session=editing={mode:'publish',id,jobId:job.id,revision:clip.revision,format,clip};
  const dialog=document.querySelector('#cuts-dialog'),form=document.querySelector('#cuts-dialog-form');
  document.querySelector('#cuts-dialog-title').textContent='Postar corte';
  delete dialog.dataset.mode;
  clearWorkspace(form);
  drawCutPublication(form,session,platform,clip);
  session.editorial=mountCutEditorialView(form.querySelector('[data-cut-editorial]'),{
    clipId:id,title:clip.title,shorts:format==='shorts',suggestions:clip.publicationText,platform,api:services.api,
    canGenerate:()=>editing===session&&dialog.open&&!session.pending,
    onBusyChange(busy){session.generating=busy;publishFormat();},
    onInvalidateConsent(){form.elements.namedItem('confirm').checked=false;},
    onFeedback(message){feedback(form,message);},
    onError(message){services.toast(message,true);},
  });
  publishFormat();
  dialog.showModal();
}

function destroyReview(){
  editing?.editor?.destroy();
  editing?.editorial?.destroy();
}

export function openCutPublication({clip,job},channels,channelId){
  remember({cuts:{...current,jobs:[{...job,clips:[clip]}],channels}});
  openPublish(clip.id,'tiktok');
  document.querySelector('#cuts-dialog-form').elements.namedItem('channelId').value=channelId;
}

function libraryJobs(){return visibleJobs().map(job=>({...job,clips:(job.clips||[]).filter(clip=>clip.hasMedia&&clip.status!=='discarded')})).filter(job=>job.clips.length);}
export function updateCutLibrary(state){
  remember({...state,cuts:state.cutFolders||state.cuts});
  const root=document.querySelector('#cut-library-host');
  if(!root)return;
  const scope=state.cutFolders?'cutFolders':'cuts';
  drawWorkspace(root,'cutLibrary',{
    groups:stableJobs(root,libraryJobs()),pagination:paginationView(current.pagination,scope),scope,safeLink,importFile,
  });
}

function feedback(form,message=''){
  const alert=form.querySelector('#cuts-dialog-feedback');
  if(!alert)return;
  alert.textContent=message;alert.hidden=!message;
}

function publishFormat(){
  if(editing?.mode!=='publish')return;
  const form=document.querySelector('#cuts-dialog-form'),changed=form.elements.namedItem('format').value!==editing.format;
  form.querySelector('#cut-format-change').hidden=!changed;
  form.querySelector('[type="submit"]').disabled=changed||!editing.canPublish||Boolean(editing.pending)||Boolean(editing.generating);
}

function openCutSourceRange({video,initialRange,save}){
  const modal=mountWorkspaceModal('cutSourceRange',{
    video,initialRange,save,onClose(){modal.destroy();},
  });
}

export function bindCuts({api,refresh,toast}){
  services={api,toast,refresh};
  async function createProject(form,input){
    await api('/cuts',input);
    form.reset();
    resetPagination('cuts');
    if(form.isConnected&&location.hash==='#cuts/new'){
      location.hash='#cuts';
      window.scrollTo(0,0);
      document.querySelector('#cuts-tab-projects')?.focus({preventScroll:true});
    }
    await refresh(true);
    toast('Projeto na fila. Acompanhe a geração na aba Projetos.');
  }
  const dialog=document.querySelector('#cuts-dialog');
  dialog.addEventListener('close',()=>{
    if(dialog.open)return;
    destroyReview();
    dialog.querySelectorAll('video').forEach(video=>video.pause());
    clearWorkspace(dialog.querySelector('form'));
    editing=null;
    delete dialog.dataset.mode;
    void refresh(true);
  });
  dialog.addEventListener('change',event=>{
    if(editing?.mode!=='publish')return;
    if(event.target.name==='platform'){
      const form=document.querySelector('#cuts-dialog-form');
      drawCutPublication(form,editing,event.target.value,findClip(editing.id).clip);
      editing.editorial.setPlatform(event.target.value);
      form.elements.namedItem('confirm').checked=false;
    }
    if(['platform','format'].includes(event.target.name))publishFormat();
  });
  document.addEventListener('submit',async event=>{
    const form=event.target;if(!['cuts-create-form','cuts-dialog-form'].includes(form.id))return;
    event.preventDefault();const button=form.querySelector('[type="submit"]'),session=form.id==='cuts-dialog-form'?editing:null;
    if(!button||button.dataset.busy||session?.pending||session?.generating)return;
    if(session)feedback(form);
    if(session)session.pending=true;button.disabled=true;button.dataset.busy='1';
    try{
      const f=new FormData(form);
      if(form.id==='cuts-create-form'){
        const input={url:f.get('url'),count:Number(f.get('count')),targetSeconds:Number(f.get('targetSeconds')),language:f.get('language')};
        if(event.submitter?.hasAttribute('data-cut-source-range')){
          openCutSourceRange({video:{title:'',duration:null},save:sourceRange=>createProject(form,{...input,sourceRange})});
        }else await createProject(form,input);
      }else if(session?.mode==='edit'){
        const body=session.editor.read();
        const result=await api(path(session.id),{...body,versionId:session.versionId},'PUT');if(editing===session&&dialog.open)dialog.close();await refresh(true);toast(result.createdVersion?'Nova versão criada. Aguarde a prévia para revisar e postar.':'Ajustes salvos. Aguarde a nova prévia antes de postar.');
      }else if(session?.mode==='publish'){
        if(f.get('format')!==session.format)throw new Error('Gere e confira a prévia no formato escolhido antes de postar.');
        await api(path(session.id)+'/publish',{format:session.format,channelId:f.get('channelId'),title:f.get('title'),description:f.get('description'),hashtags:readCommaSeparated(f.get('hashtags')),youtubeTags:readCommaSeparated(f.get('youtubeTags')),confirm:f.has('confirm'),revision:session.revision,...(f.get('platform')==='tiktok'?{tiktok:readTiktokFields(form)}:{visibility:f.get('visibility'),madeForKids:f.has('madeForKids'),containsSyntheticMedia:f.has('containsSyntheticMedia')})});const follow=editing===session&&dialog.open&&f.get('platform')==='tiktok';if(editing===session&&dialog.open)dialog.close();if(follow)location.hash='#browser';await refresh(true);toast(f.get('platform')==='tiktok'?'Envio autorizado. Acompanhe o Playwright e a janela do Chrome.':'Envio autorizado e colocado na fila. Acompanhe a confirmação no histórico.');
      }
    }catch(error){if(session&&editing===session&&dialog.open)feedback(form,error.message);toast(error.message,true);}finally{if(session)session.pending=false;button.disabled=false;delete button.dataset.busy;if(form.id==='cuts-create-form')button.disabled=!current.dependencies?.ready;if(editing===session&&dialog.open)publishFormat();}
  });
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-cuts-action]');if(!button)return;const action=button.dataset.cutsAction,id=button.dataset.id;
    button.disabled=true;
    try{
      if(action==='refresh')await refresh(true);
      else if(action==='edit'){const pending=editing?.mode==='preparing'&&editing.id===id?editing:{};await openEditor(id,pending.seek,pending.format);}
      else if(action==='export'){
        const {clip}=findClip(id);
        await api(path(id)+'/export',{revision:clip.revision});await refresh(true);
        toast('Gerando o MP4 final em alta qualidade.');
      }
      else if(action==='publish'||action==='publish-tiktok')openPublish(id,action==='publish-tiktok'?'tiktok':button.dataset.platform||'youtube');
      else if(action==='edit-format'){
        if(editing?.mode!=='publish'||editing.pending)return;
        const format=document.querySelector('#cuts-dialog-form').elements.namedItem('format').value;
        if(!cutFormats.some(([value])=>value===format))throw new Error('Escolha um formato válido.');
        await openEditor(id,undefined,format);
      }
      else if(action==='analyze-job'){await api('/cuts/jobs/'+encodeURIComponent(id)+'/analyze',{});await refresh(true);toast('Buscando picos de replay e gerando uma nova sugestão. Os cortes anteriores são preservados.');}
      else if(action==='inspect-replay'){
        const job=current.jobs.find(j=>j.id===id),clip=job?.clips?.find(c=>c.status==='review');
        if(!clip)throw new Error('Aguarde um corte disponível para abrir o editor.');
        const svg=event.target.closest('svg'),selected=event.detail&&svg?replayTimeAt(event.clientX,svg.getBoundingClientRect(),Number(job.duration)):undefined;
        await openEditor(clip.id,Number.isFinite(selected)?selected:undefined);
      }
      else if(action==='close-dialog')dialog.close();
      else if(action==='discard'){
        const {clip}=findClip(id);
        if(await confirmDiscard({kind:'clip',name:clip.title,confirmLabel:clip.status==='posted'?'Excluir arquivo':undefined,onConfirm:()=>api(path(id)+'/discard',{confirm:true})})){await refresh(true);toast('Arquivo excluído. As publicações e o histórico foram preservados.');}
      }
      else if(action==='discard-job'){
        const job=visibleJobs().find(item=>item.id===id);if(!job)throw new Error('Este projeto não está mais disponível. Atualize o painel.');
        if(await confirmDiscard({kind:'project',name:job.title,onConfirm:()=>api('/cuts/jobs/'+encodeURIComponent(id)+'/discard',{confirm:true})})){resetPagination('cuts');await refresh(true);toast('Projeto descartado. O histórico dos envios foi preservado.');}
      }
      else if(action==='retry-job'){await api('/cuts/jobs/'+encodeURIComponent(id)+'/retry',{});await refresh(true);toast('Nova geração solicitada.');}
      else if(action==='retry-source-range'){
        const job=visibleJobs().find(item=>item.id===id);if(!job)throw new Error('Este projeto não está mais disponível. Atualize o painel.');
        openCutSourceRange({video:{title:job.title,duration:null},initialRange:job.source_range,async save(sourceRange){
          await api('/cuts/jobs/'+encodeURIComponent(id)+'/retry',{sourceRange});
          await refresh(true);
          toast('Projeto na fila com o trecho escolhido.');
        }});
      }
    }catch(error){toast(error.message,true);}finally{button.disabled=false;}
  });
}
