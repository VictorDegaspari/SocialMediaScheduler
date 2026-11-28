<script setup>
defineProps(['channels', 'options', 'loading', 'pending', 'canGoBack', 'hasMore', 'empty', 'error', 'progress']);
</script>

<template>
  <dialog id="browser-publish-dialog" class="dialog" aria-labelledby="browser-publish-title">
  <div class="dialog-head">
    <h2 id="browser-publish-title">Postar agora no TikTok</h2>
    <button type="button" class="button ghost" data-immediate-action="close" aria-label="Fechar">×</button>
  </div>
  <form id="immediate-video-form">
    <div class="form-field">
      <label for="immediate-source">Origem do vídeo</label>
      <select id="immediate-source" name="source" :disabled="pending">
        <option value="cuts">Cortes do aplicativo</option>
        <option value="folders">Vídeos das minhas pastas</option>
      </select>
    </div>
    <div class="form-field">
      <label for="immediate-profile">Perfil do TikTok</label>
      <select id="immediate-profile" name="profileId" required :disabled="pending">
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
      <select id="immediate-video" name="videoId" required :disabled="pending || loading">
        <option value="">{{ loading ? 'Carregando vídeos…' : 'Escolha o vídeo' }}</option>
        <option v-for="{value, label} in options" :key="value" :value="value">{{ label }}</option>
      </select>
    </div>
    <p class="tip" data-immediate-empty :hidden="loading || !empty">Nenhum vídeo disponível nesta página. Gere um corte ou verifique suas pastas em Minhas pastas.</p>
    <div class="form-actions">
      <button class="button small" type="button" data-immediate-action="prev" :disabled="pending || loading || !canGoBack">Anterior</button>
      <button class="button small" type="button" data-immediate-action="next" :disabled="pending || loading || !hasMore">Próximos vídeos</button>
    </div>
    <p class="error-banner" data-immediate-error :hidden="!error" role="alert">{{ error }}</p>
    <p class="tip" data-immediate-progress :hidden="!progress" role="status">{{ progress }}</p>
    <p class="tip">Na próxima etapa, confira o vídeo e a legenda antes de autorizar a publicação.</p>
    <div class="dialog-footer">
      <button class="button" type="button" data-immediate-action="close">Cancelar</button>
      <button class="button primary" type="submit" :disabled="pending || loading || !channels.length">Conferir prévia e legenda</button>
    </div>
  </form>
  </dialog>
</template>
