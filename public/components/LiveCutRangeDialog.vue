<script setup lang="ts">
import {onBeforeUnmount, onMounted, ref, useTemplateRef} from 'vue';
import {MAX_CUT_SECTION_SECONDS, type CutSourceRange} from '../../src/cuts-source-limits.js';
import type {ChannelVideo} from '../../src/youtube-channel-lookup.js';
import {formatTimecode, parseTimecode} from '../cuts-time.js';

const props = defineProps<{
  video: Pick<ChannelVideo, 'title' | 'kind' | 'duration'>;
  save: (range: CutSourceRange) => Promise<void>;
  initialRange?: CutSourceRange | null;
  findRanges?: () => Promise<{ranges: CutSourceRange[]; status: string}>;
}>();
const emit = defineEmits<{close: []}>();
const dialog = useTemplateRef<HTMLDialogElement>('dialog');
const time = (seconds: number) => formatTimecode(seconds, {hours: true});
const startText = ref(time(props.initialRange?.start ?? 0));
const endText = ref(time(props.initialRange?.end ?? Math.min(props.video.duration ?? MAX_CUT_SECTION_SECONDS, MAX_CUT_SECTION_SECONDS)));
const pending = ref(false);
const finding = ref(false);
const ranges = ref<CutSourceRange[]>([]);
const notice = ref('');
const error = ref('');
let active = true;
onMounted(() => dialog.value?.showModal());
onBeforeUnmount(() => {active = false;});

function selectRange(range: CutSourceRange) {
  startText.value = time(range.start);
  endText.value = time(range.end);
  error.value = '';
}

async function suggest() {
  if (!props.findRanges || finding.value || pending.value) return;
  finding.value = true;
  notice.value = '';
  try {
    const result = await props.findRanges();
    if (!active) return;
    ranges.value = result.ranges;
    if (!result.ranges.length) notice.value = result.status === 'failed'
      ? 'O mapa não carregou. Você pode marcar os tempos manualmente ou tentar novamente.'
      : 'O YouTube não disponibilizou sugestões para este vídeo. Marque os tempos manualmente.';
  } catch (cause) {
    if (active) notice.value = cause instanceof Error ? cause.message : 'Não foi possível consultar os momentos mais revistos.';
  } finally {
    finding.value = false;
  }
}

async function submit() {
  if (pending.value) return;
  const start = parseTimecode(startText.value), end = parseTimecode(endText.value);
  const milliseconds = Math.round((end - start) * 1000);
  if (!Number.isFinite(milliseconds) || milliseconds < 500 || milliseconds > MAX_CUT_SECTION_SECONDS * 1000) {
    error.value = 'Escolha um trecho entre 0,5 segundo e 30 minutos.';
    return;
  }
  if (props.video.duration !== null && end > props.video.duration) {
    error.value = 'O fim do trecho precisa estar dentro da duração do vídeo.';
    return;
  }
  pending.value = true;
  error.value = '';
  try {
    await props.save({start, end});
    if (active) dialog.value?.close();
  } catch (cause) {
    if (active) error.value = cause instanceof Error ? cause.message : 'Não foi possível enfileirar o trecho.';
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <dialog ref="dialog" class="dialog" aria-labelledby="live-range-title" @close="emit('close')" @cancel="pending && $event.preventDefault()">
    <div class="dialog-head">
      <div>
        <h2 id="live-range-title">{{ video.kind === 'live' ? 'Escolher trecho da live' : 'Escolher trecho do vídeo' }}</h2>
        <p v-if="video.title" class="subtitle">{{ video.title }}</p>
      </div>
      <button class="icon-button" type="button" aria-label="Fechar seleção de trecho" :disabled="pending" @click="dialog?.close()">×</button>
    </div>
    <form @submit.prevent="submit">
      <p class="tip">Selecione até 30 minutos em horas, minutos e segundos, como 02:10:00.
        <template v-if="video.duration"> Duração total de {{ time(video.duration) }}.</template>
      </p>
      <div class="field-row">
        <div class="form-field">
          <label for="live-range-start">Começo do trecho</label>
          <input id="live-range-start" v-model="startText" type="text" placeholder="00:00:00" maxlength="18" required :disabled="pending">
        </div>
        <div class="form-field">
          <label for="live-range-end">Fim do trecho</label>
          <input id="live-range-end" v-model="endText" type="text" placeholder="00:30:00" maxlength="18" required :disabled="pending">
        </div>
      </div>
      <button v-if="video.duration && findRanges" class="button small" type="button" :disabled="finding || pending" @click="suggest">
        {{ finding ? 'Consultando…' : 'Buscar momentos mais revistos' }}
      </button>
      <p v-if="notice" class="tip" role="status">{{ notice }}</p>
      <ul v-if="ranges.length" class="youtube-range-suggestions" aria-label="Trechos sugeridos">
        <li v-for="range in ranges" :key="range.start">
          <button class="button small" type="button" :disabled="pending" @click="selectRange(range)">
            {{ time(range.start) }} a {{ time(range.end) }}
          </button>
        </li>
      </ul>
      <p v-if="error" class="error-banner" role="alert">{{ error }}</p>
      <div class="dialog-footer">
        <button class="button" type="button" :disabled="pending" @click="dialog?.close()">Cancelar</button>
        <button class="button primary" type="submit" :disabled="pending">{{ pending ? 'Enfileirando…' : 'Gerar cortes do trecho' }}</button>
      </div>
    </form>
  </dialog>
</template>
