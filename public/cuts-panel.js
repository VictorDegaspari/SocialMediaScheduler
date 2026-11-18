import {createCutEditor,replayGraph,cutFormats} from './cuts-editor.js';
import {formatTimecode} from './cuts-time.js';
import {replayTimeAt} from './cuts-replay.js';
import {confirmDiscard} from './confirm-dialog.js';
import {renderPagination,resetPagination} from './pagination.js';
import {cutPublishFields,updateCutDestination,readTiktokFields} from './cut-publish.js';
const jobLabels={queued:'Na fila',downloading:'Baixando vídeo',transcribing:'Transcrevendo áudio',selecting:'Selecionando momentos',rendering:'Gerando prévias',review:'Pronto para revisar',failed:'Precisa de atenção',discarded:'Descartado',completed:'Concluído'};
const clipLabels={queued:'Na fila',rendering:'Atualizando prévia',review:'Revisar corte',publishing:'Envio solicitado',posted:'Enviado',discarded:'Descartado',failed:'Precisa de atenção'};
const deliveryLabels={pending:'Na fila de envio',retry:'Aguardando nova tentativa',submitting:'Enviando ao YouTube',processing:'Processando no YouTube',published:'Publicado no YouTube',scheduled:'Agendado no YouTube',private:'Privado no YouTube',unlisted:'Não listado no YouTube',unknown:'Conferir envio no histórico',failed:'Confira o envio no histórico',cancelled:'Envio cancelado'};
let current={jobs:[],channels:[],dependencies:{ready:false,details:[]}},helpers,editing=null,apiClient;
const jobSignatures=new Map();
const stamp=value=>formatTimecode(Number(value)||0,{precision:2});
const path=id=>'/cuts/'+encodeURIComponent(id);
function safeLink(value){try{const url=new URL(value);return url.protocol==='https:'?url.href:'#';}catch{return '#';}}
function remember(state,h){helpers=h;current=state.cuts||{jobs:[],channels:[],dependencies:{ready:false,details:['Reinicie o serviço para carregar o gerador de cortes.']}};}
function visibleJobs(){return (current.jobs||[]).filter(job=>job.status!=='discarded');}
function dependencyNotice(){const {esc}=helpers,d=current.dependencies||{};return d.ready?'<span class="cuts-ready"><span class="dot"></span> Gerador disponível</span>':`<div class="notice"><strong>Preparação necessária</strong><p>${(d.details||['O gerador ainda está sendo preparado.']).map(esc).join('<br>')}</p></div>`;}
function publicationList(clip){
  const {esc}=helpers;
  return (clip.publications||[]).map(delivery=>{
    const platform=delivery.provider==='youtube'?'YouTube':'TikTok',url=delivery.release_url||(delivery.provider==='youtube'&&delivery.post_id?'https://www.youtube.com/watch?v='+encodeURIComponent(delivery.post_id):null);
    const label={pending:'Na fila',retry:'Aguardando nova tentativa',submitting:'Enviando',processing:'Processando',published:'Publicado',scheduled:'Agendado',private:'Privado',unlisted:'Não listado',completed:'Publicado',failed:'Precisa de atenção',cancelled:'Cancelado',unknown:'Conferir no histórico'}[delivery.status]||delivery.status;
    return `<div class="cut-publication"><strong>${platform} · ${esc(delivery.channel_name||'Conta selecionada')}</strong><span>${esc(label)}</span>${url?`<a href="${esc(safeLink(url))}" target="_blank" rel="noreferrer">Abrir no ${platform}</a>`:''}${delivery.error?`<small>${esc(delivery.error)}</small>`:''}</div>`;
  }).join('');
}
function discardCutButton(clip){
  return clip.hasMedia&&['review','posted','failed'].includes(clip.status)?`<button class="button ghost danger small" data-cuts-action="discard" data-id="${helpers.esc(clip.id)}">${clip.status==='posted'?'Excluir arquivo':'Descartar'}</button>`:'';
}
function clipActions(clip,library=false){
  const {esc,icon}=helpers,id=esc(clip.id),editable=['review','failed','publishing','posted'].includes(clip.status);
  const downloadable=clip.hasMedia&&['review','publishing','posted','failed'].includes(clip.status);
  if(!editable&&!downloadable&&!discardCutButton(clip))return '';
  return `<div class="cuts-actions">${downloadable?`<button class="button primary small" data-cuts-action="publish" data-id="${id}" ${library?'aria-label="Postar no YouTube"':''}>${icon(library?'youtube':'upload')} ${library?'YouTube':'Postar'}</button><button class="button small" data-cuts-action="publish-tiktok" data-platform="tiktok" data-id="${id}" aria-label="Postar no TikTok">${icon('tiktok')} ${library?'TikTok':'Postar no TikTok'}</button>`:''}${editable?`<button class="button small" data-cuts-action="edit" data-id="${id}">${icon('edit')} ${clip.status==='failed'?'Ajustar e gerar novamente':'Ajustar'}</button>`:''}${downloadable?`<a class="button small" href="/api/cuts/${encodeURIComponent(clip.id)}/media?download=1&amp;v=${Number(clip.revision)||0}" download="${esc((clip.title||'corte')+'.mp4')}">Baixar MP4</a>`:''}${library?'':discardCutButton(clip)}</div>`;
}
function clipCard(clip,job,library=false){
  const {esc,badge,icon}=helpers;
  const status=clip.publications?.length?clipLabels[clip.status]:(clip.delivery_status?deliveryLabels[clip.delivery_status]||clipLabels[clip.status]:clipLabels[clip.status]);
  const statusBadge=badge(status||clip.status,['failed','unknown'].includes(clip.delivery_status)||clip.status==='failed'?'amber':['posted','discarded'].includes(clip.status)?'gray':'');
  const versionBadge=clip.edited_from_cut_id?'<span class="badge gray">Versão ajustada</span>':'';
  const format=clip.framing_options?.format==='video'?'video':'shorts',duration=clip.output_duration??Math.max(0,Number(clip.end_seconds)-Number(clip.start_seconds)-(clip.excluded_ranges||[]).reduce((n,r)=>n+r.end-r.start,0));
  const timing=`<p class="cuts-timing">${stamp(clip.start_seconds)} → ${stamp(clip.end_seconds)} <span>· ${stamp(duration)} de vídeo · ${format==='video'?'Vídeo 16:9':'Shorts 9:16'} · ${{fit:'Imagem completa',blur:'Fundo desfocado',crop:'Recorte com foco',split:'Webcam em cima + vídeo embaixo'}[clip.framing_options?.mode||clip.framing]||'Imagem completa'}</span></p>`;
  const information=`${clip.reason?`<p class="cuts-reason">${esc(clip.reason)}</p>`:''}${(clip.render_warnings||[]).map(w=>`<p class="tip cuts-render-warning">${esc(w)}</p>`).join('')}`;
  const publication=`${publicationList(clip)}${clip.release_url&&!clip.publications?.length?`<a class="section-link" href="${esc(safeLink(clip.release_url))}" target="_blank" rel="noreferrer">Abrir no YouTube ${icon('external')}</a>`:''}${clip.delivery_id?'<p class="tip">Acompanhe o envio em <a href="#history">Histórico</a>. O arquivo fica disponível para baixar e usar em outras plataformas. Exclua manualmente quando terminar.</p>':''}`;
  const error=clip.error?`<p class="error-banner">${esc(clip.error)}</p>`:'';
  const player=clip.hasMedia?`<video class="cuts-player" controls playsinline preload="metadata" aria-label="Prévia de ${esc(clip.title)}" src="/api/cuts/${encodeURIComponent(clip.id)}/media?v=${Number(clip.revision)||0}"></video>`:`<div class="cuts-player-empty">${icon(clip.status==='posted'?'check':'play')}<span>${clip.status==='posted'?'Arquivo local indisponível':clip.status==='discarded'?'Arquivo excluído':'A prévia aparecerá aqui'}</span></div>`;
  const heading=`<div class="cuts-clip-heading"><h3 title="${esc(clip.title||'Corte sugerido')}">${esc(clip.title||'Corte sugerido')}</h3>${library?`<div class="cuts-library-badges">${statusBadge}${versionBadge}</div>`:versionBadge+statusBadge}</div>`;
  const details=library?`<p class="cuts-library-source" title="${esc(job.title||'Cortes gerados')}">${esc(job.title||'Cortes gerados')}</p>${heading}<div class="cuts-library-meta"><span>${icon('clock')} ${formatTimecode(Math.round(duration))}</span><span>${format==='video'?'Vídeo · 16:9':'Shorts · 9:16'}</span></div>${error}${clipActions(clip,true)}<details class="cuts-library-details" data-cut-details="${esc(clip.id)}"><summary>Detalhes e publicações${clip.render_warnings?.length?` <span class="cuts-library-alert">${icon('alert')} ${clip.render_warnings.length} ${clip.render_warnings.length===1?'aviso':'avisos'}</span>`:''}</summary>${timing}${information}${publication}${discardCutButton(clip)}</details>`:`${heading}${timing}${information}${error}${clipActions(clip)}${publication}`;
  return `<article class="cuts-clip${library?' cuts-library-card':''}" data-cut-clip="${esc(clip.id)}" data-format="${format}"><div class="cuts-player-wrap">${player}</div><div class="cuts-clip-content">${details}</div></article>`;
}
function jobCard(job){
  const {esc,badge,date}=helpers,clips=job.clips||[];
  return `<section class="cuts-job panel" data-cut-job="${esc(job.id)}"><div class="cuts-job-head"><div><h2>${esc(job.title||'Vídeo do YouTube')}</h2><a class="cuts-source" href="${esc(safeLink(job.url))}" target="_blank" rel="noreferrer">${esc(job.url)}</a><small>${date(job.created_at,true)}${job.duration?` · Vídeo original: ${stamp(job.duration)}`:''}</small></div>${badge(jobLabels[job.status]||job.status,job.status==='failed'?'amber':'gray')}</div>${job.analysis_message?`<p class="notice cuts-analysis-message">${esc(job.analysis_message)}</p>`:''}${job.error?`<div class="error-banner">${esc(job.error)}</div>`:''}${['queued','downloading','transcribing','selecting','rendering'].includes(job.status)?`<div class="cuts-progress" role="status"><span class="cuts-spinner" aria-hidden="true"></span><span>${esc(jobLabels[job.status])}… O processamento continua com esta página fechada.</span></div>`:''}${job.duration&&!['discarded','completed'].includes(job.status)?`<div class="cuts-replay">${clips.some(c=>c.status==='review')?`<button class="cuts-replay-open" type="button" data-cuts-action="inspect-replay" data-id="${esc(job.id)}" aria-label="Inspecionar momentos mais revistos deste vídeo">${replayGraph(job.replay_data,job.duration,esc)}</button>`:replayGraph(job.replay_data,job.duration,esc)}${['review','failed'].includes(job.status)?`<button class="button small" type="button" data-cuts-action="analyze-job" data-id="${esc(job.id)}">Buscar momentos mais revistos</button>`:''}</div>`:''}${clips.length?`<div class="cuts-clips">${clips.map(c=>clipCard(c,job)).join('')}</div>`:''}<div class="cuts-job-actions">${job.status==='failed'?`<button class="button small" data-cuts-action="retry-job" data-id="${esc(job.id)}">Tentar gerar novamente</button>`:''}${!['discarded','downloading','transcribing','selecting','rendering'].includes(job.status)&&!clips.some(c=>c.status==='publishing')?`<button class="button ghost danger small" data-cuts-action="discard-job" data-id="${esc(job.id)}">Descartar projeto e liberar arquivos</button>`:''}</div></section>`;
}
function emptyJobs(){return '<div class="panel empty-state cuts-empty"><h3>Seu próximo Short começa com um link</h3><p>Cole um vídeo do YouTube para receber sugestões de cortes com legendas e uma prévia pronta para revisar.</p></div>';}

