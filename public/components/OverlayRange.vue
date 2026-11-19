<script setup lang="ts">
defineProps<{
  field: 'fontSize' | 'width' | 'height' | 'x' | 'y' | 'opacity';
  label: string;
  min: number;
  max: number;
  value: number;
}>();
</script>

<template>
  <div class="form-field cuts-editor-range">
    <label :for="'cut-overlay-' + field">
      {{ label }} <output :data-overlay-output="field">{{ value }}{{ field === 'fontSize' ? '' : '%' }}</output>
    </label>
    <input :id="'cut-overlay-' + field" :data-overlay-field="field" type="range" :min="min" :max="max" step="1" :value="value">
  </div>
</template>
