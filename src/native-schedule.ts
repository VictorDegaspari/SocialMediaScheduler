import { DateTime } from 'luxon';
import { z } from 'zod';
import { nextRun } from './cadence.js';

// These are operator budgets, not claims about universal account limits.
export const nativeScheduleSchema=z.object({
  maxScheduled:z.number().int().min(1).max(1000).default(10),
  uploadsPer24h:z.number().int().min(1).max(1000).default(10),
  postsPerDay:z.number().int().min(1).max(100).default(2),
  horizonDays:z.number().int().min(1).max(365).default(10),
  externalScheduled:z.number().int().min(0).max(10000).default(0),
  startAt:z.iso.datetime({offset:true}).nullable().default(null),
  endAt:z.iso.datetime({offset:true}).nullable().default(null)
}).strict().refine(v=>!v.startAt||!v.endAt||Date.parse(v.endAt)>Date.parse(v.startAt),{message:'A data final deve ser posterior à inicial.',path:['endAt']});
export type NativeSchedule=z.infer<typeof nativeScheduleSchema>;
export type ScheduleProvider='youtube'|'tiktok';
export interface ScheduleCadence {cadence:string;interval_minutes:number;times:string[];timezone:string;}
export interface Reservation {id?:string;plannedAt:Date|string|null;startedAt?:Date|string|null;}
const ms=(v:Date|string)=>new Date(v).getTime();
export const scheduleLeadMs=(provider:ScheduleProvider)=>provider==='tiktok'?20*60_000:15*60_000;

export function scheduleWindow(provider:ScheduleProvider,policy:NativeSchedule,now=new Date()) {
  return {min:Math.max(now.getTime()+scheduleLeadMs(provider),policy.startAt?Date.parse(policy.startAt):0),
    max:Math.min(now.getTime()+Math.min(policy.horizonDays,provider==='tiktok'?10:365)*86400_000,policy.endAt?Date.parse(policy.endAt):Infinity)};
}
export function validScheduleDate(provider:ScheduleProvider,date:Date,policy:NativeSchedule,now=new Date()) {
  const {min,max}=scheduleWindow(provider,policy,now);
  return Number.isFinite(date.getTime())&&date.getTime()>=min&&date.getTime()<=max;
}
export function uploadBudgetAvailable(policy:NativeSchedule,reservations:Reservation[],now=new Date()) {
  return reservations.filter(r=>r.startedAt&&ms(r.startedAt)>now.getTime()-86400_000).length<policy.uploadsPer24h;
}
export function reservedCapacityAllowed(date:Date,cadence:ScheduleCadence,policy:NativeSchedule,reservations:Reservation[],now=new Date()) {
  if(cadence.cadence==='daily'&&!cadence.times.includes(DateTime.fromJSDate(date).setZone(cadence.timezone).toFormat('HH:mm')))return false;
  const local=DateTime.fromJSDate(date).setZone(cadence.timezone),start=local.startOf('day').toMillis(),end=local.endOf('day').toMillis();
  let future=0,count=0;
  for(const r of reservations)if(r.plannedAt){const value=ms(r.plannedAt);if(value>now.getTime())future++;if(value>=start&&value<=end)count++;}
  return future+policy.externalScheduled<=policy.maxScheduled&&count<=policy.postsPerDay;
}
/** All callers reserve under their existing PostgreSQL advisory lock. */
export function planNativeDate(provider:ScheduleProvider,cadence:ScheduleCadence,policy:NativeSchedule,reservations:Reservation[],now=new Date()):Date|null {
  const {min,max}=scheduleWindow(provider,policy,now);
  if(min>max)return null;
  const day=(value:number)=>DateTime.fromMillis(value).setZone(cadence.timezone).toISODate();
  const relevantStart=DateTime.fromMillis(min).setZone(cadence.timezone).startOf('day').toMillis();
  const days=new Map<string|null,number>(),occupied=new Set<number>();
  let last=0,future=0;
  for(const r of reservations)if(r.plannedAt) {
    const value=ms(r.plannedAt);
    if(!Number.isFinite(value))return null;
    last=Math.max(last,value);if(value>now.getTime())future++;
    if(value>=relevantStart&&value<=max){const key=day(value);days.set(key,(days.get(key)||0)+1);occupied.add(value);}
  }
  if(future+policy.externalScheduled>=policy.maxScheduled||last>max)return null;
  let after=new Date(Math.max(min-1,last));
  // Keep interval slots stable across ticks and restarts; daily slots use the routine's zone.
  let candidate=cadence.cadence==='daily'?nextRun(cadence,after):new Date(Math.max(last?last+cadence.interval_minutes*60_000:0,Math.ceil(min/60_000)*60_000));
  for(let attempts=0;attempts<525600&&candidate.getTime()<=max;attempts++) {
    const count=days.get(day(candidate.getTime()))||0;
    if(count<policy.postsPerDay&&!occupied.has(candidate.getTime()))return candidate;
    // A full date can be skipped without iterating every minute of an interval.
    after=count>=policy.postsPerDay?DateTime.fromJSDate(candidate).setZone(cadence.timezone).endOf('day').toJSDate():candidate;
    candidate=cadence.cadence==='daily'?nextRun(cadence,after):new Date(Math.max(candidate.getTime()+cadence.interval_minutes*60_000,after.getTime()+1));
  }
  return null;
}
