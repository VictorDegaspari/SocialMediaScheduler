<script setup>
import ConnectionIcon from './ConnectionIcon.js';
defineProps(['events', 'icon', 'date']);
</script>

<template>
  <template v-if="events.length">
    <template v-for="e in events">
      <div class="activity-item">
        <span :class="'activity-dot ' + (e.level)"></span>
        <div>
          <p>{{ e.message }}</p>
          <small>{{ e.watch_name || 'Workspace' }}</small>
        </div>
        <time>{{ date(e.created_at) }}</time>
      </div>
    </template>
  </template>
  <template v-else>
    <div class="empty-state compact">
      <div class="empty-symbol">
        <ConnectionIcon name="history" :icon="icon" />
      </div>
      <h3>Tudo pronto para começar</h3>
      <p>As verificações e os envios vão aparecer aqui assim que sua primeira rotina rodar.</p>
    </div>
  </template>
</template>
