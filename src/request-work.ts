import type {NativeSchedule,ScheduleCadence} from './native-schedule.js';
export interface RequestWork {
  id:string;provider:'youtube'|'tiktok';integrationId:string;channelName:string;
  policy:NativeSchedule;cadence:ScheduleCadence;
}
