import {bindFoldersPage} from './folders-view.js';
import {bindImmediatePublication} from './browser-publish.js';
import {readTiktokFields} from './cut-publish.js';
import {renderConnections,updateConnections,destroyConnections,bindConnections} from './connections-view.js';
import {renderRequests,updateRequests,destroyRequests,bindRequests} from './requests-panel.js';
import {readPackDefaults} from './pack-source.js';
import {readNativeSchedule} from './native-schedule.js';
import {bindBrowserPanel} from './browser-panel.js';
import {updateCuts,updateCutLibrary,bindCuts} from './cuts-panel.js';
import {paginationQuery,paginationView,bindPagination,resetEmptyPages,resetPagination} from './pagination.js';
import {mountYoutubeChannels} from './build/youtube-channels-view.js';
import {clearWorkspace,drawWorkspace} from './build/workspace-view.js';
const paths={dashboard:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',folder:'<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',history:'<path d="M3 11a9 9 0 1 1 2.8 7M3 4v7h7"/><path d="M12 7v5l3 2"/>',link:'<path d="m10 13 4-4m-6 5-2 2a3 3 0 0 0 4 4l4-4a3 3 0 0 0 0-4M14 10l2-2a3 3 0 0 0-4-4l-4 4a3 3 0 0 0 0 4"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',plus:'<path d="M12 5v14M5 12h14"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',pause:'<path d="M8 5v14M16 5v14"/>',play:'<path d="m8 4 12 8-12 8Z"/>',edit:'<path d="m15 4 5 5M3 21l5-1L21 7a2 2 0 0 0-4-4L4 16Z"/>',refresh:'<path d="M20 7a9 9 0 0 0-15-2L2 8m0-6v6h6m-4 9a9 9 0 0 0 15 2l3-3m0 6v-6h-6"/>',check:'<path d="m5 12 4 4L20 5"/>',alert:'<path d="M12 3 2 21h20L12 3Zm0 6v5m0 3v1"/>',monitor:'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>',youtube:'<rect x="2" y="5" width="20" height="14" rx="4"/><path d="m10 9 5 3-5 3Z"/>',tiktok:'<path d="M14 3v12a4 4 0 1 1-4-4m4-8c1 4 3 5 6 5"/>',drive:'<path d="m9 3 6 0 8 14-3 5H4l-3-5L9 3Zm0 0 8 14H1m3 5 8-14m5 9h6"/>',external:'<path d="M14 3h7v7m0-7L10 14m0-10H3v17h17v-7"/>'};
const icon=(name)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.folder}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
const main=document.querySelector('#main');
const dialog=document.querySelector('#watch-dialog');
let state=null, channels=[],page='overview',editingId=null,refreshTask=null;
let youtubeChannels;
dialog.addEventListener('close',()=>{
  if(dialog.open)return;
  clearWorkspace(document.querySelector('#watch-form'));
});
const esc=(s)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl=(s)=>{try{const u=new URL(s);return ['http:','https:'].includes(u.protocol)?u.href:'#';}catch{return '#';}};
const date=(v,full=false)=>v?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',...(full?{day:'2-digit',month:'2-digit'}:{}),hour:'2-digit',minute:'2-digit'}).format(new Date(v)):'Ainda não executada';
const statusLabels={waiting:'Aguardando',ready:'Na fila',uploading:'Enviando',retry:'Nova tentativa',failed:'Atenção',unknown:'Conferir envio',baseline:'Preexistente',sent:'Processado',duplicate:'Duplicado',removed:'Removido',draft:'Rascunho',scheduled:'Agendado',published:'Publicado',submitting:'Enviando',pending:'Na fila local',review:'Revisão local',processing:'Processando',private:'Privado no YouTube',unlisted:'Não listado',inbox:'Finalizar no TikTok',completed:'Finalizado no TikTok',cancelled:'Cancelado',preparing:'Preparando prévia'};
const badge=(label,type='')=>`<span class="badge ${type}">${esc(label)}</span>`;
function toast(message,error=false){const el=document.querySelector('#toast');el.textContent=message;el.className=error?'error':'';el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.hidden=true,6500);}
async function api(path,body,method='POST'){
  const response=await fetch('/api'+path,body===undefined?{}:{method,headers:{'Content-Type':'application/json','X-Watcher-Request':'1'},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw new Error(result.error || 'Não foi possível concluir a operação.');return result;
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
      const paused=state.scheduler.paused;
      document.querySelector('#connection-status').className='connection-status';
      document.querySelector('#connection-status').innerHTML=`<span class="dot"></span> ${paused?'Rotinas pausadas':'Serviço local ativo'}`;
      document.querySelector('#nav-count').textContent=(state.stats.watches??state.watches.length)+(state.cutFolders?.jobs?.length?1:0);
      const manualCount=document.querySelector('#manual-count'),actionCount=state.publishing?.summary?.actionCount??state.publishing?.actions?.length??0;
      if(manualCount){manualCount.textContent=actionCount;manualCount.hidden=!actionCount;}
      if(force || (!dialog.open && !main.contains(document.activeElement)))render();
      return true;
    }catch(error){
      document.querySelector('#connection-status').className='connection-status offline';
      document.querySelector('#connection-status').innerHTML='<span class="dot"></span> Serviço desconectado';
      if(!state)main.innerHTML=`<div class="error-banner">${esc(error.message)} Inicie a aplicação com scripts/start.sh.</div>`;
      return false;
    }finally{refreshTask=null;}
  })();
  return refreshTask;
}
function updateSourceFields(){const type=document.querySelector('#source-type').value,local=type==='local',pack=type==='gta6_pack';document.querySelector('#drive-source').hidden=local||pack;document.querySelector('#local-source').hidden=!local;document.querySelector('#pack-source').hidden=!pack;document.querySelector('#folder-url').disabled=local||pack;document.querySelector('#folder-url').required=!local&&!pack;document.querySelector('#local-path').disabled=!local;document.querySelector('#local-path').required=local;if(pack&&!editingId)document.querySelector('#watch-form [name="importExisting"]').checked=true;}
function render(){
  if(!state)return;
  const cutsView=location.hash==='#cuts/new'?'create':'projects';
  page=cutsView==='create'?'cuts':location.hash.slice(1)||'overview';if(!['overview','watches','connections','history','browser','requests','cuts','youtube-channels'].includes(page))page='overview';
  document.querySelectorAll('[data-page]').forEach(a=>a.classList.toggle('active',a.dataset.page===page));
  document.querySelector('#breadcrumb').textContent={overview:'Visão geral',watches:'Minhas pastas',connections:'Conexões',history:'Histórico',browser:'TikTok navegador',requests:'Pedidos e contas',cuts:'Gerador de cortes','youtube-channels':'Canais do YouTube'}[page];
  const viewProps={state,icon,date};
  const drawFolders=()=>drawWorkspace(main,'folders',{...viewProps,pagination:paginationView(state.pagination?.watches,'watches'),scheduleApi:api,onScheduleChanged:()=>void refresh(true)});
  const drawHistory=()=>drawWorkspace(main,'history',{...viewProps,safeUrl,statusLabels,pagination:{
    videos:paginationView(state.pagination?.videos,'videos'),events:paginationView(state.pagination?.events,'events'),
  }});
  if(page==='watches'&&main.querySelector('#my-folders')){
    drawFolders();
    updateCutLibrary(state,viewProps);
    return;
  }
  if(page==='cuts'&&main.querySelector('#cuts-panel')){updateCuts(main,state,viewProps,cutsView);return;}
  if(page==='requests'&&main.querySelector('#requests-panel')){updateRequests(state,{esc,badge,date});return;}
  if(page==='connections'&&main.querySelector('#connections-panel')){updateConnections(state,channels,{icon});return;}
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
  main.replaceChildren();

  if(page==='overview')drawWorkspace(main,'overview',{...viewProps,publisherReady:publisherReady()});
  else if(page==='watches'){
    drawFolders();
    updateCutLibrary(state,viewProps);
  }else if(page==='history')drawHistory();
  else if(page==='browser')drawWorkspace(main,'browser',{...viewProps,pagination:paginationView(state.browser?.pagination,'browser')});
  else if(page==='cuts')updateCuts(main,state,viewProps,cutsView);
  else if(page==='connections'){
    main.innerHTML=renderConnections(state,channels,{icon});
    updateConnections(state,channels,{icon});
  }else if(page==='requests'){
    main.innerHTML=renderRequests(state,{esc,badge,date});
    updateRequests(state,{date});
  }else if(page==='youtube-channels')youtubeChannels=mountYoutubeChannels(main,{api,toast,queued:()=>void refresh(true)});
}
async function openWatch(id){
  await loadChannels();
  const watch=id?state.watches.find(item=>item.id===id):null;
  editingId=watch?.id||null;
  const form=document.querySelector('#watch-form');
  document.querySelector('#dialog-title').textContent=watch?'Editar rotina':'Adicionar uma pasta';
  clearWorkspace(form);
  drawWorkspace(form,'watchForm',{w:watch,state,channels,icon});
  updateSourceFields();
  dialog.showModal();
}
document.addEventListener('change',event=>{if(event.target.id==='watch-mode')document.querySelector('#native-schedule-fields').hidden=event.target.value!=='native_schedule';if(event.target.id==='source-type')updateSourceFields();if(event.target.id==='cadence'){document.querySelector('#interval-fields').hidden=event.target.value==='daily';document.querySelector('#daily-fields').hidden=event.target.value!=='daily';}});
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
    else if(action==='link-post'){const postId=prompt('Confira o post no Postiz e informe seu ID. Ele será verificado antes de vincular:');if(postId){await api('/deliveries/'+id+'/link',{postId:postId.trim()});toast('Post encontrado e vinculado ao histórico.');await refresh(true);}}
    else if(action==='refresh')await refresh(true);
  }catch(error){toast(error.message,true);}finally{button.disabled=false;}
});
window.addEventListener('hashchange',async()=>{if(location.hash==='#connections')await loadChannels();render();});
setInterval(()=>{document.querySelector('#local-clock').textContent=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date());},1000);
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
  const youtube=delivery.provider==='youtube';
  review.dataset.platform=youtube?'youtube':'tiktok';
  review.querySelector('#delivery-title').textContent=youtube?'Revisar vídeo do YouTube':'Revisar envio para o TikTok';
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
    else if(action==='link-native'){const postId=prompt('Confira o vídeo no seu canal YouTube e informe o ID dele:');if(postId){await api('/native/deliveries/'+button.dataset.id+'/link',{postId:postId.trim()});await refresh(true);toast('Vídeo verificado e vinculado ao histórico.');}}
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
