import {renderPagination} from './pagination.js';

function cadence(w){
  if(w.cadence==='daily')return (w.times||[]).join(' · ');
  const minutes=Number(w.interval_minutes)||0;
  return minutes%60===0?`A cada ${minutes/60} ${minutes===60?'hora':'horas'}`:`A cada ${minutes} ${minutes===1?'minuto':'minutos'}`;
}

function folderLocation(w,{esc,icon,safeUrl}){
  if(w.source_type==='gta6_pack')return '<a href="https://monetizecomgta6.netlify.app/" target="_blank" rel="noreferrer">Pack GTA 6 · Catálogo automático</a>';
  if(w.source_type==='local')return `<span class="local-path" title="${esc(w.folder_url)}">${esc(w.folder_url)}</span>`;
  return `<a href="${esc(safeUrl('https://drive.google.com/drive/folders/'+w.folder_id))}" target="_blank" rel="noreferrer">Google Drive · ${esc(w.folder_id.slice(-16))} ${icon('external')}</a>`;
}

function folderCard(w,h){
  const {esc,icon,badge,date}=h,id=esc(w.id),source=w.source_type==='gta6_pack'?'Pack GTA 6':w.source_type==='local'?'Pasta local':'Google Drive';
  const channels=w.integration_ids?.length||0;
  return `<article class="watch-card" data-watch-id="${id}">
    <div class="watch-top"><div class="folder-icon">${icon(w.source_type==='local'?'monitor':w.source_type==='gta6_pack'?'folder':'drive')}</div>
      <div class="watch-info"><h3>${esc(w.name)} ${badge(w.enabled?'Ativa':'Pausada',w.enabled?'':'gray')}</h3>${folderLocation(w,h)}</div>
      <div class="watch-actions"><button class="icon-button" data-action="scan-watch" data-id="${id}" aria-label="Verificar ${esc(w.name)} agora" title="Verificar agora">${icon('refresh')}</button><button class="icon-button" data-action="edit-watch" data-id="${id}" aria-label="Editar ${esc(w.name)}" title="Editar pasta">${icon('edit')}</button><button class="icon-button" data-action="toggle-watch" data-id="${id}" aria-label="${w.enabled?'Pausar':'Retomar'} ${esc(w.name)}" title="${w.enabled?'Pausar':'Retomar'}">${icon(w.enabled?'pause':'play')}</button></div>
    </div>
    <dl class="folder-metrics"><div><dt>${w.cadence==='daily'?'Envios diários':'Frequência de envio'}</dt><dd>${esc(cadence(w))}</dd></div><div><dt>Na fila</dt><dd>${Number(w.pending_count)||0} ${Number(w.pending_count)===1?'vídeo':'vídeos'}</dd></div><div><dt>Próximo envio</dt><dd>${w.mode==='native_schedule'?'Agendamento em lote':w.next_upload_at?date(w.next_upload_at,true):'A definir'}</dd></div></dl>
    ${w.last_error?`<p class="watch-error">${esc(w.last_error)}</p>`:''}
    <details class="folder-details" data-folder-details="${id}"><summary>Configurações da pasta</summary><dl><div><dt>Origem</dt><dd>${source}</dd></div>${w.source_type==='local'?`<div><dt>Caminho</dt><dd><code>${esc(w.folder_url)}</code></dd></div>`:''}<div><dt>Destino</dt><dd>${channels?channels+' '+(channels===1?'canal':'canais'):'Nenhum canal selecionado'}</dd></div><div><dt>Novos arquivos</dt><dd>Verificação a cada ${Number(w.scan_minutes)||5} min</dd></div><div><dt>Subpastas</dt><dd>${w.recursive?'Incluídas':'Só esta pasta'}</dd></div><div><dt>Publicação</dt><dd>${{draft:'Preparar para revisão',schedule:'YouTube automático',native_schedule:'Agendar lote no YouTube'}[w.mode]||'Preparar para revisão'}</dd></div></dl></details>
  </article>`;
}

export function renderFolderCards(state,h,limit){
  const items=limit?state.watches.slice(0,limit):state.watches;
  return items.length?`<div class="watch-list">${items.map(w=>folderCard(w,h)).join('')}</div>`:`<div class="panel empty-state"><div class="empty-symbol">${h.icon('folder')}</div><h3>Sua primeira rotina começa com uma pasta</h3><p>Adicione uma pasta local ou do Google Drive para organizar os envios.</p><button class="button small" data-action="new-watch">${h.icon('plus')} Adicionar minha primeira pasta</button></div>`;
}

function folderSection(state,h){
  return `<div class="folders-section-heading"><div><h2 id="video-folders-title">Pastas de vídeos</h2><p>Pastas conectadas e seus horários de envio.</p></div></div>${renderFolderCards(state,h)}${renderPagination(state.pagination?.watches,'watches',h.esc)}<details class="folders-help" data-folder-details="help"><summary>Como funcionam os envios?</summary><p>A verificação encontra novos arquivos. A frequência de envio determina quando o próximo vídeo da fila será processado. Se o PC estiver desligado, a rotina retoma com um envio por oportunidade.</p><a href="#browser">Postar um vídeo agora no TikTok ${h.icon('arrow')}</a></details>`;
}

export function renderFoldersPage(state,h,library){
  return `<div id="my-folders" class="my-folders"><div class="page-head"><div><span class="eyebrow">SUA BIBLIOTECA</span><h1>Minhas pastas</h1><p class="subtitle">Seus cortes e pastas de vídeos em um só lugar.</p></div><div class="folders-page-actions"><a class="button" href="#cuts">${h.icon('plus')} Gerar novos cortes</a><button class="button primary" data-action="new-watch">${h.icon('folder')} Adicionar pasta</button></div></div><nav class="folders-shortcuts" aria-label="Seções de Minhas pastas"><button type="button" data-folder-jump="cuts-library" aria-controls="cuts-library">${h.icon('play')} Cortes salvos</button><button type="button" data-folder-jump="watch-routines" aria-controls="watch-routines">${h.icon('folder')} Pastas de vídeos</button></nav>${library}<section id="watch-routines" aria-labelledby="video-folders-title">${folderSection(state,h)}</section></div>`;
}

export function updateFoldersPage(state,h){
  const section=document.querySelector('#my-folders #watch-routines');if(!section)return;
  const open=new Set([...section.querySelectorAll('details[open]')].map(details=>details.dataset.folderDetails));
  section.innerHTML=folderSection(state,h);
  for(const details of section.querySelectorAll('details'))details.open=open.has(details.dataset.folderDetails);
}

export function bindFoldersPage(){
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-folder-jump]');if(!button)return;
    const target=document.getElementById(button.dataset.folderJump);
    if(target)target.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  });
}
