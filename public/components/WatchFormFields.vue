<script setup>
import ConnectionIcon from './ConnectionIcon.js';
import PackDefaultsFields from './PackDefaultsFields.vue';
import NativeScheduleFields from './NativeScheduleFields.vue';
import {nativeScheduleModel} from '../native-schedule.js';
import {computed} from 'vue';
const props = defineProps(['w', 'state', 'channels', 'icon']);
const local = computed(() => props.w?.source_type === 'local');
const pack = computed(() => props.w?.source_type === 'gta6_pack');
</script>

<template>
  <div class="form-field">
    <label for="watch-name">Nome da rotina</label>
    <input id="watch-name" name="name" placeholder="Ex.: Vídeos de nutrição" :value="w?.name||''" required maxlength="100">
  </div>
  <div class="form-field">
    <label for="source-type">Origem dos vídeos</label>
    <select id="source-type" name="sourceType" :disabled="w">
      <option value="google_drive" :selected="!local&&!pack">Google Drive</option>
      <option value="local" :selected="local">Pasta local no computador</option>
      <option value="gta6_pack" :selected="pack">Site · Pack GTA 6</option>
    </select>
    <small>{{ w?'A origem e a pasta são preservadas para manter o histórico.':'Escolha de onde a rotina deve ler os arquivos.' }}</small>
  </div>
  <div id="drive-source" class="form-field">
    <div class="label-row">
      <label for="folder-url">Link da pasta no Google Drive</label>
      <button type="button" class="button ghost small" data-action="check-folder">Verificar acesso</button>
    </div>
    <input id="folder-url" name="folderUrl" type="text" placeholder="https://drive.google.com/drive/folders/..." :value="!local?w?.folder_url||'':''" :readonly="w">
    <small>Você pode colar o link completo ou o ID da pasta.</small>
  </div>
  <div id="local-source" class="form-field">
    <div class="label-row">
      <label for="local-path">Caminho da pasta local</label>
      <button type="button" class="button ghost small" data-action="check-folder">Verificar acesso</button>
    </div>
    <input id="local-path" name="localPath" type="text" :value="local?w.folder_url:state.connections.local.rootPath" :readonly="w">
    <small>
      Pasta disponível:
      <code>{{ state.connections.local.rootPath }}</code>
      . Use esse caminho ou uma subpasta. O Google não é necessário.
    </small>
  </div>
  <div id="pack-source" hidden>
    <div class="label-row">
      <a href="https://monetizecomgta6.netlify.app/" target="_blank" rel="noreferrer">Abrir site do pack</a>
      <button type="button" class="button small" data-action="check-folder">Verificar catálogo</button>
    </div>
    <PackDefaultsFields :value="w?.pack_defaults||{}" prefix="watch" />
  </div>
  <label class="checkbox">
    <input type="checkbox" name="recursive" :checked="w?.recursive!==false">
    <span>Incluir vídeos das subpastas</span>
  </label>
  <hr class="form-divider">
  <div class="field-row">
    <div class="form-field">
      <label for="scan-minutes">Verificar novos arquivos a cada</label>
      <select name="scanMinutes" id="scan-minutes">
        <template v-for="n in [1,5,10,15,30,60,180,720,1440]">
          <option :value="n" :selected="(w?.scan_minutes||5)===n">{{ n<60?n+' minuto(s)':n/60+' hora(s)' }}</option>
        </template>
      </select>
    </div>
    <div class="form-field">
      <label for="cadence">Quando enviar o próximo vídeo?</label>
      <select id="cadence" name="cadence">
        <option value="interval" :selected="w?.cadence!=='daily'">A cada intervalo</option>
        <option value="daily" :selected="w?.cadence==='daily'">Em horários fixos, todos os dias</option>
      </select>
    </div>
  </div>
  <div id="interval-fields" class="field-row" :hidden="w?.cadence==='daily'">
    <div class="form-field">
      <label for="interval-value">Intervalo entre envios</label>
      <input id="interval-value" name="intervalValue" type="number" min="1" :value="w?w.interval_minutes%60===0?w.interval_minutes/60:w.interval_minutes:12">
    </div>
    <div class="form-field">
      <label for="interval-unit">Unidade</label>
      <select id="interval-unit" name="intervalUnit">
        <option value="60" :selected="!w||w.interval_minutes%60===0">Horas</option>
        <option value="1" :selected="w&&w.interval_minutes%60!==0">Minutos</option>
        <option value="1440">Dias</option>
      </select>
    </div>
  </div>
  <div id="daily-fields" class="form-field" :hidden="!(w?.cadence==='daily')">
    <label for="daily-times">Horários de envio</label>
    <input id="daily-times" name="times" :value="w?.times?.join(', ')||'08:00, 20:00'" placeholder="08:00, 20:00">
    <small>Separe por vírgula. Horário de São Paulo (America/Sao_Paulo).</small>
  </div>
  <div class="form-field">
    <label for="watch-mode">Como processar o vídeo?</label>
    <select id="watch-mode" name="mode">
      <option value="draft" :selected="!w||w.mode==='draft'">Preparar para revisão</option>
      <option value="schedule" :selected="w?.mode==='schedule'">YouTube automático</option>
      <option value="native_schedule" :selected="w?.mode==='native_schedule'">Agendar lote dentro do YouTube</option>
    </select>
    <small>A frequência controla um vídeo por oportunidade. No motor local, o YouTube automático exige autorização em Conexões. A visibilidade vem do JSON e o padrão é privado.</small>
  </div>
  <div id="native-schedule-fields" :hidden="!(w?.mode==='native_schedule')">
    <NativeScheduleFields :model="nativeScheduleModel(w?.native_schedule||{}, 'youtube')" prefix="youtube" :revision="0" />
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
            <input type="checkbox" name="integrationIds" :value="c.id" :checked="w?.integration_ids?.includes(c.id)" :disabled="c.disabled">
            <span>
              <ConnectionIcon :name="c.identifier==='youtube'?'youtube':'tiktok'" :icon="icon" />
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
    <input type="checkbox" name="stripMetadata" :checked="w?.strip_metadata!==false">
    <span>
      Remover metadados do vídeo
      <small>Limpa tags do arquivo antes do envio. O JSON e a declaração de uso de IA são preservados.</small>
    </span>
  </label>
  <label class="checkbox">
    <input type="checkbox" name="requireMetadata" :checked="w?.require_metadata!==false">
    <span>Exigir um JSON com título e descrição junto de cada vídeo</span>
  </label>
  <label class="checkbox">
    <input type="checkbox" name="importExisting" :checked="w?.import_existing" :disabled="w">
    <span>Incluir os vídeos que já existem na primeira verificação{{ w?' (definido na criação)':'' }}</span>
  </label>
  <div class="dialog-footer">
    <button class="button" type="button" data-action="close-dialog">Cancelar</button>
    <button class="button primary" type="submit">
      <ConnectionIcon name="check" :icon="icon" />
      {{ w?'Salvar alterações':'Criar rotina' }}
    </button>
  </div>
</template>
