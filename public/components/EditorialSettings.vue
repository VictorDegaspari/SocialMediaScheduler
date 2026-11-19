<script setup lang="ts">
import {onBeforeUnmount, ref, useTemplateRef} from 'vue';
import EditorialOptionFields from './EditorialOptionFields.vue';
import {readCommaSeparated, readEditorialOptions} from './editorial-form.js';
import type {EditorialPreviewApi} from './editorial-form.js';
import type {EditorialOptions} from '../../src/editorial-config.js';
import type {EditorialDraft} from '../../src/editorial.js';

const props = defineProps<{value?: Partial<EditorialOptions>; api: EditorialPreviewApi}>();
const root = useTemplateRef<HTMLElement>('root');
const sourceTitle = ref('');
const transcript = ref('');
const result = ref<EditorialDraft | null>(null);
const busy = ref(false);
const error = ref('');
let active = true;
onBeforeUnmount(() => {active = false;});

async function preview() {
  const form = root.value?.closest('form');
  if (busy.value || !form) return;
  const fields = new FormData(form);
  const options = readEditorialOptions(fields);
  busy.value = true;
  error.value = '';
  try {
    const draft = await props.api('/assistant/metadata/preview', {
      sourceTitle: sourceTitle.value,
      transcript: transcript.value,
      titlePrefix: String(fields.get('titlePrefix') ?? ''),
      description: String(fields.get('description') ?? ''),
      hashtags: readCommaSeparated(fields.get('hashtags')),
      options,
      useAI: options.ai,
    });
    if (active) result.value = draft;
  } catch (cause) {
    if (active) error.value = cause instanceof Error ? cause.message : 'Não foi possível gerar os textos.';
  } finally {
    if (active) busy.value = false;
  }
}
</script>

<template>
  <section ref="root" class="editorial-settings" aria-label="Geração de títulos, descrições e tags">
    <h3>Geração automática de textos</h3>
    <p class="requests-note">Usa o nome do vídeo e as legendas disponíveis. Textos revisados e autorizações de envio são preservados.</p>
    <EditorialOptionFields variant="profile" id-prefix="editorial" :value="value" />
    <details class="requests-details"><summary>Testar títulos, descrições e tags</summary>
      <div class="form-field"><label for="editorial-source-title">Nome ou título de um vídeo de exemplo</label><input id="editorial-source-title" v-model="sourceTitle" maxlength="1000" placeholder="Use um nome que descreva o vídeo"></div>
      <div class="form-field"><label for="editorial-transcript">Resumo ou transcrição do vídeo de exemplo</label><textarea id="editorial-transcript" v-model="transcript" maxlength="12000" rows="4"></textarea></div>
      <button class="button" type="button" :disabled="busy" @click="preview">{{ busy ? 'Gerando textos…' : 'Gerar exemplo para YouTube e TikTok' }}</button>
      <p v-if="error" role="alert" class="requests-profile-warning">{{ error }}</p>
      <div v-if="result" aria-live="polite">
        <p class="requests-note">{{ result.method === 'ai' ? 'Sugestão com ajuda de IA. Revise os fatos antes de usar.' : 'Sugestão gerada localmente, sem IA.' }}</p>
        <p v-for="warning in result.warnings" :key="warning" class="requests-note">{{ warning }}</p>
        <h4>YouTube</h4><p><strong>{{ result.youtube.title }}</strong> · {{ result.youtube.title.length }}/100</p><p class="editorial-copy">{{ result.youtube.description }}</p><p>{{ result.youtube.hashtags.map(tag => '#' + tag).join(' ') }}</p><p>Tags: {{ result.youtube.tags.join(', ') }}</p>
        <h4>TikTok · {{ result.tiktok.caption.length }}/2200</h4><p class="editorial-copy">{{ result.tiktok.caption }}</p>
        <details class="requests-details"><summary>Prompt pronto para usar com IA</summary><textarea aria-label="Prompt para IA" rows="8" readonly :value="result.aiPrompt"></textarea></details>
      </div>
    </details>
  </section>
</template>
