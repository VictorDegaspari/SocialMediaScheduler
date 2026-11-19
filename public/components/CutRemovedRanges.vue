<script setup>
import {formatSourceTimecode} from '../cuts-time.js';
defineProps(["gaps", "sourceRange"]);
</script>

<template>
  <template v-if="gaps.length">
    <template v-for="(range, i) in gaps" :key="range.start">
      <li>
        <span>
          {{ formatSourceTimecode(range.start, sourceRange, 2) }}
          →
          {{ formatSourceTimecode(range.end, sourceRange, 2) }}
          <small>{{ (range.end-range.start).toFixed(2) }} s removidos</small>
        </span>
        <button class="button ghost small" type="button" data-cut-editor-action="restore-range" :data-index="i" :aria-label="'Restaurar trecho ' + (i+1)">Restaurar</button>
      </li>
    </template>
  </template>
  <template v-else>
    <li class="cuts-no-removals">Nenhum trecho removido.</li>
  </template>
</template>
