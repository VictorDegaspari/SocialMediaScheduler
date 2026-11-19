<script setup lang="ts">
import {ref,useTemplateRef} from 'vue';
import type {FolderScheduleCancellation,FolderScheduleEntry} from '../../src/folder-schedule.js';

type SchedulePage={items:FolderScheduleEntry[];cancellable:number;pagination:{nextCursor:string|null}};
type ScheduleApi=(path:string,body?:{confirm:true})=>Promise<any>;
const props=defineProps<{folderId:string;name:string;api:ScheduleApi;onChanged:()=>void}>();
const dialog=useTemplateRef<HTMLDialogElement>('dialog');
const rows=ref<FolderScheduleEntry[]>([]),next=ref<string|null>(null),cancellable=ref(0);
const loading=ref(false),loaded=ref(false),cancelling=ref(false),error=ref(''),result=ref<FolderScheduleCancellation|null>(null);
const format=new Intl.DateTimeFormat('pt-BR',{
  timeZone:'America/Sao_Paulo',weekday:'short',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'
});
const labels:Record<string,string>={
  preparing:'Preparando envio',review:'Aguardando aprovação',pending:'Reservado na fila',retry:'Reservado · nova tentativa',
  failed:'Falha no envio',submitting:'Enviando',unknown:'Envio a conferir',processing:'Processando no YouTube'
};
function status(row:FolderScheduleEntry){
  if(row.status==='scheduled')return row.engine==='postiz'?'Agendado via Postiz':'Agendado no YouTube';
  return labels[row.status]??row.status;
}
const path=()=>'/watches/'+encodeURIComponent(props.folderId)+'/schedule';
async function load(cursor:string|null=null){
  if(loading.value)return;
  loading.value=true;
  error.value='';
  try{
    const page:SchedulePage=await props.api(path()+(cursor?'?cursor='+encodeURIComponent(cursor):''));
    rows.value=cursor?[...rows.value,...page.items]:page.items;
    next.value=page.pagination.nextCursor;
    cancellable.value=page.cancellable;
    loaded.value=true;
  }catch(cause){error.value=cause instanceof Error?cause.message:'Não foi possível carregar os agendamentos.';}
  finally{loading.value=false;}
}
function opened(event:Event){
  if((event.currentTarget as HTMLDetailsElement).open&&!loaded.value)void load();
}
async function cancelSchedules(){
  if(cancelling.value)return;
  cancelling.value=true;
  error.value='';
  try{
    result.value=await props.api(path()+'/cancel',{confirm:true});
    dialog.value?.close();
    await load();
    props.onChanged();
  }catch(cause){
    dialog.value?.close();
    error.value=cause instanceof Error?cause.message:'Não foi possível cancelar os agendamentos.';
  }finally{cancelling.value=false;}
}
</script>

<template>
  <details class="folder-details folder-schedule" :data-folder-details="'schedule-' + folderId" @toggle="opened">
    <summary>Agendamentos por vídeo</summary>
    <div class="folder-schedule-tools">
      <p>Data e hora em Brasília</p>
      <button class="button small" type="button" :disabled="loading || cancelling" @click="load()">Atualizar agendamentos</button>
      <button v-if="cancellable" class="button small danger" type="button" :disabled="loading || cancelling" @click="dialog?.showModal()">Cancelar agendamentos da pasta</button>
    </div>
    <p v-if="loading" role="status">Carregando agendamentos…</p>
    <p v-if="error" class="watch-error" role="alert">{{ error }}</p>
    <div v-if="result" class="folder-schedule-result" role="status">
      <p>{{ result.cancelled }} {{ result.cancelled === 1 ? 'agendamento cancelado' : 'agendamentos cancelados' }}.</p>
      <ul v-if="result.issues.length">
        <li v-for="(issue,index) in result.issues" :key="index">
          <strong>{{ issue.title }}</strong> · {{ issue.message }}
          <a v-if="issue.authorizeChannel" :href="'/auth/youtube?edit=1&amp;channel=' + encodeURIComponent(issue.authorizeChannel)" target="_blank" rel="noopener">Autorizar edição no YouTube</a>
        </li>
      </ul>
    </div>
    <p v-if="loaded && !rows.length">Nenhum próximo agendamento nesta pasta.</p>
    <ul v-if="rows.length" class="folder-schedule-list" aria-label="Próximos agendamentos desta pasta">
      <li v-for="row in rows" :key="row.id">
        <div class="folder-schedule-info">
          <strong>{{ row.title }}</strong>
          <span>{{ row.channel }} · {{ status(row) }}</span>
        </div>
        <time :datetime="row.plannedAt">{{ format.format(new Date(row.plannedAt)) }}</time>
      </li>
    </ul>
    <p v-if="rows.some(row => row.engine === 'postiz')" class="tip">Agendamentos via Postiz são gerenciados no Postiz.</p>
    <button v-if="next" class="button small" type="button" :disabled="loading || cancelling" @click="load(next)">Mais agendamentos</button>
    <dialog ref="dialog" class="dialog" :aria-labelledby="'cancel-schedule-title-' + folderId" @cancel="cancelling && $event.preventDefault()">
      <div class="dialog-head">
        <div>
          <h2 :id="'cancel-schedule-title-' + folderId">Cancelar agendamentos desta pasta?</h2>
          <p class="subtitle">{{ name }}</p>
        </div>
      </div>
      <form @submit.prevent="cancelSchedules">
        <p>{{ cancellable }} {{ cancellable === 1 ? 'envio elegível' : 'envios elegíveis' }}. O lote inclui os horários reservados na fila local e os próximos agendamentos nativos do YouTube. Os vídeos já enviados ficam privados no canal.</p>
        <p class="tip">Uma rotina ativa pode reservar horários para outros vídeos da pasta.</p>
        <div class="dialog-footer">
          <button class="button" type="button" autofocus :disabled="cancelling" @click="dialog?.close()">Voltar</button>
          <button class="button danger" type="submit" :disabled="cancelling">{{ cancelling ? 'Cancelando…' : 'Confirmar cancelamento' }}</button>
        </div>
      </form>
    </dialog>
  </details>
</template>
