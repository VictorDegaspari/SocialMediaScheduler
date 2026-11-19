<script setup>
import {computed} from 'vue';
import TiktokPublicationFields from './TiktokPublicationFields.vue';
const props = defineProps(['d']);
const m = computed(() => props.d.payload.metadata);
const yt = computed(() => props.d.provider === 'youtube');
const browser = computed(() => props.d.engine === 'browser');
</script>

<template>
  <div class="notice">
    <strong>Destino: {{ d.payload.channelName }}</strong>
    <br>
    <template v-if="browser">Este vídeo será publicado agora no TikTok, com visibilidade pública, no perfil escolhido.</template>
    <template v-else>{{ yt?'O vídeo será enviado à API oficial com a visibilidade escolhida abaixo.':'Este envio cria uma notificação na caixa de entrada do TikTok. Você precisa abrir o aplicativo, revisar a legenda e a indicação de IA e concluir a publicação.' }}</template>
  </div>
  <template v-if="d.hasMedia">
    <video class="native-preview" controls preload="metadata" :src="'/api/native/deliveries/' + (d.id) + '/media'"></video>
  </template>
  <div class="form-field">
    <label for="native-title">Título do vídeo</label>
    <input id="native-title" name="title" :value="m.title" required maxlength="100">
  </div>
  <div class="form-field">
    <label for="native-description">Descrição / legenda</label>
    <textarea id="native-description" name="description" maxlength="4900" rows="4">{{ m.description }}</textarea>
    <template v-if="!(yt||browser)">
      <small>A API de caixa de entrada envia o arquivo. Copie a legenda abaixo para finalizar a edição no TikTok.</small>
    </template>
  </div>
  <div class="form-field">
    <label for="native-hashtags">Hashtags, separadas por vírgula</label>
    <input id="native-hashtags" name="hashtags" :value="m.hashtags.join(', ')">
  </div>
  <template v-if="browser">
    <TiktokPublicationFields :hidden="false" :value="m.tiktok" />
  </template>
  <template v-else>
    <template v-if="yt">
      <div class="form-field">
        <label for="native-visibility">Visibilidade no YouTube</label>
        <select id="native-visibility" name="visibility">
          <template v-for="([v,l]) in [['private','Privado'],['unlisted','Não listado'],['public','Público']]">
            <option :value="v" :selected="m.youtube.visibility===v">{{ l }}</option>
          </template>
        </select>
      </div>
      <label class="checkbox">
        <input type="checkbox" name="madeForKids" :checked="m.youtube.madeForKids">
        <span>Este conteúdo é destinado a crianças.</span>
      </label>
      <label class="checkbox">
        <input type="checkbox" name="containsSyntheticMedia" :checked="m.youtube.containsSyntheticMedia">
        <span>Contém conteúdo realista alterado ou gerado por IA.</span>
      </label>
    </template>
    <template v-else>
      <button class="button small" type="button" data-action="copy-caption">Copiar legenda</button>
      <template v-if="m.tiktok.madeWithAI">
        <p class="tip">O JSON declara uso de IA. Mantenha essa indicação ao concluir a publicação no TikTok.</p>
      </template>
    </template>
  </template>
  <label class="checkbox">
    <input type="checkbox" name="confirm" required>
    <span>
      Autorizo o envio deste vídeo para
      {{ d.payload.channelName }}
      <template v-if="browser"> com publicação pública imediata.</template>
      <template v-else>{{ yt?' com a visibilidade selecionada.':' e vou concluir a revisão e a publicação no TikTok.' }}</template>
    </span>
  </label>
  <div class="dialog-footer">
    <button class="button" type="button" data-action="close-review">Cancelar</button>
    <button class="button primary" type="submit">{{ browser ? 'Autorizar e postar agora' : 'Autorizar e enviar' }}</button>
  </div>
</template>
