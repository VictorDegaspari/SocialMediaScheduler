import {bindFoldersPage} from './folders-view.js';
import {bindImmediatePublication} from './browser-publish.js';
import {readTiktokFields} from './cut-publish.js';
import {updateConnections,destroyConnections,bindConnections} from './connections-view.js';
import {updateRequests,destroyRequests,bindRequests} from './requests-panel.js';
import {readPackDefaults} from './pack-source.js';
import {readNativeSchedule} from './native-schedule.js';
import {bindBrowserPanel} from './browser-panel.js';
import {updateCuts,updateCutLibrary,bindCuts} from './cuts-panel.js';
import {paginationQuery,paginationView,bindPagination,resetEmptyPages,resetPagination} from './pagination.js';
import {mountYoutubeChannels} from './build/youtube-channels-view.js';
import {clearWorkspace,drawWorkspace,mountWorkspaceModal,mountWorkspaceShell,workspacePages} from './build/workspace-view.js';
const shell=mountWorkspaceShell(document.querySelector('#app'));
const main=document.querySelector('#main');
drawWorkspace(main,'notice',{message:'Carregando painel…',kind:'loading'});
const dialog=document.querySelector('#watch-dialog');
let state=null, channels=[],page='overview',editingId=null,refreshTask=null;
let youtubeChannels;
dialog.addEventListener('close',()=>{
  if(dialog.open)return;
  clearWorkspace(document.querySelector('#watch-form'));
});
const safeUrl=(s)=>{try{const u=new URL(s);return ['http:','https:'].includes(u.protocol)?u.href:'#';}catch{return '#';}};
const date=(v,full=false)=>v?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',...(full?{day:'2-digit',month:'2-digit'}:{}),hour:'2-digit',minute:'2-digit'}).format(new Date(v)):'Ainda não executada';
const statusLabels={waiting:'Aguardando',ready:'Na fila',uploading:'Enviando',retry:'Nova tentativa',failed:'Atenção',unknown:'Conferir envio',baseline:'Preexistente',sent:'Processado',duplicate:'Duplicado',removed:'Removido',draft:'Rascunho',scheduled:'Agendado',published:'Publicado',submitting:'Enviando',pending:'Na fila local',review:'Revisão local',processing:'Processando',private:'Privado no YouTube',unlisted:'Não listado',inbox:'Finalizar no TikTok',completed:'Finalizado no TikTok',cancelled:'Cancelado',preparing:'Preparando prévia'};
function toast(message,error=false){
  shell.toastMessage=message;shell.toastError=error;shell.toastVisible=true;
  clearTimeout(toast.timer);toast.timer=setTimeout(()=>shell.toastVisible=false,6500);
}
async function api(path,body,method='POST'){
  const response=await fetch('/api'+path,body===undefined?{}:{method,headers:{'Content-Type':'application/json','X-Watcher-Request':'1'},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw new Error(result.error || 'Não foi possível concluir a operação.');return result;
}
function openPublicationLink(id,youtube){
  const path=youtube?'/native/deliveries/':'/deliveries/';
  const modal=mountWorkspaceModal('linkPublication',{
    youtube,
    async link(postId){
      await api(path+id+'/link',{postId});
      await refresh(true);
      toast(youtube?'Vídeo verificado e vinculado ao histórico.':'Post encontrado e vinculado ao histórico.');
    },
    onClose(){modal.destroy();},
  });
  try{modal.dialog.showModal();}catch(error){modal.destroy();throw error;}
}
async function loadChannels(){if(!state){channels=[];return;}try{channels=(await api('/integrations')).filter(channel=>channel.identifier==='youtube');}catch{channels=[];}}
function refresh(force=false){
  if(refreshTask)return force?refreshTask.then(()=>refresh(true)):refreshTask;
  refreshTask=(async()=>{
    try{
      const query=paginationQuery();
      let nextState=await api('/state'+query);
      if(query!==paginationQuery()||resetEmptyPages(nextState))nextState=await api('/state'+paginationQuery());
      state=nextState;
      shell.offline=false;
      shell.connectionLabel=state.scheduler.paused?'Rotinas pausadas':'Serviço local ativo';
      shell.folderCount=(state.stats.watches??state.watches.length)+(state.cutFolders?.jobs?.length?1:0);
      shell.actionCount=state.publishing?.summary?.actionCount??state.publishing?.actions?.length??0;
      if(force || (!dialog.open && !main.contains(document.activeElement)))render();
      return true;
    }catch(error){
      shell.offline=true;shell.connectionLabel='Serviço desconectado';
      if(!state)drawWorkspace(main,'notice',{message:error.message,kind:'error'});
      return false;
    }finally{refreshTask=null;}
  })();
  return refreshTask;
}
function render(){
  if(!state)return;
  const cutsView=location.hash==='#cuts/new'?'create':'projects';
  const hash=cutsView==='create'?'cuts':location.hash.slice(1);
  page=workspacePages.find(item=>item.id===hash)?.id??'overview';
  shell.page=page;
  const viewProps={state,date};
  const drawFolders=()=>drawWorkspace(main,'folders',{...viewProps,pagination:paginationView(state.pagination?.watches,'watches'),scheduleApi:api,onScheduleChanged:()=>void refresh(true)});
  const drawHistory=()=>drawWorkspace(main,'history',{...viewProps,safeUrl,statusLabels,pagination:{
    videos:paginationView(state.pagination?.videos,'videos'),events:paginationView(state.pagination?.events,'events'),
  }});
  if(page==='watches'&&main.querySelector('#my-folders')){
    drawFolders();
    updateCutLibrary(state);
    return;
  }
  if(page==='cuts'&&main.querySelector('#cuts-panel')){updateCuts(main,state,viewProps,cutsView);return;}
  if(page==='requests'&&main.querySelector('#requests-panel')){updateRequests(main,state,date);return;}
  if(page==='connections'&&main.querySelector('#connections-panel')){updateConnections(main,state,channels);return;}
  if(page==='youtube-channels'&&youtubeChannels)return;
  if(page==='overview'&&main.querySelector('.stats')){drawWorkspace(main,'overview',{...viewProps,publisherReady:publisherReady()});return;}
  if(page==='history'&&main.querySelector('.history-event-list')){drawHistory();return;}

  destroyConnections();
  destroyRequests();
  youtubeChannels?.destroy();
  youtubeChannels=null;
  const library=main.querySelector('#cut-library-host');
  if(library)clearWorkspace(library);
  clearWorkspace(main);

  if(page==='overview')drawWorkspace(main,'overview',{...viewProps,publisherReady:publisherReady()});
  else if(page==='watches'){
    drawFolders();
    updateCutLibrary(state);
  }else if(page==='history')drawHistory();
  else if(page==='browser')drawWorkspace(main,'browser',{...viewProps,pagination:paginationView(state.browser?.pagination,'browser')});
  else if(page==='cuts')updateCuts(main,state,viewProps,cutsView);
  else if(page==='connections')updateConnections(main,state,channels);
  else if(page==='requests')updateRequests(main,state,date);
  else if(page==='youtube-channels')youtubeChannels=mountYoutubeChannels(main,{api,toast,queued:()=>void refresh(true)});
}
async function openWatch(id){
  await loadChannels();
  const watch=id?state.watches.find(item=>item.id===id):null;
  editingId=watch?.id||null;
  const form=document.querySelector('#watch-form');
  shell.watchEditing=Boolean(watch);
  clearWorkspace(form);
  drawWorkspace(form,'watchForm',{w:watch,state,channels});
  dialog.showModal();
}
document.addEventListener('submit',async event=>{
  const form=event.target;if(!['watch-form','google-form','postiz-form'].includes(form.id))return;event.preventDefault();const button=form.querySelector('[type="submit"]');button.disabled=true;
  try{const f=new FormData(form);
    if(form.id==='watch-form'){
      const body={sourceType:f.get('sourceType')||state.watches.find(w=>w.id===editingId)?.source_type||'google_drive',localPath:f.get('localPath')||'',enabled:editingId?state.watches.find(w=>w.id===editingId).enabled:true,name:f.get('name'),folderUrl:f.get('folderUrl')||'',recursive:f.has('recursive'),scanMinutes:Number(f.get('scanMinutes')),cadence:f.get('cadence'),intervalMinutes:Number(f.get('intervalValue'))*Number(f.get('intervalUnit')),times:String(f.get('times')).split(',').map(s=>s.trim()).filter(Boolean),timezone:'America/Sao_Paulo',mode:f.get('mode'),nativeSchedule:readNativeSchedule(form),packDefaults:readPackDefaults(form),integrationIds:f.getAll('integrationIds'),importExisting:editingId?state.watches.find(w=>w.id===editingId).import_existing:f.has('importExisting'),requireMetadata:f.has('requireMetadata'),stripMetadata:f.has('stripMetadata')};
      await api(editingId?'/watches/'+editingId:'/watches',body,editingId?'PUT':'POST');if(!editingId)resetPagination('watches');dialog.close();toast('Rotina salva. A próxima verificação já está na fila.');
    }else if(form.id==='google-form'){await api('/settings/google',{clientId:f.get('clientId'),clientSecret:f.get('clientSecret')||undefined});form.querySelector('[name="clientSecret"]').value='';toast('Credenciais salvas. Agora clique em Autorizar Google.');}
    else{const result=await api('/settings/postiz',{baseUrl:f.get('baseUrl'),apiKey:f.get('apiKey')||undefined,youtubeSchedulingApproved:f.has('youtubeSchedulingApproved')});channels=result.channels;form.querySelector('[name="apiKey"]').value='';toast(`Postiz conectado. ${channels.length} canal(is) encontrado(s).`);}
    await refresh(true);
  }catch(error){toast(error.message,true);}finally{button.disabled=false;}
});
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action,id=button.dataset.id;button.disabled=true;
  try{
    if(action==='new-watch')await openWatch();
    else if(action==='edit-watch')await openWatch(id);
    else if(action==='close-dialog')dialog.close();
    else if(action==='toggle-watch'){await api('/watches/'+id+'/toggle',{});await refresh(true);}
    else if(action==='scan-watch'){await api('/watches/'+id+'/scan',{});toast('Verificação solicitada. Aguarde o próximo ciclo da rotina.');}
    else if(action==='toggle-scheduler'){await api('/scheduler',{paused:!state.scheduler.paused});await refresh(true);}
    else if(action==='disconnect-google'){await api('/settings/google/disconnect',{});toast('Conta desconectada deste aplicativo.');await refresh(true);}
    else if(action==='reload-channels'){await loadChannels();render();toast(channels.length?`${channels.length} canal(is) encontrado(s).`:'Nenhum canal disponível. Verifique sua conexão Postiz.');}
    else if(action==='check-folder'){const result=await api('/folders/check',{sourceType:document.querySelector('#source-type').value,url:document.querySelector('#folder-url').value,localPath:document.querySelector('#local-path').value});if(!document.querySelector('#watch-name').value)document.querySelector('#watch-name').value=result.name;toast('Acesso confirmado: '+result.name);}
    else if(action==='retry-video'){await api('/videos/'+id+'/retry',{});toast('Nova verificação solicitada. Envios já aceitos serão preservados.');await refresh(true);}
    else if(action==='cancel-video'){await api('/videos/'+id+'/cancel',{});toast('Vídeo retirado da fila. O arquivo original foi preservado.');await refresh(true);}
    else if(action==='link-post')openPublicationLink(id,false);
    else if(action==='refresh'){
      if(!state)drawWorkspace(main,'notice',{message:'Reconectando ao serviço local…',kind:'loading'});
      await refresh(true);
    }
  }catch(error){toast(error.message,true);}finally{button.disabled=false;}
});
window.addEventListener('hashchange',async()=>{if(location.hash==='#connections')await loadChannels();render();});
const nativeOAuth=new URL(location.href).searchParams.get('nativeOAuth');if(nativeOAuth){history.replaceState(null,'','/#connections');toast(nativeOAuth.endsWith('-success')?'Canal conectado diretamente com sucesso.':'A conexão não foi concluída. Confira aplicativo, permissões e callback.',!nativeOAuth.endsWith('-success'));}
const oauth=new URL(location.href).searchParams.get('oauth');if(oauth){history.replaceState(null,'','/#connections');toast(oauth==='success'?'Google Drive conectado com sucesso.':'A autorização não foi concluída. Verifique suas credenciais e tente novamente.',oauth!=='success');}
await refresh();if(page==='connections'){await loadChannels();render();}setInterval(()=>{if(!document.hidden)void refresh();},5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});

