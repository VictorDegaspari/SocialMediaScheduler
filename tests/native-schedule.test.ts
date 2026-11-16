import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DateTime} from 'luxon';
import {nativeScheduleSchema,planNativeDate,uploadBudgetAvailable,validScheduleDate,type Reservation} from '../src/native-schedule.js';

const now=new Date('2026-11-16T10:00:00Z');
const daily={cadence:'daily',interval_minutes:120,times:['08:00','20:00'],timezone:'America/Sao_Paulo'};
test('distribui lote nos horários de São Paulo e respeita teto, reservas externas e período',()=>{
  const policy=nativeScheduleSchema.parse({maxScheduled:4,externalScheduled:1,startAt:'2026-11-17T00:00:00-03:00',endAt:'2026-11-18T08:00:00-03:00'});
  const reservations:Reservation[]=[];
  for(let i=0;i<3;i++)reservations.push({plannedAt:planNativeDate('tiktok',daily,policy,reservations,now)});
  assert.deepEqual(reservations.map(r=>new Date(r.plannedAt!).toISOString()),['2026-11-17T11:00:00.000Z','2026-11-17T23:00:00.000Z','2026-11-18T11:00:00.000Z']);
  assert.equal(planNativeDate('tiktok',daily,policy,reservations,now),null);
  assert.equal(planNativeDate('youtube',daily,{...policy,maxScheduled:100},reservations,now),null,'fim do período é inclusivo e não é prorrogado');
});
test('aplica a janela de 10 dias do TikTok mesmo com horizonte maior e não agenda no passado',()=>{
  const policy=nativeScheduleSchema.parse({horizonDays:365,startAt:'2026-11-27T00:00:00Z'});
  assert.equal(planNativeDate('tiktok',daily,policy,[],now),null);
  assert(planNativeDate('youtube',daily,policy,[],now));
  const interval={...daily,cadence:'interval',interval_minutes:60};
  assert.equal(planNativeDate('tiktok',interval,nativeScheduleSchema.parse({}),[],now)?.toISOString(),'2026-11-16T10:20:00.000Z');
  assert.equal(validScheduleDate('tiktok',new Date('2026-11-16T10:15:00Z'),nativeScheduleSchema.parse({}),now),false);
});
test('intervalo permanece estável quando o mínimo avança entre ciclos e após reinício',()=>{
  const interval={...daily,cadence:'interval',interval_minutes:120},policy=nativeScheduleSchema.parse({});
  const first=planNativeDate('youtube',interval,policy,[],now)!;
  const second=planNativeDate('youtube',interval,policy,[{plannedAt:first.toISOString()}],new Date(now.getTime()+60_000))!;
  assert.equal(second.getTime()-first.getTime(),120*60_000);
});
test('máximo diário é contado pelo dia local, incluindo reservas de outras rotinas',()=>{
  const policy=nativeScheduleSchema.parse({postsPerDay:1});
  const date=planNativeDate('youtube',daily,policy,[{plannedAt:'2026-11-16T23:00:00Z'}],now)!;
  assert.equal(date.toISOString(),'2026-11-17T11:00:00.000Z');
  const otherZone={...daily,timezone:'Asia/Tokyo',times:['08:00']};
  assert.equal(DateTime.fromJSDate(planNativeDate('youtube',otherZone,policy,[],now)!).setZone('Asia/Tokyo').toFormat('HH:mm'),'08:00');
});
test('orçamento de uploads usa janela móvel de 24h e libera somente quando expira',()=>{
  const policy=nativeScheduleSchema.parse({uploadsPer24h:1});
  assert.equal(uploadBudgetAvailable(policy,[{plannedAt:null,startedAt:new Date(now.getTime()-86399_000)}],now),false);
  assert.equal(uploadBudgetAvailable(policy,[{plannedAt:null,startedAt:new Date(now.getTime()-86400_000)}],now),true);
  assert.equal(uploadBudgetAvailable(policy,[{plannedAt:'2026-11-17T11:00:00Z'}],now),true);
});
test('rejeita limites inválidos e período invertido antes de persistir',()=>{
  for(const change of [{maxScheduled:0},{uploadsPer24h:0},{horizonDays:366},{postsPerDay:-1},{externalScheduled:-1},{startAt:'2026-11-17T11:00:00Z',endAt:'2026-11-16T11:00:00Z'}])
    assert.equal(nativeScheduleSchema.safeParse(change).success,false);
});
test('histórico de 150 mil reservas não expande a pilha nem muda o próximo horário',()=>{
  const policy=nativeScheduleSchema.parse({});
  const history=Array.from({length:150000},()=>({plannedAt:'2025-01-01T11:00:00Z'}));
  assert.equal(planNativeDate('youtube',daily,policy,history,now)?.toISOString(),planNativeDate('youtube',daily,policy,[],now)?.toISOString());
});
test('conta publicações anteriores no mesmo dia local e preserva dias de mudança de fuso',()=>{
  const policy=nativeScheduleSchema.parse({postsPerDay:1});
  assert.equal(planNativeDate('youtube',daily,policy,[{plannedAt:'2026-11-16T09:00:00Z'}],now)?.toISOString(),'2026-11-17T11:00:00.000Z');
  const dst={...daily,timezone:'America/New_York',times:['08:00','20:00']};
  assert.equal(planNativeDate('youtube',dst,policy,[{plannedAt:'2026-11-01T05:30:00Z'}],new Date('2026-11-01T10:00:00Z'))?.toISOString(),'2026-11-02T13:00:00.000Z');
});
