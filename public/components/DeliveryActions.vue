<script setup>
import {computed} from 'vue';
import RetryDetails from './RetryDetails.vue';
const props = defineProps(['d', 'date']);
const browser = computed(() => props.d.engine === 'browser');
const canRetry = computed(() => {const {d} = props; return ['failed','retry','unknown'].includes(d.status) && !d.postId && d.approved !== false && d.hasMedia !== false && (!browser.value || d.status !== 'unknown' && !d.uploadStarted && !d.hasSession);});
const canCancel = computed(() => {const {d} = props; return !d.postId && !d.hasSession && (['preparing','review','pending','retry','failed'].includes(d.status) && (!browser.value || !d.uploadStarted) || browser.value && d.status === 'submitting');});
</script>

<template>
  <template v-if="['local', 'browser'].includes(d.engine)">
    <template v-if="d.status==='review'&&(!browser||d.manualPublication)">
      <button class="button small" data-action="review-native" :data-id="d.id">{{ browser?'Revisar e postar agora':'Revisar e aprovar' }}</button>
    </template>
    <template v-if="canRetry">
      <button class="button small" data-action="retry-native" :data-id="d.id">{{ d.hasSession?'Retomar sessão':'Tentar novamente' }}</button>
    </template>
    <template v-if="canCancel">
      <button class="button small danger" data-action="cancel-native" :data-id="d.id">Cancelar envio</button>
    </template>
    <template v-if="d.status==='unknown'">
      <small>{{ browser?'Confira rascunhos, agendados e publicados no TikTok Studio antes de reenviar.':'Confira o vídeo na plataforma; a sessão existente será consultada ao retomar.' }}</small>
      <template v-if="d.provider==='youtube'">
        <button class="button small" data-action="link-native" :data-id="d.id">Vincular vídeo existente</button>
      </template>
      <template v-if="browser">
        <a class="button small" href="https://www.tiktok.com/tiktokstudio/content" target="_blank" rel="noreferrer">Conferir no TikTok</a>
      </template>
    </template>
    <template v-if="d.status==='inbox'">
      <small>Abra a notificação no TikTok para concluir a publicação.</small>
    </template>
    <template v-if="d.error">
      <small>{{ d.error }}</small>
    </template>
    <RetryDetails :item="d" :date="date" />
  </template>
  <small v-else-if="d.error">{{ d.error }}</small>
</template>
