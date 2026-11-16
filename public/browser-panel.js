import {packDefaultsFields,readPackDefaults} from './pack-source.js';
import {nativeScheduleFields,readNativeSchedule} from './native-schedule.js';
const labels={scheduled:'Agendado no TikTok',pending:'Na fila',running:'Em andamento',cancel_requested:'Interrompendo',review:'Preparado no Chrome',empty:'Sem vídeo novo',done:'Janela encerrada',failed:'Atenção',unknown:'Conferir envio',cancelled:'Interrompido'};

export function renderBrowserPanel(state,{icon,badge,esc,date}){
  const b=state.browser;
  if(!b)return '<div class="notice">Reinicie o aplicativo para carregar a integração do navegador.</div>';
  const c=b.config,a=b.agent,busy=!!b.active||a.externalBusy,canAct=b.configured&&a.online&&a.desktop&&!busy;
  const status=!a.online?'Agente desconectado':!a.desktop?'Sessão gráfica necessária':a.externalBusy?'Janela já aberta':b.active?'Tarefa em andamento':'Pronto para receber tarefas';
  const active=b.active;
  const jobRows=b.jobs.map(j=>`<tr><td><strong>${j.kind==='login'?'Login no TikTok':'Envio de vídeo'}</strong><small>${esc(j.filename||'')}${j.origin==='schedule'?' · Rotina automática':''}</small></td><td>${badge(j.phase==='browser_review_required'&&j.status==='running'?'Revisão no Chrome':labels[j.status]||j.status,['failed','unknown'].includes(j.status)?'amber':['pending','running'].includes(j.status)?'':'gray')}</td><td>${esc(j.message||'Aguardando execução.')}${j.planned_at?`<small>Publicação reservada: ${date(j.planned_at,true)}</small>`:''}</td><td>${date(j.created_at,true)}</td></tr>`).join('');
  return `<div class="page-head"><div><span class="eyebrow">VÍDEOS LOCAIS · CHROME NO SEU COMPUTADOR</span><h1>TikTok pelo navegador</h1><p class="subtitle">Escolha a pasta e os horários para preparar vídeos ou preencher o agendador do TikTok.</p></div><button class="button" data-browser-action="refresh">${icon('refresh')} Atualizar status</button></div>
  <div class="browser-layout">
    <section class="panel connection-card platform-card browser-status-card" data-platform="tiktok">
      <div class="connection-title"><div class="folder-icon">${icon('tiktok')}</div><h2>Sua conexão com o Chrome</h2>${badge(a.online?'Agente conectado':'Desconectado',a.online?'':'gray')}</div>
      <p class="browser-state" role="status">${esc(status)}</p>
      <div class="browser-facts"><div><span>Perfil local</span><strong>${a.profileSaved?'Salvo neste computador':'Faça o primeiro login'}</strong></div><div><span>Rotina automática</span><strong>${c.enabled?'Ativa':'Pausada'}</strong></div><div><span>${c.mode==='native_schedule'?'Próxima publicação reservada':'Próxima oportunidade'}</span><strong>${c.mode==='native_schedule'?(b.calendar?.next?date(b.calendar.next,true):'Aguardando vídeos e datas disponíveis'):(c.enabled&&c.nextAt?date(c.nextAt,true):'Defina e ative os horários')}</strong></div></div>
      ${c.mode==='native_schedule'?`<p class="tip">${b.calendar?.reserved||0} reservas neste sistema + ${c.nativeSchedule?.externalScheduled||0} externas / teto ${c.nativeSchedule?.maxScheduled||10}. Uploads nas últimas 24 horas: ${b.calendar?.uploads||0} / ${c.nativeSchedule?.uploadsPer24h||10}.</p>`:''}
      ${active?`<div class="notice browser-progress"><strong>${active.kind==='login'?'Login no Chrome':'Preparação do vídeo'}</strong><p>${esc(active.message||'Aguardando o agente.')}</p>${active.filename?`<small>${esc(active.filename)}</small>`:''}</div>`:''}
      ${a.externalBusy?'<div class="notice">O perfil já está aberto em outra janela ou rotina. Conclua o login e feche as janelas desse perfil para liberar os controles.</div>':''}
      ${!a.online?'<div class="notice">Inicie o aplicativo no Ubuntu com sua sessão gráfica aberta. Se necessário, execute <code>./scripts/start-browser-agent.sh</code> na pasta do projeto.</div>':''}
      ${state.scheduler.paused?'<div class="notice">As rotinas do aplicativo estão pausadas. <button class="button small" data-browser-action="resume">Retomar rotinas</button></div>':''}
      <div class="form-actions"><button class="button primary" data-browser-action="login" ${canAct?'':'disabled'}>${icon('link')} Abrir login do TikTok</button><button class="button" data-browser-action="run" ${canAct&&a.profileSaved&&!state.scheduler.paused?'':'disabled'}>${icon('upload')} ${c.mode==='native_schedule'?'Agendar próximo agora':'Enviar próximo agora'}</button>${active?'<button class="button danger" data-browser-action="stop">Interromper tarefa</button>':''}</div>
      <p class="tip">O login abre o Chrome para você entrar manualmente, de preferência pelo QR code. Um perfil salvo não comprova que a conta continua autenticada.</p>
      <p class="tip" ${c.mode==='native_schedule'?'hidden':''}><strong>Você conclui a publicação:</strong> depois do upload, confira conta, legenda, privacidade e indicação de IA no Chrome e clique em Publicar. Feche a janela ao terminar.</p>
    </section>
    <section class="panel connection-card browser-config-card"><div class="connection-title"><div class="folder-icon">${icon('clock')}</div><h2>Pasta e horários</h2></div>
      <form id="browser-config-form">
        <div class="form-field"><label for="browser-mode">Como processar os vídeos?</label><select id="browser-mode" name="mode"><option value="review" ${c.mode!=='native_schedule'?'selected':''}>Preparar um vídeo para revisão no Chrome</option><option value="native_schedule" ${c.mode==='native_schedule'?'selected':''}>Agendar lote dentro do TikTok Studio</option></select><small>O lote respeita os horários abaixo e só registra agendamentos confirmados pelo TikTok.</small></div>
        <div id="browser-native-fields" ${c.mode==='native_schedule'?'':'hidden'}>${nativeScheduleFields(c.nativeSchedule||{},esc,'tiktok')}<p class="tip">Ative os envios automáticos para preencher o lote até o teto. Use JSON com <code>tiktok.privacyLevel: "PUBLIC_TO_EVERYONE"</code>. Conteúdo comercial exige revisão manual; a indicação de IA precisa estar disponível no Studio. Login, verificações e mudanças na interface interrompem o lote.</p></div>
        <div class="form-field"><label for="browser-source">Origem dos vídeos do TikTok</label><select id="browser-source" name="sourceType"><option value="local" ${c.sourceType!=='gta6_pack'?'selected':''}>Pasta local</option><option value="gta6_pack" ${c.sourceType==='gta6_pack'?'selected':''}>Site · Pack GTA 6</option></select></div><div id="browser-pack-fields" ${c.sourceType==='gta6_pack'?'':'hidden'}>${packDefaultsFields(c.packDefaults||{},esc,'browser')}</div><div id="browser-local-folder" class="form-field" ${c.sourceType==='gta6_pack'?'hidden':''}><label for="browser-folder">Pasta dos vídeos para o TikTok</label><input id="browser-folder" name="folder" value="${esc(c.folder)}" required maxlength="4096"><small>Use esta pasta ou uma subpasta: <code>${esc(b.rootPath)}</code>. Inclui subpastas; o JSON com o mesmo nome é opcional.</small></div>
        <div class="form-field"><label for="browser-cadence">Quando enviar pelo navegador?</label><select id="browser-cadence" name="cadence"><option value="daily" ${c.cadence==='daily'?'selected':''}>Em horários fixos, todos os dias</option><option value="interval" ${c.cadence==='interval'?'selected':''}>A cada intervalo</option></select></div>
        <div id="browser-daily" class="form-field" ${c.cadence==='daily'?'':'hidden'}><label for="browser-times">Horários do TikTok</label><input id="browser-times" name="times" value="${esc(c.times.join(', '))}" placeholder="08:00, 20:00" required><small>America/Sao_Paulo. Separe os horários por vírgula.</small></div>
        <div id="browser-interval" class="form-field" ${c.cadence==='interval'?'':'hidden'}><label for="browser-minutes">Intervalo entre envios (minutos)</label><input id="browser-minutes" name="intervalMinutes" type="number" min="1" max="43200" value="${c.intervalMinutes}" required><small>Por exemplo, 120 para um vídeo a cada duas horas.</small></div>
        <label class="checkbox"><input type="checkbox" name="stripMetadata" ${c.stripMetadata?'checked':''}><span>Remover metadados do vídeo<small>Prepara uma cópia sem tags descritivas. Preserva o original, o JSON e a declaração de IA.</small></span></label>
        <label class="checkbox"><input type="checkbox" name="enabled" ${c.enabled?'checked':''}><span>Ativar envios automáticos pelo navegador<small>No modo lote, preenche o agendador até o teto. No modo revisão, prepara um vídeo por oportunidade.</small></span></label>
        <div class="form-actions"><button class="button primary" type="submit">${icon('check')} Salvar rotina do navegador</button>${c.enabled?'<button class="button" type="button" data-browser-action="pause">Pausar rotina do navegador</button>':''}</div>
      </form>
      <p class="tip">O PC precisa estar ligado com sua sessão gráfica aberta. Enquanto uma janela estiver em revisão, o próximo vídeo aguarda. A opção “Enviar próximo agora” salva os campos acima antes de solicitar o envio.</p>
      <p class="tip">Este fluxo usa a origem escolhida acima. O Pack GTA 6 dispensa uma pasta local. As rotinas do YouTube continuam em Minhas pastas. Evite configurar o mesmo vídeo para duas formas de envio ao TikTok.</p>
    </section>
  </div>
  <section class="browser-history"><div class="section-head"><div><h2>Atividades do navegador</h2><p>Upload preparado e publicação confirmada são etapas diferentes.</p></div></div><div class="panel">${jobRows?`<div class="table-wrap"><table><thead><tr><th>TAREFA</th><th>SITUAÇÃO</th><th>ANDAMENTO</th><th>HORÁRIO</th></tr></thead><tbody>${jobRows}</tbody></table></div>`:'<div class="empty-state compact"><h3>Nenhuma tarefa solicitada</h3><p>Conecte sua conta e coloque um MP4 na pasta para iniciar.</p></div>'}</div></section>`;
}

