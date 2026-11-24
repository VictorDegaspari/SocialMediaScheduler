<script setup lang="ts">
import {ref,useTemplateRef} from 'vue';

const props=defineProps<{importFile:(file:File)=>Promise<void>}>();
const picker=useTemplateRef<HTMLInputElement>('picker');
const importing=ref(false);
const error=ref('');

async function select(){
  const input=picker.value,file=input?.files?.[0];
  if(!input||!file||importing.value)return;
  input.value='';
  error.value='';
  importing.value=true;
  try{await props.importFile(file);}
  catch(cause){error.value=cause instanceof Error?cause.message:'Não foi possível importar o corte.';}
  finally{importing.value=false;}
}
</script>

<template>
  <div>
    <input ref="picker" type="file" accept="video/mp4,.mp4" aria-label="Arquivo MP4 do corte pronto" hidden @change="select">
    <button type="button" class="button primary" :disabled="importing" @click="picker?.click()">
      {{ importing?'Importando MP4…':'Importar corte pronto' }}
    </button>
    <p v-if="error" class="error-banner" role="alert">{{ error }}</p>
  </div>
</template>
