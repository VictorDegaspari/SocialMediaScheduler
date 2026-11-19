<script setup>
import {formatTimecode} from '../cuts-time.js';
import {vRequestValue} from './request-form.js';
defineProps(["rows"]);
</script>

<template>
  <div v-for="(cue, index) in rows" :key="cue.id" class="cuts-cue" :data-caption-row="cue.id" :data-conflict="cue.conflict ? 'true' : undefined">
    <label>
      <span class="cuts-cue-time-label">Começa em</span>
      <input :aria-label="'Início da legenda ' + (index+1)" name="cueStart" type="text" data-timecode required autocomplete="off" spellcheck="false" placeholder="00:00" maxlength="18" v-request-value="{value: formatTimecode(cue.start)}">
    </label>
    <label>
      <span class="cuts-cue-time-label">Termina em</span>
      <input :aria-label="'Fim da legenda ' + (index+1)" name="cueEnd" type="text" data-timecode required autocomplete="off" spellcheck="false" placeholder="00:00" maxlength="18" v-request-value="{value: formatTimecode(cue.end)}">
    </label>
    <label>
      <span class="sr-only">Texto da legenda {{ index+1 }}</span>
      <textarea :aria-label="'Texto da legenda ' + (index+1)" name="cueText" rows="2" required maxlength="500" v-request-value="{value: cue.text}"></textarea>
    </label>
    <button class="icon-button danger" type="button" data-cut-editor-action="remove-cue" :aria-label="'Remover legenda ' + (index+1)">×</button>
    <template v-if="cue.conflict">
      <p class="cuts-cue-warning">Esta legenda atravessa um limite ou trecho removido. Ajuste os tempos e o texto, divida a linha ou use a transcrição original.</p>
    </template>
  </div>
</template>
