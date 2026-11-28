<script setup lang="ts">
import {onBeforeUnmount, onMounted, reactive, ref} from 'vue';
import type {TikTokTrend, TikTokTrendQuery} from '../../src/channel-video-source.js';
import type {SavedChannelVideo} from '../../src/channel-videos.js';
import type {PageMetadata} from '../../src/pagination.js';
import WorkspaceProgress from './WorkspaceProgress.vue';

const props = defineProps<{
  api: <T>(path: string, body?: unknown) => Promise<T>;
  toast: (message: string, error?: boolean) => void;
  view: 'trends' | 'library' | 'youtube';
}>();
const emit = defineEmits<{saved: []}>();

type Library = {
  items: SavedChannelVideo[];
  pagination: PageMetadata;
  maxDubSeconds: number;
  dubVersion: number;
};
const path = '/channel-videos';
const markets = {US: 'Estados Unidos', JP: 'Japão', VN: 'Vietnã', TH: 'Tailândia', ID: 'Indonésia'};
const statuses: Record<SavedChannelVideo['status'], string> = {
  download_queued: 'Download na fila',
  downloading: 'Buscando o MP4…',
  download_failed: 'Download indisponível',
  ready: 'Original disponível',
  dub_queued: 'Dublagem na fila',
  dubbing: 'Transcrevendo, traduzindo e gerando voz…',
  dub_failed: 'Dublagem interrompida',
  dubbed: 'Dublagem disponível',
};
const pendingLabels = {
  retry: 'Solicitando novo download…',
  dub: 'Enfileirando dublagem…',
  source: 'Importando e verificando o MP4…',
};
const formatViews = new Intl.NumberFormat('pt-BR');
const market = ref<TikTokTrendQuery['market']>('US');
const days = ref<TikTokTrendQuery['days']>('7');
const query = ref<TikTokTrendQuery>();
const trends = ref<TikTokTrend[]>();
const loadingTrends = ref(false);
const trendsError = ref('');
const url = ref('');
const saving = ref<string>();
const library = ref<Library>();
const listError = ref('');
const loadingList = ref(false);
const cursors = ref<string[]>([]);
const changing = reactive(new Map<string, string>());
const previewId = ref<string>();
let active = true;
let timer: ReturnType<typeof setInterval>;
let listRequest = 0;
let listPending = false;

const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Não foi possível concluir a operação.';
const mediaUrl = (id: string, variant: 'original' | 'pt-br') => '/api' + path + '/' + id + '/media/' + variant;
const dubbedUrl = (video: SavedChannelVideo) => mediaUrl(video.id, 'pt-br') + '?v=' + video.dubVersion;
const isUpdating = (status: SavedChannelVideo['status']) =>
  ['download_queued', 'downloading', 'dub_queued', 'dubbing'].includes(status);

async function search() {
  if (loadingTrends.value) return;
  loadingTrends.value = true;
  trendsError.value = '';
  const requested = {market: market.value, days: days.value};
  try {
    trends.value = await props.api<TikTokTrend[]>(path + '/trends?' + new URLSearchParams(requested));
    query.value = requested;
  } catch (cause) {
    query.value ??= requested;
    trendsError.value = message(cause);
  } finally { loadingTrends.value = false; }
}

async function loadLibrary(history = cursors.value, quiet = false) {
  const request = ++listRequest;
  listPending = true;
  if (!quiet) {
    loadingList.value = true;
    listError.value = '';
  }
  try {
    const cursor = history.at(-1);
    const params = new URLSearchParams({limit: '6'});
    if (cursor) params.set('cursor', cursor);
    const result = await props.api<Library>(path + '?' + params);
    if (!active || request !== listRequest) return;
    library.value = result;
    cursors.value = history;
    listError.value = '';
  } catch (cause) {
    if (active && request === listRequest) {
      listError.value = quiet ? 'Não foi possível atualizar o status dos vídeos. ' + message(cause) : message(cause);
    }
  } finally {
    if (request === listRequest) {
      listPending = false;
      loadingList.value = false;
    }
  }
}

onMounted(() => {
  void loadLibrary();
  timer = setInterval(() => {
    if (!document.hidden && !listPending && !saving.value && !changing.size &&
      library.value?.items.some(video => isUpdating(video.status))) void loadLibrary(cursors.value, true);
  }, 2500);
});
onBeforeUnmount(() => { active = false; clearInterval(timer); });

