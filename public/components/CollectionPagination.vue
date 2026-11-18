<script setup lang="ts">
import type {PaginationView} from './request-model.js';
defineProps<{scope: string; page: PaginationView}>();
</script>

<template>
  <!-- Replace navigation on a page change so the legacy pending click cannot re-enable its old button. -->
  <nav v-if="page" :key="page.page + ':' + page.cursor" class="pagination" :aria-label="'Paginação: ' + scope">
    <button type="button" class="button small" :data-pagination-scope="scope" data-pagination-direction="prev" :disabled="page.previousDisabled">← Anterior</button>
    <span class="pagination-label" aria-live="polite">Página {{ page.page }}</span>
    <button type="button" class="button small" :data-pagination-scope="scope" data-pagination-direction="next" :data-pagination-cursor="page.cursor" :disabled="page.nextDisabled">Próxima →</button>
  </nav>
</template>
