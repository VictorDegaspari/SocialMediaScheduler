<script setup lang="ts">
import ConnectionIcon from './ConnectionIcon.js';
import type {ConnectionIconName, IconRenderer} from './connection-types.js';

defineProps<{name: string; iconName: ConnectionIconName; status: string; tone?: string; icon: IconRenderer}>();
</script>

<template>
  <div class="connection-title">
    <div class="folder-icon"><ConnectionIcon :name="iconName" :icon="icon" /></div>
    <h3>{{ name }}</h3><span class="badge" :class="tone">{{ status }}</span>
  </div>
</template>
