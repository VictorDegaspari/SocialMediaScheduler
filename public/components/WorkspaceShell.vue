<script setup lang="ts">
import {onMounted, onUnmounted, ref} from 'vue';
import ConnectionIcon from './ConnectionIcon.js';
import {workspaceNavigation, workspacePages, type WorkspaceShellState} from './workspace-shell.js';

defineProps<{model: WorkspaceShellState}>();
const root = document.documentElement;
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const theme = ref<'light' | 'dark'>(root.dataset.theme === 'dark' ? 'dark' : 'light');
let manualTheme = root.hasAttribute('data-theme-preference');

function applyTheme(next: 'light' | 'dark') {
  theme.value = next;
  root.dataset.theme = next;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#141c2b' : '#edf1f6');
}

function syncSystemTheme() {
  if (!manualTheme) applyTheme(systemTheme.matches ? 'dark' : 'light');
}

function toggleTheme() {
  const next = theme.value === 'dark' ? 'light' : 'dark';
  manualTheme = true;
  root.setAttribute('data-theme-preference', '');
  applyTheme(next);
  try { localStorage.setItem('drive-watcher-theme', next); } catch {}
}

const clock = ref('--:--');
const time = new Intl.DateTimeFormat('pt-BR', {timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'});
let timer: ReturnType<typeof setInterval>;
onMounted(() => {
  if (manualTheme) applyTheme(theme.value);
  else syncSystemTheme();
  systemTheme.addEventListener('change', syncSystemTheme);
  const update = () => { clock.value = time.format(new Date()); };
  update();
  timer = setInterval(update, 1000);
});
onUnmounted(() => {
  clearInterval(timer);
  systemTheme.removeEventListener('change', syncSystemTheme);
});
</script>

<template>
  <aside class="sidebar">
    <a class="brand" href="#overview"><span class="brand-icon" aria-hidden="true">↗</span><span>Drive <span class="brand-light">Watcher</span></span></a>
    <nav aria-label="Navegação principal">
      <div v-for="group in workspaceNavigation" :key="group.id" class="nav-group" role="group"
        :aria-labelledby="'nav-group-' + group.id">
        <h2 :id="'nav-group-' + group.id">{{ group.label }}</h2>
        <div class="nav-group-links">
          <a v-for="{id, label, icon} in group.pages" :key="id" :href="'#' + id" :data-page="id"
            :class="{active: model.page === id, 'nav-primary': id === 'cuts'}" :aria-current="model.page === id ? 'page' : undefined">
            <span :data-icon="icon"><ConnectionIcon :name="icon" /></span><span>{{ label }}</span>
            <span v-if="id === 'watches'" id="nav-count" class="nav-count">{{ model.folderCount }}</span>
            <span v-if="id === 'requests'" id="manual-count" class="nav-count" :hidden="!model.actionCount">{{ model.actionCount }}</span>
          </a>
        </div>
      </div>
    </nav>
    <div class="sidebar-bottom">
      <div class="local-pill"><ConnectionIcon name="monitor" /> Execução local</div>
    </div>
  </aside>
  <div class="workspace">
    <header class="topbar">
      <div class="breadcrumb"><span class="breadcrumb-prefix">Workspace <span>/</span></span> <strong id="breadcrumb">{{ workspacePages.find(page => page.id === model.page)?.label }}</strong></div>
      <div class="top-right">
        <span id="connection-status" class="connection-status" :class="{offline: model.offline}"><span class="dot"></span> {{ model.connectionLabel }}</span>
        <span class="timezone-label">São Paulo <time id="local-clock">{{ clock }}</time></span>
        <button type="button" class="button theme-toggle" aria-label="Modo escuro" :aria-pressed="theme === 'dark'"
          :title="theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'" @click="toggleTheme">
          <ConnectionIcon :name="theme === 'dark' ? 'sun' : 'moon'" />
        </button>
      </div>
    </header>
    <main v-once id="main" aria-live="polite"></main>
    <footer class="footer"><span>Drive Watcher <span class="version">v0.1</span></span><span>Local e persistente</span></footer>
  </div>
  <dialog id="watch-dialog" aria-labelledby="dialog-title">
    <div class="dialog-head"><div><span class="eyebrow">NOVA AUTOMAÇÃO</span><h2 id="dialog-title">{{ model.watchEditing ? 'Editar rotina' : 'Adicionar uma pasta' }}</h2></div>
      <button type="button" class="icon-button" data-action="close-dialog" aria-label="Fechar">×</button></div>
    <form v-once id="watch-form"></form>
  </dialog>
  <dialog id="delivery-dialog" class="platform-review" aria-labelledby="delivery-title" :data-platform="model.deliveryPlatform">
    <div class="dialog-head"><div><span class="eyebrow">MOTOR LOCAL</span><h2 id="delivery-title">{{ model.deliveryPlatform === 'youtube' ? 'Revisar vídeo do YouTube' : model.deliveryPlatform === 'tiktok' ? 'Revisar envio para o TikTok' : 'Revisar envio' }}</h2></div>
      <button type="button" class="icon-button" data-action="close-review" aria-label="Fechar revisão">×</button></div>
    <form v-once id="delivery-form"></form>
  </dialog>
  <dialog v-once id="cuts-dialog" class="cuts-dialog" aria-labelledby="cuts-dialog-title">
    <div class="dialog-head"><div><span class="eyebrow">GERADOR DE CORTES</span><h2 id="cuts-dialog-title">Revisar corte</h2></div>
      <button type="button" class="icon-button" data-cuts-action="close-dialog" aria-label="Fechar revisão do corte">×</button></div>
    <form id="cuts-dialog-form"></form>
  </dialog>
  <div v-once id="immediate-video-host"></div>
  <div id="toast" role="status" :class="{error: model.toastError}" :hidden="!model.toastVisible">{{ model.toastMessage }}</div>
</template>