function publisherReady(){return state.connections.native.engine==='local'?state.connections.native.youtube.connected:state.connections.postiz.configured;}
let reviewingDelivery=null;
async function openNativeReview(id){
  const delivery=await api('/native/deliveries/'+id);
  reviewingDelivery=delivery;
  const review=document.querySelector('#delivery-dialog');
  const form=review.querySelector('#delivery-form');
  shell.deliveryPlatform=delivery.provider==='youtube'?'youtube':'tiktok';
  clearWorkspace(form);
  drawWorkspace(form,'deliveryReview',{d:delivery});
  review.showModal();
}
document.querySelector('#delivery-dialog').addEventListener('close',event=>{
  if(event.currentTarget.open)return;
  clearWorkspace(event.currentTarget.querySelector('#delivery-form'));
  reviewingDelivery=null;
});
document.addEventListener('submit',async event=>{
  const form=event.target;if(!['engine-form','youtube-form','delivery-form'].includes(form.id))return;
  event.preventDefault();const button=form.querySelector('[type="submit"]');if(button.dataset.busy)return;button.dataset.busy='1';button.disabled=true;
  try{const f=new FormData(form);
    if(form.id==='engine-form'){await api('/settings/publisher',{engine:f.get('engine')});await loadChannels();await refresh(true);toast('Motor salvo. Selecione os canais correspondentes nas rotinas.');}
    else if(form.id==='youtube-form'){await api('/settings/youtube',{clientId:f.get('clientId'),clientSecret:f.get('clientSecret')||undefined,autoPublishApproved:f.has('autoPublishApproved')});form.querySelector('[name="clientSecret"]').value='';await refresh(true);toast('Credenciais salvas. Clique em Autorizar YouTube para conectar o canal.');}
    else {const delivery=reviewingDelivery,meta=structuredClone(delivery.payload.metadata);meta.title=f.get('title');meta.description=f.get('description');meta.hashtags=String(f.get('hashtags')).split(',').map(s=>s.trim()).filter(Boolean);if(delivery.provider==='youtube'){meta.youtube.visibility=f.get('visibility');meta.youtube.madeForKids=f.has('madeForKids');meta.youtube.containsSyntheticMedia=f.has('containsSyntheticMedia');}if(delivery.engine==='browser')meta.tiktok=readTiktokFields(form);await api('/native/deliveries/'+delivery.id+'/approve',{confirm:f.has('confirm'),metadata:meta,...(delivery.engine==='browser'?{publishNow:true}:{})});const dialog=document.querySelector('#delivery-dialog'),follow=delivery.engine==='browser'&&reviewingDelivery===delivery&&dialog.open;if(reviewingDelivery===delivery&&dialog.open)dialog.close();if(follow)location.hash='#browser';await refresh(true);toast(delivery.engine==='browser'?'Envio autorizado. Acompanhe o Playwright e a janela do Chrome.':'Envio aprovado e colocado na fila local.');}
  }catch(error){toast(error.message,true);}finally{button.disabled=false;delete button.dataset.busy;}
});
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action;
  if(!['review-native','close-review','retry-native','disconnect-native','copy-caption','cancel-native','link-native'].includes(action))return;
  button.disabled=true;
  try{
    if(action==='review-native')await openNativeReview(button.dataset.id);
    else if(action==='close-review')document.querySelector('#delivery-dialog').close();
    else if(action==='retry-native'){await api('/native/deliveries/'+button.dataset.id+'/retry',{});await refresh(true);toast('Nova tentativa solicitada para este vídeo e esta conta.');}
    else if(action==='cancel-native'){const result=await api('/native/deliveries/'+button.dataset.id+'/cancel',{});await refresh(true);toast(result.status==='cancel_requested'?'Cancelamento solicitado. Aguardando o navegador encerrar.':'Envio cancelado. O arquivo original foi preservado.');}
    else if(action==='link-native')openPublicationLink(button.dataset.id,true);
    else if(action==='disconnect-native'){await api('/settings/'+button.dataset.provider+'/disconnect',{});await refresh(true);toast('Canal desconectado deste aplicativo.');}
    else {const f=new FormData(document.querySelector('#delivery-form'));await navigator.clipboard.writeText([f.get('title'),f.get('description'),String(f.get('hashtags')).split(',').map(t=>'#'+t.trim().replace(/^#+/,'').replace(/\s/g,'')).filter(t=>t!=='#').join(' ')].filter(Boolean).join('\n\n'));toast('Legenda copiada.');}
  }catch(error){toast(error.message,true);}finally{button.disabled=false;}
});


bindBrowserPanel({api,refresh,toast});
bindImmediatePublication({api,refresh,toast,getState:()=>state,openReview:openNativeReview});

bindRequests({api,refresh,toast});
bindConnections({api,refresh,toast});

bindCuts({api,refresh,toast});

bindPagination({refresh,toast});

bindFoldersPage();
