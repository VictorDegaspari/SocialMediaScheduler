import type {nativeConnectionState} from '../../src/native-auth.js';
import type {playwrightMcpState} from '../../src/playwright-mcp.js';

export type YoutubeConnection = Awaited<ReturnType<typeof nativeConnectionState>>['youtube'];
export type PlaywrightMcpConnection = Awaited<ReturnType<typeof playwrightMcpState>>;
export type GoogleConnection = {configured: boolean; connected: boolean; clientId: string; callbackUrl: string};
export type PostizConnection = {configured: boolean; baseUrl: string; youtubeSchedulingApproved: boolean};
export type ConnectionChannel = {id: string; name: string; identifier: string; disabled: boolean};
export type BrowserProfile = {id: string; profileSaved: boolean};
export type ConnectionIconName = 'youtube' | 'tiktok' | 'drive' | 'monitor' | 'link';
export type IconRenderer = (name: ConnectionIconName) => string;

export type ConnectionsState = {
  connections: {
    native: {engine: 'local' | 'postiz'; youtube: YoutubeConnection};
    playwrightMcp?: PlaywrightMcpConnection;
    google: GoogleConnection;
    postiz: PostizConnection;
    local: {rootPath: string};
  };
  publishing?: {browserProfiles?: BrowserProfile[]};
  scheduler: {queue?: {backend?: string; unavailable?: boolean; waiting?: number; active?: number}};
};
