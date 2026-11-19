<script setup lang="ts">
import {computed} from 'vue';
import {vRequestValue} from './request-form.js';
import type {EditorialOptions} from '../../src/editorial-config.js';

const props = defineProps<{variant: 'profile' | 'pack'; idPrefix: string; value?: Partial<EditorialOptions>}>();
const pack = computed(() => props.variant === 'pack');
const id = (field: string) => props.idPrefix + '-' + field;
const name = (field: string) => (pack.value ? 'packeditorial' : 'editorial') + field;
</script>

<template>
  <label class="checkbox">
    <input v-request-value="{value: value?.enabled !== false}" :name="name('Enabled')" type="checkbox">
    <span>{{ pack ? 'Completar descrições, hashtags e tags sem IA' : 'Completar descrições, hashtags e tags automaticamente, sem IA' }}</span>
  </label>
  <div class="form-field">
    <label :for="id('topic')">{{ pack ? 'Tema do conteúdo' : 'Tema do perfil' }}</label>
    <input :id="id('topic')" v-request-value="{value: value?.topic || ''}" :name="name('Topic')" maxlength="160"
      :placeholder="pack ? undefined : 'Ex.: reflexões bíblicas, GTA 6'">
  </div>
  <div class="form-field">
    <label :for="id('keywords')">{{ pack ? 'Palavras-chave' : 'Palavras-chave do perfil' }}</label>
    <input :id="id('keywords')" v-request-value="{value: value?.keywords?.join(', ') || ''}" :name="name('Keywords')"
      :placeholder="pack ? undefined : 'Separe por vírgula'">
    <small v-if="!pack">Tags do YouTube e hashtags são preparadas separadamente.</small>
  </div>
  <div class="form-field">
    <label :for="id('context')">Contexto editorial</label>
    <textarea :id="id('context')" v-request-value="{value: value?.context || ''}" :name="name('Context')" maxlength="2000"
      :rows="pack ? undefined : 3" :placeholder="pack ? undefined : 'Público, tom e informações reais sobre este conteúdo.'"></textarea>
  </div>
  <label class="checkbox">
    <input v-request-value="{value: value?.ai || false}" :name="name('Ai')" type="checkbox">
    <span>{{ pack ? 'Usar IA opcional configurada no servidor; envia textos e contexto ao provedor.' : 'Melhorar com IA opcional configurada no servidor. Envia os textos e o contexto ao provedor escolhido.' }}</span>
  </label>
</template>
