const defaults={watches:20,events:20,videos:20,cuts:10,cutFolders:10,requests:20,actions:20,browser:20};
const histories=new Map();
const history=scope=>{
  if(!Object.hasOwn(defaults,scope))throw new Error('Lista de paginação desconhecida.');
  if(!histories.has(scope))histories.set(scope,{cursors:[null],index:0});
  return histories.get(scope);
};

export function resetPagination(scope){histories.delete(scope);}

export function paginationQuery(){
  const query=new URLSearchParams();
  for(const [scope,limit] of Object.entries(defaults)){
    query.set(scope+'Limit',String(limit));
    const current=history(scope),cursor=current.cursors[current.index];
    if(cursor)query.set(scope+'Cursor',cursor);
  }
  return '?'+query;
}

// Deletions or resolved actions can empty an older page while it is open.
export function resetEmptyPages(state){
  const collections={watches:[state.watches,state.pagination?.watches],events:[state.events,state.pagination?.events],videos:[state.videos,state.pagination?.videos],
    cuts:[state.cuts?.jobs,state.cuts?.pagination],cutFolders:[state.cutFolders?.jobs,state.cutFolders?.pagination],requests:[state.publishing?.requests,state.publishing?.pagination?.requests],
    actions:[state.publishing?.actions,state.publishing?.pagination?.actions],browser:[state.browser?.jobs,state.browser?.pagination]};
  let changed=false;
  for(const [scope,[items,meta]] of Object.entries(collections)){
    if(meta&&Array.isArray(items)&&items.length===0&&history(scope).index>0){resetPagination(scope);changed=true;}
  }
  return changed;
}

export function paginationView(meta,scope){
  if(!meta)return null;
  const current=history(scope);
  if(!current.index&&!meta.hasMore)return null;
  return {page:current.index+1,previousDisabled:!current.index,nextDisabled:!(meta.hasMore&&meta.nextCursor),cursor:meta.nextCursor||''};
}

export function bindPagination({refresh,toast}){
  let busy=false;
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-pagination-scope]');
    if(!button||button.disabled||busy)return;
    const scope=button.dataset.paginationScope,current=history(scope),before={cursors:[...current.cursors],index:current.index};
    if(button.dataset.paginationDirection==='prev'){
      if(!current.index)return;
      current.index--;
    }else{
      const cursor=button.dataset.paginationCursor;if(!cursor)return;
      current.cursors=current.cursors.slice(0,current.index+1);current.cursors.push(cursor);current.index++;
    }
    busy=true;button.disabled=true;
    try{
      if(await refresh(true)===false)throw new Error('Não foi possível carregar esta página. Tente novamente.');
    }catch(error){histories.set(scope,before);toast?.(error.message,true);}
    finally{busy=false;if(button.isConnected)button.disabled=false;}
  });
}
