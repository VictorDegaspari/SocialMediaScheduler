import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname, resolve} from 'node:path';
import {chromium} from 'playwright-core';

const root = resolve('public');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml'};
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    assert(file.startsWith(root + '/'));
    response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = 'http://127.0.0.1:' + server.address().port;
const id = 'UCabcdefghijklmnopqrstuv';
const emptyId = 'UCabcdefghijklmnopqrstuw';
const channels = [];
const savedTiktoks = [];
const trend = {url: 'https://www.tiktok.com/@example/video/7712345678901234567', title: 'Viral de teste', views: 1000000};
const tiktokId = 'b04fa0f0-96a4-4fc5-a402-9dba0a51b3d2';
const requests = [];
const errors = [];
const state = {
  watches: [], videos: [], events: [], stats: {},
  scheduler: {paused: false, queue: {}}, publishing: {actions: []},
  cuts: {jobs: [], channels: [], dependencies: {ready: true, details: []}},
};
const video = {id: 'GHIJKLmn_45', title: 'Primeiro vídeo completo', duration: 360};
const newerVideo = {id: 'GHIJKLmn_46', title: 'Live longa encerrada', duration: 18000, kind: 'live'};
const olderVideos = [
  {id: 'GHIJKLmn_47', title: 'Live recente encerrada', duration: 720, kind: 'live'},
  {id: 'GHIJKLmn_48', title: 'Gravação longa listada como vídeo', duration: 18900, kind: 'video'},
];
const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox']});
const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
page.setDefaultTimeout(10_000);
page.on('pageerror', error => errors.push(error.message));
let failRefresh = true;
let releaseTrends, releaseDub;
const trendsReady = new Promise(resolve => { releaseTrends = resolve; });
const dubReady = new Promise(resolve => { releaseDub = resolve; });
await page.route('**/api/**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  if (path === '/api/state') return route.fulfill({json: state});
  if (path === '/api/youtube-channels' && request.method() === 'GET') return route.fulfill({json: channels});
  if (path === '/api/channel-videos' && request.method() === 'GET') {
    assert.equal(url.searchParams.get('limit'), '6');
    return route.fulfill({json: {items: savedTiktoks, pagination: {hasMore: false}, maxDubSeconds: 300, dubVersion: 3,
      defaultDubVoice: 'pf_dora', dubVoices: [
        {id: 'pf_dora', label: 'Dora (feminina)'}, {id: 'pm_alex', label: 'Alex (masculina)'}, {id: 'pm_santa', label: 'Santa (masculina)'},
      ],
    }});
  }
  if (path === '/api/channel-videos/trends') {
    assert.equal(url.searchParams.get('market'), 'JP');
    assert.equal(url.searchParams.get('days'), '30');
    await trendsReady;
    return route.fulfill({json: [trend]});
  }
  if (path === '/api/channel-videos/' + tiktokId + '/media/pt-br') {
    return route.fulfill({status: 200, contentType: 'video/mp4', body: ''});
  }
  assert.equal(request.headers()['x-watcher-request'], '1');
  if (path === '/api/channel-videos/' + tiktokId + '/source') {
    assert.equal(request.headers()['content-type'], 'video/mp4');
    assert.equal(request.postDataBuffer().toString(), 'MP4 sintético');
    Object.assign(savedTiktoks[0], {status: 'ready', duration: 18, error: null});
    return route.fulfill({json: savedTiktoks[0]});
  }
  const body = request.postDataJSON();
  requests.push({method: request.method(), path, body});
  if (path === '/api/channel-videos') {
    assert.deepEqual(body, {url: trend.url, title: trend.title});
    const saved = {id: tiktokId, ...body, status: 'download_failed', duration: null, error: 'SSSTik indisponível.',
      dubVersion: null, dubVoice: null, requestedDubVoice: null};
    savedTiktoks.push(saved);
    return route.fulfill({status: 202, json: saved});
  }
  if (path === '/api/channel-videos/' + tiktokId + '/dub') {
    await dubReady;
    Object.assign(savedTiktoks[0], {status: 'dub_queued', requestedDubVoice: body.voice});
    return route.fulfill({status: 202, json: savedTiktoks[0]});
  }
  if (path === '/api/youtube-channels') {
    const followed = body.channel === '@somenteshorts'
      ? {id: emptyId, name: 'Somente Shorts', videos: []}
      : {id, name: 'Streamer QA', videos: [video, ...olderVideos]};
    const saved = {...followed, checkedAt: new Date().toISOString(), needsRefresh: false};
    const index = channels.findIndex(channel => channel.id === saved.id);
    if (index < 0) channels.push(saved);
    else channels[index] = saved;
    return route.fulfill({status: 201, json: saved});
  }
  if (path === '/api/youtube-channels/' + id + '/refresh' && failRefresh) {
    return route.fulfill({status: 502, json: {error: 'YouTube temporariamente indisponível.'}});
  }
  if (path.endsWith('/refresh')) {
    const saved = channels.find(channel => path.includes(channel.id));
    if (saved.id === id) saved.videos = [newerVideo, ...saved.videos].slice(0, 3);
    saved.checkedAt = new Date().toISOString();
    saved.needsRefresh = false;
    return route.fulfill({json: saved});
  }
  if (path === '/api/youtube-channels/' + emptyId && request.method() === 'DELETE') {
    channels.splice(channels.findIndex(channel => channel.id === emptyId), 1);
    return route.fulfill({json: {ok: true}});
  }
  if (path === '/api/cuts/replay-windows') return route.fulfill({json: {status: 'available', ranges: [{start: 7800, end: 9600}]}});
  if (path === '/api/cuts') return route.fulfill({status: 202, json: {id: 'cut-job', status: 'queued'}});
  throw new Error('Requisição inesperada: ' + path);
});

