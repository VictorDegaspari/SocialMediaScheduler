<script setup>
import {computed} from 'vue';
const props = defineProps(['group', 'label', 'items', 'primary']);
const active = computed(() => props.items[0][0]);
</script>

<template>
  <div :class="primary?'cuts-editor-primary-tabs':'cuts-editor-subtabs'" role="tablist" :aria-label="label" :data-editor-tabs="group">
    <template v-for="([id,title], index) in items" :key="id">
      <button type="button" role="tab" :id="(id) + '-tab'" :aria-controls="id" :aria-selected="id===active" :tabindex="id===active?0:-1" :data-editor-tab="id" :data-cut-editor-section="primary ? id : undefined">
        <template v-if="primary">
          <span>{{ index+1 }}</span>
        </template>
        {{ title }}
      </button>
    </template>
  </div>
</template>
