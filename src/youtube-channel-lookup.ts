import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {z} from 'zod';
import {AppError} from './config.js';

const youtube = 'https://www.youtube.com';
const channelIdPattern = /^UC[A-Za-z0-9_-]{22}$/;
const handlePattern = /^[\p{L}\p{N}](?:[\p{L}\p{N}\p{M}._-]{0,98}[\p{L}\p{N}\p{M}])?$/u;
const exec = promisify(execFile);

export const youtubeChannelId = z.string().regex(channelIdPattern);

export function youtubeChannelUrl(reference: string): string {
  const invalid = () => new AppError('Informe o @ ou o link de um canal do YouTube.');
  const value = reference.trim();
  if (channelIdPattern.test(value)) return youtube + '/channel/' + value;
  const handle = value.replace(/^@/, '');
  if (handlePattern.test(handle) && !/^youtube\.com$/i.test(handle)) {
    return youtube + '/@' + encodeURIComponent(handle);
  }
  let url: URL;
  let parts: string[];
  try {
    url = new URL(value.includes('://') ? value : 'https://' + value);
    parts = url.pathname.replace(/\/$/, '').slice(1).split('/').map(decodeURIComponent);
  } catch {
    throw invalid();
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) throw invalid();
  const length = parts[0].startsWith('@') ? 1 : 2;
  if (parts.length === length + 1 && ['about', 'featured', 'videos', 'shorts', 'streams', 'live', 'playlists', 'community'].includes(parts.at(-1)!)) {
    parts.pop();
  }
  if (parts.length === 1 && parts[0].startsWith('@') && handlePattern.test(parts[0].slice(1))) {
    return youtube + '/@' + encodeURIComponent(parts[0].slice(1));
  }
  if (parts.length === 2 && parts[0] === 'channel' && channelIdPattern.test(parts[1])) {
    return youtube + '/channel/' + parts[1];
  }
  if (parts.length === 2 && ['c', 'user'].includes(parts[0]) && handlePattern.test(parts[1])) {
    return youtube + '/' + parts[0] + '/' + encodeURIComponent(parts[1]);
  }
  throw invalid();
}

const tabSchema = z.object({
  id: z.string().nullish(),
  channel_id: z.string().nullish(),
  channel: z.string().nullish(),
  uploader: z.string().nullish(),
  title: z.string().nullish(),
  entries: z.array(z.unknown()).nullish(),
});
const entrySchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  title: z.string().trim().min(1),
  url: z.string(),
  duration: z.number().positive().nullish(),
  timestamp: z.number().positive().nullish(),
  live_status: z.string().nullish(),
  availability: z.string().nullish(),
});

export type ChannelVideo = {id: string; title: string; duration: number | null; kind?: 'video' | 'live'};
export type YoutubeChannel = {id: string; name: string; videos: ChannelVideo[]};

async function youtubeTab(url: string): Promise<unknown> {
  const {stdout} = await exec(process.env.CUTS_PYTHON || 'python3', [
    '-m', 'yt_dlp', '--ignore-config', '--no-plugin-dirs', '--no-cache-dir', '--flat-playlist', '--skip-download',
    '--dump-single-json', '--playlist-end', '20', '--socket-timeout', '8', '--retries', '1',
    '--extractor-retries', '0', '--no-warnings', '--extractor-args', 'youtubetab:approximate_date', '--', url,
  ], {timeout: 20_000, maxBuffer: 2 * 1024 * 1024});
  return JSON.parse(stdout);
}

type ChannelTab = z.infer<typeof tabSchema>;

function candidates(tab: ChannelTab | null, kind: 'video' | 'live') {
  const items: {video: ChannelVideo; timestamp: number}[] = [];
  for (const entry of tab?.entries ?? []) {
    const parsed = entrySchema.safeParse(entry);
    if (!parsed.success) continue;
    const {id, title, url, duration, timestamp, live_status: liveStatus, availability} = parsed.data;
    const eligible = kind === 'live' ? liveStatus === 'was_live' : !liveStatus || liveStatus === 'not_live';
    if (!eligible || url !== youtube + '/watch?v=' + id || (availability && availability !== 'public')) continue;
    items.push({video: {id, title: title.slice(0, 500), duration: duration ?? null, kind}, timestamp: timestamp ?? 0});
  }
  return items;
}

export async function lookupYoutubeChannel(reference: string, readTab = youtubeTab): Promise<YoutubeChannel> {
  const channelUrl = youtubeChannelUrl(reference);
  async function readOptionalTab(tab: 'videos' | 'streams') {
    try {
      return tabSchema.parse(await readTab(channelUrl + '/' + tab));
    } catch (error) {
      const stderr = (error as {stderr?: string})?.stderr ?? '';
      if (stderr.includes('does not have a ' + tab + ' tab')) return null;
      throw error;
    }
  }

  let profile: ChannelTab;
  let uploads: ChannelTab | null;
  let streams: ChannelTab | null;
  try {
    [uploads, streams] = await Promise.all([readOptionalTab('videos'), readOptionalTab('streams')]);
    profile = uploads ?? streams ?? tabSchema.parse(await readTab(channelUrl + '/about'));
  } catch (cause) {
    const stderr = (cause as {stderr?: string})?.stderr || '';
    if (/does not exist|unable to resolve (?:url|channel)|HTTP Error 404/i.test(stderr)) {
      throw new AppError('Canal não encontrado. Confira o @ ou o link no YouTube.', 404);
    }
    throw new AppError('Não foi possível consultar o YouTube agora. Tente novamente em instantes.', 502);
  }
  const id = [profile.channel_id, profile.id, streams?.channel_id, streams?.id].find(value => value && channelIdPattern.test(value));
  if (!id) throw new AppError('Canal não encontrado. Confira o @ ou o link no YouTube.', 404);
  const name = (profile.channel?.trim() || profile.uploader?.trim() ||
    profile.title?.replace(/\s+-\s+(?:Videos|Live|Streams)$/i, '').trim() || id).slice(0, 300);
  const items = [...candidates(uploads, 'video'), ...candidates(streams, 'live')];
  // When a replay appears on both tabs, keep its explicit live classification.
  const unique = new Map(items.map(item => [item.video.id, item]));
  const videos = [...unique.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, 3).map(item => item.video);
  return {id, name, videos};
}
