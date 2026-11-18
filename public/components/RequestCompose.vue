<script setup lang="ts">
import NativeScheduleFields from './NativeScheduleFields.vue';
import {vRequestValue} from './request-form.js';
import type {PublishingProfile} from './request-model.js';
import type {NativeScheduleModel} from '../native-schedule.js';
defineProps<{profiles: PublishingProfile[]; tiktokReady: boolean; revision: number; schedule: NativeScheduleModel}>();
</script>

<template>
  <section class="panel requests-compose">
    <div class="requests-section-head"><div><h2>Novo pedido</h2><p>Defina o que e quando publicar.</p></div></div>
    <div v-if="!profiles.length" class="requests-empty"><h3>Crie um perfil para começar</h3><p>O perfil reúne seus vídeos e as contas de destino.</p><button class="button primary" type="button" data-requests-view="profiles">Criar perfil de conteúdo</button></div>
    <form v-else id="publication-request-form">
      <div class="form-field"><label for="request-profile">Perfil de conteúdo</label><select id="request-profile" v-request-value="{value: '', revision}" name="profileId" required><option value="">Selecione um perfil</option><option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option></select></div>
      <div class="form-field"><label for="request-quantity">Quantidade de vídeos por plataforma</label><input id="request-quantity" v-request-value="{value: 10, revision}" name="quantity" type="number" min="1" max="10000" required></div>
      <fieldset class="requests-platforms"><legend>Onde publicar</legend><label class="checkbox"><input v-request-value="{value: true, revision}" type="checkbox" name="platforms" value="youtube"><span>YouTube</span></label><label class="checkbox"><input v-request-value="{value: tiktokReady, revision}" type="checkbox" name="platforms" value="tiktok" :disabled="!tiktokReady"><span>TikTok</span></label></fieldset>
      <p v-if="!tiktokReady" class="requests-note">Para usar o TikTok, <a href="#connections">adicione o token de automação em Conexões</a>.</p>
      <div class="form-field"><label for="request-times">Horários de postagem</label><input id="request-times" v-request-value="{value: '08:00, 20:00', revision}" name="times" required><small>Separe por vírgula. Horário de São Paulo.</small></div>
      <details id="request-schedule-options" class="requests-details"><summary>Limites e período de publicação</summary><div class="requests-advanced"><NativeScheduleFields :model="schedule" prefix="request" :revision="revision" /></div></details>
      <button class="button primary requests-submit" type="submit">Criar pedido e colocar na fila</button><p class="requests-note">Os vídeos entram na fila e são agendados conforme a capacidade da conta.</p>
    </form>
  </section>
</template>
