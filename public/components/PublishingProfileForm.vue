<script setup lang="ts">
import {computed, onMounted, useTemplateRef} from 'vue';
import {vRequestValue} from './request-form.js';
import type {RequestsState, PublishingProfile} from './request-model.js';

const props = defineProps<{state: RequestsState; profile?: PublishingProfile; editing: string | null}>();
const publishing = computed(() => props.state.publishing);
const defaults = computed(() => props.profile?.pack_defaults || {});
const origin = computed(() => props.profile?.source_type || '');
const folders = computed(() => (props.profile?.source_roots || []).map(id => 'https://drive.google.com/drive/folders/' + id).join('\n'));
const editor = useTemplateRef<HTMLDetailsElement>('editor');
onMounted(() => {if (editor.value) editor.value.open = Boolean(props.editing || !publishing.value.profiles.length);});
</script>

<template>
  <details id="profile-editor" ref="editor" class="requests-profile-editor">
    <summary>{{ editing ? 'Editar ' + (profile?.name || 'perfil') : 'Adicionar perfil de conteúdo' }}</summary>
    <form id="publishing-profile-form" :data-profile-id="profile?.id || ''">
      <div class="field-row">
        <div class="form-field"><label for="profile-name">Nome do perfil</label><input id="profile-name" v-request-value="{value: profile?.name || ''}" name="name" maxlength="100" required placeholder="Bíblicos, GTA 6..."></div>
        <div class="form-field"><label for="profile-source">Origem do perfil</label><select id="profile-source" v-request-value="{value: origin}" name="sourceType" :disabled="Boolean(profile?.watch_id)"><option value="">Definir depois</option><option value="gta6_pack">Site · Pack GTA 6</option><option value="google_drive">Pastas do Google Drive</option><option value="local">Pasta local</option></select></div>
      </div>
      <div class="form-field" data-profile-source="google_drive" :hidden="origin !== 'google_drive'"><label for="profile-folders">Pastas do Drive (uma por linha)</label><textarea id="profile-folders" v-request-value="{value: folders}" name="folderUrls" :readonly="Boolean(profile?.watch_id)"></textarea><small>Inclui as subpastas e ignora arquivos repetidos.</small></div>
      <div class="form-field" data-profile-source="local" :hidden="origin !== 'local'"><label for="profile-local">Pasta local</label><input id="profile-local" v-request-value="{value: origin === 'local' ? profile?.folder_url : state.connections.local.rootPath}" name="localPath" :readonly="Boolean(profile?.watch_id)"></div>
      <div class="field-row">
        <div class="form-field"><label for="profile-youtube">Canal YouTube</label><select id="profile-youtube" v-request-value="{value: profile?.youtube_id || ''}" name="youtubeId"><option value="">Vincular depois</option><option v-for="account in publishing.accounts.filter(account => account.identifier === 'youtube' && !account.disabled)" :key="account.id" :value="account.id">{{ account.name }}</option></select></div>
        <div class="form-field"><label for="profile-tiktok">Perfil TikTok</label><select id="profile-tiktok" v-request-value="{value: profile?.tiktok_profile_id || ''}" name="tiktokProfileId"><option value="">Vincular depois</option><option v-for="account in publishing.browserProfiles" :key="account.id" :value="account.id">{{ account.name }}</option></select></div>
      </div>
      <details id="profile-defaults" class="requests-details"><summary>Títulos, descrição e hashtags</summary><div class="requests-advanced">
        <div class="form-field"><label for="profile-prefix">Prefixo do título</label><input id="profile-prefix" v-request-value="{value: defaults.titlePrefix || ''}" name="titlePrefix"></div>
        <div class="form-field"><label for="profile-tags">Hashtags padrão</label><input id="profile-tags" v-request-value="{value: defaults.hashtags?.join(', ') || ''}" name="hashtags"></div>
        <div class="form-field"><label for="profile-description">Descrição padrão</label><textarea id="profile-description" v-request-value="{value: defaults.description || ''}" name="description" maxlength="2000"></textarea></div>
      </div></details>
      <fieldset class="requests-declarations"><legend>Declarações do conteúdo</legend>
        <label class="checkbox"><input v-request-value="{value: defaults.youtubeContainsSyntheticMedia === true}" name="youtubeSynthetic" type="checkbox"><span>YouTube: conteúdo realista alterado ou sintético</span></label>
        <label class="checkbox"><input v-request-value="{value: defaults.madeWithAI !== false}" name="madeWithAI" type="checkbox"><span>TikTok: declarar conteúdo gerado/alterado por IA</span></label>
        <label class="checkbox"><input v-request-value="{value: Boolean(defaults.madeForKids)}" name="madeForKids" type="checkbox"><span>Conteúdo produzido especificamente para crianças</span></label>
      </fieldset>
      <div class="form-actions"><button class="button primary" type="submit">Salvar perfil</button><button v-if="profile" class="button" type="button" data-request-action="new-profile">Adicionar outro perfil</button></div>
    </form>
  </details>
</template>