async function addVideo(link: string, title?: string) {
  if (!link.trim() || saving.value) return;
  saving.value = link;
  try {
    const video = await props.api<SavedChannelVideo>(path, {url: link, ...(title ? {title} : {})});
    if (!active) return;
    if (!title) url.value = '';
    await loadLibrary([]);
    if (!active) return;
    emit('saved');
    props.toast(isUpdating(video.status) ? 'Vídeo na fila de processamento.' : 'Este vídeo já está na biblioteca.');
  } catch (cause) {
    if (active) props.toast(message(cause), true);
  } finally { saving.value = undefined; }
}

async function updateVideo(video: SavedChannelVideo, action: 'retry' | 'dub' | 'source', file?: File) {
  if (changing.has(video.id)) return;
  changing.set(video.id, pendingLabels[action]);
  try {
    const endpoint = path + '/' + video.id + '/' + action;
    if (file) {
      const response = await fetch('/api' + endpoint, {
        method: 'POST', body: file,
        headers: {'Content-Type': 'video/mp4', 'X-Watcher-Request': '1'},
      });
      if (!response.ok) throw new Error((await response.json()).error);
    } else {
      await props.api(endpoint, {});
    }
    if (active) await loadLibrary(cursors.value, true);
  } catch (cause) {
    if (active) props.toast(message(cause), true);
  } finally { changing.delete(video.id); }
}

function importOriginal(video: SavedChannelVideo, event: Event) {
  const field = event.currentTarget as HTMLInputElement;
  const file = field.files?.[0];
  if (file) void updateVideo(video, 'source', file);
  field.value = '';
}

function togglePreview(id: string) {
  previewId.value = previewId.value === id ? undefined : id;
}
</script>

