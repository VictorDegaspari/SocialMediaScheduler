<script setup>
import ConnectionIcon from './ConnectionIcon.js';
import StatusBadge from './StatusBadge.vue';
import {computed} from 'vue';
import {formatSourceTimecode, formatTimecode} from '../cuts-time.js';
import CutPublications from './CutPublications.vue';
import CutClipActions from './CutClipActions.vue';
const props = defineProps(['clip', 'job', 'library', 'safeLink']);
const stamp = value => formatTimecode(Number(value) || 0, {precision: 2});
const clipLabels = {queued:'Na fila',rendering:'Atualizando prévia',review:'Revisar corte',publishing:'Envio solicitado',posted:'Enviado',discarded:'Descartado',failed:'Precisa de atenção'};
const deliveryLabels = {pending:'Na fila de envio',retry:'Aguardando nova tentativa',submitting:'Enviando ao YouTube',processing:'Processando no YouTube',published:'Publicado no YouTube',scheduled:'Agendado no YouTube',private:'Privado no YouTube',unlisted:'Não listado no YouTube',unknown:'Conferir envio no histórico',failed:'Confira o envio no histórico',cancelled:'Envio cancelado'};
const status = computed(() => {const {clip} = props; return clip.publications?.length ? clipLabels[clip.status] : deliveryLabels[clip.delivery_status] || clipLabels[clip.status];});
const format = computed(() => props.clip.framing_options?.format === 'video' ? 'video' : 'shorts');
const duration = computed(() => {const {clip} = props; return clip.output_duration ?? Math.max(0, Number(clip.end_seconds) - Number(clip.start_seconds) - (clip.excluded_ranges || []).reduce((total, range) => total + range.end - range.start, 0));});
</script>

