<script setup lang="ts">
defineProps<{
  text: string;
  words?: {text: string; active: boolean}[];
  color: string;
  highlightColor: string;
}>();
</script>

<template>
  <template v-if="words"><span v-for="(word, index) in words" :key="index" :style="{color: word.active ? highlightColor : color}">{{ (index ? ' ' : '') + word.text }}</span></template>
  <template v-else>{{ text }}</template>
</template>