export function renderCuts(state,h){
  remember(state,h);jobSignatures.clear();const {esc,icon}=h;
  const jobs=visibleJobs();
  for(const job of jobs)jobSignatures.set(job.id,JSON.stringify(job));
  return `<div id="cuts-panel"><div class="page-head"><div><span class="eyebrow">CORTES PARA VÍDEOS E SHORTS</span><h1>Gerador de cortes</h1><p class="subtitle">Cole o link, receba os melhores trechos sugeridos e revise antes de postar.</p></div><button class="button" data-cuts-action="refresh">${icon('refresh')} Atualizar</button></div><div class="cuts-intro"><section class="panel cuts-create"><div class="connection-title"><div class="folder-icon">${icon('youtube')}</div><h2>Criar novos cortes</h2></div><form id="cuts-create-form"><div class="form-field"><label for="cuts-url">Link do vídeo no YouTube</label><input id="cuts-url" name="url" type="url" required maxlength="2000" placeholder="https://www.youtube.com/watch?v=..." autocomplete="off"><small>Um vídeo por projeto. O áudio original é mantido.</small></div><div class="field-row"><div class="form-field"><label for="cuts-count">Quantidade de cortes</label><select id="cuts-count" name="count">${[1,2,3,4,5].map(n=>`<option value="${n}" ${n===3?'selected':''}>${n} corte${n>1?'s':''}</option>`).join('')}</select></div><div class="form-field"><label for="cuts-duration">Duração desejada</label><select id="cuts-duration" name="targetSeconds">${[[30,'30 segundos'],[60,'60 segundos'],[90,'90 segundos'],[120,'2 minutos'],[180,'3 minutos']].map(([v,t])=>`<option value="${v}" ${v===60?'selected':''}>${t}</option>`).join('')}</select></div></div><div class="form-field"><label for="cuts-language">Idioma falado no vídeo</label><select id="cuts-language" name="language"><option value="pt">Português</option><option value="auto">Detectar automaticamente</option><option value="en">Inglês</option><option value="es">Espanhol</option></select></div><div class="form-actions"><button class="button primary" type="submit" ${current.dependencies?.ready?'':'disabled'}>${icon('play')} Gerar cortes</button></div></form><div id="cuts-dependencies">${dependencyNotice()}</div></section><aside class="cuts-guide"><span class="eyebrow">VOCÊ REVISA O RESULTADO</span><h2>Da fala original à legenda.</h2><p>O gerador transcreve o áudio, sugere trechos e prepara cortes para revisar. Em Ajustar, escolha Shorts vertical ou vídeo horizontal, com ou sem legendas.</p><ol><li><strong>Assista à prévia.</strong><span>Os trechos são sugestões automáticas baseadas na fala.</span></li><li><strong>Ajuste o que precisar.</strong><span>Corrija palavras, tempos, duração, formato e enquadramento.</span></li><li><strong>Escolha o canal e poste.</strong><span>O envio acontece depois da sua aprovação.</span></li></ol><p class="cuts-review-note">A transcrição automática pode errar. Confira a legenda ouvindo o áudio antes de postar.</p><p class="tip">Os arquivos são mantidos após postar. Use “Baixar MP4” para reutilizar no TikTok ou YouTube e exclua manualmente quando terminar. O histórico é preservado.</p></aside></div><div class="section-head cuts-results-head"><div><h2>Seus projetos</h2><p>Prévias, ajustes e andamento dos envios.</p></div></div><div id="cuts-jobs">${jobs.length?jobs.map(jobCard).join(''):emptyJobs()}</div><div id="cuts-pagination">${renderPagination(current.pagination,'cuts',esc)}</div></div>`;
}

