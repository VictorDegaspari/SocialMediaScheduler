import {drawWorkspace} from './build/workspace-view.js';

export function readTiktokFields(form){
  const f=new FormData(form);
  return {privacyLevel:'PUBLIC_TO_EVERYONE',contentPostingMethod:'DIRECT_POST',madeWithAI:f.has('tiktokMadeWithAI'),allowComment:f.has('allowComment'),allowDuet:f.has('allowDuet'),allowStitch:f.has('allowStitch'),commercialContent:f.has('commercialContent'),ownBrand:f.has('ownBrand')};
}

export function updateCutDestination(form,clip,channels){
  const tiktok=form.elements.namedItem('platform').value==='tiktok';
  const available=channels.filter(channel=>!channel.disabled&&channel.identifier===(tiktok?'tiktok-browser':'youtube'));
  const previous=form.elements.namedItem('channelId').value;
  const select=form.elements.namedItem('channelId');
  const used=new Set((clip.publications||[]).map(delivery=>delivery.integration_id));
  drawWorkspace(select,'selectOptions',{options:[
    {value:'',label:'Escolha a conta de destino'},
    ...available.map(channel=>({
      value:channel.id,disabled:used.has(channel.id),
      label:channel.name+(used.has(channel.id)?' · envio no histórico':''),
    })),
  ]});
  select.value=available.some(channel=>channel.id===previous)?previous:'';
  form.querySelector('[for="cut-channel"]').textContent=tiktok?'Perfil do TikTok':'Canal do YouTube';
  for(const [selector,enabled] of [['[data-youtube-fields]',!tiktok],['[data-tiktok-fields]',tiktok]]){const fieldset=form.querySelector(selector);fieldset.hidden=!enabled;fieldset.disabled=!enabled;}
  form.querySelector('[data-cut-consent]').textContent=tiktok?'Revisei este vídeo e autorizo a publicação agora, com visibilidade pública, no perfil TikTok escolhido.':'Revisei o vídeo e a legenda e autorizo o envio ao canal e com a visibilidade escolhidos acima.';
  form.querySelector('[type="submit"]').textContent=tiktok?'Autorizar e postar agora':'Autorizar e enviar';
  form.querySelector('[data-cut-no-channel]').hidden=available.length>0;
  return available.some(channel=>!used.has(channel.id));
}
