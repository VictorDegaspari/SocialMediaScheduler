<script setup>
defineProps(['channels']);
</script>

<template>
  <div class="dialog-head">
    <h2 id="browser-publish-title">Postar agora no TikTok</h2>
    <button type="button" class="button ghost" data-immediate-action="close" aria-label="Fechar">×</button>
  </div>
  <form id="immediate-video-form">
    <div class="form-field">
      <label for="immediate-source">Origem do vídeo</label>
      <select id="immediate-source" name="source">
        <option value="cuts">Cortes do aplicativo</option>
        <option value="folders">Vídeos das minhas pastas</option>
      </select>
    </div>
    <div class="form-field">
      <label for="immediate-profile">Perfil do TikTok</label>
      <select id="immediate-profile" name="profileId" required>
        <option value="">Escolha o perfil de destino</option>
        <template v-for="channel in channels" :key="channel.id">
          <option :value="channel.id">{{ channel.name }}</option>
        </template>
      </select>
      <template v-if="!(channels.length)">
        <small>Conecte um perfil TikTok em Conexões para continuar.</small>
      </template>
    </div>
    <div class="form-field">
      <label for="immediate-video">Vídeo para revisar</label>
      <select id="immediate-video" name="videoId" required></select>
    </div>
    <p class="tip" data-immediate-empty hidden>Nenhum vídeo disponível nesta página. Gere um corte ou verifique suas pastas em Minhas pastas.</p>
    <div class="form-actions">
      <button class="button small" type="button" data-immediate-action="prev" disabled>Anterior</button>
      <button class="button small" type="button" data-immediate-action="next" disabled>Próximos vídeos</button>
    </div>
    <p class="error-banner" data-immediate-error hidden role="alert"></p>
    <p class="tip">Na próxima etapa, confira o vídeo e a legenda antes de autorizar a publicação.</p>
    <div class="dialog-footer">
      <button class="button" type="button" data-immediate-action="close">Cancelar</button>
      <button class="button primary" type="submit" :disabled="!(channels.length)">Conferir prévia e legenda</button>
    </div>
  </form>
</template>
