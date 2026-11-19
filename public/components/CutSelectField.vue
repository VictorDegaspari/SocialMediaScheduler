<script setup>
defineProps(["id","name","label","options","value"]);
</script>

<template>
  <div class="form-field">
    <label :for="id">{{ label }}</label>
    <select :id="id" :name="name">
      <template v-for="([v,t]) in options" :key="v">
        <option :value="v" :selected="v===value">{{ t }}</option>
      </template>
    </select>
  </div>
</template>
