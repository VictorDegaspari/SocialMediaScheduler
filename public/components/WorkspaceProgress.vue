<script setup lang="ts">
defineProps<{message: string}>();
</script>

<template>
  <span class="workspace-progress" role="status">
    <span class="workspace-spinner" aria-hidden="true"></span>
    {{ message }}
  </span>
</template>
