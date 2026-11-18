<script setup lang="ts">
import RequestOrders from './RequestOrders.vue';
import RequestCompose from './RequestCompose.vue';
import RequestProfiles from './RequestProfiles.vue';
import RequestAccounts from './RequestAccounts.vue';
import {requestViews} from './request-model.js';
import type {RequestsSnapshot} from './request-model.js';
defineProps<RequestsSnapshot>();
</script>

<template>
  <div class="page-head requests-page-head"><div><h1>Pedidos e contas</h1><p class="subtitle">Agende seus vídeos e acompanhe os pedidos.</p></div></div>
  <div class="requests-tabs" role="tablist" aria-label="Pedidos e contas">
    <button v-for="[id, label] in requestViews" :id="'requests-tab-' + id" :key="id" type="button" role="tab" :aria-controls="'requests-view-' + id" :aria-selected="view === id" :tabindex="view === id ? 0 : -1" :data-requests-view="id">{{ label }}<span v-if="id === 'profiles'" class="requests-tab-count">{{ state.publishing.profiles.length }}</span></button>
  </div>
  <section id="requests-view-orders" role="tabpanel" aria-labelledby="requests-tab-orders" :hidden="view !== 'orders'"><div class="requests-layout">
    <div class="requests-main"><RequestOrders :publishing="state.publishing" :pagination="pagination" :date="date" /></div>
    <RequestCompose :profiles="state.publishing.profiles" :tiktok-ready="Boolean(state.connections.playwrightMcp?.configured)" :revision="revisions.request" :schedule="schedule" />
  </div></section>
  <section id="requests-view-profiles" role="tabpanel" aria-labelledby="requests-tab-profiles" :hidden="view !== 'profiles'"><RequestProfiles :state="state" :editing="editing" :revision="revisions.profile" /></section>
  <section id="requests-view-accounts" role="tabpanel" aria-labelledby="requests-tab-accounts" :hidden="view !== 'accounts'"><RequestAccounts :state="state" :revision="revisions.browser" /></section>
</template>
