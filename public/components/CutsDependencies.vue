<script setup>
import {computed} from 'vue';
const props = defineProps(['dependencies']);
const d = computed(() => props.dependencies || {});
</script>

<template>
  <template v-if="d.ready">
    <span class="cuts-ready">
      <span class="dot"></span>
      Gerador disponível
    </span>
  </template>
  <template v-else>
    <div class="notice">
      <strong>Preparação necessária</strong>
      <p>
        <template v-for="(detail, index) in d.details || ['O gerador ainda está sendo preparado.']" :key="index">
          <br v-if="index">
          {{ detail }}
        </template>
      </p>
    </div>
  </template>
</template>
