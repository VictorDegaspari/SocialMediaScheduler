export function renderConnections(state,channels,helpers) {
  const {head}=helpers,n=state.connections.native;
  return `<div id="connections-panel">${head('Conexões','Contas e fontes de vídeo em um só lugar.','',false)}
    <section class="connections-group" aria-labelledby="connections-publishing"><div class="connections-section-head"><h2 id="connections-publishing">Onde publicar</h2></div><div class="connections-grid">${n.engine==='local'?youtubeConnection(state,helpers):postizConnection(state,channels,helpers)}${tiktokConnection(state,helpers)}</div></section>
    <section class="connections-group" aria-labelledby="connections-sources"><div class="connections-section-head"><h2 id="connections-sources">De onde vêm os vídeos</h2></div><div class="connections-grid">${googleConnection(state,helpers)}${localConnection(state,helpers)}</div></section>
    ${publisherSettings(state,helpers)}</div>`;
}

function connectionTitle(name,iconName,status,tone,{icon,badge}) {
  return `<div class="connection-title"><div class="folder-icon">${icon(iconName)}</div><h3>${name}</h3>${badge(status,tone)}</div>`;
}

function youtubeConnection(state,helpers) {
  const {esc}=helpers,y=state.connections.native.youtube;
  return `<section class="panel connection-card platform-card connection-service" data-platform="youtube" aria-label="Conexão YouTube">
    ${connectionTitle('YouTube','youtube',y.connected?'Conectado':y.configured?'Autorização pendente':'Não conectado',y.connected?'':y.configured?'amber':'gray',helpers)}
    <p class="connections-description">Publique e agende vídeos nos seus canais.</p><div class="connections-account">${y.connected?`<span>Canal conectado</span><strong>${esc(y.account||'YouTube')}</strong>`:'<p>Conecte um canal para começar a enviar vídeos.</p>'}</div>
    <div class="connections-actions">${y.configured?`<a class="button primary" href="/auth/youtube">${y.connected?'Adicionar conta YouTube':'Autorizar YouTube'}</a>`:'<button class="button primary" type="button" data-connection-setup="youtube-setup">Configurar YouTube</button>'}<a class="button" href="#requests" data-requests-view="accounts">Gerenciar contas</a></div>
    <details id="youtube-setup" class="connections-details"><summary>Credenciais e permissões do YouTube</summary><p class="connections-help">No Google Cloud, habilite a YouTube Data API v3 e crie um cliente OAuth do tipo “Aplicativo da Web”.</p><form id="youtube-form">
      <div class="form-field"><label for="youtube-client-id">Client ID do YouTube</label><input id="youtube-client-id" name="clientId" value="${esc(y.clientId||'')}" required autocomplete="off"></div>
      <div class="form-field"><label for="youtube-client-secret">Client Secret do YouTube</label><input id="youtube-client-secret" name="clientSecret" type="password" placeholder="${y.configured?'Já salvo · deixe vazio para manter':'Seu Client Secret'}" ${y.configured?'':'required'} autocomplete="new-password"></div>
      <div class="form-field"><span class="field-label">Callback do YouTube</span><code class="code">${esc(y.callbackUrl||'')}</code><small>Cadastre este endereço no cliente OAuth. Permissões: youtube.upload e youtube.readonly.</small></div>
      <label class="checkbox"><input name="autoPublishApproved" type="checkbox" ${y.autoPublishApproved?'checked':''}><span>Autorizo os envios automáticos do YouTube nos horários das rotinas. A visibilidade vem do JSON de cada vídeo; o padrão é privado.</span></label>
      <div class="form-actions"><button class="button primary" type="submit">Salvar YouTube</button>${y.connected?'<button class="button ghost danger" type="button" data-action="disconnect-native" data-provider="youtube">Desconectar YouTube</button>':''}</div>
    </form></details></section>`;
}

