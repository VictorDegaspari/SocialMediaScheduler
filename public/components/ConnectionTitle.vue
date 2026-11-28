<script setup lang="ts">
import ConnectionIcon from './ConnectionIcon.js';
import type {WorkspaceIconName} from './ConnectionIcon.js';

defineProps<{name: string; iconName: WorkspaceIconName; status: string; tone?: string}>();
</script>

<template>
  <div class="connection-title">
    <div class="folder-icon"><ConnectionIcon :name="iconName" /></div>
    <h3>{{ name }}</h3><span class="badge" :class="tone">{{ status }}</span>
  </div>
</template>
