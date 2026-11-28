<script setup lang="ts">
import {computed, ref, useTemplateRef} from 'vue';

const props = defineProps<{
  kind: 'project' | 'clip';
  name?: string;
  confirmLabel?: string;
  onConfirm: () => Promise<unknown>;
}>();
const emit = defineEmits<{finish: [confirmed: boolean, error?: unknown]}>();
const dialog = useTemplateRef<HTMLDialogElement>('dialog');
const busy = ref(false);
const project = computed(() => props.kind === 'project');
const label = computed(() => props.confirmLabel || (project.value ? 'Descartar projeto' : 'Descartar corte'));
let confirmed = false;
let failure: unknown;

async function submit() {
  if (busy.value) return;
  busy.value = true;
  try {
    await props.onConfirm();
    confirmed = true;
  } catch (error) {
    failure = error;
  }
  dialog.value?.close(confirmed ? 'confirmed' : 'failed');
}
</script>

<template>
  <dialog id="confirm-discard-dialog" ref="dialog" class="confirm-discard-dialog" role="alertdialog"
    aria-labelledby="confirm-discard-title" aria-describedby="confirm-discard-name confirm-discard-message"
    :aria-busy="busy || undefined" @cancel="busy && $event.preventDefault()" @close="emit('finish', confirmed, failure)">
    <div class="confirm-discard-content">
      <h2 id="confirm-discard-title">{{ label }}?</h2>
      <p id="confirm-discard-name">{{ name || (project ? 'Vídeo do YouTube' : 'Corte sugerido') }}</p>
      <p id="confirm-discard-message">{{ project
        ? 'O projeto sairá da lista e suas cópias locais de vídeo serão removidas. O histórico de auditoria e as publicações já existentes serão preservados.'
        : 'As cópias locais deste corte serão removidas. Se for o último corte do projeto, o vídeo original também será removido. O histórico de auditoria e as publicações já existentes serão preservados.' }}</p>
      <div class="dialog-footer">
        <button class="button" type="button" data-confirm-cancel autofocus :disabled="busy" @click="dialog?.close('cancelled')">Cancelar</button>
        <button class="button danger" type="button" data-confirm-submit :disabled="busy" @click="submit">
          {{ busy ? (confirmLabel ? 'Excluindo…' : 'Descartando…') : label }}
        </button>
      </div>
    </div>
  </dialog>
</template>
