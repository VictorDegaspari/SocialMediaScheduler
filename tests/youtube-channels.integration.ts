import assert from 'node:assert/strict';
import {once} from 'node:events';
import {after, test} from 'node:test';
import express from 'express';
import type {AddressInfo} from 'node:net';
import type {YoutubeChannel} from '../src/youtube-channel-lookup.js';

const database = new URL(process.env.DATABASE_URL!);
database.pathname = '/watcher_youtube_channels_test';
process.env.DATABASE_URL = database.toString();
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.ENCRYPTION_KEY ||= '00'.repeat(32);
const {AppError} = await import('../src/config.js');
const {initDb, pool, redis} = await import('../src/db.js');
const {createYoutubeChannelRoutes} = await import('../src/youtube-channels.js');
await initDb();
await pool.query('TRUNCATE followed_youtube_channels');

const id = 'UCabcdefghijklmnopqrstuv';
const first = {id: 'GHIJKLmn_45', title: 'Primeiro vídeo', duration: 360};
const second = {id: 'GHIJKLmn_47', title: 'Segundo vídeo', duration: 720};
let next: YoutubeChannel = {id, name: 'Streamer', videos: [first, second]};
let offline = false;
const app = express();
app.use(express.json());
app.use(createYoutubeChannelRoutes(async () => {
  if (offline) throw new AppError('YouTube indisponível.', 502);
  return next;
}));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(error instanceof AppError ? error.status : 400).json({error: error instanceof Error ? error.message : 'Erro'});
});
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/youtube-channels';
after(async () => {
  server.close();
  await once(server, 'close');
  await pool.end();
  redis.disconnect();
});

const submit = (path: string, body: unknown) => fetch(url + path, {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify(body),
});

test('canais são deduplicados e preservam os vídeos quando uma atualização falha', async () => {
  const added = await submit('', {channel: '@streamer'});
  assert.equal(added.status, 201);
  assert.equal((await added.json()).id, id);
  assert.equal((await submit('', {channel: 'https://www.youtube.com/channel/' + id})).status, 201);
  let saved = await (await fetch(url)).json();
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].video, first);
  assert.deepEqual(saved[0].videos, [first, second]);
  assert.equal(saved[0].needsRefresh, false);

  offline = true;
  assert.equal((await submit('/' + id + '/refresh', {})).status, 502);
  assert.deepEqual(await (await fetch(url)).json(), saved);

  await pool.query('UPDATE followed_youtube_channels SET includes_live_replays = false WHERE channel_id = $1', [id]);
  const [previousFormat] = await (await fetch(url)).json();
  assert.deepEqual(previousFormat.videos, [first, second]);
  assert.equal(previousFormat.needsRefresh, true);

  // Simulate a saved channel from the previous version with an exact timestamp.
  await pool.query(`
    UPDATE followed_youtube_channels SET recent_videos = NULL,
      checked_at = '2026-11-01T20:00:00.100001Z'
    WHERE channel_id = $1`, [id]);
  const [legacy] = await (await fetch(url)).json();
  assert.deepEqual(legacy.videos, [first]);
  assert.equal(legacy.needsRefresh, true);
  offline = false;
  const newer = {id: 'GHIJKLmn_46', title: 'Live encerrada recente', duration: 300, kind: 'live' as const};
  next = {...next, videos: [newer, first, second]};
  const refreshed = await submit('/' + id + '/refresh', {});
  assert.equal(refreshed.status, 200);
  assert.deepEqual((await refreshed.json()).videos, next.videos);
  saved = await (await fetch(url)).json();
  assert.deepEqual(saved[0].videos, next.videos);
  assert.deepEqual(saved[0].video, newer);
  assert.equal(saved[0].needsRefresh, false);

  assert.equal((await fetch(url + '/' + id, {method: 'DELETE'})).status, 200);
  assert.deepEqual(await (await fetch(url)).json(), []);
  assert.equal((await submit('/' + id + '/refresh', {})).status, 404);
});
