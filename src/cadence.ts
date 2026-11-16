import { DateTime } from 'luxon';

export function nextRun(config: { cadence: string; interval_minutes: number; times: string[]; timezone: string }, after: Date): Date {
  if (config.cadence === 'interval') return new Date(after.getTime() + config.interval_minutes * 60_000);
  const local = DateTime.fromJSDate(after).setZone(config.timezone);
  if (!local.isValid) throw new Error('Fuso horário inválido');
  const candidates = [0,1,2].flatMap(days => config.times.map(t => {
    const [hour,minute] = t.split(':').map(Number);
    return local.plus({days}).set({hour,minute,second:0,millisecond:0});
  })).filter(t=>t.isValid && t.toMillis() > after.getTime()).sort((a,b)=>a.toMillis()-b.toMillis());
  if (!candidates[0]) throw new Error('Nenhum horário válido');
  return candidates[0].toJSDate();
}

