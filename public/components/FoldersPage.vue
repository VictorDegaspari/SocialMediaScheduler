<script setup>
import ConnectionIcon from './ConnectionIcon.js';
import CollectionPagination from './CollectionPagination.vue';
import WatchCards from './WatchCards.vue';
defineProps(['state', 'date', 'pagination', 'scheduleApi', 'onScheduleChanged']);
</script>

<template>
  <div id="my-folders" class="my-folders">
    <div class="page-head">
      <div>
        <span class="eyebrow">SUA BIBLIOTECA</span>
        <h1>Minhas pastas</h1>
        <p class="subtitle">Seus cortes e pastas de vídeos em um só lugar.</p>
      </div>
      <div class="folders-page-actions">
        <a class="button" href="#cuts/new">
          <ConnectionIcon name="plus" />
          Gerar novos cortes
        </a>
        <button class="button primary" data-action="new-watch">
          <ConnectionIcon name="folder" />
          Adicionar pasta
        </button>
      </div>
    </div>
    <nav class="folders-shortcuts" aria-label="Seções de Minhas pastas">
      <button type="button" data-folder-jump="cuts-library" aria-controls="cuts-library">
        <ConnectionIcon name="play" />
        Cortes salvos
      </button>
      <button type="button" data-folder-jump="watch-routines" aria-controls="watch-routines">
        <ConnectionIcon name="folder" />
        Pastas de vídeos
      </button>
    </nav>
    <div id="cut-library-host"></div>
    <section id="watch-routines" aria-labelledby="video-folders-title">
      <div class="folders-section-heading">
        <div>
          <h2 id="video-folders-title">Pastas de vídeos</h2>
          <p>Pastas conectadas e seus horários de envio.</p>
        </div>
      </div>
      <WatchCards :items="state.watches" :date="date" :schedule-api="scheduleApi" :on-schedule-changed="onScheduleChanged" />
      <CollectionPagination :page="pagination" scope="watches" />
      <details class="folders-help" data-folder-details="help">
        <summary>Como funcionam os envios?</summary>
        <p>A verificação encontra novos arquivos. A frequência de envio determina quando o próximo vídeo da fila será processado. Se o PC estiver desligado, a rotina retoma com um envio por oportunidade.</p>
        <a href="#browser">
          Postar um vídeo agora no TikTok
          <ConnectionIcon name="arrow" />
        </a>
      </details>
    </section>
  </div>
</template>
