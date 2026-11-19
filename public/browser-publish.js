import {openCutPublication} from './cuts-panel.js';
import {clearWorkspace,drawWorkspace} from './build/workspace-view.js';

export function bindImmediatePublication({api,refresh,toast,getState,openReview}){
  const dialog=document.createElement('dialog');dialog.id='browser-publish-dialog';dialog.className='dialog';dialog.setAttribute('aria-labelledby','browser-publish-title');document.body.append(dialog);
  let session=null;
  async function load(current){
    const version=(current.loadVersion||0)+1;current.loadVersion=version;
    const source=current.form.elements.namedItem('source').value,cursor=current.cursors[current.index];
    const response=await api((source==='cuts'?'/cuts/library':'/browser/videos')+'?limit=20'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
    if(session!==current||!dialog.open||version!==current.loadVersion||source!==current.form.elements.namedItem('source').value)return;
    current.rows=source==='cuts'?response.jobs.flatMap(job=>(job.clips||[]).filter(clip=>clip.hasMedia&&['review','posted','failed','publishing'].includes(clip.status)).map(clip=>({id:clip.id,title:clip.title,clip,job}))):response.items;
    current.channels=response.channels||current.channels;current.pagination=response.pagination;
    const select=current.form.elements.namedItem('videoId');
    drawWorkspace(select,'selectOptions',{options:[
      {value:'',label:'Escolha o vídeo'},
      ...current.rows.map(row=>({value:row.id,label:(row.title||row.name)+(row.folder?' · '+row.folder:'')+(row.clip?.finalReady===false?' · MP4 final pendente':'')})),
    ]});
    select.value='';
    current.form.querySelector('[data-immediate-empty]').hidden=current.rows.length>0;
    current.form.querySelector('[data-immediate-action="prev"]').disabled=current.index===0;
    current.form.querySelector('[data-immediate-action="next"]').disabled=!response.pagination?.hasMore;
  }
  async function open(){
    if(!getState().connections.playwrightMcp?.configured)throw new Error('Adicione o PLAYWRIGHT_MCP_EXTENSION_TOKEN em Conexões → TikTok antes de publicar.');
    const state=getState(),channels=(state.cutFolders?.channels||state.cuts?.channels||[]).filter(channel=>channel.identifier==='tiktok-browser'&&!channel.disabled);
    clearWorkspace(dialog);
    drawWorkspace(dialog,'immediateVideo',{channels});
    drawWorkspace(dialog.querySelector('#immediate-video'),'selectOptions',{options:[{value:'',label:'Carregando vídeos…'}]});
    const current={form:dialog.querySelector('form'),channels,cursors:[null],index:0,rows:[],pending:false};session=current;dialog.showModal();await load(current);
  }
  dialog.addEventListener('close',()=>{
    if(dialog.open)return;
    const videos=dialog.querySelector('#immediate-video');
    if(videos)clearWorkspace(videos);
    clearWorkspace(dialog);
    session=null;
  });
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
    const progress=form.querySelector('[data-immediate-progress]');
    const selected=current.rows.find(row=>row.id===f.get('videoId'));if(!selected)return;
    current.pending=true;button.disabled=true;errorBox.hidden=true;form.querySelectorAll('select').forEach(select=>{select.disabled=true;});
    try{
      const channelId=String(f.get('profileId'));
      if(f.get('source')==='cuts'){
        const {clip}=selected;
        if(clip.finalReady===false){
          const path='/cuts/'+encodeURIComponent(clip.id)+'/export',statusPath=path+'?v='+clip.revision;
          progress.hidden=false;progress.textContent='Gerando o MP4 em alta qualidade para revisão…';
          let result=await api(statusPath);
          if(!['ready','queued','rendering'].includes(result.status))result=await api(path,{revision:clip.revision});
          while(session===current&&dialog.open&&['queued','rendering'].includes(result.status)){
            await new Promise(resolve=>setTimeout(resolve,1500));
            if(session!==current||!dialog.open)return;
            result=await api(statusPath);
          }
          if(session!==current||!dialog.open)return;
          if(result.status!=='ready')throw new Error(result.error||'Não foi possível gerar o MP4 final. Tente novamente.');
        }
        dialog.close();openCutPublication(selected,current.channels,channelId);
      }else{
        const result=await api('/browser/videos/'+encodeURIComponent(selected.id)+'/prepare',{profileId:channelId.slice('browser:tiktok:'.length),version:selected.version});
        if(session===current&&dialog.open){dialog.close();await openReview(result.id);}else toast('Vídeo preparado. Você pode revisá-lo no Histórico.');
        await refresh(true);
      }
    }catch(error){if(session===current&&dialog.open){errorBox.textContent=error.message;errorBox.hidden=false;}toast(error.message,true);}
    finally{current.pending=false;progress.hidden=true;if(button.isConnected){button.disabled=false;form.querySelectorAll('select').forEach(select=>{select.disabled=false;});}}
  });
}
