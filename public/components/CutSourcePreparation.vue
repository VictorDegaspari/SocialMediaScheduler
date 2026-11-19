<script setup>
defineProps(['id']);
</script>

<template>
  <p class="notice">O vídeo original deste projeto precisa ser recuperado. O download usa a melhor qualidade disponível de imagem e áudio e preserva os cortes e envios anteriores. Você pode fechar esta janela; a recuperação continua em segundo plano.</p>
  <p id="cut-source-preparation" role="status">Preparando recuperação…</p>
  <p id="cut-source-preparation-error" class="error-banner" role="alert" hidden></p>
  <div class="dialog-footer">
    <button class="button" type="button" data-cuts-action="close-dialog">Cancelar</button>
    <button id="cut-source-prepare-retry" class="button primary" type="button" data-cuts-action="edit" :data-id="id" hidden>Tentar recuperar novamente</button>
  </div>
</template>
