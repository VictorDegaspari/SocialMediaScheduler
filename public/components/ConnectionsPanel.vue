<script setup lang="ts">
import {computed} from 'vue';
import ConnectionTitle from './ConnectionTitle.vue';
import YoutubeConnection from './YoutubeConnection.vue';
import TiktokConnection from './TiktokConnection.vue';
import GoogleConnection from './GoogleConnection.vue';
import PostizConnection from './PostizConnection.vue';
import {vConnectionValue} from './connection-form.js';
import type {ConnectionsState, ConnectionChannel, IconRenderer} from './connection-types.js';

const props = defineProps<{state: ConnectionsState; channels: ConnectionChannel[]; icon: IconRenderer}>();
const connections = computed(() => props.state.connections);
const queue = computed(() => props.state.scheduler.queue);
</script>

<template>
  <div class="page-head"><div><span class="eyebrow"></span><h1>Conexões</h1><p class="subtitle">Contas e fontes de vídeo em um só lugar.</p></div></div>
  <section class="connections-group" aria-labelledby="connections-publishing">
    <div class="connections-section-head"><h2 id="connections-publishing">Onde publicar</h2></div>
    <div class="connections-grid">
      <YoutubeConnection v-if="connections.native.engine === 'local'" :connection="connections.native.youtube" :icon="icon" />
      <PostizConnection v-else :connection="connections.postiz" :channels="channels" :icon="icon" />
      <TiktokConnection :profiles="state.publishing?.browserProfiles || []" :mcp="connections.playwrightMcp || {configured: false, source: null}" :icon="icon" />
    </div>
  </section>
  <section class="connections-group" aria-labelledby="connections-sources">
    <div class="connections-section-head"><h2 id="connections-sources">De onde vêm os vídeos</h2></div>
    <div class="connections-grid">
      <GoogleConnection :connection="connections.google" :icon="icon" />
      <section class="panel connection-card connection-service" aria-label="Conexão pastas locais">
        <ConnectionTitle name="Pastas locais" icon-name="monitor" status="Disponível" tone="" :icon="icon" />
        <p class="connections-description">Use os vídeos que estão no seu computador.</p>
        <div class="connections-account"><span>Pasta de vídeos</span><code class="code">{{ connections.local.rootPath }}</code></div>
        <div class="connections-actions"><a class="button" href="#watches">Abrir minhas pastas</a></div>
      </section>
    </div>
  </section>
  <details id="connections-advanced" class="panel connections-advanced">
    <summary><span>Configurações avançadas</span><span class="connections-engine-label">{{ connections.native.engine === 'local' ? 'Publicação local' : 'Publicação pelo Postiz' }}</span></summary>
    <div class="connections-advanced-body">
      <h2>Motor de publicação</h2>
      <p class="connections-help">Escolha o serviço que gerencia os envios. Ao trocar, selecione os canais correspondentes nas suas rotinas.</p>
      <form id="engine-form">
        <div class="form-field"><label for="publisher-engine">Quem gerencia as publicações?</label><select id="publisher-engine" v-connection-value="connections.native.engine" name="engine"><option value="local">Neste computador</option><option value="postiz">Postiz</option></select></div>
        <button class="button" type="submit">Salvar motor</button>
      </form>
      <p class="queue-status">Fila: {{ queue?.backend || 'Redis' }} · {{ queue?.unavailable ? 'indisponível' : `${queue?.waiting || 0} aguardando · ${queue?.active || 0} em execução` }}</p>
    </div>
  </details>
</template>
