<script setup lang="ts">
import {computed} from 'vue';
import {vRequestValue} from './request-form.js';
import type {RequestsState} from './request-model.js';
const props = defineProps<{state: RequestsState; revision: number}>();
const publishing = computed(() => props.state.publishing);
const tiktokReady = computed(() => Boolean(props.state.connections.playwrightMcp?.configured));
</script>

<template>
  <div class="requests-accounts-grid">
    <section class="panel requests-account-panel">
      <div class="requests-section-head"><div><h2>YouTube</h2><p>Conecte seus canais e gerencie o envio automático.</p></div></div>
      <a class="button" :href="state.connections.native.youtube.configured ? '/auth/youtube' : '/#connections'">Adicionar conta YouTube</a>
      <div class="requests-account-list">
        <article v-for="account in publishing.accounts" :key="account.id" class="requests-account">
          <div><h3>{{ account.name }}</h3><span class="badge" :class="account.disabled ? 'gray' : account.autoPublishApproved ? '' : 'amber'">{{ account.disabled ? 'Desconectada' : account.autoPublishApproved ? 'Automático autorizado' : 'Autorização pendente' }}</span></div>
          <button v-if="account.identifier === 'youtube' && !account.disabled" class="button small" data-request-action="approval" :data-id="account.id" :data-approved="account.autoPublishApproved ? 'false' : 'true'" :data-name="account.name">{{ account.autoPublishApproved ? 'Desativar automático' : 'Autorizar automático' }}</button>
        </article>
        <p v-if="!publishing.accounts.length" class="requests-note">Nenhum canal conectado.</p>
      </div>
    </section>
    <section class="panel requests-account-panel">
      <div class="requests-section-head"><div><h2>TikTok</h2><p>Cada conta usa uma sessão de login separada.</p></div></div>
      <p v-if="!tiktokReady" class="requests-note">Antes de conectar uma conta TikTok, <a href="#connections">adicione o token de automação em Conexões</a>.</p>
      <div class="requests-account-list">
        <article v-for="account in publishing.browserProfiles" :key="account.id" class="requests-account"><div><h3>{{ account.name }}</h3><span class="badge" :class="account.profileSaved ? '' : 'amber'">{{ account.profileSaved ? 'Sessão salva' : 'Login necessário' }}</span></div><button :key="tiktokReady ? 'ready' : 'blocked'" class="button small" data-request-action="login" :data-id="account.id" :disabled="!tiktokReady">Abrir login</button></article>
        <p v-if="!publishing.browserProfiles.length" class="requests-note">Nenhuma conta adicionada.</p>
      </div>
      <details id="tiktok-account-add" class="requests-details"><summary>Adicionar conta TikTok</summary><form id="browser-profile-form"><div class="form-field"><label for="new-browser-profile">Nome de outra conta TikTok</label><input id="new-browser-profile" v-request-value="{value: '', revision}" name="name" required maxlength="100" placeholder="Ex.: TikTok bíblico"></div><button :key="tiktokReady ? 'ready' : 'blocked'" class="button" type="submit" :disabled="!tiktokReady">Adicionar perfil TikTok</button></form></details>
    </section>
  </div>
</template>
