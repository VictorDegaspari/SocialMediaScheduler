<script setup>
import {useTemplateRef, watch} from 'vue';
import ConnectionIcon from './ConnectionIcon.js';
import CollectionPagination from './CollectionPagination.vue';
import CutImportButton from './CutImportButton.vue';
import CutJobCard from './CutJobCard.vue';
import CutsDependencies from './CutsDependencies.vue';
const props = defineProps(['jobs','dependencies','pagination','date','safeLink','createDisabled','view','importFile']);
const tabs = [
  {id: 'projects', label: 'Projetos', href: '#cuts'},
  {id: 'create', label: 'Criar novos cortes', href: '#cuts/new'},
];
const projects = useTemplateRef('projects');
watch(() => props.view, view => {
  if (view === 'create') projects.value?.querySelectorAll('video').forEach(video => video.pause());
});

function navigateTabs(event) {
  const tab = event.currentTarget;
  const links = [...tab.parentElement.querySelectorAll('[role="tab"]')];
  let target;
  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowRight': target = links.find(link => link !== tab); break;
    case 'Home': target = links[0]; break;
    case 'End': target = links.at(-1); break;
    case ' ': target = tab; break;
    default: return;
  }
  event.preventDefault();
  target.focus({preventScroll: true});
  target.click();
}
</script>

<template>
  <div id="cuts-panel">
    <div class="page-head">
      <div>
        <span class="eyebrow">CORTES PARA VÍDEOS E SHORTS</span>
        <h1>Gerador de cortes</h1>
        <p class="subtitle">Acompanhe a geração e revise os cortes antes de postar.</p>
      </div>
      <div class="form-actions">
        <CutImportButton :import-file="importFile" />
        <button class="button" data-cuts-action="refresh">
          <ConnectionIcon name="refresh" />
          Atualizar
        </button>
      </div>
    </div>
    <div class="cuts-page-tabs" role="tablist" aria-label="Gerador de cortes">
      <a v-for="tab in tabs" :id="'cuts-tab-' + tab.id" :key="tab.id" :href="tab.href" role="tab"
        :aria-controls="'cuts-view-' + tab.id" :aria-selected="view === tab.id" :tabindex="view === tab.id ? 0 : -1"
        @keydown="navigateTabs">{{ tab.label }}</a>
    </div>
    <div v-show="view === 'create'" id="cuts-view-create" class="cuts-intro" role="tabpanel" aria-labelledby="cuts-tab-create">
      <section class="panel cuts-create">
        <div class="connection-title">
          <div class="folder-icon">
            <ConnectionIcon name="youtube" />
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
              <ConnectionIcon name="play" />
              Gerar cortes
            </button>
            <button class="button" type="submit" data-cut-source-range :disabled="createDisabled">Escolher trecho</button>
          </div>
          <p class="tip">Em gravações longas, use Escolher trecho para baixar e analisar apenas o intervalo escolhido.</p>
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
    <section v-show="view === 'projects'" id="cuts-view-projects" ref="projects" role="tabpanel" aria-labelledby="cuts-tab-projects">
      <div id="cuts-jobs">
        <template v-if="jobs.length">
          <CutJobCard v-for="job in jobs" :key="job.id" :job="job" :date="date" :safe-link="safeLink" />
        </template>
        <template v-else>
          <div class="panel empty-state cuts-empty">
            <h2>Nenhum projeto de cortes</h2>
            <p>Importe um MP4 para editar um corte pronto ou use Criar novos cortes para selecionar trechos de um vídeo do YouTube.</p>
          </div>
        </template>
      </div>
      <div id="cuts-pagination">
        <CollectionPagination :page="pagination" scope="cuts" />
      </div>
    </section>
  </div>
</template>
