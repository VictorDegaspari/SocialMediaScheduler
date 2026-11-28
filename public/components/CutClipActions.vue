<script setup>
import ConnectionIcon from './ConnectionIcon.js';
import {computed} from 'vue';
const props = defineProps(['clip', 'library']);
const editable = computed(() => ['review','failed','publishing','posted'].includes(props.clip.status));
const downloadable = computed(() => props.clip.hasMedia && ['review','publishing','posted','failed'].includes(props.clip.status));
const finalReady = computed(() => downloadable.value && props.clip.finalReady !== false);
const exporting = computed(() => ['queued','rendering'].includes(props.clip.export_status));
</script>

<template>
  <div v-if="editable || downloadable" class="cuts-actions">
    <template v-if="finalReady">
      <button class="button primary small" data-cuts-action="publish" :data-id="clip.id" :aria-label="library ? 'Postar no YouTube' : undefined">
        <ConnectionIcon :name="library?'youtube':'upload'" />
        {{ library?'YouTube':'Postar' }}
      </button>
      <button class="button small" data-cuts-action="publish-tiktok" data-platform="tiktok" :data-id="clip.id" aria-label="Postar no TikTok">
        <ConnectionIcon name="tiktok" />
        {{ library?'TikTok':'Postar no TikTok' }}
      </button>
    </template>
    <template v-if="editable">
      <button class="button small" data-cuts-action="edit" :data-id="clip.id">
        <ConnectionIcon name="edit" />
        {{ clip.status==='failed'?'Ajustar e gerar novamente':'Ajustar' }}
      </button>
    </template>
    <template v-if="finalReady">
      <a class="button small" :href="'/api/cuts/' + (encodeURIComponent(clip.id)) + '/media?download=1&v=' + (Number(clip.revision)||0)" :download="(clip.title||'corte')+'.mp4'">Baixar MP4</a>
    </template>
    <button v-else-if="downloadable&&!exporting" class="button primary small" data-cuts-action="export" :data-id="clip.id">{{ clip.export_error?'Tentar gerar o MP4 final':'Gerar MP4 final' }}</button>
    <span v-if="downloadable&&exporting" class="tip" role="status">{{ clip.export_status==='queued'?'MP4 final na fila':'Gerando MP4 em alta qualidade…' }}</span>
    <template v-if="!(library)">
      <template v-if="clip.hasMedia&&['review','posted','failed'].includes(clip.status)">
        <button class="button ghost danger small" data-cuts-action="discard" :data-id="clip.id">{{ clip.status==='posted'?'Excluir arquivo':'Descartar' }}</button>
      </template>
    </template>
  </div>
  <p v-if="downloadable&&clip.export_error" class="error-banner" role="alert">{{ clip.export_error }}</p>
</template>