try {
  await page.goto(base + '/#cuts');
  await page.getByRole('link', {name: 'Canais', exact: true}).click();
  await page.getByRole('heading', {name: 'Canais', exact: true, level: 1}).waitFor();
  const views = page.getByRole('group', {name: 'Seções de canais'});
  const youtubeView = views.getByRole('button', {name: 'YouTube', exact: true});
  const libraryView = views.getByRole('button', {name: 'Vídeos salvos', exact: true});
  assert.equal(await page.getByLabel('Link de vídeo público do TikTok').isVisible(), true);
  assert.equal(await page.getByRole('heading', {name: 'Canais do YouTube'}).isVisible(), false);
  await page.getByLabel('País', {exact: true}).selectOption('JP');
  await page.getByLabel('Período', {exact: true}).selectOption('30');
  await page.getByRole('button', {name: 'Buscar vídeos virais'}).click();
  await page.getByText('Consultando o ranking público do TikTok…', {exact: true}).waitFor();
  releaseTrends();
  await page.getByText('1.000.000 visualizações no período').waitFor();
  await page.getByRole('button', {name: 'Baixar vídeo', exact: true}).click();
  await page.getByText('SSSTik indisponível.').waitFor();
  assert.equal(await libraryView.getAttribute('aria-pressed'), 'true');
  await page.getByLabel('Importar MP4 original').setInputFiles({
    name: 'original.mp4', mimeType: 'video/mp4', buffer: Buffer.from('MP4 sintético'),
  });
  await page.getByRole('link', {name: 'Baixar original'}).waitFor();
  const voice = page.getByRole('combobox', {name: 'Voz da dublagem'});
  assert.equal(await voice.inputValue(), 'pf_dora');
  await voice.selectOption({label: 'Alex (masculina)'});
  await page.getByRole('button', {name: 'Dublar em pt-BR'}).click();
  await page.getByText('Enfileirando dublagem…', {exact: true}).waitFor();
  releaseDub();
  await page.getByText('Dublagem na fila', {exact: true}).waitFor();
  assert.equal(await voice.isDisabled(), true);
  assert.equal(savedTiktoks[0].requestedDubVoice, 'pm_alex');
  Object.assign(savedTiktoks[0], {status: 'dubbed', dubVersion: 3, dubVoice: 'pm_alex', requestedDubVoice: null});
  await page.getByRole('link', {name: 'Baixar dublado'}).waitFor();
  await page.getByRole('button', {name: 'Ouvir dublagem'}).click();
  const preview = page.locator('video[aria-label="Prévia do vídeo dublado"]');
  assert.match(await preview.getAttribute('src'), /\/media\/pt-br\?v=3&voice=pm_alex$/);
  assert.equal(await page.getByRole('button', {name: 'Refazer dublagem'}).count(), 0);
  await voice.selectOption({label: 'Santa (masculina)'});
  await page.getByRole('button', {name: 'Refazer dublagem'}).click();
  await page.getByText('Dublagem na fila', {exact: true}).waitFor();
  assert.match(await preview.getAttribute('src'), /\/media\/pt-br\?v=3&voice=pm_alex$/);
  assert.equal(savedTiktoks[0].requestedDubVoice, 'pm_santa');
  Object.assign(savedTiktoks[0], {status: 'dubbed', dubVoice: 'pm_santa', requestedDubVoice: null});
  await page.waitForFunction(() => document.querySelector('.channel-tiktok-preview video')?.getAttribute('src')?.endsWith('&voice=pm_santa'));
  assert.equal(await page.getByRole('button', {name: 'Refazer dublagem'}).count(), 0);
  await page.setViewportSize({width: 320, height: 844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({width: 1440, height: 1000});
  await youtubeView.click();
  assert.equal(await page.locator('video[aria-label="Prévia do vídeo dublado"]').count(), 0);
  await page.getByText('Nenhum canal acompanhado.', {exact: true}).waitFor();
  const channelInput = page.getByLabel('Canal do YouTube', {exact: true});
  const add = page.getByRole('button', {name: 'Acompanhar canal', exact: true});
  await channelInput.fill('@streamer');
  await add.click();
  const channel = page.locator('.youtube-channel-card').filter({has: page.getByRole('heading', {name: 'Streamer QA', exact: true})});
  const shortsOnly = page.locator('.youtube-channel-card').filter({has: page.getByRole('heading', {name: 'Somente Shorts', exact: true})});
  await channel.waitFor();
  assert.equal(await page.getByRole('link', {name: video.title, exact: true}).isVisible(), false);
  assert.equal(await page.getByRole('button', {name: 'Gerar corte', exact: true}).count(), 0);
  await channel.locator('summary').click();
  await page.getByRole('link', {name: video.title, exact: true}).waitFor();
  assert.deepEqual(await channel.locator('.youtube-video-row a[target="_blank"]').allTextContents(), [video, ...olderVideos].map(item => item.title));
  assert.deepEqual(requests.at(-1).body, {channel: '@streamer'});
  await channelInput.fill('@somenteshorts');
  await add.click();
  await shortsOnly.locator('summary').click();
  await shortsOnly.getByText('Nenhum vídeo ou live encerrada disponível.', {exact: true}).waitFor();
  assert.equal(await page.getByRole('button', {name: 'Gerar corte', exact: true}).count(), 1);
  assert.equal(await page.getByRole('button', {name: 'Escolher trecho', exact: true}).count(), 2);
  const recording = olderVideos[1];
  const longVideoRow = channel.locator('.youtube-video-row').filter({hasText: recording.title});
  await longVideoRow.getByRole('button', {name: 'Escolher trecho', exact: true}).click();
  const recordingPicker = page.getByRole('dialog', {name: 'Escolher trecho do vídeo', exact: true});
  await recordingPicker.getByLabel('Começo do trecho').fill('03:50:00');
  await recordingPicker.getByLabel('Fim do trecho').fill('04:20:00');
  await recordingPicker.getByRole('button', {name: 'Gerar cortes do trecho', exact: true}).click();
  await recordingPicker.waitFor({state: 'detached'});
  const recordingRequest = {method: 'POST', path: '/api/cuts', body: {
    url: 'https://www.youtube.com/watch?v=' + recording.id, sourceRange: {start: 13800, end: 15600},
  }};
  assert.deepEqual(requests.filter(request => request.path === '/api/cuts'), [recordingRequest]);
  channels[0].needsRefresh = true;
  await page.reload();
  await youtubeView.click();
  await page.getByText('YouTube temporariamente indisponível.', {exact: true}).waitFor();
  assert.equal(await page.locator('.youtube-channel-details[open]').count(), 0);
  await channel.locator('summary').click();
  await page.getByRole('link', {name: video.title, exact: true}).waitFor();
  assert.equal(await page.locator('.youtube-channel-card').count(), 2);

  const refresh = page.getByRole('button', {name: 'Atualizar vídeos', exact: true});
  failRefresh = false;
  await refresh.click();
  await page.getByRole('link', {name: newerVideo.title, exact: true}).waitFor();
  assert.deepEqual(await channel.locator('.youtube-video-row a[target="_blank"]').allTextContents(), [newerVideo.title, video.title, olderVideos[0].title]);
  assert.equal(await channel.getByText('Live encerrada', {exact: true}).count(), 2);
  const longLive = channel.locator('.youtube-video-row').filter({has: page.getByRole('link', {name: newerVideo.title, exact: true})});
  await longLive.getByRole('button', {name: 'Escolher trecho', exact: true}).click();
  const picker = page.getByRole('dialog', {name: 'Escolher trecho da live', exact: true});
  const start = picker.getByLabel('Começo do trecho');
  const end = picker.getByLabel('Fim do trecho');
  const submit = picker.getByRole('button', {name: 'Gerar cortes do trecho', exact: true});
  assert.equal(await end.inputValue(), '00:30:00');
  await start.fill('02:10:00');
  await end.fill('02:41:00');
  await submit.click();
  assert.match(await picker.getByRole('alert').textContent(), /30 minutos/);
  assert.deepEqual(requests.filter(request => request.path === '/api/cuts'), [recordingRequest]);
  await picker.getByRole('button', {name: 'Buscar momentos mais revistos', exact: true}).click();
  await picker.getByRole('button', {name: '02:10:00 a 02:40:00', exact: true}).click();
  assert.equal(await start.inputValue(), '02:10:00');
  assert.equal(await end.inputValue(), '02:40:00');
  await submit.click();
  await picker.waitFor({state: 'detached'});
  await longLive.getByRole('link', {name: 'Ver projeto na fila', exact: true}).waitFor();
  assert.deepEqual(requests.filter(request => request.path === '/api/cuts'), [recordingRequest, {
    method: 'POST', path: '/api/cuts', body: {url: 'https://www.youtube.com/watch?v=' + newerVideo.id, sourceRange: {start: 7800, end: 9600}},
  }]);
  await page.getByRole('button', {name: 'Deixar de acompanhar Somente Shorts', exact: true}).click();
  await page.getByRole('heading', {name: 'Somente Shorts', exact: true}).waitFor({state: 'detached'});
  await page.setViewportSize({width: 320, height: 844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole('link', {name: 'Ver projeto na fila', exact: true}).click();
  await page.getByRole('heading', {name: 'Gerador de cortes', exact: true}).waitFor();
  assert.deepEqual(errors, []);
  console.log('Canais com tendências do TikTok, importação e dublagem, além dos fluxos do YouTube e layout móvel.');
} finally {
  releaseTrends();
  releaseDub();
  await browser.close();
  await new Promise(done => server.close(done));
}
