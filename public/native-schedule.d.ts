import type {NativeSchedule} from '../src/native-schedule.js';
export type NativeScheduleField = {name: string; label: string; min: number; max: number; value: number; hint: string};
export type NativeScheduleModel = {notice: string; tip: string; groups: NativeScheduleField[][]; dates: {name: string; label: string; value: string}[]};
export function nativeScheduleModel(value?: Partial<NativeSchedule>, prefix?: string): NativeScheduleModel;
export function nativeScheduleFields(value: Partial<NativeSchedule> | undefined, esc: (value: unknown) => string, prefix?: string): string;
export function readNativeSchedule(form: HTMLFormElement): NativeSchedule;
