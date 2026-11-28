<script setup lang="ts">
import ConnectionTitle from './ConnectionTitle.vue';
import {vConnectionValue} from './connection-form.js';
import type {YoutubeConnection} from './connection-types.js';

defineProps<{connection: YoutubeConnection}>();
</script>

<template>
  <section class="panel connection-card platform-card connection-service" data-platform="youtube" aria-label="Conexão YouTube">
    <ConnectionTitle name="YouTube" icon-name="youtube" :status="connection.connected ? 'Conectado' : connection.configured ? 'Autorização pendente' : 'Não conectado'" :tone="connection.connected ? '' : connection.configured ? 'amber' : 'gray'" />
    <p class="connections-description">Publique e agende vídeos nos seus canais.</p>
    <div class="connections-account">
      <template v-if="connection.connected"><span>Canal conectado</span><strong>{{ connection.account || 'YouTube' }}</strong></template>
      <p v-else>Conecte um canal para começar a enviar vídeos.</p>
    </div>
    <div class="connections-actions">
      <a v-if="connection.configured" class="button primary" href="/auth/youtube">{{ connection.connected ? 'Adicionar conta YouTube' : 'Autorizar YouTube' }}</a>
      <button v-else class="button primary" type="button" data-connection-setup="youtube-setup">Configurar YouTube</button>
      <a class="button" href="#requests" data-requests-view="accounts">Gerenciar contas</a>
    </div>
    <details id="youtube-setup" class="connections-details">
      <summary>Credenciais e permissões do YouTube</summary>
      <p class="connections-help">No Google Cloud, habilite a YouTube Data API v3 e crie um cliente OAuth do tipo “Aplicativo da Web”.</p>
      <form id="youtube-form">
        <div class="form-field"><label for="youtube-client-id">Client ID do YouTube</label><input id="youtube-client-id" v-connection-value="connection.clientId || ''" name="clientId" required autocomplete="off"></div>
        <div class="form-field"><label for="youtube-client-secret">Client Secret do YouTube</label><input id="youtube-client-secret" v-connection-value="''" name="clientSecret" type="password" :placeholder="connection.configured ? 'Já salvo · deixe vazio para manter' : 'Seu Client Secret'" :required="!connection.configured" autocomplete="new-password"></div>
        <div class="form-field"><span class="field-label">Callback do YouTube</span><code class="code">{{ connection.callbackUrl || '' }}</code><small>Cadastre este endereço no cliente OAuth. Permissões: youtube.upload e youtube.readonly.</small></div>
        <label class="checkbox"><input v-connection-value="connection.autoPublishApproved" name="autoPublishApproved" type="checkbox"><span>Autorizo os envios automáticos do YouTube nos horários das rotinas. A visibilidade vem do JSON de cada vídeo; o padrão é privado.</span></label>
        <div class="form-actions">
          <button class="button primary" type="submit">Salvar YouTube</button>
          <button v-if="connection.connected" class="button ghost danger" type="button" data-action="disconnect-native" data-provider="youtube">Desconectar YouTube</button>
        </div>
      </form>
    </details>
  </section>
</template>
