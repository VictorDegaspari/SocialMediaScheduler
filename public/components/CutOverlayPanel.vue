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
function name(layer: CutOverlay) {
  if (layer.type === 'text') return layer.text.trim().slice(0, 55) || 'Texto sem conteúdo';
  if (layer.type === 'redaction') return layer.effect === 'bar' ? 'Tarja preta' : 'Borrão';
  return layer.watermark ? 'Marca-d’água' : 'Imagem';
}
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
    <div><h3 id="cut-overlays-heading">3. Elementos</h3><p>Adicione textos, imagens e áreas de censura ao corte.</p></div>
  </div>
  <div class="cuts-overlay-add">
    <button class="button small" type="button" data-cut-overlay-action="add-text">Adicionar texto</button>
    <button class="button small" type="button" data-cut-overlay-action="add-image">Adicionar imagem</button>
    <button class="button small" type="button" data-cut-overlay-action="add-watermark">Adicionar marca-d’água</button>
    <button class="button small" type="button" data-cut-overlay-action="add-redaction">Adicionar censura</button>
    <input id="cut-overlay-file" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden>
    <input id="cut-watermark-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>
  </div>
  <p class="tip">Para colar uma imagem copiada, use Ctrl+V com o editor aberto. PNG, JPEG ou WebP, até 20 MB.</p>
  <p id="cut-overlay-status" class="cuts-overlay-status" role="status">{{ message }}</p>
  <div id="cut-overlay-list" class="cuts-overlay-list" aria-label="Elementos do vídeo">
    <button v-for="(layer, index) in layers" :key="layer.id" class="cuts-overlay-item" type="button" data-cut-overlay-action="select" :data-id="layer.id" :aria-pressed="layer.id === selected">
      <span class="cuts-overlay-kind" aria-hidden="true">{{ layer.type === 'text' ? 'T' : layer.type === 'redaction' ? '▰' : '▧' }}</span>
      <span>{{ name(layer) }}<small>{{ layer.end === null ? 'Durante todo o vídeo' : `${layer.start} s → ${layer.end} s` }}</small></span>
      <span class="cuts-overlay-order">{{ index + 1 }}</span>
    </button>
    <p v-if="!layers.length" class="cuts-overlay-empty">Nenhum elemento adicionado.</p>
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
        <div class="form-field">
          <label for="cut-overlay-alignment">Alinhamento do texto</label>
          <select id="cut-overlay-alignment" data-overlay-field="alignment" :value="current.alignment ?? 'left'">
            <option value="left">À esquerda</option>
            <option value="center">Centralizado</option>
            <option value="right">À direita</option>
            <option value="justify">Justificado</option>
          </select>
        </div>
        <OverlayRange field="fontSize" label="Tamanho do texto" :min="24" :max="160" :value="current.fontSize" />
      </div>
      <div id="cut-overlay-position" role="tabpanel" aria-labelledby="cut-overlay-position-tab" tabindex="0" data-editor-panel="overlay" :hidden="active !== 'cut-overlay-position'">
      <div v-if="current.type === 'redaction'" class="form-field">
        <label for="cut-overlay-effect">Efeito de censura</label>
        <select id="cut-overlay-effect" data-overlay-field="effect" :value="current.effect">
          <option value="bar">Tarja preta</option>
          <option value="blur">Borrão</option>
        </select>
      </div>
      <OverlayRange field="width" :label="current.type === 'redaction' ? 'Largura da área' : current.type === 'image' ? 'Tamanho da imagem' : 'Largura do texto'" :min="current.type === 'redaction' ? 2 : 5" :max="100" :value="Math.round(current.width * 100)" />
      <OverlayRange v-if="current.type === 'redaction'" field="height" label="Altura da área" :min="2" :max="100" :value="Math.round(current.height * 100)" />
      <OverlayRange v-if="current.type === 'image'" field="opacity" label="Opacidade" :min="0" :max="100" :value="Math.round((current.opacity ?? 1) * 100)" />
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
          <input id="cut-overlay-start" data-overlay-field="start" type="number" min="0" :max="duration" step="0.001" :value="current.start" :disabled="current.end === null">
        </div>
        <div class="form-field">
          <label for="cut-overlay-end">Some em (segundos)</label>
          <input id="cut-overlay-end" data-overlay-field="end" type="number" min="0" :max="duration" step="0.001" :value="current.end ?? Math.min(3, duration)" :disabled="current.end === null">
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
