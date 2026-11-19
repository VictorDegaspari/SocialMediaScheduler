<script setup>
defineProps(['publications', 'safeLink']);
const labels = {pending:'Na fila',retry:'Aguardando nova tentativa',submitting:'Enviando',processing:'Processando',published:'Publicado',scheduled:'Agendado',private:'Privado',unlisted:'Não listado',completed:'Publicado',failed:'Precisa de atenção',cancelled:'Cancelado',unknown:'Conferir no histórico'};
const platform = delivery => delivery.provider === 'youtube' ? 'YouTube' : 'TikTok';
const release = delivery => delivery.release_url || (delivery.provider === 'youtube' && delivery.post_id ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(delivery.post_id) : null);
</script>

<template>
  <template v-for="delivery in publications" :key="delivery.id || delivery.integration_id">
    <div class="cut-publication">
      <strong>{{ platform(delivery) }} · {{ delivery.channel_name||'Conta selecionada' }}</strong>
      <span>{{ labels[delivery.status] || delivery.status }}</span>
      <template v-if="release(delivery)">
        <a :href="safeLink(release(delivery))" target="_blank" rel="noreferrer">Abrir no {{ platform(delivery) }}</a>
      </template>
      <template v-if="delivery.error">
        <small>{{ delivery.error }}</small>
      </template>
    </div>
  </template>
</template>
