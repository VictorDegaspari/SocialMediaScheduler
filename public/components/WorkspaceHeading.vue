<script setup>
import ConnectionIcon from './ConnectionIcon.js';
defineProps(['title', 'subtitle', 'eyebrow', 'action']);
</script>

<template>
  <div class="page-head">
    <div>
      <span v-if="eyebrow" class="eyebrow">{{ eyebrow }}</span>
      <h1>{{ title }}</h1>
      <p class="subtitle">{{ subtitle }}</p>
    </div>
    <button v-if="action" class="button primary" data-action="new-watch">
      <ConnectionIcon name="plus" />
      Adicionar pasta
    </button>
  </div>
</template>
