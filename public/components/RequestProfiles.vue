<script setup lang="ts">
import {computed} from 'vue';
import PublishingProfileForm from './PublishingProfileForm.vue';
import type {EditorialPreviewApi} from './editorial-form.js';
import type {RequestsState} from './request-model.js';
const props = defineProps<{state: RequestsState; editing: string | null; revision: number; api: EditorialPreviewApi}>();
const publishing = computed(() => props.state.publishing);
const profile = computed(() => publishing.value.profiles.find(profile => profile.id === props.editing));
const origin = (source?: string) => source === 'gta6_pack' ? 'Pack GTA 6' : source === 'google_drive' ? 'Google Drive' : source === 'local' ? 'Pasta local' : 'Origem não definida';
</script>

<template>
  <section class="panel requests-profiles">
    <div class="requests-section-head"><div><h2>Perfis de conteúdo</h2><p>Reúna a origem dos vídeos e as contas de destino.</p></div></div>
    <div class="requests-profile-list">
      <article v-for="row in publishing.profiles" :key="row.id" class="requests-profile">
        <div class="requests-profile-heading"><div><h3>{{ row.name }}</h3><p>{{ origin(row.source_type) }}</p></div><button class="button small" data-request-action="edit-profile" :data-id="row.id">Editar perfil<span class="requests-sr"> {{ row.name }}</span></button></div>
        <div class="requests-destinations"><span>YouTube <strong>{{ publishing.accounts.find(account => account.id === row.youtube_id)?.name || 'Não vinculado' }}</strong></span><span>TikTok <strong>{{ publishing.browserProfiles.find(account => account.id === row.tiktok_profile_id)?.name || 'Não vinculado' }}</strong></span></div>
        <p v-if="row.source_type === 'google_drive' && !publishing.googleConnected" class="requests-profile-warning">Autorize o Google Drive em <a href="#connections">Conexões</a> para acessar os vídeos.</p>
        <span v-if="!row.source_type" class="badge amber">Defina uma origem</span>
      </article>
    </div>
    <PublishingProfileForm :key="(editing || '') + ':' + revision" :state="state" :profile="profile" :editing="editing" :api="api" />
  </section>
</template>
