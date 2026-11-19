<script setup lang="ts">
import {onBeforeUnmount, onMounted, reactive, ref} from 'vue';
import {MAX_CUT_SOURCE_SECONDS, type CutSourceRange} from '../../src/cuts-source-limits.js';
import type {ChannelVideo} from '../../src/youtube-channel-lookup.js';
import type {FollowedYoutubeChannel} from '../../src/youtube-channels.js';
import LiveCutRangeDialog from './LiveCutRangeDialog.vue';

const props = defineProps<{
  api: <T>(path: string, body?: unknown, method?: 'POST' | 'DELETE') => Promise<T>;
  toast: (message: string, error?: boolean) => void;
  queued: () => void;
}>();

const path = '/youtube-channels';
const maxAgeMs = 15 * 60 * 1000;
const options = {dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo'} as const;
const checkedDate = new Intl.DateTimeFormat('pt-BR', options);
const channels = ref<FollowedYoutubeChannel[]>([]);
const input = ref('');
const loading = ref(true);
const busy = ref(false);
const loaded = ref(false);
const error = ref('');
const lookupErrors = reactive(new Map<string, string>());
const pendingVideos = reactive(new Set<string>());
const queuedVideos = reactive(new Set<string>());
const selectedVideo = ref<ChannelVideo | null>(null);
let active = true;
let refreshTimer: ReturnType<typeof setInterval>;
onBeforeUnmount(() => {
  active = false;
  clearInterval(refreshTimer);
});

const videoUrl = (id: string) => 'https://www.youtube.com/watch?v=' + encodeURIComponent(id);
const channelUrl = (id: string) => 'https://www.youtube.com/channel/' + encodeURIComponent(id);
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Não foi possível concluir a operação.';

function formatDuration(seconds: number) {
  const parts = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, Math.floor(seconds) % 60];
  return (parts[0] ? parts : parts.slice(1)).map(part => String(part).padStart(2, '0')).join(':');
}

function requiresRange(video: ChannelVideo) {
  return video.kind === 'live' || (video.duration ?? 0) > MAX_CUT_SOURCE_SECONDS;
}

function saveChannel(channel: FollowedYoutubeChannel) {
  const index = channels.value.findIndex(item => item.id === channel.id);
  if (index < 0) channels.value.push(channel);
  else channels.value[index] = channel;
  lookupErrors.delete(channel.id);
}

async function refreshChannels(items = channels.value) {
  if (busy.value || !items.length) return;
  busy.value = true;
  error.value = '';
  try {
    for (let index = 0; active && index < items.length; index += 3) {
      await Promise.all(items.slice(index, index + 3).map(async ({id}) => {
        try {
          const updated = await props.api<FollowedYoutubeChannel>(path + '/' + id + '/refresh', {});
          if (active) saveChannel(updated);
        } catch (cause) {
          if (active) lookupErrors.set(id, message(cause));
        }
      }));
    }
  } finally {
    busy.value = false;
  }
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const saved = await props.api<FollowedYoutubeChannel[]>(path);
    if (!active) return;
    channels.value = saved;
    loaded.value = true;
    await refreshStaleChannels();
  } catch (cause) {
    if (active) error.value = message(cause);
  } finally {
    loading.value = false;
  }
}

function refreshStaleChannels() {
  const cutoff = Date.now() - maxAgeMs;
  return refreshChannels(channels.value.filter(channel => channel.needsRefresh || Date.parse(channel.checkedAt) <= cutoff));
}

onMounted(() => {
  void load();
  refreshTimer = setInterval(() => {
    if (!document.hidden) void refreshStaleChannels();
  }, maxAgeMs);
});

async function follow() {
  if (!loaded.value || busy.value || !input.value.trim()) return;
  busy.value = true;
  error.value = '';
  try {
    const saved = await props.api<FollowedYoutubeChannel>(path, {channel: input.value});
    if (active) {
      saveChannel(saved);
      input.value = '';
    }
  } catch (cause) {
    if (active) error.value = message(cause);
  } finally {
    busy.value = false;
  }
}

async function unfollow(id: string) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await props.api(path + '/' + id, {}, 'DELETE');
    if (active) {
      channels.value = channels.value.filter(channel => channel.id !== id);
      lookupErrors.delete(id);
    }
  } catch (cause) {
    if (active) error.value = message(cause);
  } finally {
    busy.value = false;
  }
}

