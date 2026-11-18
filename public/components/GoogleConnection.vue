<script setup lang="ts">
import ConnectionTitle from './ConnectionTitle.vue';
import {vConnectionValue} from './connection-form.js';
import type {GoogleConnection, IconRenderer} from './connection-types.js';

defineProps<{connection: GoogleConnection; icon: IconRenderer}>();
</script>

<template>
  <section class="panel connection-card connection-service" aria-label="Conexão Google Drive">
    <ConnectionTitle name="Google Drive" icon-name="drive" :status="connection.connected ? 'Conectado' : connection.configured ? 'Autorização pendente' : 'Não conectado'" :tone="connection.connected ? '' : connection.configured ? 'amber' : 'gray'" :icon="icon" />
    <p class="connections-description">Busque vídeos nas suas pastas do Drive.</p>
    <div class="connections-account"><p>{{ connection.connected ? 'Suas pastas podem ser usadas nos perfis e nas rotinas.' : connection.configured ? 'Autorize o acesso para buscar os vídeos das pastas cadastradas.' : 'Conecte sua conta para usar vídeos salvos na nuvem.' }}</p></div>
    <div class="connections-actions">
      <a v-if="connection.configured" class="button" :class="connection.connected ? '' : 'primary'" href="/auth/google">{{ connection.connected ? 'Reconectar' : 'Autorizar Google' }}</a>
      <button v-else class="button primary" type="button" data-connection-setup="google-setup">Configurar Google Drive</button>
      <a v-if="connection.connected" class="button" href="#watches">Ver pastas</a>
    </div>
    <details id="google-setup" class="connections-details">
      <summary>Credenciais do Google Drive</summary>
      <p class="connections-help">No Google Cloud, habilite a Google Drive API e crie um cliente OAuth do tipo “Aplicativo da Web”.</p>
      <form id="google-form">
        <div class="form-field"><label for="client-id">Client ID</label><input id="client-id" v-connection-value="connection.clientId || ''" name="clientId" placeholder="seu-client-id.apps.googleusercontent.com" required autocomplete="off"></div>
        <div class="form-field"><label for="client-secret">Client Secret</label><input id="client-secret" v-connection-value="''" name="clientSecret" type="password" :placeholder="connection.configured ? 'Já salvo · deixe vazio para manter' : 'Seu Client Secret'" :required="!connection.configured" autocomplete="new-password"></div>
        <div class="form-field"><span class="field-label">URI de redirecionamento autorizada</span><code class="code">{{ connection.callbackUrl || '' }}</code><small>Cadastre este endereço no cliente OAuth.</small></div>
        <div class="form-actions"><button class="button primary" type="submit">Salvar credenciais</button><button v-if="connection.connected" type="button" class="button ghost danger" data-action="disconnect-google">Desconectar</button></div>
      </form>
    </details>
  </section>
</template>
