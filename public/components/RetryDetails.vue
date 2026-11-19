<script setup>
defineProps(['item', 'date']);
</script>

<template>
  <template v-if="item.attempts">
    <small>{{ Number(item.attempts) }} tentativa(s) realizada(s).</small>
  </template>
  <template v-if="item.status==='retry'&&item.retryAt">
    <small>Próxima tentativa automática: {{ date(item.retryAt,true) }}.</small>
  </template>
</template>
