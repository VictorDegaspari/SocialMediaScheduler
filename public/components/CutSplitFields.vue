<script setup>
import {computed} from 'vue';
import CutSplitPane from './CutSplitPane.vue';
import {initialSplitLayout} from '../cuts-split.js';
const props = defineProps(['value']);
const layout = computed(() => initialSplitLayout(props.value));
const percent = value => Number((value * 100).toFixed(2));
</script>

<template>
  <fieldset id="cut-split-controls" class="cuts-split-controls" hidden disabled>
    <legend>Webcam em cima + vídeo embaixo</legend>
    <p>Selecione duas regiões do mesmo vídeo. Cada parte tem seu próprio recorte e ajuste.</p>
    <div class="form-field cuts-editor-range">
      <label for="cut-split-ratio">
        Espaço da webcam (%)
        <output id="cut-split-ratio-value">{{ percent(layout.topRatio) }}</output>
      </label>
      <input id="cut-split-ratio" type="range" min="20" max="70" step="0.1" :value="percent(layout.topRatio)">
    </div>
    <button class="button ghost small" type="button" data-split-action="half">Metade para cada parte</button>
    <div class="cuts-split-tabs" role="group" aria-label="Parte que deseja ajustar">
      <button class="button small" type="button" data-split-pane="webcam" aria-pressed="true">Webcam · cima</button>
      <button class="button small" type="button" data-split-pane="content" aria-pressed="false">Vídeo · baixo</button>
    </div>
    <p id="cut-split-selection-label" class="cuts-split-selection-label">Selecione a webcam no vídeo original</p>
    <div class="cuts-split-source">
      <canvas id="cut-split-source" width="640" height="360" tabindex="0" role="img" aria-label="Selecionar região da webcam no vídeo original" aria-describedby="cut-split-help"></canvas>
    </div>
    <p id="cut-split-help" class="tip">Arraste o retângulo para mover e os cantos para redimensionar. Arraste fora dele para selecionar outra área. As setas movem a seleção; Shift + setas ajusta o tamanho. A divisão na prévia também pode ser arrastada.</p>
    <CutSplitPane :pane="layout.webcam" pane-name="webcam" />
    <CutSplitPane :pane="layout.content" pane-name="content" />
  </fieldset>
</template>