async function queueCut(id: string, sourceRange?: CutSourceRange) {
  pendingVideos.add(id);
  try {
    await props.api('/cuts', {url: videoUrl(id), ...(sourceRange ? {sourceRange} : {})});
    if (active) {
      queuedVideos.add(id);
      props.toast('Projeto adicionado à fila do Gerador de cortes.');
    }
    props.queued();
  } finally {
    pendingVideos.delete(id);
  }
}

async function generateCut(id: string) {
  if (busy.value || pendingVideos.has(id) || queuedVideos.has(id)) return;
  try {
    await queueCut(id);
  } catch (cause) {
    if (active) props.toast(message(cause), true);
  }
}

async function saveRange(range: CutSourceRange) {
  if (selectedVideo.value) await queueCut(selectedVideo.value.id, range);
}

function findRanges() {
  const video = selectedVideo.value!;
  return props.api<{ranges: CutSourceRange[]; status: string}>('/cuts/replay-windows', {
    url: videoUrl(video.id), duration: video.duration,
  });
}
</script>

<template>
  <div class="page-head">
    <div>
      <h1>Canais do YouTube</h1>
      <p class="subtitle">Abra os detalhes para ver os três itens públicos mais recentes, entre vídeos e lives encerradas.</p>
    </div>
    <button class="button" type="button" :disabled="loading || busy || (loaded && !channels.length)"
      @click="loaded ? refreshChannels() : load()">Atualizar vídeos</button>
  </div>

  <form class="panel youtube-follow-form" @submit.prevent="follow">
    <div class="form-field">
      <label for="youtube-channel">Canal do YouTube</label>
      <input id="youtube-channel" v-model.trim="input" placeholder="@canal ou link do YouTube" maxlength="300"
        required :disabled="!loaded || busy">
    </div>
    <button class="button primary" type="submit" :disabled="!loaded || busy || !input">Acompanhar canal</button>
  </form>

  <p v-if="error" class="error-banner youtube-channels-error" role="alert">{{ error }}</p>
  <p v-if="loading && !loaded" class="tip youtube-channels-error" role="status">Carregando canais…</p>
  <p v-else-if="loaded && !channels.length" class="empty-state compact">Nenhum canal acompanhado.</p>
  <ul v-if="channels.length" class="youtube-channels-list">
    <li v-for="channel in channels" :key="channel.id" class="panel youtube-channel-card">
      <div class="youtube-channel-info">
        <h2><a :href="channelUrl(channel.id)" target="_blank" rel="noopener noreferrer">{{ channel.name }}</a></h2>
        <p v-if="lookupErrors.has(channel.id)" role="status" class="youtube-channels-error">{{ lookupErrors.get(channel.id) }}</p>
      </div>
      <button class="button ghost" type="button" :disabled="busy" :aria-label="'Deixar de acompanhar ' + channel.name"
        @click="unfollow(channel.id)">Deixar de acompanhar</button>
      <details class="youtube-channel-details">
        <summary>Ver detalhes<span class="sr-only"> de {{ channel.name }}</span></summary>
        <ol v-if="channel.videos.length" class="youtube-video-list" aria-label="Vídeos mais recentes">
          <li v-for="video in channel.videos" :key="video.id" class="youtube-video-row">
            <div class="youtube-channel-info">
              <a :href="videoUrl(video.id)" target="_blank" rel="noopener noreferrer">{{ video.title }}</a>
              <small v-if="video.duration"> · {{ formatDuration(video.duration) }}</small>
              <span v-if="video.kind === 'live'" class="badge gray youtube-live-badge">Live encerrada</span>
            </div>
            <a v-if="queuedVideos.has(video.id)" class="button" href="#cuts">Ver projeto na fila</a>
            <button v-if="!requiresRange(video) && !queuedVideos.has(video.id)" class="button primary" type="button"
              :disabled="busy || pendingVideos.has(video.id)"
              @click="generateCut(video.id)">Gerar corte</button>
            <button v-if="requiresRange(video) || video.duration === null" class="button" :class="{primary: requiresRange(video)}" type="button"
              :disabled="busy || pendingVideos.has(video.id)" @click="selectedVideo = video">Escolher trecho</button>
          </li>
        </ol>
        <p v-else class="youtube-channel-empty">Nenhum vídeo ou live encerrada disponível.</p>
        <small class="youtube-channel-checked">Consultado em
          <time :datetime="channel.checkedAt">{{ checkedDate.format(new Date(channel.checkedAt)) }}</time>
        </small>
      </details>
    </li>
  </ul>
  <LiveCutRangeDialog v-if="selectedVideo" :video="selectedVideo" :save="saveRange"
    :find-ranges="findRanges" @close="selectedVideo = null" />
</template>
