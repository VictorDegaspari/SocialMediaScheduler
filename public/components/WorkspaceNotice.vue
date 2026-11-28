<script setup lang="ts">
import WorkspaceProgress from './WorkspaceProgress.vue';
defineProps<{message: string; kind?: 'loading' | 'error'}>();
</script>

<template>
  <div v-if="kind === 'loading'" class="loading"><WorkspaceProgress :message="message" /></div>
  <div v-else-if="kind === 'error'" class="error-banner workspace-load-error">
    <p role="alert">Não foi possível carregar o painel. {{ message }}</p>
    <button type="button" class="button small" data-action="refresh">Tentar novamente</button>
  </div>
  <p v-else>{{ message }}</p>
</template>
