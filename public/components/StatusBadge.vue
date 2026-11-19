<script setup>
defineProps(['label', 'tone']);
</script>

<template>
  <span class="badge" :class="tone">{{ label }}</span>
</template>
