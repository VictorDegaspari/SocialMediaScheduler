<script setup>
import {computed} from 'vue';
import {formatSourceTimecode} from '../cuts-time.js';
const props = defineProps(['replay', 'duration', 'interactive', 'sourceRange']);
const points = computed(() => props.replay?.status === 'available' ? props.replay.points || [] : []);
const safeDuration = computed(() => Math.max(1, Number(props.duration) || 1));
const shape = computed(() => points.value.filter(p=>Number.isFinite(p.start)&&Number.isFinite(p.end)&&Number.isFinite(p.value)).map(p=>`${Math.max(0,Math.min(1000,((p.start+p.end)/2)/safeDuration.value*1000)).toFixed(3)},${(76-Math.max(0,Math.min(1,p.value))*68).toFixed(3)}`).join(' '));
</script>

<template>
  <p v-if="!points.length" class="cuts-replay-note">{{ replay?.message || 'Busque os momentos mais revistos para consultar os dados que o YouTube disponibiliza.' }}</p>
  <template v-else>
    <svg :role="interactive ? 'slider' : 'img'" :tabindex="interactive ? 0 : undefined" :aria-label="interactive ? 'Selecionar início do corte no gráfico' : 'Interesse relativo dos momentos mais revistos no YouTube'" :aria-valuemin="interactive ? 0 : undefined" :aria-valuemax="interactive ? Math.max(0, safeDuration - .5) : undefined" :aria-valuenow="interactive ? 0 : undefined" :class="'cuts-replay-graph' + (interactive?' cuts-replay-picker':'')" viewBox="0 0 1000 84" preserveAspectRatio="none">
      <template v-if="interactive">
        <rect class="cuts-replay-window" x="0" y="0" width="0" height="84" />
      </template>
      <polyline :points="'0,80 ' + (shape) + ' 1000,80'" fill="none" stroke="currentColor" stroke-width="3" vector-effect="non-scaling-stroke" />
      <line x1="0" y1="80" x2="1000" y2="80" stroke="currentColor" opacity=".2" />
      <template v-if="interactive">
        <g class="cuts-replay-marker">
          <line x1="0" y1="0" x2="0" y2="84" />
          <circle cx="0" cy="80" r="5" />
        </g>
        <g class="cuts-replay-hover" visibility="hidden">
          <line x1="0" y1="0" x2="0" y2="84" />
          <circle cx="0" cy="80" r="4" />
        </g>
      </template>
    </svg>
    <div class="cuts-replay-ticks" aria-hidden="true">
      <span>{{ formatSourceTimecode(0, sourceRange, 0) }}</span>
      <span>{{ formatSourceTimecode(safeDuration / 2, sourceRange, 0) }}</span>
      <span>{{ formatSourceTimecode(safeDuration, sourceRange, 0) }}</span>
    </div>
    <p class="cuts-replay-note">Mais revistos no YouTube · interesse relativo, sem contagem de cliques.</p>
  </template>
</template>