<template>
    <section v-show="view === 'trends'" id="channel-trends" class="panel channel-tiktok-panel" aria-labelledby="channel-tiktok-title">
      <h2 id="channel-tiktok-title">Tendências do TikTok</h2>
      <form class="channel-tiktok-form" @submit.prevent="search">
        <div class="form-field">
          <label for="trend-market">País</label>
          <select id="trend-market" v-model="market" :disabled="loadingTrends">
            <option v-for="(label, code) in markets" :key="code" :value="code">{{ label }}</option>
          </select>
        </div>
        <div class="form-field">
          <label for="trend-period">Período</label>
          <select id="trend-period" v-model="days" :disabled="loadingTrends">
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
          </select>
        </div>
        <button class="button primary" type="submit" :disabled="loadingTrends" :aria-busy="loadingTrends || undefined">Buscar vídeos virais</button>
      </form>
      <form class="channel-tiktok-form channel-tiktok-import" @submit.prevent="addVideo(url)">
        <div class="form-field channel-tiktok-url">
          <label for="channel-tiktok-url">Link de vídeo público do TikTok</label>
          <input id="channel-tiktok-url" v-model.trim="url" type="url" maxlength="500" required placeholder="https://www.tiktok.com/@canal/video/…">
        </div>
        <button type="submit" class="button" :disabled="!!saving || !url">Baixar pelo link</button>
      </form>
      <WorkspaceProgress v-if="saving" message="Adicionando vídeo à fila…" />
      <WorkspaceProgress v-if="loadingTrends" message="Consultando o ranking público do TikTok…" />
      <p v-if="trendsError" class="error-banner" role="alert">{{ trendsError }}</p>
      <p v-else-if="!loadingTrends && trends && !trends.length" class="channel-empty" role="status">Nenhum vídeo no ranking público para este período.</p>
      <ol v-if="trends?.length" class="youtube-video-list" aria-label="Vídeos mais vistos no ranking público" :aria-busy="loadingTrends || undefined">
        <li v-for="video in trends" :key="video.url" class="youtube-video-row">
          <div class="youtube-channel-info">
            <a :href="video.url" target="_blank" rel="noopener noreferrer">{{ video.title }}</a>
            <small v-if="video.views !== null" class="channel-tiktok-detail">{{ formatViews.format(video.views) }} visualizações no período</small>
          </div>
          <button class="button small" type="button" :disabled="!!saving" :aria-busy="saving === video.url || undefined"
            @click="addVideo(video.url, video.title)">Baixar vídeo</button>
        </li>
      </ol>
      <a v-if="query" class="channel-tiktok-link"
        :href="`https://ads.tiktok.com/creative/creativeCenter/trends/video?period=${query.days}&region=${query.market}`"
        target="_blank" rel="noopener noreferrer">Abrir TikTok Creative Center</a>

    </section>

    <section v-show="view === 'library'" id="channel-library" class="panel channel-tiktok-panel" aria-labelledby="channel-library-title">
      <h2 id="channel-library-title">Vídeos salvos</h2>
      <p class="channel-tiktok-detail">Dublagem local com voz brasileira. A primeira execução baixa os modelos.</p>
      <p v-if="listError" class="error-banner" role="alert">{{ listError }} <button type="button" class="button" @click="loadLibrary()">Tentar novamente</button></p>
      <WorkspaceProgress v-if="loadingList" :message="library ? 'Atualizando vídeos salvos…' : 'Carregando vídeos salvos…'" />
      <p v-else-if="library && !library.items.length" class="channel-empty">Nenhum vídeo salvo.</p>
      <ul v-if="library?.items.length" class="youtube-video-list" :aria-busy="loadingList || undefined">
        <li v-for="video in library.items" :key="video.id" class="youtube-video-row">
          <div class="youtube-channel-info">
            <a :href="video.url" target="_blank" rel="noopener noreferrer">{{ video.title || 'Vídeo do TikTok' }}</a>
            <div class="channel-video-status">
              <WorkspaceProgress v-if="changing.has(video.id)" :message="changing.get(video.id)!" />
              <WorkspaceProgress v-else-if="video.status === 'downloading' || video.status === 'dubbing'" :message="statuses[video.status]" />
              <span v-else class="badge" role="status" :class="{
                amber: isUpdating(video.status),
                red: video.status === 'download_failed' || video.status === 'dub_failed',
              }">{{ statuses[video.status] }}</span>
            </div>
            <p v-if="video.error" class="channel-tiktok-detail">{{ video.error }}</p>
            <small v-if="video.duration && video.duration > library.maxDubSeconds" class="channel-tiktok-detail">A dublagem aceita até 5 minutos.</small>
          </div>
          <div v-if="video.status === 'download_failed'" class="channel-tiktok-actions">
            <button class="button" type="button" :disabled="changing.has(video.id)" @click="updateVideo(video, 'retry')">Repetir download</button>
            <a class="button" href="https://ssstik.io/pt" target="_blank" rel="noopener noreferrer">Abrir SSSTik</a>
            <input :id="'tiktok-import-' + video.id" class="sr-only" type="file" accept=".mp4,video/mp4"
              :disabled="changing.has(video.id)" @change="importOriginal(video, $event)">
            <label class="button channel-file-label" :for="'tiktok-import-' + video.id">Importar MP4 original</label>
          </div>
          <div v-else-if="video.duration" class="channel-tiktok-actions">
            <a class="button" :href="mediaUrl(video.id, 'original') + '?download=1'">Baixar original</a>
            <button v-if="video.dubVersion !== null" class="button" type="button" @click="togglePreview(video.id)">
              {{ previewId === video.id ? 'Fechar prévia' : 'Ouvir dublagem' }}
            </button>
            <a v-if="video.dubVersion !== null" class="button primary" :href="dubbedUrl(video) + '&download=1'">Baixar dublado</a>
            <button v-if="video.duration <= library.maxDubSeconds && (video.status === 'ready' || video.status === 'dub_failed' ||
              (video.status === 'dubbed' && video.dubVersion !== library.dubVersion))"
              class="button" :class="{primary: video.dubVersion === null}" type="button" :disabled="changing.has(video.id)" @click="updateVideo(video, 'dub')">
              {{ video.status === 'ready' ? 'Dublar em pt-BR' : video.status === 'dubbed' ? 'Refazer dublagem' : 'Repetir dublagem' }}
            </button>
          </div>
          <div v-if="view === 'library' && previewId === video.id" class="channel-tiktok-preview">
            <video :src="dubbedUrl(video)" controls preload="metadata" aria-label="Prévia do vídeo dublado"></video>
          </div>
        </li>
      </ul>
      <nav v-if="cursors.length || library?.pagination.hasMore" class="channel-tiktok-actions" aria-label="Páginas dos vídeos salvos">
        <button class="button" type="button" :disabled="loadingList || !cursors.length" @click="loadLibrary(cursors.slice(0, -1))">Anterior</button>
        <button v-if="library?.pagination.nextCursor" class="button" type="button" :disabled="loadingList"
          @click="loadLibrary([...cursors, library.pagination.nextCursor])">Próxima</button>
      </nav>
    </section>
</template>
