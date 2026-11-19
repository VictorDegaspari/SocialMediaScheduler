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
await page.route('**/api/**', async route => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  if (path === '/api/state') return route.fulfill({json: state});
  if (path === '/api/youtube-channels' && request.method() === 'GET') return route.fulfill({json: channels});
  assert.equal(request.headers()['x-watcher-request'], '1');
  const body = request.postDataJSON();
  requests.push({method: request.method(), path, body});
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
  await page.getByRole('link', {name: 'Canais do YouTube', exact: true}).click();
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
  console.log('Canais do YouTube: cadastro, atualização, erro recuperável, corte explícito, remoção e layout móvel validados.');
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
