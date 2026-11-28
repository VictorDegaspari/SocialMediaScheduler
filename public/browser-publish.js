import {openCutPublication} from './cuts-panel.js';
import {clearWorkspace,drawWorkspace} from './build/workspace-view.js';

export function bindImmediatePublication({api,refresh,toast,getState,openReview}){
  const host=document.querySelector('#immediate-video-host');
  let session=null;
  const isOpen=current=>session===current&&current.dialog.open;
  function render(current){
    drawWorkspace(host,'immediateVideo',{
      channels:current.profileOptions,
      options:current.rows.map(row=>({value:row.id,label:(row.title||row.name)+(row.folder?' · '+row.folder:'')+(row.clip?.finalReady===false?' · MP4 final pendente':'')})),
      loading:current.loading,pending:current.pending,canGoBack:current.index>0,hasMore:current.pagination?.hasMore,
      empty:current.loaded&&!current.rows.length,error:current.error,progress:current.progress,
    });
  }
  async function load(current,index){
    const version=(current.loadVersion||0)+1;current.loadVersion=version;
    const source=current.form.elements.namedItem('source').value,cursor=current.cursors[index];
    current.loading=true;render(current);
    try{
      const response=await api((source==='cuts'?'/cuts/library':'/browser/videos')+'?limit=20'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
      if(!isOpen(current)||version!==current.loadVersion||source!==current.form.elements.namedItem('source').value)return;
      current.rows=source==='cuts'?response.jobs.flatMap(job=>(job.clips||[]).filter(clip=>clip.hasMedia&&['review','posted','failed','publishing'].includes(clip.status)).map(clip=>({id:clip.id,title:clip.title,clip,job}))):response.items;
      current.channels=response.channels||current.channels;
      current.pagination=response.pagination;current.index=index;current.loaded=true;
      current.form.elements.namedItem('videoId').value='';
    }finally{
      if(isOpen(current)&&version===current.loadVersion){current.loading=false;render(current);}
    }
  }
  async function open(){
    if(!getState().connections.playwrightMcp?.configured)throw new Error('Adicione o PLAYWRIGHT_MCP_EXTENSION_TOKEN em Conexões → TikTok antes de publicar.');
    const state=getState(),channels=(state.cutFolders?.channels||state.cuts?.channels||[]).filter(channel=>channel.identifier==='tiktok-browser'&&!channel.disabled);
    clearWorkspace(host);
    const current={channels,profileOptions:channels,cursors:[null],index:0,rows:[],loading:true,pending:false};
    render(current);
    current.dialog=host.querySelector('dialog');
    current.form=current.dialog.querySelector('form');
    session=current;current.dialog.showModal();await load(current,0);
  }
  host.addEventListener('close',event=>{
    if(event.target!==session?.dialog||event.target.open)return;
    session=null;
    clearWorkspace(host);
  },true);
  host.addEventListener('change',async event=>{
    if(event.target.name!=='source'||!session)return;
    const current=session;
    current.cursors=[null];current.index=0;current.rows=[];current.pagination=null;current.loaded=false;
    try{await load(current,0);}catch(error){toast(error.message,true);}
  });
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-immediate-action]');if(!button||button.disabled)return;
    const action=button.dataset.immediateAction;
    try{
      if(action==='open')return await open();
      const current=session;if(!current)return;
      if(action==='close'){current.dialog.close();return;}
      if(current.pending||current.loading)return;
      if(action==='next'&&current.pagination?.nextCursor){
        current.cursors[current.index+1]=current.pagination.nextCursor;
        await load(current,current.index+1);
      }else if(action==='prev'&&current.index>0)await load(current,current.index-1);
    }catch(error){toast(error.message,true);}finally{if(button.isConnected&&action==='open')button.disabled=false;}
  });
  host.addEventListener('submit',async event=>{
    event.preventDefault();const current=session;if(!current||current.pending||current.loading)return;
    const f=new FormData(current.form);
    const selected=current.rows.find(row=>row.id===f.get('videoId'));if(!selected)return;
    current.pending=true;current.error='';render(current);
    try{
      const channelId=String(f.get('profileId'));
      if(f.get('source')==='cuts'){
        const {clip}=selected;
        if(clip.finalReady===false){
          const path='/cuts/'+encodeURIComponent(clip.id)+'/export',statusPath=path+'?v='+clip.revision;
          current.progress='Gerando o MP4 em alta qualidade para revisão…';render(current);
          let result=await api(statusPath);
          if(!['ready','queued','rendering'].includes(result.status))result=await api(path,{revision:clip.revision});
          while(isOpen(current)&&['queued','rendering'].includes(result.status)){
            await new Promise(resolve=>setTimeout(resolve,1500));
            if(!isOpen(current))return;
            result=await api(statusPath);
          }
          if(!isOpen(current))return;
          if(result.status!=='ready')throw new Error(result.error||'Não foi possível gerar o MP4 final. Tente novamente.');
        }
        current.dialog.close();openCutPublication(selected,current.channels,channelId);
      }else{
        const result=await api('/browser/videos/'+encodeURIComponent(selected.id)+'/prepare',{profileId:channelId.slice('browser:tiktok:'.length),version:selected.version});
        if(isOpen(current)){current.dialog.close();await openReview(result.id);}else toast('Vídeo preparado. Você pode revisá-lo no Histórico.');
        await refresh(true);
      }
    }catch(error){current.error=error.message;toast(error.message,true);}
    finally{if(isOpen(current)){current.pending=false;current.progress='';render(current);}}
  });
}