<template>
  <article :class="'cuts-clip' + (library?' cuts-library-card':'')" :data-cut-clip="clip.id" :data-format="format">
    <div class="cuts-player-wrap">
      <template v-if="clip.hasMedia">
        <video class="cuts-player" controls playsinline preload="metadata" :aria-label="'Prévia de ' + (clip.title)" :src="'/api/cuts/' + (encodeURIComponent(clip.id)) + '/media?v=' + (Number(clip.revision)||0)"></video>
      </template>
      <template v-else>
        <div class="cuts-player-empty">
          <ConnectionIcon :name="clip.status==='posted'?'check':'play'" />
          <span>
            <template v-if="clip.status==='posted'">Arquivo local indisponível</template>
            <template v-else>{{ clip.status==='discarded'?'Arquivo excluído':'A prévia aparecerá aqui' }}</template>
          </span>
        </div>
      </template>
    </div>
    <div class="cuts-clip-content">
      <template v-if="library">
        <p class="cuts-library-source" :title="job.title||'Cortes gerados'">{{ job.title||'Cortes gerados' }}</p>
        <div class="cuts-clip-heading">
          <h3 :title="clip.title||'Corte sugerido'">{{ clip.title||'Corte sugerido' }}</h3>
          <template v-if="library">
            <div class="cuts-library-badges">
              <StatusBadge :label="status || clip.status" :tone="['failed','unknown'].includes(clip.delivery_status) || clip.status === 'failed' ? 'amber' : ['posted','discarded'].includes(clip.status) ? 'gray' : ''" />
              <span v-if="clip.edited_from_cut_id" class="badge gray">Versão ajustada</span>
            </div>
          </template>
          <template v-else>
            <span v-if="clip.edited_from_cut_id" class="badge gray">Versão ajustada</span>
            <StatusBadge :label="status || clip.status" :tone="['failed','unknown'].includes(clip.delivery_status) || clip.status === 'failed' ? 'amber' : ['posted','discarded'].includes(clip.status) ? 'gray' : ''" />
          </template>
        </div>
        <div class="cuts-library-meta">
          <span>
            <ConnectionIcon name="clock" />
            {{ formatTimecode(Math.round(duration)) }}
          </span>
          <span>{{ format==='video'?'Vídeo · 16:9':'Shorts · 9:16' }}</span>
        </div>
        <template v-if="clip.error">
          <p class="error-banner">{{ clip.error }}</p>
        </template>
        <CutClipActions :clip="clip" :library="true" />
        <details class="cuts-library-details" :data-cut-details="clip.id">
          <summary>
            Detalhes e publicações
            <template v-if="clip.render_warnings?.length">
              <span class="cuts-library-alert">
                <ConnectionIcon name="alert" />
                {{ clip.render_warnings.length }}
                {{ clip.render_warnings.length===1?'aviso':'avisos' }}
              </span>
            </template>
          </summary>
          <p class="cuts-timing">
            {{ formatSourceTimecode(clip.start_seconds, job.source_range, 2) }}
            →
            {{ formatSourceTimecode(clip.end_seconds, job.source_range, 2) }}
            <span>· {{ stamp(duration) }} de vídeo · {{ format==='video'?'Vídeo 16:9':'Shorts 9:16' }} · {{ {fit:'Imagem completa',blur:'Fundo desfocado',crop:'Recorte com foco',split:'Webcam em cima + vídeo embaixo'}[clip.framing_options?.mode||clip.framing]||'Imagem completa' }}</span>
          </p>
          <template v-if="clip.reason">
            <p class="cuts-reason">{{ clip.reason }}</p>
          </template>
          <template v-for="w in (clip.render_warnings||[])">
            <p class="tip cuts-render-warning">{{ w }}</p>
          </template>
          <CutPublications :publications="clip.publications || []" :safe-link="safeLink" />
          <template v-if="clip.release_url&&!clip.publications?.length">
            <a class="section-link" :href="safeLink(clip.release_url)" target="_blank" rel="noreferrer">
              Abrir no YouTube
              <ConnectionIcon name="external" />
            </a>
          </template>
          <template v-if="clip.delivery_id">
            <p class="tip">
              Acompanhe o envio em
              <a href="#history">Histórico</a>
              . O arquivo fica disponível para baixar e usar em outras plataformas. Exclua manualmente quando terminar.
            </p>
          </template>
          <template v-if="clip.hasMedia&&['review','posted','failed'].includes(clip.status)">
            <button class="button ghost danger small" data-cuts-action="discard" :data-id="clip.id">{{ clip.status==='posted'?'Excluir arquivo':'Descartar' }}</button>
          </template>
        </details>
      </template>
      <template v-else>
        <div class="cuts-clip-heading">
          <h3 :title="clip.title||'Corte sugerido'">{{ clip.title||'Corte sugerido' }}</h3>
          <template v-if="library">
            <div class="cuts-library-badges">
              <StatusBadge :label="status || clip.status" :tone="['failed','unknown'].includes(clip.delivery_status) || clip.status === 'failed' ? 'amber' : ['posted','discarded'].includes(clip.status) ? 'gray' : ''" />
              <span v-if="clip.edited_from_cut_id" class="badge gray">Versão ajustada</span>
            </div>
          </template>
          <template v-else>
            <span v-if="clip.edited_from_cut_id" class="badge gray">Versão ajustada</span>
            <StatusBadge :label="status || clip.status" :tone="['failed','unknown'].includes(clip.delivery_status) || clip.status === 'failed' ? 'amber' : ['posted','discarded'].includes(clip.status) ? 'gray' : ''" />
          </template>
        </div>
        <p class="cuts-timing">
          {{ formatSourceTimecode(clip.start_seconds, job.source_range, 2) }}
          →
          {{ formatSourceTimecode(clip.end_seconds, job.source_range, 2) }}
          <span>· {{ stamp(duration) }} de vídeo · {{ format==='video'?'Vídeo 16:9':'Shorts 9:16' }} · {{ {fit:'Imagem completa',blur:'Fundo desfocado',crop:'Recorte com foco',split:'Webcam em cima + vídeo embaixo'}[clip.framing_options?.mode||clip.framing]||'Imagem completa' }}</span>
        </p>
        <template v-if="clip.reason">
          <p class="cuts-reason">{{ clip.reason }}</p>
        </template>
        <template v-for="w in (clip.render_warnings||[])">
          <p class="tip cuts-render-warning">{{ w }}</p>
        </template>
        <template v-if="clip.error">
          <p class="error-banner">{{ clip.error }}</p>
        </template>
        <CutClipActions :clip="clip" :library="false" />
        <CutPublications :publications="clip.publications || []" :safe-link="safeLink" />
        <template v-if="clip.release_url&&!clip.publications?.length">
          <a class="section-link" :href="safeLink(clip.release_url)" target="_blank" rel="noreferrer">
            Abrir no YouTube
            <ConnectionIcon name="external" />
          </a>
        </template>
        <template v-if="clip.delivery_id">
          <p class="tip">
            Acompanhe o envio em
            <a href="#history">Histórico</a>
            . O arquivo fica disponível para baixar e usar em outras plataformas. Exclua manualmente quando terminar.
          </p>
        </template>
      </template>
    </div>
  </article>
</template>
