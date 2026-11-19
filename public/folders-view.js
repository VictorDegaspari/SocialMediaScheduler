export function bindFoldersPage(){
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-folder-jump]');if(!button)return;
    const target=document.getElementById(button.dataset.folderJump);
    if(target)target.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  });
}
