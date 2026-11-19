<script setup>
import TiktokPublicationFields from './TiktokPublicationFields.vue';
import {computed} from 'vue';
const props = defineProps(['clip', 'platform', 'cutFormats']);
const format = computed(() => props.clip.framing_options?.format || 'shorts');
</script>

<template>
  <video class="cuts-publish-preview" controls playsinline preload="metadata" :src="'/api/cuts/' + (encodeURIComponent(clip.id)) + '/media?final=1&v=' + (Number(clip.revision)||0)" aria-label="Prévia final do corte"></video>
  <div class="notice">Confira o formato, o enquadramento e as legendas. O envio usa exatamente esta versão da prévia.</div>
  <div class="form-field">
    <label for="cut-platform">Onde postar?</label>
    <select id="cut-platform" name="platform">
      <option value="youtube" :selected="platform==='youtube'">YouTube</option>
      <option value="tiktok" :selected="platform==='tiktok'">TikTok · postar agora</option>
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
    <label for="cut-channel">Canal do YouTube</label>
    <select id="cut-channel" name="channelId" required></select>
    <small data-cut-no-channel hidden>
      Conecte uma conta em
      <a href="#connections" data-cuts-action="close-dialog">Conexões</a>
      para postar.
    </small>
  </div>
  <div data-cut-editorial></div>
  <fieldset data-youtube-fields>
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
  <TiktokPublicationFields />
  <label class="checkbox">
    <input type="checkbox" name="confirm" required>
    <span data-cut-consent></span>
  </label>
  <div class="dialog-footer">
    <p id="cuts-dialog-feedback" class="cuts-dialog-feedback" role="alert" hidden></p>
    <button class="button" type="button" data-cuts-action="close-dialog">Cancelar</button>
    <button class="button primary" type="submit">Autorizar e enviar</button>
  </div>
</template>
