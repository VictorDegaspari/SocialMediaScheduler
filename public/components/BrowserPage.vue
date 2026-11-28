<script setup>
import {ref} from 'vue';
import ConnectionIcon from './ConnectionIcon.js';
import StatusBadge from './StatusBadge.vue';
import PackDefaultsFields from './PackDefaultsFields.vue';
import NativeScheduleFields from './NativeScheduleFields.vue';
import {nativeScheduleModel} from '../native-schedule.js';
import CollectionPagination from './CollectionPagination.vue';
import {vRequestValue} from './request-form.js';
const props = defineProps(['state', 'date', 'pagination']);
const b=props.state.browser;
const tokenReady=!!props.state.connections.playwrightMcp?.configured;
const c = b?.config;
const packDefaults = c?.packDefaults || {};
const schedule = nativeScheduleModel(c?.nativeSchedule || {}, 'tiktok');
const source = ref(c?.sourceType === 'gta6_pack' ? 'gta6_pack' : 'local');
const mode = ref(c?.mode === 'native_schedule' ? 'native_schedule' : 'review');
const cadence = ref(c?.cadence || 'daily');
const a = b?.agent;
const busy = Boolean(b?.active || a?.externalBusy);
const canAct = tokenReady && b?.configured && a?.online && a.desktop && !busy;
const status=!tokenReady?'Token do TikTok obrigatório':!a?.online?'Agente desconectado':!a.desktop?'Sessão gráfica necessária':a.externalBusy?'Janela já aberta':b.active?'Tarefa em andamento':'Pronto para receber tarefas';
const active = b?.active;
const labels = {scheduled:'Agendado no TikTok',completed:'Publicado no TikTok',duplicate:'Já enviado',pending:'Na fila',running:'Em andamento',cancel_requested:'Interrompendo',review:'Preparado no Chrome',empty:'Sem vídeo novo',done:'Janela encerrada',failed:'Falha antes do upload',unknown:'Conferir envio',cancelled:'Cancelado'}
</script>

