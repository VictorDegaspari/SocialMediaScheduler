<script setup>
import {formatSourceTimecode} from '../cuts-time.js';
import CutEditorTabs from './CutEditorTabs.vue';
import CutTimeField from './CutTimeField.vue';
import CutRangeField from './CutRangeField.vue';
import CutSelectField from './CutSelectField.vue';
import CutSplitFields from './CutSplitFields.vue';
defineProps(["clip","job","style","framing","cutFormats"]);
const panelAttributes = (group, id, active = false) => ({id, role: 'tabpanel', 'aria-labelledby': id + '-tab', tabindex: 0, 'data-editor-panel': group, hidden: !active});
</script>

<template>
  <div class="cuts-editor-intro">
    <div class="form-field">
      <label for="cut-edit-title">Título do corte</label>
      <input id="cut-edit-title" name="title" :value="clip.title" required maxlength="100">
    </div>
    <p>Use as abas para ajustar o corte e conferir o resultado na prévia.</p>
  </div>
  <nav class="cuts-editor-nav" aria-label="Etapas da edição">
    <CutEditorTabs group="primary" label="Ajustes do corte" :items="[['cut-editor-timing','Trecho'],['cut-editor-framing','Formato'],['cut-overlays','Elementos'],['cut-editor-captions','Legendas']]" :primary="true" />
    <button type="button" data-cut-editor-section="cut-editor-preview" aria-controls="cut-editor-preview" class="cuts-preview-shortcut">Prévia</button>
  </nav>
  <div class="cuts-editor-workspace">
    <aside id="cut-editor-preview" class="cuts-editor-preview" tabindex="-1" aria-label="Prévia do corte">
      <div class="cuts-editor-preview-heading">
        <span class="eyebrow">PRÉVIA DO CORTE</span>
        <span id="cut-preview-format" class="badge gray">Shorts · 9:16</span>
      </div>
      <div class="cuts-phone">
        <div class="cuts-phone-screen">
          <canvas id="cut-phone-canvas" width="720" height="1280" tabindex="0" role="button" data-cut-editor-action="play-preview" data-seeking="true" aria-label="Reproduzir ou pausar a prévia no celular"></canvas>
          <div id="cut-phone-caption" class="cuts-phone-caption">
            <span id="cut-phone-caption-text"></span>
          </div>
          <div class="cuts-phone-safe" aria-hidden="true"></div>
          <output id="cut-phone-source-time" class="cuts-phone-source-time">Original {{ formatSourceTimecode(clip.start_seconds, job.source_range) }}</output>
          <div id="cut-phone-loading" class="cuts-phone-loading" role="status">Buscando {{ formatSourceTimecode(clip.start_seconds, job.source_range) }}…</div>
          <div id="cut-split-divider" class="cuts-split-divider" hidden tabindex="0" role="separator"
            aria-orientation="horizontal" aria-label="Divisão entre webcam e vídeo" aria-valuemin="20" aria-valuemax="70">
            <span aria-hidden="true">↕</span>
          </div>
        </div>
        <div class="cuts-phone-controls">
          <output id="cut-phone-time">
            <span id="cut-preview-time">00:00 / 00:00</span>
          </output>
          <input id="cut-phone-seek" type="range" min="0" max="0" step="0.001" value="0" aria-label="Posição na prévia do celular">
          <div class="cuts-phone-buttons">
            <button id="cut-phone-back" type="button" data-cut-editor-action="phone-back" aria-label="Voltar 5 segundos na prévia" title="Voltar 5 segundos">−5 s</button>
            <button id="cut-phone-play" type="button" data-cut-editor-action="play-preview" aria-label="Reproduzir prévia no celular" title="Reproduzir prévia">
              <span aria-hidden="true">▶</span>
            </button>
            <button id="cut-phone-forward" type="button" data-cut-editor-action="phone-forward" aria-label="Avançar 5 segundos na prévia" title="Avançar 5 segundos">+5 s</button>
            <button id="cut-phone-mute" type="button" data-cut-editor-action="phone-mute" aria-label="Silenciar prévia" aria-pressed="false" title="Silenciar prévia">
              <span aria-hidden="true">♪</span>
            </button>
          </div>
        </div>
      </div>
      <p class="tip">Confira a montagem aqui. O tempo “Original” indica a posição no vídeo de origem.</p>
      <p id="cut-editor-message" class="cuts-editor-message" role="status"></p>
    </aside>
    <section class="cuts-editor-tools" aria-label="Ajustes do corte">
      <p v-if="clip.delivery_id || clip.publications?.length || ['posted', 'publishing'].includes(clip.status)" class="notice cuts-version-notice">Ao salvar, será criada uma nova versão para revisão. O arquivo já enviado e o histórico serão preservados. Você poderá postar a nova versão depois de conferir a prévia.</p>
      <section v-bind="panelAttributes('primary', 'cut-editor-timing', true)" class="cuts-tool-section">
        <div class="cuts-tool-heading">
          <div>
            <h3 id="cut-timing-heading">1. Trecho e duração</h3>
            <p>Use a fonte para marcar os limites e retirar partes que não interessam.</p>
          </div>
          <strong id="cut-final-duration" class="cuts-duration-pill"></strong>
        </div>
        <CutEditorTabs group="timing" label="Ajustes do trecho" :items="[['cut-timing-limits','Início e fim'],['cut-timing-removals','Remover trechos'],...(job.imported ? [] : [['cut-timing-replay','Replay']])]" :primary="false" />
        <video id="cut-source-player" controls playsinline preload="metadata" aria-label="Vídeo original para selecionar os trechos" :src="'/api/cuts/jobs/' + (encodeURIComponent(job.id)) + '/source'"></video>
        <div class="cuts-source-readout">
          No vídeo original:
          <strong id="cut-source-time">{{ formatSourceTimecode(clip.start_seconds, job.source_range, 2) }}</strong>
        </div>
        <div v-bind="panelAttributes('timing', 'cut-timing-limits', true)">
          <p v-if="job.source_range" id="cut-time-help" class="cuts-time-help">Use os horários da live original, entre <strong>{{ formatSourceTimecode(0, job.source_range) }}</strong> e <strong>{{ formatSourceTimecode(job.duration, job.source_range) }}</strong>.</p>
          <p v-else id="cut-time-help" class="cuts-time-help">
            Use minutos:segundos, como
            <strong>09:11</strong>
            . Para marcar sem digitar, pause o vídeo e clique em “Marcar aqui”.
          </p>
          <div class="field-row cuts-main-times">
            <CutTimeField name="start" label="Começo do corte" :time="clip.start_seconds" :source-range="job.source_range" />
            <CutTimeField name="end" label="Fim do corte" :time="clip.end_seconds" :source-range="job.source_range" />
          </div>
        </div>
        <div v-bind="panelAttributes('timing', 'cut-timing-removals')">
          <div class="cuts-removal-box">
            <h4>Remover um trecho do meio</h4>
            <div class="cuts-removal-inputs">
              <div class="form-field">
                <label for="cut-remove-start">Remover a partir de</label>
                <input id="cut-remove-start" type="text" data-timecode autocomplete="off" spellcheck="false" placeholder="00:00" maxlength="18" :value="formatSourceTimecode(clip.start_seconds, job.source_range)">
                <button class="button ghost small" type="button" data-cut-editor-action="mark-remove-start">Marcar início</button>
              </div>
              <div class="form-field">
                <label for="cut-remove-end">Remover até</label>
                <input id="cut-remove-end" type="text" data-timecode autocomplete="off" spellcheck="false" placeholder="00:00" maxlength="18" :value="formatSourceTimecode(clip.start_seconds, job.source_range)">
                <button class="button ghost small" type="button" data-cut-editor-action="mark-remove-end">Marcar fim</button>
              </div>
              <button class="button small" type="button" data-cut-editor-action="add-removal">Remover este trecho</button>
            </div>
            <ul id="cut-removed-ranges" class="cuts-removed-ranges"></ul>
            <p class="tip">Imagem, áudio e legendas dos trechos removidos ficam fora do vídeo final. A prévia pula essas partes.</p>
          </div>
        </div>
        <div v-bind="panelAttributes('timing', 'cut-timing-replay')">
          <section class="cuts-replay-details">
            <h4>Momentos mais revistos</h4>
            <p class="cuts-replay-instruction">Clique ou arraste na linha do gráfico para marcar o começo do corte.</p>
            <div class="cuts-replay-selection-readout">
              <span>Início selecionado</span>
              <output id="cut-replay-selected">{{ formatSourceTimecode(clip.start_seconds, job.source_range) }}</output>
            </div>
            <div id="cut-editor-replay"></div>
            <label for="cut-replay-position">
              Ajuste fino do início ·
              <output id="cut-replay-time">{{ formatSourceTimecode(clip.start_seconds, job.source_range, 2) }}</output>
            </label>
            <input id="cut-replay-position" type="range" min="0" :max="Math.max(0,(Number(job.duration)||7200)-.5)" step="0.001" :value="Number(clip.start_seconds)">
            <button class="button small" type="button" data-cut-editor-action="use-replay-window">Usar 60 segundos a partir daqui</button>
          </section>
        </div>
      </section>
      <section v-bind="panelAttributes('primary', 'cut-editor-framing')" class="cuts-tool-section">
        <div class="cuts-tool-heading">
          <div>
            <h3 id="cut-framing-heading">2. Formato e enquadramento</h3>
            <p>Mova o foco e aproxime ou afaste a imagem sem perder o que importa.</p>
          </div>
        </div>
        <CutEditorTabs group="framing" label="Ajustes do formato" :items="[['cut-framing-format','Proporção'],['cut-framing-position','Enquadrar imagem']]" :primary="false" />
        <div v-bind="panelAttributes('framing', 'cut-framing-format', true)">
          <CutSelectField id="cut-format" name="format" label="Formato no YouTube" :options="cutFormats" :value="framing.format" />
          <p class="tip">Shorts usa 9:16. Para postar como vídeo comum, escolha 16:9 e gere uma nova prévia.</p>
        </div>
        <div v-bind="panelAttributes('framing', 'cut-framing-position')">
          <CutSelectField id="cut-framing" name="framingMode" label="Enquadramento" :options="[['fit','Imagem completa · faixas pretas'],['blur','Imagem completa · fundo desfocado'],['crop','Preencher quadro · ajustar foco'],['split','Webcam em cima + vídeo embaixo']]" :value="framing.mode" />
          <div id="cut-crop-controls" class="cuts-crop-controls">
            <CutRangeField id="cut-focus-x" name="focusX" label="Foco horizontal" :value="Math.round(framing.focusX*100)" :min="0" :max="100" :step="1" />
            <CutRangeField id="cut-focus-y" name="focusY" label="Foco vertical" :value="Math.round(framing.focusY*100)" :min="0" :max="100" :step="1" />
            <CutRangeField id="cut-zoom" name="zoom" label="Zoom" :value="framing.zoom" :min=".25" :max="3" :step=".05" />
            <p class="tip">1× preenche a tela. Reduza o zoom para mostrar mais da imagem.</p>
            <button class="button ghost small" type="button" data-cut-editor-action="reset-focus">Centralizar imagem</button>
          </div>
          <CutSplitFields :value="framing.split" />
        </div>
      </section>
      <section v-bind="panelAttributes('primary', 'cut-overlays')" class="cuts-tool-section cuts-overlays"></section>
      <section v-bind="panelAttributes('primary', 'cut-editor-captions')" class="cuts-tool-section">
        <section class="cuts-caption-style">
          <div class="cuts-tool-heading">
            <div>
              <h3 id="cut-captions-heading">4. Legendas</h3>
              <p>Escolha se as legendas aparecem no vídeo e ajuste o estilo.</p>
            </div>
          </div>
          <label class="checkbox cuts-original-caption">
            <input id="cut-captions-enabled" name="captionsEnabled" type="checkbox" :checked="style.enabled!==false" aria-describedby="cut-captions-help">
            <span>Exibir legendas no vídeo</span>
          </label>
          <p id="cut-captions-help" class="tip">Desmarque para gerar o vídeo sem legendas. O texto fica salvo para reativar depois.</p>
          <CutEditorTabs group="captions" label="Ajustes das legendas" :items="[['cut-captions-style','Estilo'],['cut-captions-effects','Posição e efeitos'],['cut-captions-text','Texto e tempos']]" :primary="false" />
          <div v-bind="panelAttributes('captions', 'cut-captions-style', true)">
            <div class="cuts-style-presets">
              <button class="button small" type="button" data-cut-editor-action="preset" data-preset="classic">Clássica</button>
              <button class="button small" type="button" data-cut-editor-action="preset" data-preset="highlight">Destaque amarelo</button>
              <button class="button small" type="button" data-cut-editor-action="preset" data-preset="clean">Fundo escuro</button>
            </div>
            <CutRangeField id="cut-font-size" name="fontSize" label="Tamanho da legenda" :value="style.fontSize" :min="24" :max="80" :step="1" />
            <div class="cuts-color-grid">
              <div class="form-field">
                <label for="cut-caption-color">Cor do texto</label>
                <input id="cut-caption-color" name="color" type="color" :value="style.color">
              </div>
              <div class="form-field">
                <label for="cut-highlight-color">Cor de destaque</label>
                <input id="cut-highlight-color" name="highlightColor" type="color" :value="style.highlightColor">
              </div>
              <div class="form-field">
                <label for="cut-outline-color">Cor do contorno</label>
                <input id="cut-outline-color" name="outlineColor" type="color" :value="style.outlineColor">
              </div>
            </div>
          </div>
          <div v-bind="panelAttributes('captions', 'cut-captions-effects')">
            <div class="field-row">
              <CutSelectField id="cut-caption-position" name="position" label="Posição da legenda" :options="[['bottom','Parte inferior · área segura'],['middle','Centro'],['top','Parte superior']]" :value="style.position" />
              <CutSelectField id="cut-caption-background" name="background" label="Fundo da legenda" :options="[['none','Sem caixa'],['box','Caixa escura']]" :value="style.background" />
            </div>
            <CutSelectField id="cut-caption-animation" name="animation" label="Animação da legenda" :options="[['none','Sem animação'],['fade','Entrada e saída suaves'],['pop','Entrada com destaque'],['karaoke','Destacar palavra falada']]" :value="style.animation" />
            <p id="cut-karaoke-note" class="tip" hidden>O destaque por palavra usa os tempos reconhecidos no áudio. Linhas corrigidas sem esse alinhamento aparecem sem destaque por palavra.</p>
          </div>
          <section v-bind="panelAttributes('captions', 'cut-captions-text')" class="cuts-caption-text">
            <div class="cuts-caption-heading">
              <div>
                <h4 id="cut-caption-text-heading">Texto e sincronização</h4>
                <p>Os tempos acompanham a prévia, começando em 00:00 e descontando os trechos removidos. Use minutos:segundos; para ajuste fino, digite 00:01,720.</p>
              </div>
              <button class="button small" type="button" data-cut-editor-action="add-cue">Adicionar linha</button>
            </div>
            <label class="checkbox cuts-original-caption">
              <input type="checkbox" name="originalCaptions">
              <span>
                Usar a transcrição original para o intervalo escolhido
                <small>Substitui as alterações das linhas abaixo ao gerar a nova prévia.</small>
              </span>
            </label>
            <div class="cuts-transcript-state">
              <p id="cut-transcript-status" role="status"></p>
              <button id="cut-retry-transcript" class="button small" type="button" data-cut-editor-action="retry-transcript" hidden>Tentar carregar transcrição</button>
            </div>
            <div class="cuts-cue-labels" aria-hidden="true">
              <span>Começa em</span>
              <span>Termina em</span>
              <span>Texto falado</span>
              <span></span>
            </div>
            <p id="cuts-cues-state" class="cuts-cues-state" role="status"></p>
            <div id="cuts-cues"></div>
          </section>
        </section>
      </section>
    </section>
  </div>
  <div class="dialog-footer">
    <p id="cuts-dialog-feedback" class="cuts-dialog-feedback" role="alert" hidden></p>
    <button class="button" type="button" data-cuts-action="close-dialog">Cancelar</button>
    <button class="button primary" type="submit">Salvar e gerar prévia</button>
  </div>
</template>
