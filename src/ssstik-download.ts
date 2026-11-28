import {createWriteStream} from 'node:fs';
import {rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {chromium} from 'playwright-core';
import {AppError} from './config.js';
import {availableCutBytes} from './cuts-media.js';
import {creativeVideoUrls, resolveTikTokVideo, tiktokMediaUrl, tiktokSourceKey} from './channel-video-source.js';
import {validateVideo} from './media.js';

export const ssstikPage = 'https://ssstik.io/pt';
export const maxChannelVideoBytes = 512 * 1024 * 1024;
const downloadError = 'Não foi possível obter o MP4 público pelo SSSTik ou pelo TikTok. Confira o link ou importe o MP4 original.';
const openBrowser = () => chromium.launch({
  executablePath: process.env.CHANNELS_CHROME_PATH || process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: true, timeout: 12_000,
});

function serviceUrl(value: string, media = false): URL | null {
  try {
    const url = new URL(value, ssstikPage);
    const permitted = media ? ['ssstik.io', 'ssstik.top', 'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokv.com'] : ['ssstik.io'];
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      permitted.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) return url;
  } catch { /* invalid link */ }
  return null;
}

type DownloadOption = {href: string; label: string};

export function identifiedDownload(options: DownloadOption[]): URL | null {
  const usable = options.filter(({label}) =>
    !/\b(?:sem marca|without watermark|no watermark|mp3|áudio)\b/i.test(label) &&
    /\b(?:com marca|with watermark|original)\b/i.test(label),
  );
  const quality = (label: string) => /\b(?:hd|original)\b/i.test(label) ? 1 : 0;
  for (const option of usable.sort((a, b) => quality(b.label) - quality(a.label))) {
    const url = serviceUrl(option.href, true);
    if (url) return url;
  }
  return null;
}

export async function writeChannelVideo(input: Readable, output: string, declaredBytes?: number, signal?: AbortSignal) {
  const limit = Math.min(maxChannelVideoBytes, await availableCutBytes(dirname(output)));
  if (limit <= 0 || (declaredBytes !== undefined && declaredBytes > limit)) {
    throw new AppError('O MP4 excede o limite de 512 MB ou o espaço livre disponível.', 413);
  }
  let bytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, done) {
      bytes += chunk.length;
      if (bytes > limit) return done(new AppError('O MP4 excede o limite de 512 MB ou o espaço livre disponível.', 413));
      done(null, chunk);
    },
  });
  await pipeline(input, meter, createWriteStream(output, {flags: 'wx'}), {signal});
  if (!bytes || (declaredBytes !== undefined && bytes !== declaredBytes)) {
    throw new AppError('O arquivo MP4 está vazio ou incompleto.');
  }
}

function completeVideoLength(status: number, headers: Headers) {
  const size = headers.get('content-length');
  const length = size === null ? undefined : Number(size);
  if (length !== undefined && (!Number.isSafeInteger(length) || length <= 0)) throw new Error('Invalid MP4 length');
  if (status === 206) {
    const range = /^bytes 0-(\d+)\/(\d+)$/i.exec(headers.get('content-range') || '');
    const total = Number(range?.[2]);
    if (!range || !Number.isSafeInteger(total) || Number(range[1]) + 1 !== total || (length !== undefined && length !== total)) {
      throw new Error('Incomplete MP4 response');
    }
    return total;
  }
  return length;
}

function isMp4(headers: Headers) {
  const type = headers.get('content-type')?.split(';')[0].toLowerCase();
  return type === 'video/mp4' || type === 'application/octet-stream';
}

async function fetchVideo(url: URL, output: string, referer: string, allowed: (value: string) => URL | null) {
  const signal = AbortSignal.timeout(120_000);
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = await fetch(url, {redirect: 'manual', signal, headers: {referer}});
    const location = result.headers.get('location');
    if (result.status >= 300 && result.status < 400 && location) {
      await result.body?.cancel();
      const next = allowed(new URL(location, url).href);
      if (!next) break;
      url = next;
      continue;
    }
    if (!result.ok || !result.body || !isMp4(result.headers)) {
      await result.body?.cancel();
      break;
    }
    const body = Readable.fromWeb(result.body as Parameters<typeof Readable.fromWeb>[0]);
    try { await writeChannelVideo(body, output, completeVideoLength(result.status, result.headers), signal); }
    finally { body.destroy(); }
    return;
  }
  throw new AppError(downloadError, 502);
}

