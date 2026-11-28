<script setup>
import ConnectionIcon from './ConnectionIcon.js';
import StatusBadge from './StatusBadge.vue';
import FolderSchedule from './FolderSchedule.vue';
defineProps(['items', 'date', 'scheduleApi', 'onScheduleChanged']);
function cadence(w){
  if(w.cadence==='daily')return (w.times||[]).join(' · ');
  const minutes=Number(w.interval_minutes)||0;
  return minutes%60===0?`A cada ${minutes/60} ${minutes===60?'hora':'horas'}`:`A cada ${minutes} ${minutes===1?'minuto':'minutos'}`;
}
</script>

<template>
  <div v-if="items.length" class="watch-list">
    <article v-for="w in items" :key="w.id" class="watch-card" :data-watch-id="w.id">
      <div class="watch-top">
        <div class="folder-icon">
          <ConnectionIcon :name="w.source_type==='local'?'monitor':w.source_type==='gta6_pack'?'folder':'drive'" />
        </div>
        <div class="watch-info">
          <h3>
            {{ w.name }}
            <StatusBadge :label="w.enabled?'Ativa':'Pausada'" :tone="w.enabled?'':'gray'" />
          </h3>
          <a v-if="w.source_type === 'gta6_pack'" href="https://monetizecomgta6.netlify.app/" target="_blank" rel="noreferrer">Pack GTA 6 · Catálogo automático</a>
          <span v-else-if="w.source_type === 'local'" class="local-path" :title="w.folder_url">{{ w.folder_url }}</span>
          <a v-else :href="'https://drive.google.com/drive/folders/' + encodeURIComponent(w.folder_id)" target="_blank" rel="noreferrer">
            Google Drive ·
            {{ w.folder_id.slice(-16) }}
            <ConnectionIcon name="external" />
          </a>
        </div>
        <div class="watch-actions">
          <button class="icon-button" data-action="scan-watch" :data-id="w.id" :aria-label="'Verificar ' + (w.name) + ' agora'" title="Verificar agora">
            <ConnectionIcon name="refresh" />
          </button>
          <button class="icon-button" data-action="edit-watch" :data-id="w.id" :aria-label="'Editar ' + (w.name)" title="Editar pasta">
            <ConnectionIcon name="edit" />
          </button>
          <button class="icon-button" data-action="toggle-watch" :data-id="w.id" :aria-label="(w.enabled?'Pausar':'Retomar') + ' ' + (w.name)" :title="w.enabled?'Pausar':'Retomar'">
            <ConnectionIcon :name="w.enabled?'pause':'play'" />
          </button>
        </div>
      </div>
      <dl class="folder-metrics">
        <div>
          <dt>{{ w.cadence==='daily'?'Envios diários':'Frequência de envio' }}</dt>
          <dd>{{ cadence(w) }}</dd>
        </div>
        <div>
          <dt>Na fila</dt>
          <dd>{{ Number(w.pending_count)||0 }} {{ Number(w.pending_count)===1?'vídeo':'vídeos' }}</dd>
        </div>
        <div>
          <dt>Próximo envio</dt>
          <dd>
            <template v-if="w.mode==='native_schedule'">Agendamento em lote</template>
            <template v-else>{{ w.next_upload_at?date(w.next_upload_at,true):'A definir' }}</template>
          </dd>
        </div>
      </dl>
      <template v-if="w.last_error">
        <p class="watch-error">{{ w.last_error }}</p>
      </template>
      <FolderSchedule v-if="scheduleApi" :folder-id="w.id" :name="w.name" :api="scheduleApi" :on-changed="onScheduleChanged" />
      <details class="folder-details" :data-folder-details="w.id">
        <summary>Configurações da pasta</summary>
        <dl>
          <div>
            <dt>Origem</dt>
            <dd>{{ {gta6_pack: 'Pack GTA 6', local: 'Pasta local'}[w.source_type] || 'Google Drive' }}</dd>
          </div>
          <template v-if="w.source_type==='local'">
            <div>
              <dt>Caminho</dt>
              <dd>
                <code>{{ w.folder_url }}</code>
              </dd>
            </div>
          </template>
          <div>
            <dt>Destino</dt>
            <dd>{{ w.integration_ids?.length ? w.integration_ids.length + ' '+(w.integration_ids.length===1?'canal':'canais'):'Nenhum canal selecionado' }}</dd>
          </div>
          <div>
            <dt>Novos arquivos</dt>
            <dd>Verificação a cada {{ Number(w.scan_minutes)||5 }} min</dd>
          </div>
          <div>
            <dt>Subpastas</dt>
            <dd>{{ w.recursive?'Incluídas':'Só esta pasta' }}</dd>
          </div>
          <div>
            <dt>Publicação</dt>
            <dd>{{ {draft:'Preparar para revisão',schedule:'YouTube automático',native_schedule:'Agendar lote no YouTube'}[w.mode]||'Preparar para revisão' }}</dd>
          </div>
        </dl>
      </details>
    </article>
  </div>
  <div v-else class="panel empty-state">
    <div class="empty-symbol">
      <ConnectionIcon name="folder" />
    </div>
    <h3>Sua primeira rotina começa com uma pasta</h3>
    <p>Adicione uma pasta local ou do Google Drive para organizar os envios.</p>
    <button class="button small" data-action="new-watch">
      <ConnectionIcon name="plus" />
      Adicionar minha primeira pasta
    </button>
  </div>
</template>
