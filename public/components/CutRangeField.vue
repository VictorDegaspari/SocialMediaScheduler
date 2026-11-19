<script setup>
defineProps(["id","name","label","value","min","max","step"]);
</script>

<template>
  <div class="form-field cuts-editor-range">
    <label :for="id">
      {{ label }}
      <output :data-cut-output="name">{{ value }}</output>
    </label>
    <input :id="id" :name="name" type="range" :min="min" :max="max" :step="step" :value="value">
  </div>
</template>