export function updateCuts(state,h){
  remember(state,h);const root=document.querySelector('#cuts-panel');if(!root)return;
  root.querySelector('#cuts-dependencies').innerHTML=dependencyNotice();
  const create=root.querySelector('#cuts-create-form [type="submit"]');if(!create.dataset.busy)create.disabled=!current.dependencies?.ready;
  root.querySelector('#cuts-pagination').innerHTML=renderPagination(current.pagination,'cuts',h.esc);
  syncCutJobs(root.querySelector('#cuts-jobs'),visibleJobs(),jobCard,emptyJobs());
}
function syncCutJobs(container,jobs,renderJob,empty){
  const ids=new Set(jobs.map(job=>job.id));
  container.querySelectorAll('[data-cut-job]').forEach(node=>{if(!ids.has(node.dataset.cutJob)){node.remove();jobSignatures.delete(node.dataset.cutJob);}});
  if(jobs.length)container.querySelector('.cuts-empty')?.remove();
  for(const job of [...jobs].reverse()){
    const old=[...container.querySelectorAll('[data-cut-job]')].find(n=>n.dataset.cutJob===job.id),signature=JSON.stringify(job);
    if(old&&jobSignatures.get(job.id)===signature)continue;
    // Keep the playing element and the review that the user is reading stable.
    if(old&&([...old.querySelectorAll('video')].some(v=>!v.paused)||editing?.jobId===job.id))continue;
    const holder=document.createElement('div');holder.innerHTML=renderJob(job);const node=holder.firstElementChild;
    if(old){
      const open=new Set([...old.querySelectorAll('details[open][data-cut-details]')].map(details=>details.dataset.cutDetails));
      for(const details of node.querySelectorAll('[data-cut-details]'))details.open=open.has(details.dataset.cutDetails);
      old.replaceWith(node);
    }else container.prepend(node);
    jobSignatures.set(job.id,signature);
  }
  if(!jobs.length&&!container.querySelector('.cuts-empty'))container.innerHTML=empty;
}

