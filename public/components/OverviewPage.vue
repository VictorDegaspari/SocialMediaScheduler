<script setup>
import ConnectionIcon from './ConnectionIcon.js';
import StatusBadge from './StatusBadge.vue';
import {computed} from 'vue';
import WorkspaceHeading from './WorkspaceHeading.vue';
import WatchCards from './WatchCards.vue';
import WorkspaceActivity from './WorkspaceActivity.vue';
const props = defineProps(['state', 'icon', 'date', 'publisherReady']);
const total = computed(() => props.state.stats.watches ?? props.state.watches.length);
const sourceReady = computed(() => (props.state.stats.local_source_ready ?? props.state.watches.some(w => ['gta6_pack', 'local'].includes(w.source_type))) || props.state.connections.google.connected);
const active = computed(() => props.state.stats.active_watches ?? props.state.watches.filter(w => w.enabled).length);
</script>

<template>
  <WorkspaceHeading title="Seu conteúdo, no ritmo certo." subtitle="Organize suas pastas. O resto entra na rotina." eyebrow="SEU WORKSPACE" :action="true" :icon="icon" />
  <div class="stats">
    <article class="stat">
      <div class="stat-top">
        Pastas monitoradas
        <span class="stat-icon">
          <ConnectionIcon name="folder" :icon="icon" />
        </span>
      </div>
      <strong class="stat-number">{{ total.toString().padStart(2,'0') }}</strong>
      <p class="stat-bottom green">{{ active }} rotina(s) ativa(s)</p>
    </article>
    <article class="stat">
      <div class="stat-top">
        Vídeos aguardando
        <span class="stat-icon">
          <ConnectionIcon name="clock" :icon="icon" />
        </span>
      </div>
      <strong class="stat-number">{{ state.stats.pending.toString().padStart(2,'0') }}</strong>
      <p class="stat-bottom">Na sua fila de conteúdo</p>
    </article>
    <article class="stat">
      <div class="stat-top">
        Publicações enviadas
        <span class="stat-icon">
          <ConnectionIcon name="upload" :icon="icon" />
        </span>
      </div>
      <strong class="stat-number">{{ state.stats.sent.toString().padStart(2,'0') }}</strong>
      <p class="stat-bottom">Envios e publicações</p>
    </article>
    <article class="stat">
      <div class="stat-top">
        Precisam de atenção
        <span class="stat-icon">
          <ConnectionIcon name="alert" :icon="icon" />
        </span>
      </div>
      <strong class="stat-number">{{ state.stats.attention.toString().padStart(2,'0') }}</strong>
      <p class="stat-bottom">Acompanhe pelo histórico</p>
    </article>
  </div>
  <section class="hero">
    <div class="hero-copy">
      <span class="eyebrow">DA SUA PASTA PARA O PRÓXIMO POST</span>
      <h2>
        Uma pasta organizada.
        <br>
        Uma rotina que trabalha por você.
      </h2>
      <p>Adicione seus vídeos, defina a frequência e acompanhe cada envio. Sem precisar deixar esta página aberta.</p>
    </div>
    <div class="hero-flow" aria-hidden="true">
      <div class="flow-node">
        <ConnectionIcon name="drive" :icon="icon" />
      </div>
      <span class="flow-dash">····</span>
      <div class="flow-node dark">↗</div>
      <span class="flow-dash">····</span>
      <div class="flow-end">
        <div class="flow-node" data-platform="youtube">
          <ConnectionIcon name="youtube" :icon="icon" />
        </div>
        <div class="flow-node" data-platform="tiktok">
          <ConnectionIcon name="tiktok" :icon="icon" />
        </div>
      </div>
    </div>
  </section>
  <section>
    <div class="section-head">
      <div>
        <h2>
          Suas pastas
          <StatusBadge :label="total+' cadastrada(s)'" tone="gray" />
        </h2>
        <p>Cada pasta tem seu próprio ritmo.</p>
      </div>
      <a href="#watches" class="section-link">
        Ver todas
        <ConnectionIcon name="arrow" :icon="icon" />
      </a>
    </div>
    <WatchCards :items="state.watches.slice(0, 3)" :icon="icon" :date="date" />
  </section>
  <div class="content-grid">
    <section>
      <div class="section-head">
        <h2>Últimas atividades</h2>
        <a class="section-link" href="#history">
          Ver histórico
          <ConnectionIcon name="arrow" :icon="icon" />
        </a>
      </div>
      <div class="panel">
        <WorkspaceActivity :events="state.events.slice(0, 6)" :icon="icon" :date="date" />
      </div>
    </section>
    <section>
      <div class="section-head">
        <h2>{{ sourceReady&&publisherReady&&state.watches.length?'Seu fluxo está configurado':'Seu checklist de início' }}</h2>
      </div>
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
    </section>
  </div>
  <div class="runtime-bar">
    <div>
      <ConnectionIcon name="monitor" :icon="icon" />
      <span>
        <strong>{{ state.scheduler.paused?'Rotinas pausadas':'Sua rotina continua com esta página fechada.' }}</strong>
        <br>
        <small>O PC e o serviço precisam estar ligados. {{ state.scheduler.heartbeat?'Último ciclo às '+date(state.scheduler.heartbeat)+'.':'' }}</small>
      </span>
    </div>
    <button class="button small" data-action="toggle-scheduler">
      <ConnectionIcon :name="state.scheduler.paused?'play':'pause'" :icon="icon" />
      {{ state.scheduler.paused?'Retomar':'Pausar' }}
    </button>
  </div>
</template>
