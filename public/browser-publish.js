import {openCutPublication} from './cuts-panel.js';

export function immediatePublicationCard({icon},tokenReady=true){
  return `<section class="panel immediate-publication"><div><h2>Postar agora</h2><p>Escolha um corte do aplicativo ou um vídeo de suas pastas, confira a prévia e publique no TikTok sem agendar.</p></div><button class="button primary" type="button" data-immediate-action="open" ${tokenReady?'':'disabled'}>${icon('tiktok')} Postar agora no TikTok</button></section>`;
}

export function bindImmediatePublication({api,refresh,toast,getState,openReview,helpers}){
  const dialog=document.createElement('dialog');dialog.id='browser-publish-dialog';dialog.className='dialog';dialog.setAttribute('aria-labelledby','browser-publish-title');document.body.append(dialog);
  let session=null;
  const {esc}=helpers;
  async function load(current){
    const version=(current.loadVersion||0)+1;current.loadVersion=version;
    const source=current.form.elements.namedItem('source').value,cursor=current.cursors[current.index];
    const response=await api((source==='cuts'?'/cuts/library':'/browser/videos')+'?limit=20'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
    if(session!==current||!dialog.open||version!==current.loadVersion||source!==current.form.elements.namedItem('source').value)return;
    current.rows=source==='cuts'?response.jobs.flatMap(job=>(job.clips||[]).filter(clip=>clip.hasMedia&&['review','posted','failed','publishing'].includes(clip.status)).map(clip=>({id:clip.id,title:clip.title,clip,job}))):response.items;
    current.channels=response.channels||current.channels;current.pagination=response.pagination;
    current.form.elements.namedItem('videoId').innerHTML='<option value="">Escolha o vídeo</option>'+current.rows.map(row=>`<option value="${esc(row.id)}">${esc(row.title||row.name)}${row.folder?' · '+esc(row.folder):''}</option>`).join('');
    current.form.querySelector('[data-immediate-empty]').hidden=current.rows.length>0;
    current.form.querySelector('[data-immediate-action="prev"]').disabled=current.index===0;
    current.form.querySelector('[data-immediate-action="next"]').disabled=!response.pagination?.hasMore;
  }
  async function open(){
    if(!getState().connections.playwrightMcp?.configured)throw new Error('Adicione o PLAYWRIGHT_MCP_EXTENSION_TOKEN em Conexões → TikTok antes de publicar.');
    const state=getState(),channels=(state.cutFolders?.channels||state.cuts?.channels||[]).filter(channel=>channel.identifier==='tiktok-browser'&&!channel.disabled);
    dialog.innerHTML=`<div class="dialog-head"><h2 id="browser-publish-title">Postar agora no TikTok</h2><button type="button" class="button ghost" data-immediate-action="close" aria-label="Fechar">×</button></div><form id="immediate-video-form"><div class="form-field"><label for="immediate-source">Origem do vídeo</label><select id="immediate-source" name="source"><option value="cuts">Cortes do aplicativo</option><option value="folders">Vídeos das minhas pastas</option></select></div><div class="form-field"><label for="immediate-profile">Perfil do TikTok</label><select id="immediate-profile" name="profileId" required><option value="">Escolha o perfil de destino</option>${channels.map(channel=>`<option value="${esc(channel.id)}">${esc(channel.name)}</option>`).join('')}</select>${channels.length?'':'<small>Conecte um perfil TikTok em Conexões para continuar.</small>'}</div><div class="form-field"><label for="immediate-video">Vídeo para revisar</label><select id="immediate-video" name="videoId" required><option value="">Carregando vídeos…</option></select></div><p class="tip" data-immediate-empty hidden>Nenhum vídeo disponível nesta página. Gere um corte ou verifique suas pastas em Minhas pastas.</p><div class="form-actions"><button class="button small" type="button" data-immediate-action="prev" disabled>Anterior</button><button class="button small" type="button" data-immediate-action="next" disabled>Próximos vídeos</button></div><p class="error-banner" data-immediate-error hidden role="alert"></p><p class="tip">Na próxima etapa, confira o vídeo e a legenda antes de autorizar a publicação.</p><div class="dialog-footer"><button class="button" type="button" data-immediate-action="close">Cancelar</button><button class="button primary" type="submit" ${channels.length?'':'disabled'}>Conferir prévia e legenda</button></div></form>`;
    const current={form:dialog.querySelector('form'),channels,cursors:[null],index:0,rows:[],pending:false};session=current;dialog.showModal();await load(current);
  }
  dialog.addEventListener('close',()=>{session=null;});
  dialog.addEventListener('change',async event=>{
    if(event.target.name!=='source'||!session)return;
    const current=session;current.cursors=[null];current.index=0;
    try{await load(current);}catch(error){toast(error.message,true);}
  });
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-immediate-action]');if(!button||button.disabled)return;
    const action=button.dataset.immediateAction;
    try{
      if(action==='open')return await open();
      if(action==='close'){dialog.close();return;}
      const current=session;if(!current||current.pending)return;
      if(action==='next'){if(!current.pagination?.nextCursor)return;current.cursors[++current.index]=current.pagination.nextCursor;}
      else if(action==='prev'){if(current.index===0)return;current.index--;}
      else return;
      button.disabled=true;await load(current);
    }catch(error){toast(error.message,true);}finally{if(button.isConnected&&action==='open')button.disabled=false;}
  });
  dialog.addEventListener('submit',async event=>{
    event.preventDefault();const current=session;if(!current||current.pending)return;
    const form=current.form,button=form.querySelector('[type="submit"]'),errorBox=form.querySelector('[data-immediate-error]'),f=new FormData(form);
    const selected=current.rows.find(row=>row.id===f.get('videoId'));if(!selected)return;
    current.pending=true;button.disabled=true;errorBox.hidden=true;form.querySelectorAll('select').forEach(select=>{select.disabled=true;});
    try{
      const channelId=String(f.get('profileId'));
      if(f.get('source')==='cuts'){
        dialog.close();openCutPublication(selected,current.channels,helpers,channelId);
      }else{
        const result=await api('/browser/videos/'+encodeURIComponent(selected.id)+'/prepare',{profileId:channelId.slice('browser:tiktok:'.length),version:selected.version});
        if(session===current&&dialog.open){dialog.close();await openReview(result.id);}else toast('Vídeo preparado. Você pode revisá-lo no Histórico.');
        await refresh(true);
      }
    }catch(error){if(session===current&&dialog.open){errorBox.textContent=error.message;errorBox.hidden=false;}toast(error.message,true);}
    finally{current.pending=false;if(button.isConnected){button.disabled=false;form.querySelectorAll('select').forEach(select=>{select.disabled=false;});}}
  });
}
