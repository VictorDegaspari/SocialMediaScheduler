<script setup lang="ts">
import {computed} from 'vue';
import ConnectionIcon from './ConnectionIcon.js';

const props = defineProps<{
  total: number;
  active: number;
  stats: {pending?: number; sent?: number; attention?: number};
}>();
const count = new Intl.NumberFormat('pt-BR');
const cardCount = new Intl.NumberFormat('pt-BR', {minimumIntegerDigits: 2});
const flow = computed(() => [
  {label: 'Aguardando', title: 'Vídeos aguardando', value: props.stats.pending ?? 0, icon: 'clock', accent: 'amber', detail: 'Vídeos e envios na fila'},
  {label: 'Enviadas', title: 'Publicações enviadas', value: props.stats.sent ?? 0, icon: 'upload', accent: 'mint', detail: 'Inclui agendados e rascunhos'},
  {label: 'Atenção', title: 'Precisam de atenção', value: props.stats.attention ?? 0, icon: 'alert', accent: 'rose', detail: 'Falhas ou envios incertos'},
] as const);
const cards = computed(() => [{
  title: 'Pastas monitoradas', value: props.total, icon: 'folder', accent: 'blue',
  detail: props.active === 1 ? '1 rotina ativa' : count.format(props.active) + ' rotinas ativas',
} as const, ...flow.value]);
const peak = computed(() => Math.max(1, ...flow.value.map(metric => metric.value)));
const rate = computed(() => props.total > 0 ? Math.round(100 * props.active / props.total) : null);
</script>

<template>
  <div class="stats">
    <article v-for="metric in cards" :key="metric.title" class="stat" :data-accent="metric.accent">
      <div class="stat-top">
        <h2>{{ metric.title }}</h2>
        <span class="stat-icon"><ConnectionIcon :name="metric.icon" /></span>
      </div>
      <strong class="stat-number">{{ cardCount.format(metric.value) }}</strong>
      <p class="stat-bottom">{{ metric.detail }}</p>
    </article>
  </div>
  <div class="dashboard-charts">
    <section class="panel dashboard-chart" aria-labelledby="dashboard-flow-title">
      <div class="dashboard-chart-head">
        <h2 id="dashboard-flow-title">Envios e pendências</h2>
        <a class="section-link" href="#history">Histórico <ConnectionIcon name="arrow" /></a>
      </div>
      <dl class="dashboard-columns">
        <div v-for="metric in flow" :key="metric.label" class="dashboard-column" :data-accent="metric.accent">
          <dt>{{ metric.label }}</dt>
          <dd>
            <span>{{ count.format(metric.value) }}</span>
            <span class="dashboard-column-track" aria-hidden="true">
              <span :style="{blockSize: 100 * metric.value / peak + '%'}"></span>
            </span>
          </dd>
        </div>
      </dl>
    </section>
    <section class="panel dashboard-chart" aria-labelledby="dashboard-routines-title">
      <div class="dashboard-chart-head">
        <h2 id="dashboard-routines-title">Status das rotinas</h2>
      </div>
      <div class="dashboard-routines">
        <div class="dashboard-ring" :style="{ '--dashboard-rate': (rate ?? 0) + '%' }">
          <div class="dashboard-ring-center">
            <strong>{{ rate === null ? '—' : rate + '%' }}</strong>
            <span>{{ rate === null ? 'Sem rotinas' : 'Ativas' }}</span>
          </div>
        </div>
        <dl class="dashboard-legend">
          <div data-routine-status="active"><dt>Ativas</dt><dd>{{ count.format(active) }}</dd></div>
          <div><dt>Pausadas</dt><dd>{{ count.format(Math.max(0, total - active)) }}</dd></div>
        </dl>
      </div>
    </section>
  </div>
</template>
