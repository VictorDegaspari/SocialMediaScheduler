<script setup>
import ConnectionIcon from './ConnectionIcon.js';
import CollectionPagination from './CollectionPagination.vue';
import CutJobCard from './CutJobCard.vue';
import CutsDependencies from './CutsDependencies.vue';
defineProps(["jobs","dependencies","pagination","icon","date","safeLink","createDisabled"]);
</script>

<template>
  <div id="cuts-panel">
    <div class="page-head">
      <div>
        <span class="eyebrow">CORTES PARA VÍDEOS E SHORTS</span>
        <h1>Gerador de cortes</h1>
        <p class="subtitle">Cole o link, receba os melhores trechos sugeridos e revise antes de postar.</p>
      </div>
      <button class="button" data-cuts-action="refresh">
        <ConnectionIcon name="refresh" :icon="icon" />
        Atualizar
      </button>
    </div>
    <div class="cuts-intro">
      <section class="panel cuts-create">
        <div class="connection-title">
          <div class="folder-icon">
            <ConnectionIcon name="youtube" :icon="icon" />
          </div>
          <h2>Criar novos cortes</h2>
        </div>
        <form id="cuts-create-form">
          <div class="form-field">
            <label for="cuts-url">Link do vídeo no YouTube</label>
            <input id="cuts-url" name="url" type="url" required maxlength="2000" placeholder="https://www.youtube.com/watch?v=..." autocomplete="off">
            <small>Um vídeo por projeto. O áudio original é mantido.</small>
          </div>
          <div class="field-row">
            <div class="form-field">
              <label for="cuts-count">Quantidade de cortes</label>
              <select id="cuts-count" name="count">
                <template v-for="n in [1,2,3,4,5]">
                  <option :value="n" :selected="n===3">{{ n }} corte{{ n>1?'s':'' }}</option>
                </template>
              </select>
            </div>
            <div class="form-field">
              <label for="cuts-duration">Duração desejada</label>
              <select id="cuts-duration" name="targetSeconds">
                <template v-for="([v,t]) in [[30,'30 segundos'],[60,'60 segundos'],[90,'90 segundos'],[120,'2 minutos'],[180,'3 minutos']]">
                  <option :value="v" :selected="v===60">{{ t }}</option>
                </template>
              </select>
            </div>
          </div>
          <div class="form-field">
            <label for="cuts-language">Idioma falado no vídeo</label>
            <select id="cuts-language" name="language">
              <option value="pt">Português</option>
              <option value="auto">Detectar automaticamente</option>
              <option value="en">Inglês</option>
              <option value="es">Espanhol</option>
            </select>
          </div>
          <div class="form-actions">
            <button class="button primary" type="submit" :disabled="createDisabled">
              <ConnectionIcon name="play" :icon="icon" />
              Gerar cortes
            </button>
          </div>
        </form>
        <div id="cuts-dependencies">
          <CutsDependencies :dependencies="dependencies" />
        </div>
      </section>
      <aside class="cuts-guide">
        <span class="eyebrow">VOCÊ REVISA O RESULTADO</span>
        <h2>Da fala original à legenda.</h2>
        <p>O gerador transcreve o áudio, sugere trechos e prepara cortes para revisar. Em Ajustar, escolha Shorts vertical ou vídeo horizontal, com ou sem legendas.</p>
        <ol>
          <li>
            <strong>Assista à prévia.</strong>
            <span>Os trechos são sugestões automáticas baseadas na fala.</span>
          </li>
          <li>
            <strong>Ajuste o que precisar.</strong>
            <span>Corrija palavras, tempos, duração, formato e enquadramento.</span>
          </li>
          <li>
            <strong>Escolha o canal e poste.</strong>
            <span>O envio acontece depois da sua aprovação.</span>
          </li>
        </ol>
        <p class="cuts-review-note">A transcrição automática pode errar. Confira a legenda ouvindo o áudio antes de postar.</p>
        <p class="tip">Os arquivos são mantidos após postar. Use “Baixar MP4” para reutilizar no TikTok ou YouTube e exclua manualmente quando terminar. O histórico é preservado.</p>
      </aside>
    </div>
    <div class="section-head cuts-results-head">
      <div>
        <h2>Seus projetos</h2>
        <p>Prévias, ajustes e andamento dos envios.</p>
      </div>
    </div>
    <div id="cuts-jobs">
      <template v-if="jobs.length">
        <CutJobCard v-for="job in jobs" :key="job.id" :job="job" :icon="icon" :date="date" :safe-link="safeLink" />
      </template>
      <template v-else>
        <div class="panel empty-state cuts-empty">
          <h3>Seu próximo Short começa com um link</h3>
          <p>Cole um vídeo do YouTube para receber sugestões de cortes com legendas e uma prévia pronta para revisar.</p>
        </div>
      </template>
    </div>
    <div id="cuts-pagination">
      <CollectionPagination :page="pagination" scope="cuts" />
    </div>
  </div>
</template>
