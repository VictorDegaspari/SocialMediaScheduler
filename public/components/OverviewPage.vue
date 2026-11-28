<script setup>
import ConnectionIcon from './ConnectionIcon.js';
import StatusBadge from './StatusBadge.vue';
import {computed} from 'vue';
import WorkspaceHeading from './WorkspaceHeading.vue';
import DashboardIndicators from './DashboardIndicators.vue';
import WatchCards from './WatchCards.vue';
import WorkspaceActivity from './WorkspaceActivity.vue';
const props = defineProps(['state', 'date', 'publisherReady']);
const total = computed(() => props.state.stats.watches ?? props.state.watches.length);
const sourceReady = computed(() => (props.state.stats.local_source_ready ?? props.state.watches.some(w => ['gta6_pack', 'local'].includes(w.source_type))) || props.state.connections.google.connected);
const active = computed(() => props.state.stats.active_watches ?? props.state.watches.filter(w => w.enabled).length);
const configured = computed(() => sourceReady.value && props.publisherReady && props.state.watches.length > 0);
</script>

<template>
  <WorkspaceHeading title="Seu conteúdo, no ritmo certo." subtitle="Acompanhe as rotinas e o andamento dos seus vídeos." :action="true" />
  <DashboardIndicators :total="total" :active="active" :stats="state.stats" />
  <div class="dashboard-details">
    <section>
      <div class="section-head">
        <div>
          <h2>
            Suas pastas
            <StatusBadge :label="total+' cadastrada(s)'" tone="gray" />
          </h2>
        </div>
        <a href="#watches" class="section-link">
          Ver todas
          <ConnectionIcon name="arrow" />
        </a>
      </div>
      <WatchCards :items="state.watches.slice(0, 3)" :date="date" />
    </section>
    <section>
      <div class="section-head">
        <h2>Últimas atividades</h2>
        <a class="section-link" href="#history">
          Ver histórico
          <ConnectionIcon name="arrow" />
        </a>
      </div>
      <div class="panel">
        <WorkspaceActivity :events="state.events.slice(0, 6)" :date="date" />
      </div>
    </section>
  </div>
  <details class="dashboard-checklist" :open="!configured">
    <summary>{{ configured ? 'Seu fluxo está configurado' : 'Seu checklist de início' }}</summary>
    <div class="panel panel-pad">
      <div class="steps">
        <div class="step">
          <span :class="'step-number ' + (sourceReady?'done':'')">{{ sourceReady?'✓':'1' }}</span>
          <div>
            <h3>Escolha a origem dos vídeos</h3>
            <p>Use uma pasta local ou conecte seu Google Drive.</p>
            <a href="#connections">{{ sourceReady?'Origem configurada':'Ver opções de conexão →' }}</a>
          </div>
        </div>
        <div class="step">
          <span :class="'step-number ' + (publisherReady?'done':'')">{{ publisherReady?'✓':'2' }}</span>
          <div>
            <h3>Conecte seus canais</h3>
            <p>O scheduler local organiza a fila e envia pelas APIs oficiais.</p>
            <a href="#connections">{{ publisherReady?'Conexão configurada':'Conectar YouTube e TikTok →' }}</a>
          </div>
        </div>
        <div class="step">
          <span :class="'step-number ' + (state.watches.length?'done':'')">{{ state.watches.length?'✓':'3' }}</span>
          <div>
            <h3>Escolha uma pasta e a frequência</h3>
            <p>Inclua subpastas e personalize os horários.</p>
            <a href="#watches">{{ state.watches.length?'Gerenciar minhas pastas →':'Criar minha primeira rotina →' }}</a>
          </div>
        </div>
      </div>
    </div>
  </details>
  <div class="runtime-bar">
    <div>
      <ConnectionIcon name="monitor" />
      <span>
        <strong>{{ state.scheduler.paused?'Rotinas pausadas':'Sua rotina continua com esta página fechada.' }}</strong>
        <br>
        <small>O PC e o serviço precisam estar ligados. {{ state.scheduler.heartbeat?'Último ciclo às '+date(state.scheduler.heartbeat)+'.':'' }}</small>
      </span>
    </div>
    <button class="button small" data-action="toggle-scheduler">
      <ConnectionIcon :name="state.scheduler.paused?'play':'pause'" />
      {{ state.scheduler.paused?'Retomar':'Pausar' }}
    </button>
  </div>
</template>
