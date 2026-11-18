<script setup lang="ts">
import CollectionPagination from './CollectionPagination.vue';
import {requestStatuses, requestPlatform} from './request-model.js';
import type {PublishingContext, RequestPagination, RequestDate} from './request-model.js';
defineProps<{publishing: PublishingContext; pagination: RequestPagination; date: RequestDate}>();
const finished = (status: string) => ['completed', 'cancelled'].includes(status);
</script>

<template>
  <section v-if="publishing.actions.length || publishing.pagination?.actions" class="panel requests-attention">
    <div class="requests-section-head"><h2>Precisa de você</h2></div>
    <div v-for="action in publishing.actions" :key="action.id" class="notice requests-action">
      <strong>{{ action.profile_name }} · {{ requestPlatform(action.provider) }}</strong><p>{{ action.message }}</p>
      <div class="form-actions">
        <a class="button small" :href="action.href">Abrir pendência</a>
        <template v-if="action.kind === 'unknown_upload' || action.kind === 'delivery_review'">
          <button class="button small" data-request-action="resolve" :data-id="action.id" data-resolution="checked_not_scheduled">Conferi: não agendado; usar próximo</button>
          <button v-if="action.provider === 'tiktok'" class="button small" data-request-action="resolve" :data-id="action.id" data-resolution="checked_scheduled">Conferi no TikTok: agendado</button>
        </template>
        <button v-else class="button small" data-request-action="resume" :data-id="action.request_id">Já resolvi; verificar novamente</button>
      </div>
    </div>
    <p v-if="!publishing.actions.length" class="requests-note">Nenhuma pendência nesta página.</p>
    <CollectionPagination scope="actions" :page="pagination.actions" />
  </section>
  <section class="panel requests-orders">
    <div class="requests-section-head"><h2>Seus pedidos</h2></div>
    <article v-for="request in publishing.requests" :key="request.id" class="notice requests-order">
      <div class="requests-order-heading"><div><span class="requests-platform">{{ requestPlatform(request.provider) }}</span><h3>{{ request.profile_name }}</h3></div><span class="badge" :class="request.status === 'waiting_manual' ? 'amber' : request.status === 'completed' ? '' : 'gray'">{{ requestStatuses[request.status] || request.status }}</span></div>
      <div class="requests-progress-label"><strong>{{ request.confirmed }} / {{ request.quantity }} confirmados</strong><span v-if="!finished(request.status)">{{ request.reserved }} em preparação · {{ request.waiting }} na fila</span></div>
      <progress :value="request.confirmed" :max="request.quantity" :aria-label="`Agendamentos confirmados de ${request.profile_name} no ${requestPlatform(request.provider)}`"></progress>
      <p class="requests-order-schedule">{{ request.config?.cadence?.times?.join(' · ') || 'Sem horário definido' }} <span>· {{ request.config?.cadence?.timezone === 'America/Sao_Paulo' ? 'São Paulo' : request.config?.cadence?.timezone || 'São Paulo' }}</span></p>
      <details :id="'request-detail-' + request.id" class="requests-details">
        <summary>Detalhes do pedido</summary><p>{{ request.message || 'Aguardando o próximo ciclo.' }}</p><p>Criado em {{ date(request.created_at, true) }}.</p>
        <template v-if="!finished(request.status)"><div class="form-actions"><button class="button small danger" data-request-action="cancel" :data-id="request.id">Cancelar restante do pedido</button></div><p class="requests-note">Agendamentos já confirmados continuam na plataforma.</p></template>
      </details>
    </article>
    <div v-if="!publishing.requests.length" class="requests-empty"><span class="requests-empty-symbol" aria-hidden="true">↗</span><h3>Seu primeiro pedido começa aqui</h3><p>Escolha um perfil e os horários em “Novo pedido” para começar a agendar seus vídeos.</p></div>
    <CollectionPagination scope="requests" :page="pagination.requests" />
  </section>
</template>
