<script setup lang="ts">
import {computed, onMounted, useTemplateRef} from 'vue';
import ConnectionTitle from './ConnectionTitle.vue';
import {vConnectionValue} from './connection-form.js';
import type {BrowserProfile, PlaywrightMcpConnection, IconRenderer} from './connection-types.js';

const props = defineProps<{profiles: BrowserProfile[]; mcp: PlaywrightMcpConnection; icon: IconRenderer}>();
const saved = computed(() => props.profiles.filter(profile => profile.profileSaved).length);
const setup = useTemplateRef<HTMLDetailsElement>('setup');
onMounted(() => {if (setup.value) setup.value.open = !props.mcp.configured;});
</script>

<template>
  <section class="panel connection-card platform-card connection-service" data-platform="tiktok" aria-label="Conexão TikTok">
    <ConnectionTitle name="TikTok" icon-name="tiktok" :status="!mcp.configured ? 'Token obrigatório' : saved ? 'Sessão salva' : profiles.length ? 'Login necessário' : 'Não configurado'" :tone="!mcp.configured ? 'amber' : saved ? '' : profiles.length ? 'amber' : 'gray'" :icon="icon" />
    <p class="connections-description">Use seu login no Chrome para publicar vídeos.</p>
    <div class="connections-account"><span>Contas no navegador</span><strong>{{ profiles.length ? `${saved} de ${profiles.length} com sessão salva` : 'Nenhuma conta adicionada' }}</strong></div>
    <div class="connections-actions"><a class="button primary" href="#browser">Abrir TikTok navegador</a><a class="button" href="#requests" data-requests-view="accounts">Gerenciar contas</a></div>
    <details id="playwright-mcp-setup" ref="setup" class="connections-details">
      <summary>Token de automação do TikTok</summary>
      <section class="connections-mcp" aria-labelledby="playwright-mcp-title">
        <div class="connections-mcp-heading"><h4 id="playwright-mcp-title">Token da automação</h4><span id="playwright-mcp-status" class="badge" :class="mcp.configured ? '' : 'gray'" :data-source="mcp.source || ''">{{ mcp.source === 'input' ? 'Token salvo no painel' : mcp.source === 'environment' ? 'Token definido no ambiente' : 'Token não configurado' }}</span></div>
        <p class="connections-help">Obrigatório para configurar o TikTok e iniciar novos envios. Cole o token exibido na extensão Playwright do seu navegador.</p>
        <form id="playwright-mcp-form">
          <div class="form-field">
            <label for="playwright-extension-token">PLAYWRIGHT_MCP_EXTENSION_TOKEN</label>
            <input id="playwright-extension-token" v-connection-value="''" name="extensionToken" type="password" maxlength="4096" autocomplete="new-password" autocapitalize="off" spellcheck="false" :placeholder="mcp.configured ? 'Já configurado · deixe vazio para manter' : 'Cole apenas o valor do token'" :required="!mcp.configured">
            <small>{{ mcp.source === 'environment' ? 'O valor salvo aqui terá prioridade sobre o ambiente.' : mcp.configured ? 'Deixe vazio para manter o token já configurado.' : 'Copie o valor mostrado na página da extensão Playwright.' }}</small>
          </div>
          <div class="form-actions"><button class="button" type="submit">Salvar token</button><button v-if="mcp.source === 'input'" class="button ghost danger" type="button" data-playwright-remove>Remover token salvo</button></div>
        </form>
      </section>
    </details>
  </section>
</template>