function tiktokTokenFields(state,{esc}) {
  const mcp=state.connections.playwrightMcp||{configured:false,source:null};
  return `<details id="playwright-mcp-setup" class="connections-details" ${mcp.configured?'':'open'}><summary>Token de automação do TikTok</summary><section class="connections-mcp" aria-labelledby="playwright-mcp-title"><div class="connections-mcp-heading"><h4 id="playwright-mcp-title">Token da automação</h4><span id="playwright-mcp-status" class="badge ${mcp.configured?'':'gray'}" data-source="${esc(mcp.source||'')}">${mcp.source==='input'?'Token salvo no painel':mcp.source==='environment'?'Token definido no ambiente':'Token não configurado'}</span></div><p class="connections-help">Obrigatório para configurar o TikTok e iniciar novos envios. Cole o token exibido na extensão Playwright do seu navegador.</p>
      <form id="playwright-mcp-form"><div class="form-field"><label for="playwright-extension-token">PLAYWRIGHT_MCP_EXTENSION_TOKEN</label><input id="playwright-extension-token" name="extensionToken" type="password" maxlength="4096" autocomplete="new-password" autocapitalize="off" spellcheck="false" placeholder="${mcp.configured?'Já configurado · deixe vazio para manter':'Cole apenas o valor do token'}" ${mcp.configured?'':'required'}><small>${mcp.source==='environment'?'O valor salvo aqui terá prioridade sobre o ambiente.':mcp.configured?'Deixe vazio para manter o token já configurado.':'Copie o valor mostrado na página da extensão Playwright.'}</small></div><div class="form-actions"><button class="button" type="submit">Salvar token</button>${mcp.source==='input'?'<button class="button ghost danger" type="button" data-playwright-remove>Remover token salvo</button>':''}</div></form></section></details>`;
}

function tiktokConnection(state,helpers) {
  const profiles=state.publishing?.browserProfiles||[],saved=profiles.filter(p=>p.profileSaved).length,tokenReady=!!state.connections.playwrightMcp?.configured;
  return `<section class="panel connection-card platform-card connection-service" data-platform="tiktok" aria-label="Conexão TikTok">
    ${connectionTitle('TikTok','tiktok',!tokenReady?'Token obrigatório':saved?'Sessão salva':profiles.length?'Login necessário':'Não configurado',!tokenReady?'amber':saved?'':profiles.length?'amber':'gray',helpers)}
    <p class="connections-description">Use seu login no Chrome para publicar vídeos.</p><div class="connections-account"><span>Contas no navegador</span><strong>${profiles.length?`${saved} de ${profiles.length} com sessão salva`:'Nenhuma conta adicionada'}</strong></div>
    <div class="connections-actions"><a class="button primary" href="#browser">Abrir TikTok navegador</a><a class="button" href="#requests" data-requests-view="accounts">Gerenciar contas</a></div>${tiktokTokenFields(state,helpers)}
  </section>`;
}

function googleConnection(state,helpers) {
  const {esc}=helpers,g=state.connections.google;
  return `<section class="panel connection-card connection-service" aria-label="Conexão Google Drive">
    ${connectionTitle('Google Drive','drive',g.connected?'Conectado':g.configured?'Autorização pendente':'Não conectado',g.connected?'':g.configured?'amber':'gray',helpers)}
    <p class="connections-description">Busque vídeos nas suas pastas do Drive.</p><div class="connections-account"><p>${g.connected?'Suas pastas podem ser usadas nos perfis e nas rotinas.':g.configured?'Autorize o acesso para buscar os vídeos das pastas cadastradas.':'Conecte sua conta para usar vídeos salvos na nuvem.'}</p></div>
    <div class="connections-actions">${g.configured?`<a class="button ${g.connected?'':'primary'}" href="/auth/google">${g.connected?'Reconectar':'Autorizar Google'}</a>`:'<button class="button primary" type="button" data-connection-setup="google-setup">Configurar Google Drive</button>'}${g.connected?'<a class="button" href="#watches">Ver pastas</a>':''}</div>
    <details id="google-setup" class="connections-details"><summary>Credenciais do Google Drive</summary><p class="connections-help">No Google Cloud, habilite a Google Drive API e crie um cliente OAuth do tipo “Aplicativo da Web”.</p><form id="google-form">
      <div class="form-field"><label for="client-id">Client ID</label><input id="client-id" name="clientId" value="${esc(g.clientId||'')}" placeholder="seu-client-id.apps.googleusercontent.com" required autocomplete="off"></div>
      <div class="form-field"><label for="client-secret">Client Secret</label><input id="client-secret" name="clientSecret" type="password" placeholder="${g.configured?'Já salvo · deixe vazio para manter':'Seu Client Secret'}" ${g.configured?'':'required'} autocomplete="new-password"></div>
      <div class="form-field"><span class="field-label">URI de redirecionamento autorizada</span><code class="code">${esc(g.callbackUrl||'')}</code><small>Cadastre este endereço no cliente OAuth.</small></div>
      <div class="form-actions"><button class="button primary" type="submit">Salvar credenciais</button>${g.connected?'<button type="button" class="button ghost danger" data-action="disconnect-google">Desconectar</button>':''}</div>
    </form></details></section>`;
}

