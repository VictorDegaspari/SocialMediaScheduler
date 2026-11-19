<script setup>
import {computed} from 'vue';
const props = defineProps(['pane', 'paneName']);
const label = computed(() => props.paneName === 'webcam' ? 'webcam' : 'vídeo');
const part = computed(() => props.paneName === 'webcam' ? 'da webcam' : 'do vídeo');
const percent = value => Number((value * 100).toFixed(2));
</script>

<template>
  <fieldset :data-split-fields="paneName" :hidden="paneName==='content'" :disabled="paneName==='content'">
    <legend>{{ paneName==='webcam'?'Webcam / reação · parte de cima':'Vídeo / jogo · parte de baixo' }}</legend>
    <div class="cuts-split-coordinates">
      <template v-for="([property,title]) in [['x','Esquerda'],['y','Topo'],['width','Largura'],['height','Altura']]">
        <div class="form-field">
          <label :for="'split-' + (paneName) + '-' + (property)">{{ title }} da área de {{ label }} (%)</label>
          <input :id="'split-' + (paneName) + '-' + (property)" :name="'split-' + (paneName) + '-' + (property)" :data-split-region="property" :data-pane="paneName" type="number" :min="property==='width'||property==='height'?1:0" max="100" step="0.01" :value="percent(pane.region[property])" required>
        </div>
      </template>
    </div>
    <div class="form-field">
      <label :for="'split-' + (paneName) + '-fit'">Encaixe da {{ paneName==='webcam'?'webcam':'parte de vídeo' }}</label>
      <select :id="'split-' + (paneName) + '-fit'" data-split-property="fit" :data-pane="paneName">
        <option value="crop" :selected="pane.fit==='crop'">Preencher espaço · recortar sobras</option>
        <option value="fit" :selected="pane.fit==='fit'">Encaixar imagem inteira · manter proporção</option>
      </select>
    </div>
    <template v-for="([property,title,min,max,step]) in [['zoom','Aproximação',0.25,3,0.05],['focusX','Posição horizontal',0,1,0.01],['focusY','Posição vertical',0,1,0.01]]">
      <div class="form-field cuts-editor-range">
        <label :for="'split-' + (paneName) + '-' + (property)">
          {{ title }}
          {{ part }}
          <output :data-split-output="(paneName) + '-' + (property)"></output>
        </label>
        <input :id="'split-' + (paneName) + '-' + (property)" :data-split-property="property" :data-pane="paneName" type="range" :min="min" :max="max" :step="step" :value="pane[property]">
      </div>
    </template>
    <button class="button ghost small" type="button" data-split-action="reset">Redefinir esta parte</button>
  </fieldset>
</template>
