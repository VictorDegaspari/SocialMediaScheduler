import {z} from 'zod';
import {AppError} from './config.js';

export const tiktokMarkets = ['US', 'JP', 'VN', 'TH', 'ID'] as const;
export const tiktokTrendQuery = z.object({
  market: z.enum(tiktokMarkets).default('US'),
  days: z.enum(['7', '30']).default('7'),
});
export type TikTokTrendQuery = z.infer<typeof tiktokTrendQuery>;
export type TikTokTrend = {url: string; title: string; views: number | null};

export function tiktokVideoUrl(value: string): string {
  const invalid = () => new AppError('Informe um link HTTPS de um vídeo público do TikTok.');
  let url: URL;
  try { url = new URL(value); } catch { throw invalid(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw invalid();
  const host = url.hostname;
  const full = /^\/@([\w.]+)\/video\/(\d{15,25})\/?$/.exec(url.pathname);
  if (full && ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'].includes(host)) {
    return 'https://www.tiktok.com/@' + full[1] + '/video/' + full[2];
  }
  if (['vm.tiktok.com', 'vt.tiktok.com'].includes(host) && /^\/[a-z0-9]+\/?$/i.test(url.pathname)) {
    return url.origin + url.pathname.replace(/\/?$/, '/');
  }
  if (['tiktok.com', 'www.tiktok.com'].includes(host) && /^\/t\/[a-z0-9]+\/?$/i.test(url.pathname)) {
    return 'https://www.tiktok.com' + url.pathname.replace(/\/?$/, '/');
  }
  throw invalid();
}

export async function resolveTikTokVideo(value: string, request = fetch): Promise<string> {
  let url = tiktokVideoUrl(value);
  for (let attempt = 0; attempt < 4; attempt++) {
    if (url.startsWith('https://www.tiktok.com/@')) return url;
    try {
      const response = await request(url, {redirect: 'manual', signal: AbortSignal.timeout(5_000)});
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || !location) break;
      url = tiktokVideoUrl(new URL(location, url).href);
    } catch { break; }
  }
  // SSSTik also accepts the short link when TikTok does not resolve it here.
  return tiktokVideoUrl(value);
}

export function tiktokSourceKey(url: string): string {
  return /\/video\/(\d+)$/.exec(url)?.[1] ?? url;
}

const metrics = z.union([z.string(), z.number()]).optional();
const rankingSchema = z.object({
  BaseResp: z.object({StatusCode: z.literal(0)}),
  entityInfos: z.array(z.object({
    itemInfo: z.object({itemID: z.string().regex(/^\d{15,25}$/), title: z.string().optional()}).optional(),
    itemAuthorInfo: z.object({handlerName: z.string().optional()}).optional(),
    itemMetrics: z.object({videoViews: metrics}).optional(),
  })),
});
const overviewSchema = z.object({
  BaseResp: z.object({StatusCode: z.literal(0)}),
  lastDailyEndTimestamp: z.coerce.number().int().positive(),
});
const creativeCenterHosts = ['https://ads.us.tiktok.com', 'https://ads.tiktok.com'] as const;
const creativeDetailSchema = z.object({
  BaseResp: z.object({StatusCode: z.literal(0)}),
  entityInfo: z.object({itemInfo: z.object({itemID: z.string(), videoURL: z.string()})}),
});

const trendsCache = new Map<string, {expires: number; result: Promise<TikTokTrend[]>}>();

export async function tiktokTrends(query: TikTokTrendQuery, request = fetch): Promise<TikTokTrend[]> {
  const key = query.market + ':' + query.days;
  const cached = trendsCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;
  const result = fetchTrends(query, request);
  trendsCache.set(key, {expires: Date.now() + 10 * 60_000, result});
  try { return await result; }
  catch (error) {
    if (trendsCache.get(key)?.result === result) trendsCache.delete(key);
    throw error;
  }
}

async function creativeReport(base: typeof creativeCenterHosts[number], path: string, request: typeof fetch): Promise<unknown> {
  const response = await request(base + '/CreativeOne/Report/' + path, {redirect: 'error', signal: AbortSignal.timeout(8_000)});
  if (!response.ok) throw new Error('Creative Center request');
  return JSON.parse(await response.text(), (key, value, context?: {source?: string}) => {
    // TikTok may serialize 64-bit video IDs as JSON numbers. Keep the original digits.
    return key === 'itemID' && typeof value === 'number' ? context?.source : value;
  });
}

export function tiktokMediaUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokv.com'].some(host => url.hostname.endsWith('.' + host)) ||
      /^v\d+-webapp-prime\.tiktok\.com$/.test(url.hostname)) return url;
  } catch { /* invalid CDN link */ }
  return null;
}

export async function* creativeVideoUrls(id: string, request = fetch) {
  if (!/^\d{15,25}$/.test(id)) return;
  const seen = new Set<string>();
  for (const host of creativeCenterHosts) {
    let timestamp: string;
    try {
      const overview = overviewSchema.parse(await creativeReport(host, 'GetTopContentsOverview', request));
      timestamp = String(overview.lastDailyEndTimestamp);
    } catch { continue; }
    // A video can be missing from one report window while its MP4 is available in the other.
    for (const periodDimension of ['3', '5']) {
      try {
        const params = new URLSearchParams({itemID: id, periodDimension, periodEndTimestamp: timestamp});
        const {entityInfo: {itemInfo}} = creativeDetailSchema.parse(await creativeReport(
          host, 'CreativeCenterGetTopContentsItemDetail?' + params, request,
        ));
        const url = itemInfo.itemID === id ? tiktokMediaUrl(itemInfo.videoURL) : null;
        if (!url || seen.has(url.href)) continue;
        seen.add(url.href);
        yield url;
      } catch { /* The next report may still have a public MP4. */ }
    }
  }
}

async function fetchTrends(query: TikTokTrendQuery, request: typeof fetch): Promise<TikTokTrend[]> {
  // These are the same regional hosts and public four entries the Creative Center uses.
  const base = creativeCenterHosts[query.market === 'US' ? 0 : 1];
  const read = (path: string) => creativeReport(base, path, request);
  try {
    const {lastDailyEndTimestamp} = overviewSchema.parse(await read('GetTopContentsOverview'));
    const params = new URLSearchParams({
      countryCode: query.market, periodDimension: query.days === '7' ? '3' : '5',
      periodEndTimestamp: String(lastDailyEndTimestamp), orderByMetric: '1',
      contentLabelIDs: '', organicOnly: 'false', limit: '4', page: '1',
    });
    const {entityInfos} = rankingSchema.parse(await read('CreativeCenterGetTopContentsList?' + params));
    const videos = new Map<string, TikTokTrend>();
    for (const {itemInfo, itemAuthorInfo, itemMetrics} of entityInfos.slice(0, 4)) {
      if (!itemInfo || videos.has(itemInfo.itemID)) continue;
      const author = itemAuthorInfo?.handlerName?.trim();
      if (!author || !/^[\w.]+$/.test(author)) continue;
      const views = Number(itemMetrics?.videoViews);
      videos.set(itemInfo.itemID, {
        url: 'https://www.tiktok.com/@' + author + '/video/' + itemInfo.itemID,
        title: (itemInfo.title?.trim() || '@' + author).slice(0, 500),
        views: Number.isSafeInteger(views) && views >= 0 ? views : null,
      });
    }
    return [...videos.values()];
  } catch {
    throw new AppError('O ranking público do TikTok está indisponível. Consulte o Creative Center ou cole um link.', 502);
  }
}
