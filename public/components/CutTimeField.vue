<script setup>
import {formatSourceTimecode} from '../cuts-time.js';
import {computed} from 'vue';
const props = defineProps(['name', 'label', 'time', 'sourceRange']);
const kind = computed(() => props.name === 'start' ? 'início' : 'fim');
</script>

<template>
  <div class="form-field cuts-time-field">
    <label :for="'cut-edit-' + (name)">{{ label }}</label>
    <input :id="'cut-edit-' + (name)" :name="name" type="text" data-timecode autocomplete="off" spellcheck="false" placeholder="00:00" maxlength="18" aria-describedby="cut-time-help" :value="formatSourceTimecode(time, sourceRange)" required>
    <div class="cuts-time-actions">
      <button class="button small" type="button" data-cut-editor-action="step-time" :data-field="name" data-step="-1" :aria-label="'Voltar ' + (kind) + ' em 1 segundo'">−1 s</button>
      <button class="button small" type="button" data-cut-editor-action="step-time" :data-field="name" data-step="1" :aria-label="'Adiantar ' + (kind) + ' em 1 segundo'">+1 s</button>
      <button class="button ghost small" type="button" :data-cut-editor-action="'set-' + (name)">Marcar {{ kind }} aqui</button>
    </div>
  </div>
</template>