async function downloadFromSsstik(tiktokUrl: string, output: string) {
  const browser = await openBrowser();
  try {
    const context = await browser.newContext({locale: 'pt-BR', serviceWorkers: 'block'});
    await context.route('**/*', route => serviceUrl(route.request().url()) ? route.continue() : route.abort());
    const page = await context.newPage();
    const response = await page.goto(ssstikPage, {waitUntil: 'domcontentloaded', timeout: 15_000});
    if (!response?.ok()) throw new Error('SSSTik indisponível');
    const form = page.locator('form').filter({has: page.locator('input[name="id"]')});
    await form.locator('input[name="id"]').fill(tiktokUrl, {timeout: 8_000});
    const submitted = page.waitForResponse(reply =>
      reply.request().method() === 'POST' && serviceUrl(reply.url()) !== null,
    {timeout: 16_000});
    void submitted.catch(() => {});
    await form.locator('button[type="submit"]').click({timeout: 8_000});
    const reply = await submitted;
    if (!reply.ok() || (await reply.text()).includes('/images/rickrolled.gif')) throw new Error('SSSTik returned no video');
    const links = page.locator('#target a[href]');
    await Promise.race([
      links.first().waitFor({state: 'attached', timeout: 20_000}),
      page.locator('#errorContainer').filter({hasText: /\S/}).waitFor({state: 'visible', timeout: 20_000}),
    ]);
    const choices = await links.evaluateAll(nodes => nodes.map(node => ({
      href: (node as HTMLAnchorElement).href,
      label: node.textContent?.trim() ?? '',
    })));
    const selected = identifiedDownload(choices);
    if (!selected) throw new Error('MP4 identificado indisponível');
    await fetchVideo(selected, output, ssstikPage, value => serviceUrl(value, true));
  } finally {
    await browser.close().catch(() => {});
  }
}

async function downloadFromPublicPlayer(id: string, output: string) {
  const browser = await openBrowser();
  const hosts = ['tiktok.com', 'tiktokv.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'ttwstatic.com', 'byteoversea.com', 'ibytedtos.com'];
  try {
    const context = await browser.newContext({locale: 'en-US', serviceWorkers: 'block'});
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.protocol === 'https:' && hosts.some(host => url.hostname === host || url.hostname.endsWith('.' + host))
        ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const media = page.waitForEvent('requestfinished', {timeout: 45_000, predicate: async request => {
      if (request.resourceType() !== 'media' || !tiktokMediaUrl(request.url())) return false;
      const reply = await request.response();
      if (!reply?.ok()) return false;
      const headers = new Headers(reply.headers());
      try { return isMp4(headers) && Boolean(completeVideoLength(reply.status(), headers)); }
      catch { return false; }
    }});
    void media.catch(() => {});
    const opened = await page.goto('https://www.tiktok.com/player/v1/' + id, {waitUntil: 'domcontentloaded', timeout: 12_000});
    if (!opened?.ok()) throw new Error('TikTok player unavailable');
    await page.getByRole('button', {name: 'Play', exact: true}).first().click({timeout: 8_000});
    const reply = (await (await media).response())!;
    const length = completeVideoLength(reply.status(), new Headers(reply.headers()))!;
    if (length > Math.min(maxChannelVideoBytes, await availableCutBytes(dirname(output)))) {
      throw new AppError('O MP4 excede o limite de 512 MB ou o espaço livre disponível.', 413);
    }
    // The public player can serve the complete media to its own navigation context only.
    await writeChannelVideo(Readable.from(await reply.body()), output, length);
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function downloadChannelVideo(tiktokUrl: string, output: string) {
  async function attempt(download: () => Promise<void>) {
    try {
      await download();
      return await validateVideo(output, 'any', Infinity);
    } catch (error) {
      await rm(output, {force: true});
      if (error instanceof AppError && error.status === 413) throw error;
      return null;
    }
  }
  const ssstik = await attempt(() => downloadFromSsstik(tiktokUrl, output));
  if (ssstik) return ssstik;

  const id = tiktokSourceKey(await resolveTikTokVideo(tiktokUrl));
  if (/^\d{15,25}$/.test(id)) {
    for await (const link of creativeVideoUrls(id)) {
      const creative = await attempt(() => fetchVideo(link, output, 'https://ads.tiktok.com/', tiktokMediaUrl));
      if (creative) return creative;
    }
    for (let retry = 0; retry < 2; retry++) {
      const player = await attempt(() => downloadFromPublicPlayer(id, output));
      if (player) return player;
    }
  }
  throw new AppError(downloadError, 502);
}
