<script setup>
defineProps({hidden: {type: Boolean, default: true}, value: {type: Object, default: () => ({})}});
</script>

<template>
  <fieldset data-tiktok-fields :hidden="hidden" :disabled="hidden">
    <legend>Publicação no TikTok</legend>
    <p class="tip">O Chrome será aberto pelo Playwright para publicar agora no perfil escolhido, com visibilidade pública. Acompanhe as etapas na tela TikTok pelo navegador.</p>
    <label class="checkbox">
      <input type="checkbox" name="tiktokMadeWithAI" :checked="Boolean(value.madeWithAI)">
      <span>Contém conteúdo realista alterado ou gerado por IA.</span>
    </label>
    <label class="checkbox">
      <input type="checkbox" name="allowComment" :checked="Boolean(value.allowComment)">
      <span>Permitir comentários</span>
    </label>
    <label class="checkbox">
      <input type="checkbox" name="allowDuet" :checked="Boolean(value.allowDuet)">
      <span>Permitir duetos</span>
    </label>
    <label class="checkbox">
      <input type="checkbox" name="allowStitch" :checked="Boolean(value.allowStitch)">
      <span>Permitir costura</span>
    </label>
    <label class="checkbox">
      <input type="checkbox" name="commercialContent" :checked="Boolean(value.commercialContent)">
      <span>Conteúdo comercial ou parceria paga</span>
    </label>
    <label class="checkbox">
      <input type="checkbox" name="ownBrand" :checked="Boolean(value.ownBrand)">
      <span>Promove minha marca</span>
    </label>
  </fieldset>
</template>
