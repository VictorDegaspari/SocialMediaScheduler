export function nativeScheduleFields(value={},esc,prefix='native') {
  const p={maxScheduled:10,uploadsPer24h:10,postsPerDay:2,horizonDays:10,externalScheduled:0,...value};
  const local=iso=>iso?new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso)).replace(' ','T'):'';
  const number=(name,label,max,hint)=>`<div class="form-field"><label for="${prefix}-${name}">${label}</label><input id="${prefix}-${name}" name="${name}" type="number" min="${name==='externalScheduled'?0:1}" max="${max}" value="${esc(p[name])}" required>${hint?`<small>${hint}</small>`:''}</div>`;
  return `<div class="notice">O lote envia os vídeos antecipadamente. A plataforma publica nos horários da rotina, mesmo com o PC desligado após a confirmação. Os limites abaixo são tetos do sistema; a conta pode permitir menos.</div>
    <div class="field-row">${number('maxScheduled','Máximo de vídeos agendados',1000,'Inclui a fila reservada e os agendamentos ainda futuros.')}${number('externalScheduled','Agendados fora deste sistema',10000,'Reserve capacidade para vídeos agendados manualmente ou por outras ferramentas.')}</div>
    <div class="field-row">${number('uploadsPer24h','Máximo de uploads em 24 horas',1000,'Considere o limite da sua conta e a cota da API.')}${number('postsPerDay','Máximo de publicações por dia',100,'Considera o calendário deste sistema, no fuso da rotina.')}</div>
    ${number('horizonDays','Preparar quantos dias à frente?',prefix==='tiktok'?10:365,prefix==='tiktok'?'TikTok: de 15 minutos a 10 dias de antecedência; o sistema reserva pelo menos 20 minutos.':'A antecedência mínima do sistema é de 15 minutos.')}
    <div class="field-row"><div class="form-field"><label for="${prefix}-startAt">Publicar a partir de (opcional)</label><input id="${prefix}-startAt" name="startAt" type="datetime-local" value="${esc(local(p.startAt))}"></div><div class="form-field"><label for="${prefix}-endAt">Publicar até (opcional)</label><input id="${prefix}-endAt" name="endAt" type="datetime-local" value="${esc(local(p.endAt))}"></div></div><p class="tip">Datas em America/Sao_Paulo. Ao atingir um teto ou o fim do período, os próximos vídeos aguardam. Alterar ou pausar a rotina não cancela agendamentos já confirmados na plataforma.</p>`;
}
export function readNativeSchedule(form) {
  const f=new FormData(form),result={};
  for(const name of ['maxScheduled','uploadsPer24h','postsPerDay','horizonDays','externalScheduled'])result[name]=Number(f.get(name));
  for(const name of ['startAt','endAt'])result[name]=f.get(name)?new Date(String(f.get(name))+':00-03:00').toISOString():null;
  return result;
}