<template>
  <div v-if="!b || !c || !a" class="notice">Reinicie o aplicativo para carregar a integração do navegador.</div>
  <template v-else>
    <div class="page-head">
      <div>
        <span class="eyebrow">VÍDEOS LOCAIS · CHROME NO SEU COMPUTADOR</span>
        <h1>TikTok pelo navegador</h1>
        <p class="subtitle">Escolha a pasta e os horários para preparar vídeos ou preencher o agendador do TikTok.</p>
      </div>
      <button class="button" data-browser-action="refresh">
        <ConnectionIcon name="refresh" />
        Atualizar status
      </button>
    </div>
    <template v-if="!tokenReady">
      <div class="notice browser-token-required" role="status">
        <strong>Adicione o token para configurar o TikTok.</strong>
        <p>Login, novas rotinas e novos envios precisam do PLAYWRIGHT_MCP_EXTENSION_TOKEN.</p>
        <a class="button small" href="#connections">Adicionar token em Conexões</a>
      </div>
    </template>
    <section class="panel immediate-publication">
      <div>
        <h2>Postar agora</h2>
        <p>Escolha um corte do aplicativo ou um vídeo de suas pastas, confira a prévia e publique no TikTok sem agendar.</p>
      </div>
      <button class="button primary" type="button" data-immediate-action="open" :disabled="!(tokenReady)">
        <ConnectionIcon name="tiktok" />
        Postar agora no TikTok
      </button>
    </section>
    <div class="browser-layout">
      <section class="panel connection-card platform-card browser-status-card" data-platform="tiktok">
        <div class="connection-title">
          <div class="folder-icon">
            <ConnectionIcon name="tiktok" />
          </div>
          <h2>Sua conexão com o Chrome</h2>
          <StatusBadge :label="a.online?'Agente conectado':'Desconectado'" :tone="a.online?'':'gray'" />
        </div>
        <p class="browser-state" role="status">{{ status }}</p>
        <div class="browser-facts">
          <div>
            <span>Perfil local</span>
            <strong>{{ a.profileSaved?'Salvo neste computador':'Faça o primeiro login' }}</strong>
          </div>
          <div>
            <span>Rotina automática</span>
            <strong>{{ c.enabled?'Ativa':'Pausada' }}</strong>
          </div>
          <div>
            <span>{{ c.mode==='native_schedule'?'Próxima publicação reservada':'Próxima oportunidade' }}</span>
            <strong>{{ c.mode==='native_schedule'?(b.calendar?.next?date(b.calendar.next,true):'Aguardando vídeos e datas disponíveis'):(c.enabled&&c.nextAt?date(c.nextAt,true):'Defina e ative os horários') }}</strong>
          </div>
        </div>
        <template v-if="c.mode==='native_schedule'">
          <p class="tip">{{ b.calendar?.reserved||0 }} reservas neste sistema + {{ c.nativeSchedule?.externalScheduled||0 }} externas / teto {{ c.nativeSchedule?.maxScheduled||10 }}. Uploads nas últimas 24 horas: {{ b.calendar?.uploads||0 }} / {{ c.nativeSchedule?.uploadsPer24h||10 }}.</p>
        </template>
        <template v-if="active">
          <div class="notice browser-progress">
            <div class="browser-progress-heading">
              <template v-if="active.status==='pending'">
                <ConnectionIcon name="clock" />
              </template>
              <template v-else>
                <span class="cuts-spinner" aria-hidden="true"></span>
              </template>
              <strong>
                <template v-if="active.status==='pending'">Vídeo aguardando execução</template>
                <template v-else>{{ active.kind==='login'?'Login no Chrome':'Publicação pelo Playwright' }}</template>
              </strong>
            </div>
            <p>{{ active.message||'Aguardando o agente.' }}</p>
            <template v-if="active.filename">
              <small>{{ active.filename }}</small>
            </template>
          </div>
        </template>
        <template v-if="a.externalBusy">
          <div class="notice">O perfil já está aberto em outra janela ou rotina. Conclua o login e feche as janelas desse perfil para liberar os controles.</div>
        </template>
        <template v-if="!a.online">
          <div class="notice">
            Inicie o aplicativo no Ubuntu com sua sessão gráfica aberta. Se necessário, execute
            <code>./scripts/start-browser-agent.sh</code>
            na pasta do projeto.
          </div>
        </template>
        <template v-if="state.scheduler.paused">
          <div class="notice">
            As rotinas do aplicativo estão pausadas.
            <button class="button small" data-browser-action="resume">Retomar rotinas</button>
          </div>
        </template>
        <div class="form-actions">
          <button class="button primary" data-browser-action="login" :disabled="!(canAct)">
            <ConnectionIcon name="link" />
            Abrir login do TikTok
          </button>
          <button class="button" data-browser-action="run" :disabled="!(canAct&&a.profileSaved&&!state.scheduler.paused)">
            <ConnectionIcon name="upload" />
            {{ c.mode==='native_schedule'?'Agendar próximo agora':'Enviar próximo agora' }}
          </button>
          <template v-if="active">
            <button class="button danger" data-browser-action="stop">Interromper tarefa</button>
          </template>
        </div>
        <p class="tip">O login abre o Chrome para você entrar manualmente, de preferência pelo QR code. Um perfil salvo não comprova que a conta continua autenticada.</p>
        <p class="tip" :hidden="c.mode==='native_schedule'">
          <strong>Você conclui a publicação:</strong>
          depois do upload, confira conta, legenda, privacidade e indicação de IA no Chrome e clique em Publicar. Feche a janela ao terminar.
        </p>
      </section>
      <section class="panel connection-card browser-config-card">
        <div class="connection-title">
          <div class="folder-icon">
            <ConnectionIcon name="clock" />
          </div>
          <h2>Pasta e horários</h2>
        </div>
        <form id="browser-config-form">
          <div class="form-field">
            <label for="browser-mode">Como processar os vídeos?</label>
            <select id="browser-mode" v-model="mode" name="mode">
              <option value="review">Preparar um vídeo para revisão no Chrome</option>
              <option value="native_schedule">Agendar lote dentro do TikTok Studio</option>
            </select>
            <small>O lote respeita os horários abaixo e só registra agendamentos confirmados pelo TikTok.</small>
          </div>
          <div id="browser-native-fields" :hidden="mode !== 'native_schedule'">
            <NativeScheduleFields :model="schedule" prefix="tiktok" :revision="0" />
            <p class="tip">
              Ative os envios automáticos para preencher o lote até o teto. Use JSON com
              <code>tiktok.privacyLevel: "PUBLIC_TO_EVERYONE"</code>
              . Conteúdo comercial exige revisão manual; a indicação de IA precisa estar disponível no Studio. Login, verificações e mudanças na interface interrompem o lote.
            </p>
          </div>
          <div class="form-field">
            <label for="browser-source">Origem dos vídeos do TikTok</label>
            <select id="browser-source" v-model="source" name="sourceType">
              <option value="local">Pasta local</option>
              <option value="gta6_pack">Site · Pack GTA 6</option>
            </select>
          </div>
          <div id="browser-pack-fields" :hidden="source !== 'gta6_pack'">
            <PackDefaultsFields :value="packDefaults" prefix="browser" />
          </div>
          <div id="browser-local-folder" class="form-field" :hidden="source === 'gta6_pack'">
            <label for="browser-folder">Pasta dos vídeos para o TikTok</label>
            <input id="browser-folder" name="folder" v-request-value="{value: c.folder}" required maxlength="4096">
            <small>
              Use esta pasta ou uma subpasta:
              <code>{{ b.rootPath }}</code>
              . Inclui subpastas; o JSON com o mesmo nome é opcional.
            </small>
          </div>
          <div class="form-field">
            <label for="browser-cadence">Quando enviar pelo navegador?</label>
            <select id="browser-cadence" v-model="cadence" name="cadence">
              <option value="daily">Em horários fixos, todos os dias</option>
              <option value="interval">A cada intervalo</option>
            </select>
          </div>
          <div id="browser-daily" class="form-field" :hidden="cadence !== 'daily'">
            <label for="browser-times">Horários do TikTok</label>
            <input id="browser-times" name="times" v-request-value="{value: c.times.join(', ')}" placeholder="08:00, 20:00" required>
            <small>America/Sao_Paulo. Separe os horários por vírgula.</small>
          </div>
          <div id="browser-interval" class="form-field" :hidden="cadence !== 'interval'">
            <label for="browser-minutes">Intervalo entre envios (minutos)</label>
            <input id="browser-minutes" name="intervalMinutes" type="number" min="1" max="43200" v-request-value="{value: c.intervalMinutes}" required>
            <small>Por exemplo, 120 para um vídeo a cada duas horas.</small>
          </div>
          <label class="checkbox">
            <input type="checkbox" name="stripMetadata" v-request-value="{value: c.stripMetadata}">
            <span>
              Remover metadados do vídeo
              <small>Prepara uma cópia sem tags descritivas. Preserva o original, o JSON e a declaração de IA.</small>
            </span>
          </label>
          <label class="checkbox">
            <input type="checkbox" name="enabled" v-request-value="{value: c.enabled}">
            <span>
              Ativar envios automáticos pelo navegador
              <small>No modo lote, preenche o agendador até o teto. No modo revisão, prepara um vídeo por oportunidade.</small>
            </span>
          </label>
          <div class="form-actions">
            <button class="button primary" type="submit" :disabled="!(tokenReady)">
              <ConnectionIcon name="check" />
              Salvar rotina do navegador
            </button>
            <template v-if="c.enabled">
              <button class="button" type="button" data-browser-action="pause">Pausar rotina do navegador</button>
            </template>
          </div>
        </form>
        <p class="tip">O PC precisa estar ligado com sua sessão gráfica aberta. Enquanto uma janela estiver em revisão, o próximo vídeo aguarda. A opção “Enviar próximo agora” salva os campos acima antes de solicitar o envio.</p>
        <p class="tip">Este fluxo usa a origem escolhida acima. O Pack GTA 6 dispensa uma pasta local. As rotinas do YouTube continuam em Minhas pastas. Evite configurar o mesmo vídeo para duas formas de envio ao TikTok.</p>
      </section>
    </div>
    <section class="browser-history">
      <div class="section-head">
        <div>
          <h2>Atividades do navegador</h2>
          <p>Cancele cada vídeo ou tente novamente após corrigir uma falha anterior ao upload.</p>
        </div>
      </div>
      <div class="panel">
        <template v-if="b.jobs.length">
          <div class="table-wrap">
            <table class="queue-table">
              <thead>
                <tr>
                  <th>TAREFA / VÍDEO</th>
                  <th>SITUAÇÃO</th>
                  <th>ANDAMENTO E ORIENTAÇÃO</th>
                  <th>HORÁRIO</th>
                  <th>AÇÕES</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="j in b.jobs" :key="j.id">
                  <tr>
                    <td data-label="Tarefa / vídeo">
                      <strong>{{ j.kind==='login'?'Login no TikTok':(j.filename||'Envio de vídeo') }}</strong>
                      <small>{{ j.origin==='schedule'?'Rotina automática':'Solicitação manual' }}</small>
                    </td>
                    <td data-label="Situação">
                      <StatusBadge :label="j.phase==='browser_review_required'&&j.status==='running'?'Revisão no Chrome':labels[j.status]||j.status" :tone="['failed','unknown'].includes(j.status)?'amber':['pending','running'].includes(j.status)?'':'gray'" />
                    </td>
                    <td data-label="Andamento e orientação">
                      {{ j.message||'Aguardando execução.' }}
                      <template v-if="j.status==='unknown'">
                        <small>Confira rascunhos, agendados e publicados no TikTok Studio antes de reenviar.</small>
                      </template>
                      <template v-if="j.planned_at">
                        <small>Publicação reservada: {{ date(j.planned_at,true) }}</small>
                      </template>
                    </td>
                    <td data-label="Solicitado em">{{ date(j.created_at,true) }}</td>
                    <td data-label="Ações">
                      <template v-if="j.status==='failed'&&!j.upload_started">
                        <button class="button small" data-browser-action="retry-job" :data-id="j.id" :disabled="!(tokenReady)">Tentar novamente</button>
                      </template>
                      <template v-if="['pending','running'].includes(j.status)">
                        <button class="button small danger" data-browser-action="cancel-job" :data-id="j.id">Cancelar {{ j.kind==='login'?'tarefa':'vídeo' }}</button>
                      </template>
                      <template v-else>
                        <template v-if="j.status==='cancel_requested'">
                          <small>Aguardando encerramento do navegador.</small>
                        </template>
                      </template>
                      <template v-if="j.status==='unknown'">
                        <a class="button small" href="https://www.tiktok.com/tiktokstudio/content" target="_blank" rel="noreferrer">Conferir no TikTok</a>
                      </template>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </template>
        <template v-else>
          <div class="empty-state compact">
            <h3>Nenhuma tarefa solicitada</h3>
            <p>Conecte sua conta e coloque um MP4 na pasta para iniciar.</p>
          </div>
        </template>
        <CollectionPagination :page="pagination" scope="browser" />
      </div>
    </section>
  </template>
</template>
