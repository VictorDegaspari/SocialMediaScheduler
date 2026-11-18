<script setup lang="ts">
import type {NativeScheduleModel} from '../native-schedule.js';
import {vRequestValue} from './request-form.js';
defineProps<{model: NativeScheduleModel; prefix: string; revision: number}>();
</script>

<template>
  <div class="notice">{{ model.notice }}</div>
  <template v-for="group in model.groups" :key="group[0].name">
    <div v-if="group.length > 1" class="field-row">
      <div v-for="field in group" :key="field.name" class="form-field">
        <label :for="prefix + '-' + field.name">{{ field.label }}</label>
        <input :id="prefix + '-' + field.name" v-request-value="{value: field.value, revision}" :name="field.name" type="number" :min="field.min" :max="field.max" required>
        <small v-if="field.hint">{{ field.hint }}</small>
      </div>
    </div>
    <div v-else class="form-field">
      <label :for="prefix + '-' + group[0].name">{{ group[0].label }}</label>
      <input :id="prefix + '-' + group[0].name" v-request-value="{value: group[0].value, revision}" :name="group[0].name" type="number" :min="group[0].min" :max="group[0].max" required>
      <small v-if="group[0].hint">{{ group[0].hint }}</small>
    </div>
  </template>
  <div class="field-row">
    <div v-for="field in model.dates" :key="field.name" class="form-field"><label :for="prefix + '-' + field.name">{{ field.label }}</label><input :id="prefix + '-' + field.name" v-request-value="{value: field.value, revision}" :name="field.name" type="datetime-local"></div>
  </div>
  <p class="tip">{{ model.tip }}</p>
</template>
