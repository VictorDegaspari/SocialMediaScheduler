import type {PageMetadata} from '../../src/pagination.js';
import type {PackDefaults} from '../../src/pack-config.js';
import type {BrowserProfile, ConnectionChannel} from './connection-types.js';
import type {NativeScheduleModel} from '../native-schedule.js';
import type {EditorialPreviewApi} from './editorial-form.js';

export const requestViews = [['orders', 'Pedidos'], ['profiles', 'Perfis'], ['accounts', 'Contas']] as const;
export type RequestView = typeof requestViews[number][0];
export const requestStatuses: Record<string, string> = {active: 'Na fila', waiting_manual: 'Precisa de você', completed: 'Concluído', cancelled: 'Cancelado'};
export const requestPlatform = (provider: string) => provider === 'youtube' ? 'YouTube' : 'TikTok';
export type PublishingProfile = {
  id: string; name: string; source_type?: string; source_roots?: string[]; folder_url?: string;
  watch_id?: string | null; youtube_id?: string | null; tiktok_profile_id?: string | null; pack_defaults?: Partial<PackDefaults>;
};
export type PublicationRequest = {
  id: string; profile_name: string; provider: string; status: string; confirmed: number; quantity: number;
  reserved: number; waiting: number; message?: string; created_at: string;
  config?: {cadence?: {times?: string[]; timezone?: string}};
};
export type RequestAction = {id: string; profile_name: string; provider: string; message: string; href: string; kind: string; request_id: string};
export type PublishingContext = {
  profiles: PublishingProfile[]; accounts: (ConnectionChannel & {autoPublishApproved?: boolean})[];
  browserProfiles: (BrowserProfile & {name: string})[]; googleConnected?: boolean;
  requests: PublicationRequest[]; actions: RequestAction[];
  pagination?: {requests?: PageMetadata; actions?: PageMetadata};
};
export type RequestsState = {
  publishing: PublishingContext;
  connections: {local: {rootPath: string}; playwrightMcp?: {configured: boolean}; native: {youtube: {configured: boolean}}};
};
export type PaginationView = {page: number; previousDisabled: boolean; nextDisabled: boolean; cursor: string} | null;
export type RequestPagination = {requests: PaginationView; actions: PaginationView};
export type RequestRevisions = {request: number; profile: number; browser: number};
export type RequestDate = (value: string, includeTime?: boolean) => string;
export type RequestsSnapshot = {
  state: RequestsState; view: RequestView; editing: string | null; revisions: RequestRevisions;
  pagination: RequestPagination; schedule: NativeScheduleModel; date: RequestDate;
  api: EditorialPreviewApi;
};
