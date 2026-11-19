<script setup>
import StatusBadge from './StatusBadge.vue';
import {computed} from 'vue';
import {formatSourceTimecode, formatTimecode} from '../cuts-time.js';
import CutReplayGraph from './CutReplayGraph.vue';
import CutClipCard from './CutClipCard.vue';
const props = defineProps(['job', 'icon', 'date', 'safeLink']);
const clips = computed(() => props.job.clips || []);
const stamp = value => formatTimecode(Number(value) || 0, {precision: 2});
const jobLabels = {queued:'Na fila',downloading:'Baixando vídeo',transcribing:'Transcrevendo áudio',selecting:'Selecionando momentos',rendering:'Gerando prévias',review:'Pronto para revisar',failed:'Precisa de atenção',discarded:'Descartado',completed:'Concluído'};
</script>

<template>
  <section class="cuts-job panel" :data-cut-job="job.id">
    <div class="cuts-job-head">
      <div>
        <h2>{{ job.title||'Vídeo do YouTube' }}</h2>
        <a class="cuts-source" :href="safeLink(job.url)" target="_blank" rel="noreferrer">{{ job.url }}</a>
        <small v-if="job.source_range">{{ date(job.created_at, true) }} · Trecho da origem: {{ formatSourceTimecode(0, job.source_range) }} a {{ formatTimecode(job.source_range.end, {hours: true}) }}</small>
        <small v-else>{{ date(job.created_at,true) }}{{ job.duration?` · Vídeo original: ${stamp(job.duration)}`:'' }}</small>
      </div>
      <StatusBadge :label="jobLabels[job.status]||job.status" :tone="job.status==='failed'?'amber':'gray'" />
    </div>
    <template v-if="job.analysis_message">
      <p class="notice cuts-analysis-message">{{ job.analysis_message }}</p>
    </template>
    <template v-if="job.error">
      <div class="error-banner">{{ job.error }}</div>
    </template>
    <template v-if="['queued','downloading','transcribing','selecting','rendering'].includes(job.status)">
      <div class="cuts-progress" role="status">
        <span class="cuts-spinner" aria-hidden="true"></span>
        <span>{{ jobLabels[job.status] }}… O processamento continua com esta página fechada.</span>
      </div>
    </template>
    <template v-if="job.duration&&!['discarded','completed'].includes(job.status)">
      <div class="cuts-replay">
        <template v-if="clips.some(c=>c.status==='review')">
          <button class="cuts-replay-open" type="button" data-cuts-action="inspect-replay" :data-id="job.id" aria-label="Inspecionar momentos mais revistos deste vídeo">
            <CutReplayGraph :replay="job.replay_data" :duration="job.duration" :source-range="job.source_range" :interactive="false" />
          </button>
        </template>
        <template v-else>
          <CutReplayGraph :replay="job.replay_data" :duration="job.duration" :source-range="job.source_range" :interactive="false" />
        </template>
        <template v-if="['review','failed'].includes(job.status)">
          <button class="button small" type="button" data-cuts-action="analyze-job" :data-id="job.id">Buscar momentos mais revistos</button>
        </template>
      </div>
    </template>
    <template v-if="clips.length">
      <div class="cuts-clips">
        <template v-for="c in clips" :key="c.id">
          <CutClipCard :clip="c" :job="job" :icon="icon" :safe-link="safeLink" />
        </template>
      </div>
    </template>
    <div class="cuts-job-actions">
      <template v-if="job.status==='failed'">
        <button class="button small" data-cuts-action="retry-job" :data-id="job.id">Tentar gerar novamente</button>
        <button v-if="!job.title&&!job.hasSource&&!clips.length" class="button small" data-cuts-action="retry-source-range" :data-id="job.id">Escolher trecho</button>
      </template>
      <template v-if="!['discarded','downloading','transcribing','selecting','rendering'].includes(job.status)&&!clips.some(c=>c.status==='publishing')">
        <button class="button ghost danger small" data-cuts-action="discard-job" :data-id="job.id">Descartar projeto e liberar arquivos</button>
      </template>
    </div>
  </section>
</template>
