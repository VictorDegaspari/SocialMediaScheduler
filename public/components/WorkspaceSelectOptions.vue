<script setup>
defineProps(['options']);
</script>

<template>
  <option v-for="option in options" :key="option.value" :value="option.value" :disabled="option.disabled">
    {{ option.label }}
  </option>
</template>
