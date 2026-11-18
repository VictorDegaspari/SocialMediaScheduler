import {cutFormats} from './cuts-editor.js';

export function tiktokFields(){
  return `<fieldset data-tiktok-fields hidden disabled><legend>Publicação no TikTok</legend><p class="tip">O Chrome será aberto pelo Playwright para publicar agora no perfil escolhido, com visibilidade pública. Acompanhe as etapas na tela TikTok pelo navegador.</p><label class="checkbox"><input type="checkbox" name="tiktokMadeWithAI"><span>Contém conteúdo realista alterado ou gerado por IA.</span></label><label class="checkbox"><input type="checkbox" name="allowComment"><span>Permitir comentários</span></label><label class="checkbox"><input type="checkbox" name="allowDuet"><span>Permitir duetos</span></label><label class="checkbox"><input type="checkbox" name="allowStitch"><span>Permitir costura</span></label><label class="checkbox"><input type="checkbox" name="commercialContent"><span>Conteúdo comercial ou parceria paga</span></label><label class="checkbox"><input type="checkbox" name="ownBrand"><span>Promove minha marca</span></label></fieldset>`;
}

export function readTiktokFields(form){
  const f=new FormData(form);
  return {privacyLevel:'PUBLIC_TO_EVERYONE',contentPostingMethod:'DIRECT_POST',madeWithAI:f.has('tiktokMadeWithAI'),allowComment:f.has('allowComment'),allowDuet:f.has('allowDuet'),allowStitch:f.has('allowStitch'),commercialContent:f.has('commercialContent'),ownBrand:f.has('ownBrand')};
}

export function cutPublishFields(clip,esc,platform='youtube'){
  const format=clip.framing_options?.format||'shorts';
  return `<video class="cuts-publish-preview" controls playsinline preload="metadata" src="/api/cuts/${encodeURIComponent(clip.id)}/media?v=${Number(clip.revision)||0}" aria-label="Prévia final do corte"></video><div class="notice">Confira o formato, o enquadramento e as legendas. O envio usa exatamente esta versão da prévia.</div>
    <div class="form-field"><label for="cut-platform">Onde postar?</label><select id="cut-platform" name="platform"><option value="youtube" ${platform==='youtube'?'selected':''}>YouTube</option><option value="tiktok" ${platform==='tiktok'?'selected':''}>TikTok · postar agora</option></select></div>
    <div class="form-field"><label for="cut-publish-format">Publicar como</label><select id="cut-publish-format" name="format">${cutFormats.map(([value,label])=>`<option value="${value}" ${value===format?'selected':''}>${label}</option>`).join('')}</select></div><div id="cut-format-change" class="notice" hidden>O formato escolhido precisa de uma nova prévia. Ajuste e confira antes de postar.<button class="button small" type="button" data-cuts-action="edit-format" data-id="${esc(clip.id)}">Ajustar formato</button></div>
    <div class="form-field"><label for="cut-channel">Canal do YouTube</label><select id="cut-channel" name="channelId" required></select><small data-cut-no-channel hidden>Conecte uma conta em <a href="#connections" data-cuts-action="close-dialog">Conexões</a> para postar.</small></div>
    <div class="form-field"><label for="cut-post-title">Título no YouTube</label><input id="cut-post-title" name="title" maxlength="100" value="${esc(clip.title)}" required></div><div class="form-field"><label for="cut-post-description">Descrição</label><textarea id="cut-post-description" name="description" rows="3" maxlength="4900">${platform==='youtube'&&format==='shorts'?'#Shorts':''}</textarea></div>
    <fieldset data-youtube-fields><legend>YouTube</legend><div class="form-field"><label for="cut-visibility">Visibilidade</label><select id="cut-visibility" name="visibility"><option value="private">Privado</option><option value="unlisted">Não listado</option><option value="public">Público</option></select></div><label class="checkbox"><input type="checkbox" name="madeForKids"><span>Este conteúdo é destinado a crianças.</span></label><label class="checkbox"><input type="checkbox" name="containsSyntheticMedia"><span>Contém conteúdo realista alterado ou gerado por IA.</span></label></fieldset>
    ${tiktokFields()}<label class="checkbox"><input type="checkbox" name="confirm" required><span data-cut-consent></span></label><div class="dialog-footer"><button class="button" type="button" data-cuts-action="close-dialog">Cancelar</button><button class="button primary" type="submit">Autorizar e enviar</button></div>`;
}

export function updateCutDestination(form,clip,channels,esc){
  const tiktok=form.elements.namedItem('platform').value==='tiktok';
  const available=channels.filter(channel=>!channel.disabled&&channel.identifier===(tiktok?'tiktok-browser':'youtube'));
  const previous=form.elements.namedItem('channelId').value;
  form.elements.namedItem('channelId').innerHTML='<option value="">Escolha a conta de destino</option>'+available.map(channel=>`<option value="${esc(channel.id)}" ${(clip.publications||[]).some(delivery=>delivery.integration_id===channel.id)?'disabled':''}>${esc(channel.name)}${(clip.publications||[]).some(delivery=>delivery.integration_id===channel.id)?' · envio no histórico':''}</option>`).join('');
  if(available.some(channel=>channel.id===previous))form.elements.namedItem('channelId').value=previous;
  form.querySelector('[for="cut-channel"]').textContent=tiktok?'Perfil do TikTok':'Canal do YouTube';
  form.querySelector('[for="cut-post-title"]').textContent=tiktok?'Título do vídeo':'Título no YouTube';
  for(const [selector,enabled] of [['[data-youtube-fields]',!tiktok],['[data-tiktok-fields]',tiktok]]){const fieldset=form.querySelector(selector);fieldset.hidden=!enabled;fieldset.disabled=!enabled;}
  form.querySelector('[data-cut-consent]').textContent=tiktok?'Revisei este vídeo e autorizo a publicação agora, com visibilidade pública, no perfil TikTok escolhido.':'Revisei o vídeo e a legenda e autorizo o envio ao canal e com a visibilidade escolhidos acima.';
  form.querySelector('[type="submit"]').textContent=tiktok?'Autorizar e postar agora':'Autorizar e enviar';
  form.querySelector('[data-cut-no-channel]').hidden=available.length>0;
  form.elements.namedItem('description').maxLength=tiktok?2000:4900;
  return available.some(channel=>!(clip.publications||[]).some(delivery=>delivery.integration_id===channel.id));
}