function findClip(id){for(const job of current.jobs||[]){const clip=(job.clips||[]).find(c=>c.id===id);if(clip)return {job,clip};}throw new Error('Este corte não está mais disponível. Atualize o painel.');}
async function openEditor(id,seek,format){
  const {clip,job}=findClip(id);editing?.editor?.destroy();
  document.querySelectorAll('#cuts-dialog-form video').forEach(video=>video.pause());
  if(job.hasSource===false){
    const session=editing={mode:'preparing',id,jobId:job.id,seek,format};
    const dialog=document.querySelector('#cuts-dialog'),form=document.querySelector('#cuts-dialog-form');
    document.querySelector('#cuts-dialog-title').textContent='Recuperar vídeo para ajustar';dialog.dataset.mode='edit';
    form.innerHTML=`<p class="notice">O vídeo original deste projeto precisa ser recuperado. O download usa a melhor qualidade disponível de imagem e áudio e preserva os cortes e envios anteriores. Você pode fechar esta janela; a recuperação continua em segundo plano.</p><p id="cut-source-preparation" role="status">Preparando recuperação…</p><p id="cut-source-preparation-error" class="error-banner" role="alert" hidden></p><div class="dialog-footer"><button class="button" type="button" data-cuts-action="close-dialog">Cancelar</button><button id="cut-source-prepare-retry" class="button primary" type="button" data-cuts-action="edit" data-id="${helpers.esc(id)}" hidden>Tentar recuperar novamente</button></div>`;
    if(!dialog.open)dialog.showModal();
    try{
      let source=await apiClient('/cuts/jobs/'+encodeURIComponent(job.id)+'/prepare-source',{});
      while(editing===session&&dialog.open&&!source.ready){
        if(source.status==='failed')throw new Error(source.error||'Não foi possível recuperar o vídeo original. Tente novamente.');
        form.querySelector('#cut-source-preparation').textContent=(jobLabels[source.status]||'Recuperando vídeo original')+'… Você poderá ajustar assim que a fonte estiver pronta.';
        await new Promise(resolve=>setTimeout(resolve,1000));
        if(editing!==session||!dialog.open)return;
        source=await apiClient('/cuts/jobs/'+encodeURIComponent(job.id)+'/source-status');
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
  editing.editor=createCutEditor({clip:format?{...clip,framing_options:{...clip.framing_options,format}}:clip,job,esc:helpers.esc,api:apiClient});
  if(!document.querySelector('#cuts-dialog').open)document.querySelector('#cuts-dialog').showModal();
  if(seek!==undefined){editing.editor.selectReplayStart(seek);const details=document.querySelector('.cuts-replay-details');details.open=true;details.scrollIntoView({block:'nearest'});}
}
function openPublish(id,platform='youtube'){
  const {clip,job}=findClip(id),{esc}=helpers,format=clip.framing_options?.format||'shorts';editing={mode:'publish',id,jobId:job.id,revision:clip.revision,format};
  document.querySelector('#cuts-dialog-title').textContent='Postar corte';
  delete document.querySelector('#cuts-dialog').dataset.mode;
  const form=document.querySelector('#cuts-dialog-form');form.innerHTML=cutPublishFields(clip,esc,platform);
  editing.canPublish=updateCutDestination(form,clip,current.channels||[],esc);
  form.querySelector('[type="submit"]').disabled=!editing.canPublish;
  document.querySelector('#cuts-dialog').showModal();
}

export function openCutPublication({clip,job},channels,h,channelId){
  remember({cuts:{...current,jobs:[{...job,clips:[clip]}],channels}},h);
  openPublish(clip.id,'tiktok');
  document.querySelector('#cuts-dialog-form').elements.namedItem('channelId').value=channelId;
}

function libraryJobs(){return visibleJobs().map(job=>({...job,clips:(job.clips||[]).filter(clip=>clip.hasMedia&&clip.status!=='discarded')})).filter(job=>job.clips.length);}
function libraryJob(job){return `<div class="cuts-library-project" data-cut-job="${helpers.esc(job.id)}">${job.clips.map(clip=>clipCard(clip,job,true)).join('')}</div>`;}
const emptyLibrary='<div class="panel empty-state cuts-empty"><h3>Nenhum corte com arquivo disponível</h3><p>Os cortes prontos aparecem nesta pasta automaticamente.</p></div>';
export function renderCutLibrary(state,h){
  remember({...state,cuts:state.cutFolders||state.cuts},h);const groups=libraryJobs();
  for(const job of groups)jobSignatures.set(job.id,JSON.stringify(job));
  return `<section id="cuts-library" class="cuts-library"><div class="page-head"><div><h2>Cortes do aplicativo</h2><p>Assista, ajuste ou escolha onde publicar.</p></div></div><div id="cut-library-jobs">${groups.length?groups.map(libraryJob).join(''):emptyLibrary}</div><div id="cut-library-pagination">${renderPagination(current.pagination,state.cutFolders?'cutFolders':'cuts',h.esc)}</div></section>`;
}
export function updateCutLibrary(state,h){
  remember({...state,cuts:state.cutFolders||state.cuts},h);const root=document.querySelector('#cuts-library');if(!root)return;
  root.querySelector('#cut-library-pagination').innerHTML=renderPagination(current.pagination,state.cutFolders?'cutFolders':'cuts',h.esc);
  syncCutJobs(root.querySelector('#cut-library-jobs'),libraryJobs(),libraryJob,emptyLibrary);
}

export function bindCuts({api,refresh,toast}){
  apiClient=api;
  const dialog=document.querySelector('#cuts-dialog');
  function feedback(form,message=''){
    let alert=form.querySelector('#cuts-dialog-feedback');
    if(!alert){alert=document.createElement('p');alert.id='cuts-dialog-feedback';alert.className='cuts-dialog-feedback';alert.setAttribute('role','alert');(form.querySelector('.dialog-footer')||form).prepend(alert);}
    alert.textContent=message;alert.hidden=!message;
  }
  dialog.addEventListener('close',()=>{editing?.editor?.destroy();dialog.querySelectorAll('video').forEach(v=>v.pause());editing=null;delete dialog.dataset.mode;void refresh(true);});
  function publishFormat(){
    if(editing?.mode!=='publish')return;
    const form=document.querySelector('#cuts-dialog-form'),changed=form.elements.namedItem('format').value!==editing.format;
    form.querySelector('#cut-format-change').hidden=!changed;
    form.querySelector('[type="submit"]').disabled=changed||!editing.canPublish||Boolean(editing.pending);
  }
  dialog.addEventListener('change',event=>{if(editing?.mode!=='publish')return;if(event.target.name==='platform'){const form=document.querySelector('#cuts-dialog-form');editing.canPublish=updateCutDestination(form,findClip(editing.id).clip,current.channels||[],helpers.esc);form.elements.namedItem('confirm').checked=false;}if(['platform','format'].includes(event.target.name))publishFormat();});
  document.addEventListener('submit',async event=>{
    const form=event.target;if(!['cuts-create-form','cuts-dialog-form'].includes(form.id))return;
    event.preventDefault();const button=form.querySelector('[type="submit"]'),session=form.id==='cuts-dialog-form'?editing:null;
    if(!button||button.dataset.busy||session?.pending)return;
    if(session)feedback(form);
    if(session)session.pending=true;button.disabled=true;button.dataset.busy='1';
    try{
      const f=new FormData(form);
      if(form.id==='cuts-create-form'){
        await api('/cuts',{url:f.get('url'),count:Number(f.get('count')),targetSeconds:Number(f.get('targetSeconds')),language:f.get('language')});form.reset();resetPagination('cuts');await refresh(true);toast('Projeto na fila. Acompanhe a geração dos cortes abaixo.');
      }else if(session?.mode==='edit'){
        const body=session.editor.read();
        const result=await api(path(session.id),{...body,versionId:session.versionId},'PUT');if(editing===session&&dialog.open)dialog.close();await refresh(true);toast(result.createdVersion?'Nova versão criada. Aguarde a prévia para revisar e postar.':'Ajustes salvos. Aguarde a nova prévia antes de postar.');
      }else if(session?.mode==='publish'){
        if(f.get('format')!==session.format)throw new Error('Gere e confira a prévia no formato escolhido antes de postar.');
        await api(path(session.id)+'/publish',{format:session.format,channelId:f.get('channelId'),title:f.get('title'),description:f.get('description'),confirm:f.has('confirm'),revision:session.revision,...(f.get('platform')==='tiktok'?{tiktok:readTiktokFields(form)}:{visibility:f.get('visibility'),madeForKids:f.has('madeForKids'),containsSyntheticMedia:f.has('containsSyntheticMedia')})});const follow=editing===session&&dialog.open&&f.get('platform')==='tiktok';if(editing===session&&dialog.open)dialog.close();if(follow)location.hash='#browser';await refresh(true);toast(f.get('platform')==='tiktok'?'Envio autorizado. Acompanhe o Playwright e a janela do Chrome.':'Envio autorizado e colocado na fila. Acompanhe a confirmação no histórico.');
      }
    }catch(error){if(session&&editing===session&&dialog.open)feedback(form,error.message);toast(error.message,true);}finally{if(session)session.pending=false;button.disabled=false;delete button.dataset.busy;if(form.id==='cuts-create-form')button.disabled=!current.dependencies?.ready;if(editing===session&&dialog.open)publishFormat();}
  });
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-cuts-action]');if(!button)return;const action=button.dataset.cutsAction,id=button.dataset.id;
    button.disabled=true;
    try{
      if(action==='refresh')await refresh(true);
      else if(action==='edit'){const pending=editing?.mode==='preparing'&&editing.id===id?editing:{};await openEditor(id,pending.seek,pending.format);}
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
    }catch(error){toast(error.message,true);}finally{button.disabled=false;}
  });
}