function localConnection(state,helpers) {
  const {esc}=helpers;
  return `<section class="panel connection-card connection-service" aria-label="Conexão pastas locais">${connectionTitle('Pastas locais','monitor','Disponível','',helpers)}
    <p class="connections-description">Use os vídeos que estão no seu computador.</p><div class="connections-account"><span>Pasta de vídeos</span><code class="code">${esc(state.connections.local.rootPath)}</code></div><div class="connections-actions"><a class="button" href="#watches">Abrir minhas pastas</a></div></section>`;
}

function postizConnection(state,channels,helpers) {
  const {esc,icon}=helpers,p=state.connections.postiz;
  return `<section class="panel connection-card connection-service" aria-label="Conexão Postiz">${connectionTitle('Postiz','link',p.configured?'Configurado':'Não conectado',p.configured?'':'gray',helpers)}
    <p class="connections-description">Publique usando os canais conectados no Postiz.</p><div id="channels-list" class="channel-list">${channels.map(c=>`<span class="channel-chip platform-chip" data-platform="${c.identifier==='youtube'?'youtube':'tiktok'}">${icon(c.identifier==='youtube'?'youtube':'tiktok')} ${esc(c.name)}${c.disabled?' · desabilitado':''}</span>`).join('')||'<p class="connections-help">Nenhum canal carregado.</p>'}</div>
    <div class="connections-actions"><button class="button ${p.configured?'':'primary'}" type="button" data-connection-setup="postiz-setup">${p.configured?'Editar conexão':'Conectar Postiz'}</button>${p.configured?'<button class="button" type="button" data-action="reload-channels">Atualizar canais</button>':''}</div>
    <details id="postiz-setup" class="connections-details"><summary>Credenciais e permissões do Postiz</summary><form id="postiz-form">
      <div class="form-field"><label for="postiz-url">URL da API</label><input id="postiz-url" name="baseUrl" type="url" value="${esc(p.baseUrl||'')}" placeholder="https://api.postiz.com/public/v1" required><small>Instalação local: http://host.docker.internal:4007/api/public/v1</small></div>
      <div class="form-field"><label for="postiz-key">Chave da API</label><input id="postiz-key" name="apiKey" type="password" placeholder="${p.configured?'Já salva · deixe vazio para manter':'Disponível em Configurações → Desenvolvedor'}" ${p.configured?'':'required'} autocomplete="new-password"></div>
      <label class="checkbox"><input type="checkbox" name="youtubeSchedulingApproved" ${p.youtubeSchedulingApproved?'checked':''}><span>Verifiquei o acesso do meu canal YouTube e autorizo envios para agendamento. Sem esta opção, use rascunhos.</span></label><div class="form-actions"><button class="button primary" type="submit">Salvar e verificar</button></div>
    </form></details></section>`;
}

