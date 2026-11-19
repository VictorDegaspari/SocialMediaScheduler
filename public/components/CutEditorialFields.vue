<script setup lang="ts">
import {onBeforeUnmount, reactive, ref, watch} from 'vue';
import type {PublicationText} from '../../src/editorial.js';
import type {EditorialPreviewApi} from './editorial-form.js';

type Platform = 'youtube' | 'tiktok';
type Suggestions = Record<Platform, PublicationText> & {evidence?: string};
const props = defineProps<{
  clipId: string;
  title: string;
  shorts: boolean;
  suggestions?: Suggestions;
  platform: Platform;
  api: EditorialPreviewApi;
  canGenerate: () => boolean;
}>();
const emit = defineEmits<{
  busyChange: [busy: boolean];
  invalidateConsent: [];
  feedback: [message: string];
  error: [message: string];
}>();

function textFields(text: PublicationText | undefined, platform: Platform) {
  const shorts = platform === 'youtube' && props.shorts;
  return {
    title: text?.title || props.title,
    description: text?.description ?? (shorts ? '#Shorts' : ''),
    hashtags: text?.hashtags.join(', ') ?? (shorts ? 'Shorts' : ''),
    youtubeTags: text?.tags.join(', ') ?? '',
  };
}

let suggestions = props.suggestions;
let automatic = textFields(suggestions?.[props.platform], props.platform);
const fields = reactive({...automatic});
const fieldNames = ['title', 'description', 'hashtags', 'youtubeTags'] as const;
const useAI = ref(false);
const busy = ref(false);
const editedDuringGeneration = new Set<keyof typeof fields>();
let active = true;
onBeforeUnmount(() => {active = false;});

watch(() => props.platform, platform => {
  if (!suggestions) return;
  const next = textFields(suggestions[platform], platform);
  for (const field of fieldNames) {
    if (fields[field] === automatic[field]) fields[field] = next[field];
  }
  automatic = next;
});

function recordEdit(field: keyof typeof fields) {
  if (busy.value) editedDuringGeneration.add(field);
}

async function generate() {
  if (busy.value || !props.canGenerate()) return;
  editedDuringGeneration.clear();
  busy.value = true;
  emit('busyChange', true);
  emit('invalidateConsent');
  try {
    const draft = await props.api('/assistant/metadata/preview', {
      sourceTitle: props.title,
      transcript: props.suggestions?.evidence || '',
      useAI: useAI.value,
    });
    if (!active || !props.canGenerate()) return;
    suggestions = draft;
    const next = textFields(draft[props.platform], props.platform);
    for (const field of fieldNames) {
      if (!editedDuringGeneration.has(field)) fields[field] = next[field];
    }
    automatic = next;
    emit('invalidateConsent');
    emit('feedback', draft.warnings.join(' '));
  } catch (cause) {
    if (active && props.canGenerate()) emit('error', cause instanceof Error ? cause.message : 'Não foi possível gerar os textos.');
  } finally {
    if (active) {
      busy.value = false;
      emit('busyChange', false);
    }
  }
}
</script>

<template>
  <div class="form-field">
    <label for="cut-post-title">{{ platform === 'tiktok' ? 'Título do vídeo' : 'Título no YouTube' }}</label>
    <input id="cut-post-title" v-model="fields.title" name="title" maxlength="100" required @input="recordEdit('title')">
  </div>
  <div class="form-field">
    <label for="cut-post-description">Descrição</label>
    <textarea id="cut-post-description" v-model="fields.description" name="description" rows="3"
      :maxlength="platform === 'tiktok' ? 2000 : 4900" @input="recordEdit('description')"></textarea>
  </div>
  <div class="form-field">
    <label for="cut-post-hashtags">Hashtags</label>
    <input id="cut-post-hashtags" v-model="fields.hashtags" name="hashtags" @input="recordEdit('hashtags')">
    <small>Separe por vírgula. A legenda final do TikTok inclui título, descrição e hashtags.</small>
  </div>
  <div class="form-field" data-youtube-tags :hidden="platform === 'tiktok'">
    <label for="cut-post-tags">Tags do YouTube</label>
    <input id="cut-post-tags" v-model="fields.youtubeTags" name="youtubeTags" :disabled="platform === 'tiktok'" @input="recordEdit('youtubeTags')">
    <small>Até 500 caracteres, incluindo separadores e aspas nas expressões.</small>
  </div>
  <label class="checkbox">
    <input v-model="useAI" name="editorialAi" type="checkbox">
    <span>Usar IA opcional para melhorar estes textos (envia título e legendas ao provedor configurado).</span>
  </label>
  <button class="button small" type="button" data-cuts-action="generate-text" :data-id="clipId" :disabled="busy" @click.stop="generate">
    Gerar título, descrição e tags
  </button>
</template>
