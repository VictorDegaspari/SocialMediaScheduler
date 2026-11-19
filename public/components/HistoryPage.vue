<script setup>
import ConnectionIcon from './ConnectionIcon.js';
import StatusBadge from './StatusBadge.vue';
import CollectionPagination from './CollectionPagination.vue';
import WorkspaceHeading from './WorkspaceHeading.vue';
import WorkspaceActivity from './WorkspaceActivity.vue';
import DeliveryActions from './DeliveryActions.vue';
import RetryDetails from './RetryDetails.vue';
defineProps(['state', 'icon', 'date', 'safeUrl', 'statusLabels', 'pagination']);
</script>

<template>
  <WorkspaceHeading title="Histórico de conteúdo" subtitle="Acompanhe cada destino, corrija falhas e cancele vídeos da fila." eyebrow="ACOMPANHAMENTO" :action="false" :icon="icon" />
  <section class="panel">
    <template v-if="state.videos.length">
      <div class="table-wrap">
        <table class="queue-table">
          <thead>
            <tr>
              <th>VÍDEO / PASTA</th>
              <th>SITUAÇÃO</th>
              <th>DESTINOS E AÇÕES</th>
              <th>VÍDEO NA ORIGEM</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="v in state.videos">
              <tr>
                <td data-label="Vídeo / pasta">
                  {{ v.name }}
                  <small>{{ v.watch_name }}</small>
                  <template v-if="v.error">
                    <small>{{ v.error }}</small>
                  </template>
                  <RetryDetails :item="v" :date="date" />
                </td>
                <td data-label="Situação na origem">
                  <StatusBadge :label="statusLabels[v.status]||v.status" :tone="['failed','unknown'].includes(v.status)?'amber':['baseline','cancelled'].includes(v.status)?'gray':''" />
                </td>
                <td data-label="Destinos e ações">
                  <template v-for="d in v.deliveries" :key="d.id">
                    <div>
                      <span class="badge delivery-platform" :class="{amber: ['failed', 'unknown'].includes(d.status)}" :data-platform="d.provider === 'youtube' ? 'youtube' : 'tiktok'">
                        <ConnectionIcon :name="d.provider === 'youtube' ? 'youtube' : 'tiktok'" :icon="icon" />
                        {{ (d.provider === 'youtube' ? 'YouTube' : 'TikTok') + ' · ' + (statusLabels[d.status] || d.status) }}
                      </span>
                      <template v-if="d.channelName">
                        <small>Conta: {{ d.channelName }}</small>
                      </template>
                      <DeliveryActions :d="d" :date="date" />
                      <template v-if="d.plannedAt">
                        <small>{{ d.status==='cancelled'?'Horário cancelado':d.status==='scheduled'?'Publicação agendada':'Horário registrado' }} · {{ date(d.plannedAt,true) }}</small>
                      </template>
                      <template v-if="d.url">
                        <a :href="safeUrl(d.url)" target="_blank" rel="noreferrer" aria-label="Abrir publicação">
                          <ConnectionIcon name="external" :icon="icon" />
                        </a>
                      </template>
                      <template v-if="d.status==='unknown'&&d.engine==='postiz'">
                        <button class="button small" data-action="link-post" :data-id="d.id">Vincular post</button>
                      </template>
                    </div>
                  </template>
                  <span v-if="!v.deliveries.length" class="muted">Ainda sem envio</span>
                </td>
                <td data-label="Ações do vídeo">
                  <template v-if="v.status==='failed'">
                    <button class="button small" data-action="retry-video" :data-id="v.id">Tentar novamente</button>
                  </template>
                  <template v-if="!v.deliveries.length&&['waiting','ready','retry','failed'].includes(v.status)">
                    <button class="button small danger" data-action="cancel-video" :data-id="v.id">Cancelar vídeo</button>
                  </template>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </template>
    <template v-else>
      <div class="empty-state">
        <div class="empty-symbol">
          <ConnectionIcon name="upload" :icon="icon" />
        </div>
        <h3>Seu conteúdo vai aparecer aqui</h3>
        <p>Cadastre uma pasta local ou conecte o Google Drive para encontrar seus vídeos.</p>
        <a class="button small" href="#watches">
          Ir para minhas pastas
          <ConnectionIcon name="arrow" :icon="icon" />
        </a>
      </div>
    </template>
    <CollectionPagination :page="pagination.videos" scope="videos" />
  </section>
  <section class="history-event-list">
    <div class="section-head">
      <h2>Registro de atividades</h2>
      <button class="button small" data-action="refresh">
        <ConnectionIcon name="refresh" :icon="icon" />
        Atualizar
      </button>
    </div>
    <div class="panel">
      <WorkspaceActivity :events="state.events" :icon="icon" :date="date" />
      <CollectionPagination :page="pagination.events" scope="events" />
    </div>
  </section>
</template>
