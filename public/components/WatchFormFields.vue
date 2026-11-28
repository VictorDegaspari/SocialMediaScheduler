<script setup>
import ConnectionIcon from './ConnectionIcon.js';
import PackDefaultsFields from './PackDefaultsFields.vue';
import NativeScheduleFields from './NativeScheduleFields.vue';
import {nativeScheduleModel} from '../native-schedule.js';
import {computed, ref, watch} from 'vue';
import {vRequestValue} from './request-form.js';
const props = defineProps(['w', 'state', 'channels']);
const packDefaults = props.w?.pack_defaults || {};
const schedule = nativeScheduleModel(props.w?.native_schedule || {}, 'youtube');
const source = ref(props.w?.source_type || 'google_drive');
const cadence = ref(props.w?.cadence || 'interval');
const mode = ref(props.w?.mode || 'draft');
const importExisting = ref(Boolean(props.w?.import_existing));
const local = computed(() => source.value === 'local');
const pack = computed(() => source.value === 'gta6_pack');
watch(pack, selected => {
  if (selected && !props.w) importExisting.value = true;
});
</script>

<template>
  <div class="form-field">
    <label for="watch-name">Nome da rotina</label>
    <input id="watch-name" v-request-value="{value: w?.name}" name="name" placeholder="Ex.: Vídeos de nutrição" required maxlength="100">
  </div>
  <div class="form-field">
    <label for="source-type">Origem dos vídeos</label>
    <select id="source-type" v-model="source" name="sourceType" :disabled="w">
      <option value="google_drive">Google Drive</option>
      <option value="local">Pasta local no computador</option>
      <option value="gta6_pack">Site · Pack GTA 6</option>
    </select>
    <small>{{ w?'A origem e a pasta são preservadas para manter o histórico.':'Escolha de onde a rotina deve ler os arquivos.' }}</small>
  </div>
  <div id="drive-source" class="form-field" :hidden="local || pack">
    <div class="label-row">
      <label for="folder-url">Link da pasta no Google Drive</label>
      <button type="button" class="button ghost small" data-action="check-folder">Verificar acesso</button>
    </div>
    <input id="folder-url" name="folderUrl" type="text" placeholder="https://drive.google.com/drive/folders/..."
      v-request-value="{value: w?.source_type === 'google_drive' || !w?.source_type ? w?.folder_url : ''}" :readonly="w"
      :disabled="local || pack" :required="!local && !pack">
    <small>Você pode colar o link completo ou o ID da pasta.</small>
  </div>
  <div id="local-source" class="form-field" :hidden="!local">
    <div class="label-row">
      <label for="local-path">Caminho da pasta local</label>
      <button type="button" class="button ghost small" data-action="check-folder">Verificar acesso</button>
    </div>
    <input id="local-path" name="localPath" type="text" v-request-value="{value: w?.source_type === 'local' ? w.folder_url : state.connections.local.rootPath}"
      :readonly="w" :disabled="!local" :required="local">
    <small>
      Pasta disponível:
      <code>{{ state.connections.local.rootPath }}</code>
      . Use esse caminho ou uma subpasta. O Google não é necessário.
    </small>
  </div>
  <div id="pack-source" :hidden="!pack">
    <div class="label-row">
      <a href="https://monetizecomgta6.netlify.app/" target="_blank" rel="noreferrer">Abrir site do pack</a>
      <button type="button" class="button small" data-action="check-folder">Verificar catálogo</button>
    </div>
    <PackDefaultsFields :value="packDefaults" prefix="watch" />
  </div>
  <label class="checkbox">
    <input type="checkbox" name="recursive" v-request-value="{value: w?.recursive !== false}">
    <span>Incluir vídeos das subpastas</span>
  </label>
  <hr class="form-divider">
  <div class="field-row">
    <div class="form-field">
      <label for="scan-minutes">Verificar novos arquivos a cada</label>
      <select name="scanMinutes" id="scan-minutes" v-request-value="{value: w?.scan_minutes || 5}">
        <template v-for="n in [1,5,10,15,30,60,180,720,1440]">
          <option :value="n">{{ n<60?n+' minuto(s)':n/60+' hora(s)' }}</option>
        </template>
      </select>
    </div>
    <div class="form-field">
      <label for="cadence">Quando enviar o próximo vídeo?</label>
      <select id="cadence" v-model="cadence" name="cadence">
        <option value="interval">A cada intervalo</option>
        <option value="daily">Em horários fixos, todos os dias</option>
      </select>
    </div>
  </div>
  <div id="interval-fields" class="field-row" :hidden="cadence === 'daily'">
    <div class="form-field">
      <label for="interval-value">Intervalo entre envios</label>
      <input id="interval-value" name="intervalValue" type="number" min="1"
        v-request-value="{value: w ? w.interval_minutes % 60 === 0 ? w.interval_minutes / 60 : w.interval_minutes : 12}">
    </div>
    <div class="form-field">
      <label for="interval-unit">Unidade</label>
      <select id="interval-unit" name="intervalUnit" v-request-value="{value: !w || w.interval_minutes % 60 === 0 ? 60 : 1}">
        <option value="60">Horas</option>
        <option value="1">Minutos</option>
        <option value="1440">Dias</option>
      </select>
    </div>
  </div>
  <div id="daily-fields" class="form-field" :hidden="cadence !== 'daily'">
    <label for="daily-times">Horários de envio</label>
    <input id="daily-times" name="times" v-request-value="{value: w?.times?.join(', ') || '08:00, 20:00'}" placeholder="08:00, 20:00">
    <small>Separe por vírgula. Horário de São Paulo (America/Sao_Paulo).</small>
  </div>
  <div class="form-field">
    <label for="watch-mode">Como processar o vídeo?</label>
    <select id="watch-mode" v-model="mode" name="mode">
      <option value="draft">Preparar para revisão</option>
      <option value="schedule">YouTube automático</option>
      <option value="native_schedule">Agendar lote dentro do YouTube</option>
    </select>
    <small>A frequência controla um vídeo por oportunidade. No motor local, o YouTube automático exige autorização em Conexões. A visibilidade vem do JSON e o padrão é privado.</small>
  </div>
  <div id="native-schedule-fields" :hidden="mode !== 'native_schedule'">
    <NativeScheduleFields :model="schedule" prefix="youtube" :revision="0" />
    <p class="tip">
      Selecione apenas canais YouTube e autorize envios automáticos em Conexões. Cada JSON precisa ter
      <code>youtube.visibility: "public"</code>
      ; o YouTube mantém o vídeo privado até a data reservada. Para agendar lotes no TikTok, abra TikTok navegador.
    </p>
  </div>
  <div>
    <span class="field-label">Canais de destino</span>
    <div class="channel-checkboxes">
      <template v-if="channels.length">
        <template v-for="c in channels">
          <label class="checkbox platform-choice" :data-platform="c.identifier==='youtube'?'youtube':'tiktok'">
            <input type="checkbox" name="integrationIds" :value="c.id" v-request-value="{value: w?.integration_ids?.includes(c.id)}" :disabled="c.disabled">
            <span>
              <ConnectionIcon :name="c.identifier==='youtube'?'youtube':'tiktok'" />
              {{ c.name }}
              ·
              {{ c.identifier==='youtube'?'YouTube':'TikTok' }}
              {{ c.disabled?' (desabilitado)':'' }}
            </span>
          </label>
        </template>
      </template>
      <template v-else>
        <p class="tip">Conecte seus canais em Conexões para selecionar os destinos. Você pode salvar a pasta agora e editar depois.</p>
      </template>
    </div>
  </div>
  <hr class="form-divider">
  <label class="checkbox">
    <input type="checkbox" name="stripMetadata" v-request-value="{value: w?.strip_metadata !== false}">
    <span>
      Remover metadados do vídeo
      <small>Limpa tags do arquivo antes do envio. O JSON e a declaração de uso de IA são preservados.</small>
    </span>
  </label>
  <label class="checkbox">
    <input type="checkbox" name="requireMetadata" v-request-value="{value: w?.require_metadata !== false}">
    <span>Exigir um JSON com título e descrição junto de cada vídeo</span>
  </label>
  <label class="checkbox">
    <input v-model="importExisting" type="checkbox" name="importExisting" :disabled="w">
    <span>Incluir os vídeos que já existem na primeira verificação{{ w?' (definido na criação)':'' }}</span>
  </label>
  <div class="dialog-footer">
    <button class="button" type="button" data-action="close-dialog">Cancelar</button>
    <button class="button primary" type="submit">
      <ConnectionIcon name="check" />
      {{ w?'Salvar alterações':'Criar rotina' }}
    </button>
  </div>
</template>
