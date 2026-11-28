<script setup lang="ts">
import {ref, useTemplateRef} from 'vue';

const props = defineProps<{youtube: boolean; link: (id: string) => Promise<void>}>();
const emit = defineEmits<{close: []}>();
const dialog = useTemplateRef<HTMLDialogElement>('dialog');
const id = ref('');
const busy = ref(false);
const error = ref('');

async function submit() {
  if (busy.value || !id.value.trim()) return;
  busy.value = true;
  error.value = '';
  try {
    await props.link(id.value.trim());
    dialog.value?.close();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Não foi possível vincular a publicação.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <dialog ref="dialog" class="dialog" aria-labelledby="link-publication-title"
    @close="emit('close')" @cancel="busy && $event.preventDefault()">
    <div class="dialog-head">
      <h2 id="link-publication-title">{{ youtube ? 'Vincular vídeo do YouTube' : 'Vincular post do Postiz' }}</h2>
      <button class="icon-button" type="button" aria-label="Fechar" :disabled="busy" @click="dialog?.close()">×</button>
    </div>
    <form @submit.prevent="submit">
      <p class="tip">{{ youtube
        ? 'Confira o vídeo no canal do YouTube e informe o ID para verificar e vincular.'
        : 'Confira o post no Postiz e informe o ID para verificar e vincular.' }}</p>
      <div class="form-field">
        <label for="link-publication-id">{{ youtube ? 'ID do vídeo' : 'ID do post' }}</label>
        <input id="link-publication-id" v-model="id" required autofocus :disabled="busy" :maxlength="youtube ? 100 : 200">
      </div>
      <p v-if="error" class="error-banner" role="alert">{{ error }}</p>
      <div class="dialog-footer">
        <button class="button" type="button" :disabled="busy" @click="dialog?.close()">Cancelar</button>
        <button class="button primary" type="submit" :disabled="busy || !id.trim()">{{ busy ? 'Verificando…' : 'Vincular' }}</button>
      </div>
    </form>
  </dialog>
</template>
