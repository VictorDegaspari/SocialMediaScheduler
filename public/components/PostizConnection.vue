<script setup lang="ts">
import ConnectionTitle from './ConnectionTitle.vue';
import ConnectionIcon from './ConnectionIcon.js';
import {vConnectionValue} from './connection-form.js';
import type {PostizConnection, ConnectionChannel, IconRenderer} from './connection-types.js';

defineProps<{connection: PostizConnection; channels: ConnectionChannel[]; icon: IconRenderer}>();
</script>

<template>
  <section class="panel connection-card connection-service" aria-label="Conexão Postiz">
    <ConnectionTitle name="Postiz" icon-name="link" :status="connection.configured ? 'Configurado' : 'Não conectado'" :tone="connection.configured ? '' : 'gray'" :icon="icon" />
    <p class="connections-description">Publique usando os canais conectados no Postiz.</p>
    <div id="channels-list" class="channel-list">
      <span v-for="channel in channels" :key="channel.id" class="channel-chip platform-chip" :data-platform="channel.identifier === 'youtube' ? 'youtube' : 'tiktok'"><ConnectionIcon :name="channel.identifier === 'youtube' ? 'youtube' : 'tiktok'" :icon="icon" /> {{ channel.name }}{{ channel.disabled ? ' · desabilitado' : '' }}</span>
      <p v-if="!channels.length" class="connections-help">Nenhum canal carregado.</p>
    </div>
    <div class="connections-actions">
      <button class="button" :class="connection.configured ? '' : 'primary'" type="button" data-connection-setup="postiz-setup">{{ connection.configured ? 'Editar conexão' : 'Conectar Postiz' }}</button>
      <button v-if="connection.configured" class="button" type="button" data-action="reload-channels">Atualizar canais</button>
    </div>
    <details id="postiz-setup" class="connections-details">
      <summary>Credenciais e permissões do Postiz</summary>
      <form id="postiz-form">
        <div class="form-field"><label for="postiz-url">URL da API</label><input id="postiz-url" v-connection-value="connection.baseUrl || ''" name="baseUrl" type="url" placeholder="https://api.postiz.com/public/v1" required><small>Instalação local: http://host.docker.internal:4007/api/public/v1</small></div>
        <div class="form-field"><label for="postiz-key">Chave da API</label><input id="postiz-key" v-connection-value="''" name="apiKey" type="password" :placeholder="connection.configured ? 'Já salva · deixe vazio para manter' : 'Disponível em Configurações → Desenvolvedor'" :required="!connection.configured" autocomplete="new-password"></div>
        <label class="checkbox"><input v-connection-value="connection.youtubeSchedulingApproved" type="checkbox" name="youtubeSchedulingApproved"><span>Verifiquei o acesso do meu canal YouTube e autorizo envios para agendamento. Sem esta opção, use rascunhos.</span></label>
        <div class="form-actions"><button class="button primary" type="submit">Salvar e verificar</button></div>
      </form>
    </details>
  </section>
</template>
