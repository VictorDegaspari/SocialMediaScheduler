<script setup>
import CollectionPagination from './CollectionPagination.vue';
import CutImportButton from './CutImportButton.vue';
import CutClipCard from './CutClipCard.vue';
defineProps(["groups","pagination","scope","icon","safeLink","importFile"]);
</script>

<template>
  <section id="cuts-library" class="cuts-library">
    <div class="page-head">
      <div>
        <h2>Cortes do aplicativo</h2>
        <p>Assista, ajuste ou escolha onde publicar.</p>
      </div>
      <CutImportButton :import-file="importFile" />
    </div>
    <div id="cut-library-jobs">
      <template v-if="groups.length">
        <div v-for="job in groups" :key="job.id" class="cuts-library-project" :data-cut-job="job.id">
          <CutClipCard v-for="clip in job.clips" :key="clip.id" :clip="clip" :job="job" :library="true" :icon="icon" :safe-link="safeLink" />
        </div>
      </template>
      <template v-else>
        <div class="panel empty-state cuts-empty">
          <h3>Nenhum corte com arquivo disponível</h3>
          <p>Os cortes prontos aparecem nesta pasta automaticamente.</p>
        </div>
      </template>
    </div>
    <div id="cut-library-pagination">
      <CollectionPagination :page="pagination" :scope="scope" />
    </div>
  </section>
</template>