export function bindBrowserPanel({api,refresh,toast}){
  function body(form){
    const f=new FormData(form);
    return {sourceType:f.get('sourceType'),packDefaults:readPackDefaults(form),mode:f.get('mode'),nativeSchedule:readNativeSchedule(form),folder:f.get('folder'),cadence:f.get('cadence'),intervalMinutes:Number(f.get('intervalMinutes')),
      times:String(f.get('times')).split(',').map(v=>v.trim()).filter(Boolean),stripMetadata:f.has('stripMetadata'),enabled:f.has('enabled')};
  }
  document.addEventListener('change',event=>{
    if(event.target.id==='browser-source'){const pack=event.target.value==='gta6_pack';document.querySelector('#browser-pack-fields').hidden=!pack;document.querySelector('#browser-local-folder').hidden=pack;}
    if(event.target.id==='browser-mode')document.querySelector('#browser-native-fields').hidden=event.target.value!=='native_schedule';
    if(event.target.id!=='browser-cadence')return;
    document.querySelector('#browser-daily').hidden=event.target.value!=='daily';
    document.querySelector('#browser-interval').hidden=event.target.value!=='interval';
  });
  document.addEventListener('submit',async event=>{
    if(event.target.id!=='browser-config-form')return;
    event.preventDefault();const button=event.target.querySelector('[type="submit"]');button.disabled=true;
    try{await api('/browser/config',body(event.target));await refresh(true);toast('Pasta e horários do navegador salvos.');}
    catch(error){toast(error.message,true);}finally{button.disabled=false;}
  });
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-browser-action]');if(!button)return;
    button.disabled=true;
    try{
      const action=button.dataset.browserAction;
      if(action==='refresh')await refresh(true);
      else if(action==='resume'){await api('/scheduler',{paused:false});await refresh(true);}
      else{
        if(action==='run'){
          const form=document.querySelector('#browser-config-form');if(!form.reportValidity())return;
          await api('/browser/config',body(form));
        }
        await api('/browser/'+action,{});await refresh(true);
        toast({login:'Login solicitado. Confira o Chrome no seu computador.',run:'Envio solicitado. Acompanhe o andamento abaixo.',pause:'Novos envios automáticos pausados.',stop:'Interrupção solicitada. Confira o Chrome se o upload já começou.'}[action]);
      }
    }catch(error){toast(error.message,true);}finally{button.disabled=false;}
  });
}
