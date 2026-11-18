<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import type {CutOverlay} from '../../src/cuts-overlays.js';
import OverlayRange from './OverlayRange.vue';

const props = defineProps<{
  layers: CutOverlay[];
  selected: string | null;
  message: string;
  duration: number;
}>();
const current = computed(() => props.layers.find(layer => layer.id === props.selected));
const name = (layer: CutOverlay) => layer.type === 'text' ? (layer.text.trim().slice(0, 55) || 'Texto sem conteúdo') : 'Imagem';
const tabs = computed(() => [
  ...(current.value?.type === 'text' ? [['cut-overlay-content', 'Texto']] : []),
  ['cut-overlay-position', 'Posição e tamanho'], ['cut-overlay-timing', 'Duração'],
]);
const active = ref(current.value ? tabs.value[0][0] : '');
watch(() => current.value?.type, type => {
  if (!type) active.value = '';
  else if (!tabs.value.some(([id]) => id === active.value)) active.value = tabs.value[0][0];
}, {flush: 'sync'});
function tabChanged(event: Event) {
  const panel = event.target as HTMLElement;
  if (panel.dataset.editorPanel === 'overlay') active.value = panel.id;
}
</script>

<template>
  <div class="cuts-tool-heading">
    <div><h3 id="cut-overlays-heading">3. Textos e imagens</h3><p>Adicione títulos, logos ou imagens sobre o vídeo.</p></div>
  </div>
  <div class="cuts-overlay-add">
    <button class="button small" type="button" data-cut-overlay-action="add-text">Adicionar texto</button>
    <button class="button small" type="button" data-cut-overlay-action="add-image">Adicionar imagem</button>
    <input id="cut-overlay-file" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden>
  </div>
  <p class="tip">Para colar uma imagem copiada, use Ctrl+V com o editor aberto. PNG, JPEG ou WebP, até 20 MB.</p>
  <p id="cut-overlay-status" class="cuts-overlay-status" role="status">{{ message }}</p>
  <div id="cut-overlay-list" class="cuts-overlay-list" aria-label="Textos e imagens do vídeo">
    <button v-for="(layer, index) in layers" :key="layer.id" class="cuts-overlay-item" type="button" data-cut-overlay-action="select" :data-id="layer.id" :aria-pressed="layer.id === selected">
      <span class="cuts-overlay-kind">{{ layer.type === 'text' ? 'T' : '▧' }}</span>
      <span>{{ name(layer) }}<small>{{ layer.end === null ? 'Durante todo o vídeo' : `${layer.start} s → ${layer.end} s` }}</small></span>
      <span class="cuts-overlay-order">{{ index + 1 }}</span>
    </button>
    <p v-if="!layers.length" class="cuts-overlay-empty">Nenhum texto ou imagem adicionado.</p>
  </div>
  <div id="cut-overlay-controls">
    <div v-if="current" :key="current.id" class="cuts-overlay-settings" @cut-editor-tab-change="tabChanged">
      <div class="cuts-editor-subtabs" role="tablist" aria-label="Ajustes do elemento" data-editor-tabs="overlay">
        <button v-for="[id, title] in tabs" :id="id + '-tab'" :key="id" type="button" role="tab" :aria-controls="id" :aria-selected="id === active" :tabindex="id === active ? 0 : -1" :data-editor-tab="id">{{ title }}</button>
      </div>
      <div v-if="current.type === 'text'" id="cut-overlay-content" role="tabpanel" aria-labelledby="cut-overlay-content-tab" tabindex="0" data-editor-panel="overlay" :hidden="active !== 'cut-overlay-content'">
        <div class="form-field">
          <label for="cut-overlay-text">Texto sobre o vídeo</label>
          <textarea id="cut-overlay-text" data-overlay-field="text" rows="3" maxlength="1000" :value="current.text"></textarea>
        </div>
        <div class="field-row">
          <div class="form-field"><label for="cut-overlay-color">Cor do texto</label><input id="cut-overlay-color" data-overlay-field="color" type="color" :value="current.color"></div>
          <div class="form-field">
            <label for="cut-overlay-background">Fundo do texto</label>
            <select id="cut-overlay-background" data-overlay-field="background" :value="current.background">
              <option value="none">Sem caixa</option><option value="box">Caixa escura</option>
            </select>
          </div>
        </div>
        <OverlayRange field="fontSize" label="Tamanho do texto" :min="24" :max="160" :value="current.fontSize" />
      </div>
      <div id="cut-overlay-position" role="tabpanel" aria-labelledby="cut-overlay-position-tab" tabindex="0" data-editor-panel="overlay" :hidden="active !== 'cut-overlay-position'">
      <OverlayRange field="width" :label="current.type === 'image' ? 'Tamanho da imagem' : 'Largura do texto'" :min="5" :max="100" :value="Math.round(current.width * 100)" />
      <div class="field-row">
        <OverlayRange field="x" label="Posição horizontal" :min="0" :max="100" :value="Math.round(current.x * 100)" />
        <OverlayRange field="y" label="Posição vertical" :min="0" :max="100" :value="Math.round(current.y * 100)" />
      </div>
      <p class="tip">Você também pode arrastar o elemento na prévia para posicionar.</p>
      </div>
      <div id="cut-overlay-timing" role="tabpanel" aria-labelledby="cut-overlay-timing-tab" tabindex="0" data-editor-panel="overlay" :hidden="active !== 'cut-overlay-timing'">
      <label class="checkbox"><input id="cut-overlay-always" data-overlay-field="always" type="checkbox" :checked="current.end === null"><span>Durante todo o vídeo</span></label>
      <div class="field-row cuts-overlay-times">
        <div class="form-field">
          <label for="cut-overlay-start">Aparece em (segundos)</label>
          <input id="cut-overlay-start" data-overlay-field="start" type="number" min="0" max="180" step="0.001" :value="current.start" :disabled="current.end === null">
        </div>
        <div class="form-field">
          <label for="cut-overlay-end">Some em (segundos)</label>
          <input id="cut-overlay-end" data-overlay-field="end" type="number" min="0" max="180" step="0.001" :value="current.end ?? Math.min(3, duration)" :disabled="current.end === null">
        </div>
      </div>
      <p class="tip">Os segundos contam a partir do início do vídeo final, descontando os trechos removidos.</p>
      </div>
      <div class="form-actions">
        <button class="button small" type="button" data-cut-overlay-action="preview">Ver na prévia</button>
        <button class="button small" type="button" data-cut-overlay-action="front">Trazer para frente</button>
        <button class="button small danger" type="button" data-cut-overlay-action="remove">Remover elemento</button>
      </div>
    </div>
  </div>
</template>