function publisherSettings(state,{esc}) {
  const n=state.connections.native,q=state.scheduler.queue;
  return `<details id="connections-advanced" class="panel connections-advanced"><summary><span>Configurações avançadas</span><span class="connections-engine-label">${n.engine==='local'?'Publicação local':'Publicação pelo Postiz'}</span></summary>
    <div class="connections-advanced-body"><h2>Motor de publicação</h2><p class="connections-help">Escolha o serviço que gerencia os envios. Ao trocar, selecione os canais correspondentes nas suas rotinas.</p><form id="engine-form"><div class="form-field"><label for="publisher-engine">Quem gerencia as publicações?</label><select id="publisher-engine" name="engine"><option value="local" ${n.engine==='local'?'selected':''}>Neste computador</option><option value="postiz" ${n.engine==='postiz'?'selected':''}>Postiz</option></select></div><button class="button" type="submit">Salvar motor</button></form><p class="queue-status">Fila: ${esc(q?.backend||'Redis')} · ${q?.unavailable?'indisponível':`${q?.waiting||0} aguardando · ${q?.active||0} em execução`}</p>

    </div></details>`;
}

// Preserve unsaved credentials in the DOM only, including while another form saves.
export function updateConnections(state,channels,helpers) {
  const panel=document.querySelector('#connections-panel');
  const drafts=Array.from(panel.querySelectorAll('form')).map(form=>({id:form.id,fields:Array.from(form.elements).filter(e=>{
    if(!e.name)return false;
    if(e.type==='checkbox')return e.checked!==e.defaultChecked;
    if(e.tagName==='SELECT')return e.value!==Array.from(e.options).find(o=>o.defaultSelected)?.value;
    return e.value!==e.defaultValue;
  }).map(e=>({name:e.name,value:e.value,checked:e.checked,type:e.type}))}));
  const details=Array.from(panel.querySelectorAll('details')).map(e=>({id:e.id,open:e.open}));
  const active=document.activeElement,focusId=panel.contains(active)?active.id:null;
  panel.outerHTML=renderConnections(state,channels,helpers);
  for(const draft of drafts) {
    const form=document.getElementById(draft.id);if(!form)continue;
    for(const field of draft.fields) {
      const input=form.elements.namedItem(field.name);if(!input)continue;
      if(field.type==='checkbox')input.checked=field.checked;else input.value=field.value;
    }
  }
  for(const {id,open} of details){const detail=document.getElementById(id);if(detail)detail.open=open;}
  if(focusId)document.getElementById(focusId)?.focus({preventScroll:true});
}

export function bindConnections({api,refresh,toast}) {
  let savingMcp=false;
  async function saveMcp(form,remove=false){
    if(savingMcp)return;savingMcp=true;
    const button=form.querySelector(remove?'[data-playwright-remove]':'[type=submit]');button.disabled=true;
    try{
      await api('/settings/playwright-mcp',remove?{}:{extensionToken:form.elements.namedItem('extensionToken').value||undefined},remove?'DELETE':'POST');
      form.elements.namedItem('extensionToken').value='';await refresh(true);toast(remove?'Token salvo removido. Se houver um token no ambiente, ele será usado.':'Token da extensão salvo. Novas conexões MCP usarão este valor.');
    }catch(error){toast(error.message,true);}finally{savingMcp=false;button.disabled=false;}
  }
  document.addEventListener('submit',event=>{if(event.target.id!=='playwright-mcp-form')return;event.preventDefault();void saveMcp(event.target);});
  document.addEventListener('click',event=>{
    const remove=event.target.closest('[data-playwright-remove]');if(remove){void saveMcp(remove.closest('form'),true);return;}
    const button=event.target.closest('[data-connection-setup]');if(!button)return;
    const detail=document.getElementById(button.dataset.connectionSetup);if(!detail)return;
    detail.open=true;detail.scrollIntoView({block:'nearest',behavior:'smooth'});detail.querySelector('input')?.focus({preventScroll:true});
  });
  document.addEventListener('invalid',event=>{
    if(!event.target.closest('#connections-panel'))return;
    for(let parent=event.target.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
  },true);
}
