export function bindEditorTabs(form,signal){
  const nav=form.querySelector('.cuts-editor-nav');
  const targetFor=tab=>form.querySelector('#'+CSS.escape(tab.getAttribute('aria-controls')));
  function scrollTo(target){
    const inset=parseFloat(getComputedStyle(form).paddingTop)||0;
    const top=form.scrollTop+target.getBoundingClientRect().top-form.getBoundingClientRect().top-nav.offsetHeight-inset-16;
    form.scrollTo({top:Math.max(0,top),behavior:'instant'});
  }
  function select(tab){
    for(const button of tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')){
      const active=button===tab;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;targetFor(button).hidden=!active;
    }
    targetFor(tab).dispatchEvent(new CustomEvent('cut-editor-tab-change',{bubbles:true}));
  }
  function reveal(target,{scroll=true}={}){
    if(typeof target==='string')target=form.querySelector(target);
    if(!target||!form.contains(target))return;
    const panels=[];
    for(let node=target;node&&node!==form;node=node.parentElement)if(node.matches('[data-editor-panel]'))panels.unshift(node);
    for(const panel of panels)select(form.querySelector('#'+CSS.escape(panel.getAttribute('aria-labelledby'))));
    const details=target.closest('details');if(details)details.open=true;
    if(scroll)scrollTo(target);
  }
  form.addEventListener('click',event=>{
    const tab=event.target.closest('[role="tab"][data-editor-tab]');
    if(tab){event.preventDefault();select(tab);scrollTo(tab.closest('[role="tablist"]')===nav.querySelector('[role="tablist"]')?targetFor(tab):tab.closest('[role="tablist"]'));return;}
    const preview=event.target.closest('[data-cut-editor-section="cut-editor-preview"]');
    if(preview){const target=form.querySelector('#cut-editor-preview');scrollTo(target);target.focus({preventScroll:true});}
  },{signal});
  form.addEventListener('keydown',event=>{
    const tab=event.target.closest('[role="tab"][data-editor-tab]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();const buttons=[...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')],index=buttons.indexOf(tab);
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
    select(buttons[next]);buttons[next].focus({preventScroll:true});
  },{signal});
  // Native validation must expose invalid fields even when their tab is closed.
  form.addEventListener('invalid',event=>reveal(event.target),{capture:true,signal});
  form.addEventListener('cut-editor-reveal',event=>reveal(event.target),{signal});
  const observer=new ResizeObserver(()=>form.style.setProperty('--cuts-nav-height',nav.offsetHeight+'px'));
  observer.observe(nav);signal.addEventListener('abort',()=>observer.disconnect(),{once:true});
  return {reveal};
}
