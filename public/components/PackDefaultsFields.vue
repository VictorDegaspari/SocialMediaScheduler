<script setup>
import {computed} from 'vue';
import EditorialOptionFields from './EditorialOptionFields.vue';
const props = defineProps(['value', 'prefix']);
const defaults = computed(() => ({titlePrefix:'GTA 6 —',description:'',hashtags:['gta6','gtavi','shorts'],madeWithAI:true,youtubeContainsSyntheticMedia:false,madeForKids:false,youtubeVisibility:'public',...props.value}));
</script>

<template>
  <div class="notice">
    <strong>Pack GTA 6 conectado ao catálogo do site.</strong>
    O sistema encontra os vídeos no Drive e baixa somente os necessários para a fila. Você não precisa salvar arquivos nem criar JSONs.
  </div>
  <div class="form-field">
    <label :for="(prefix) + '-pack-title'">Prefixo do título</label>
    <input :id="(prefix) + '-pack-title'" name="packTitlePrefix" maxlength="60" :value="defaults.titlePrefix">
    <small>Combinado com o título disponível no site, por exemplo: GTA 6 — Vídeo 0001.</small>
  </div>
  <div class="form-field">
    <label :for="(prefix) + '-pack-description'">Descrição dos vídeos importados</label>
    <textarea :id="(prefix) + '-pack-description'" name="packDescription" maxlength="4000">{{ defaults.description }}</textarea>
  </div>
  <div class="form-field">
    <label :for="(prefix) + '-pack-tags'">Hashtags do pack</label>
    <input :id="(prefix) + '-pack-tags'" name="packHashtags" :value="defaults.hashtags.join(', ')">
    <small>Separe por vírgula.</small>
  </div>
  <details :data-pack-editorial="prefix">
    <summary>Geração automática de textos</summary>
    <EditorialOptionFields variant="pack" :id-prefix="prefix + '-editorial'" :value="defaults.editorial" />
  </details>
  <div class="form-field">
    <label :for="(prefix) + '-pack-visibility'">Visibilidade dos vídeos do pack no YouTube</label>
    <select :id="(prefix) + '-pack-visibility'" name="packYoutubeVisibility">
      <template v-for="([v,label]) in [['public','Público na data agendada'],['private','Privado'],['unlisted','Não listado']]">
        <option :value="v" :selected="defaults.youtubeVisibility===v">{{ label }}</option>
      </template>
    </select>
  </div>
  <label class="checkbox">
    <input name="packYoutubeSynthetic" type="checkbox" :checked="defaults.youtubeContainsSyntheticMedia">
    <span>
      YouTube: conteúdo realista alterado ou sintético
      <small>Desmarcado por padrão. Ative quando o conteúdo exigir essa declaração. A limpeza das tags do arquivo é independente.</small>
    </span>
  </label>
  <label class="checkbox">
    <input name="packMadeWithAI" type="checkbox" :checked="defaults.madeWithAI">
    <span>TikTok: declarar conteúdo gerado ou alterado por IA</span>
  </label>
  <label class="checkbox">
    <input name="packMadeForKids" type="checkbox" :checked="defaults.madeForKids">
    <span>Conteúdo produzido especificamente para crianças</span>
  </label>
  <p class="tip">As imagens do pack são ignoradas. Vídeos repetidos são bloqueados pelo histórico. O arquivo precisa passar pela validação de MP4 vertical ou quadrado, com até 3 minutos.</p>
</template>
