<script setup>
import TiktokPublicationFields from './TiktokPublicationFields.vue';
import {computed} from 'vue';
const props = defineProps(['clip', 'platform', 'cutFormats', 'destinations']);
const format = computed(() => props.clip.framing_options?.format || 'shorts');
const tiktok = computed(() => props.platform === 'tiktok');
</script>

<template>
  <video class="cuts-publish-preview" controls playsinline preload="metadata" :src="'/api/cuts/' + (encodeURIComponent(clip.id)) + '/media?final=1&v=' + (Number(clip.revision)||0)" aria-label="Prévia final do corte"></video>
  <div class="notice">Confira o formato, o enquadramento e as legendas. O envio usa exatamente esta versão da prévia.</div>
  <div class="form-field">
    <label for="cut-platform">Onde postar?</label>
    <select id="cut-platform" name="platform" :value="platform">
      <option value="youtube">YouTube</option>
      <option value="tiktok">TikTok · postar agora</option>
    </select>
  </div>
  <div class="form-field">
    <label for="cut-publish-format">Publicar como</label>
    <select id="cut-publish-format" name="format">
      <template v-for="([value,label]) in cutFormats">
        <option :value="value" :selected="value===format">{{ label }}</option>
      </template>
    </select>
  </div>
  <div id="cut-format-change" class="notice" hidden>
    O formato escolhido precisa de uma nova prévia. Ajuste e confira antes de postar.
    <button class="button small" type="button" data-cuts-action="edit-format" :data-id="clip.id">Ajustar formato</button>
  </div>
  <div class="form-field">
    <label for="cut-channel">{{ tiktok ? 'Perfil do TikTok' : 'Canal do YouTube' }}</label>
    <select id="cut-channel" name="channelId" required>
      <option value="">Escolha a conta de destino</option>
      <option v-for="{value, disabled, label} in destinations" :key="value" :value="value" :disabled="disabled">{{ label }}</option>
    </select>
    <small data-cut-no-channel :hidden="destinations.length > 0">
      Conecte uma conta em
      <a href="#connections" data-cuts-action="close-dialog">Conexões</a>
      para postar.
    </small>
  </div>
  <div v-once data-cut-editorial></div>
  <fieldset data-youtube-fields :hidden="tiktok" :disabled="tiktok">
    <legend>YouTube</legend>
    <div class="form-field">
      <label for="cut-visibility">Visibilidade</label>
      <select id="cut-visibility" name="visibility">
        <option value="private">Privado</option>
        <option value="unlisted">Não listado</option>
        <option value="public">Público</option>
      </select>
    </div>
    <label class="checkbox">
      <input type="checkbox" name="madeForKids">
      <span>Este conteúdo é destinado a crianças.</span>
    </label>
    <label class="checkbox">
      <input type="checkbox" name="containsSyntheticMedia">
      <span>Contém conteúdo realista alterado ou gerado por IA.</span>
    </label>
  </fieldset>
  <TiktokPublicationFields :hidden="!tiktok" />
  <label class="checkbox">
    <input type="checkbox" name="confirm" required>
    <span data-cut-consent>{{ tiktok
      ? 'Revisei este vídeo e autorizo a publicação agora, com visibilidade pública, no perfil TikTok escolhido.'
      : 'Revisei o vídeo e a legenda e autorizo o envio ao canal e com a visibilidade escolhidos acima.' }}</span>
  </label>
  <div class="dialog-footer">
    <p id="cuts-dialog-feedback" class="cuts-dialog-feedback" role="alert" hidden></p>
    <button class="button" type="button" data-cuts-action="close-dialog">Cancelar</button>
    <button class="button primary" type="submit">{{ tiktok ? 'Autorizar e postar agora' : 'Autorizar e enviar' }}</button>
  </div>
</template>
