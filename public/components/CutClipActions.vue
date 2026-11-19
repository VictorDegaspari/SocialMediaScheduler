<script setup>
import ConnectionIcon from './ConnectionIcon.js';
import {computed} from 'vue';
const props = defineProps(['clip', 'library', 'icon']);
const editable = computed(() => ['review','failed','publishing','posted'].includes(props.clip.status));
const downloadable = computed(() => props.clip.hasMedia && ['review','publishing','posted','failed'].includes(props.clip.status));
</script>

<template>
  <div v-if="editable || downloadable" class="cuts-actions">
    <template v-if="downloadable">
      <button class="button primary small" data-cuts-action="publish" :data-id="clip.id" :aria-label="library ? 'Postar no YouTube' : undefined">
        <ConnectionIcon :name="library?'youtube':'upload'" :icon="icon" />
        {{ library?'YouTube':'Postar' }}
      </button>
      <button class="button small" data-cuts-action="publish-tiktok" data-platform="tiktok" :data-id="clip.id" aria-label="Postar no TikTok">
        <ConnectionIcon name="tiktok" :icon="icon" />
        {{ library?'TikTok':'Postar no TikTok' }}
      </button>
    </template>
    <template v-if="editable">
      <button class="button small" data-cuts-action="edit" :data-id="clip.id">
        <ConnectionIcon name="edit" :icon="icon" />
        {{ clip.status==='failed'?'Ajustar e gerar novamente':'Ajustar' }}
      </button>
    </template>
    <template v-if="downloadable">
      <a class="button small" :href="'/api/cuts/' + (encodeURIComponent(clip.id)) + '/media?download=1&v=' + (Number(clip.revision)||0)" :download="(clip.title||'corte')+'.mp4'">Baixar MP4</a>
    </template>
    <template v-if="!(library)">
      <template v-if="clip.hasMedia&&['review','posted','failed'].includes(clip.status)">
        <button class="button ghost danger small" data-cuts-action="discard" :data-id="clip.id">{{ clip.status==='posted'?'Excluir arquivo':'Descartar' }}</button>
      </template>
    </template>
  </div>
</template>
