import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {once} from 'node:events';
import {copyFile, mkdtemp, readFile, rm} from 'node:fs/promises';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, test} from 'node:test';
import {promisify} from 'node:util';
import express from 'express';

const database = new URL(process.env.DATABASE_URL!);
database.pathname = '/watcher_channel_videos_test';
process.env.DATABASE_URL = database.toString();
process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'watcher-channel-videos-'));
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.ENCRYPTION_KEY ||= '00'.repeat(32);

const {AppError, dataDir} = await import('../src/config.js');
const {initDb, pool, redis} = await import('../src/db.js');
const {channelVideoRoutes, ChannelVideoWorker} = await import('../src/channel-videos.js');
const {creativeVideoUrls, tiktokTrends, resolveTikTokVideo, tiktokVideoUrl} = await import('../src/channel-video-source.js');
const {identifiedDownload} = await import('../src/ssstik-download.js');
const {dubChannelVideo, dubFilename, dubVersion} = await import('../src/channel-dubbing.js');
await initDb();
await pool.query('TRUNCATE channel_videos');

const app = express();
app.use(express.json(), channelVideoRoutes);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(error instanceof AppError ? error.status : 400).json({error: error instanceof Error ? error.message : 'Erro'});
});
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/channel-videos';
after(async () => {
  server.close();
  await once(server, 'close');
  await pool.end();
  redis.disconnect();
  await rm(dataDir, {recursive: true, force: true});
});

const exec = promisify(execFile);
const ffmpeg = (args: string[]) => exec('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', ...args]);
const submit = (path: string, body: unknown = {}) => fetch(base + path, {
  method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
});
const tiktok = 'https://www.tiktok.com/@example/video/7712345678901234567';

test('dubbing prepares spoken Brazilian Portuguese and preserves ambiguous uses', async () => {
  const cases = [
    ['A empresa equipa ambulâncias e ele a equipa com rádio. A equipa está a propor mudanças.',
      'A empresa equipa ambulâncias e ele a equipa com rádio. A equipe está propondo mudanças.'],
    ['A carta de condução está no ecrã. O camião pagou a portagem.',
      'A carteira de motorista está na tela. O caminhão pagou o pedágio.'],
    ['O ecrã branco está ligado. O adesivo começou a descolar. Ela está a caminho.',
      'O ecrã branco está ligado. O adesivo começou a descolar. Ela está a caminho.'],
    ['Paguei R$ 1.250,50 no dia 15/03/2024 às 15h30.',
      'Paguei mil duzentos e cinquenta reais e cinquenta centavos no dia quinze de março de dois mil e vinte e quatro às quinze horas e trinta minutos.'],
    ['O Dr. Silva afirmou que 2 pessoas perderam 0,5% em 30 kg.',
      'O Doutor Silva afirmou que duas pessoas perderam zero vírgula cinco por cento em trinta quilogramas.'],
    ['A IA encontrou o DNA e o CPF. A ONU falou com a UTI.',
      'A i á encontrou o dê éne á e o cê pê éfe. A ONU falou com a u tê i.'],
  ];
  const {stdout} = await exec(process.env.CUTS_PYTHON || 'python3', ['-B', '-c', `
import json, sys
sys.path.insert(0, "scripts")
from dub_portuguese import spoken_portuguese
print(json.dumps([spoken_portuguese(text) for text in json.loads(sys.argv[1])]))
  `, JSON.stringify(cases.map(([input]) => input))], {timeout: 15_000});
  assert.deepEqual(JSON.parse(stdout), cases.map(([, expected]) => expected));
});

test('ranking uses the country endpoint, public limit and full TikTok video links', async () => {
  const urls: URL[] = [];
  const fakeFetch: typeof fetch = async input => {
    const url = new URL(String(input));
    urls.push(url);
    const info = {
      itemInfo: {itemID: '7712345678901234567', title: 'Teste'},
      itemAuthorInfo: {handlerName: 'example'}, itemMetrics: {videoViews: '1000000'},
    };
    const body = JSON.stringify({BaseResp: {StatusCode: 0}, lastDailyEndTimestamp: 1795651200, entityInfos: [info, info]});
    return new Response(body.replaceAll('"7712345678901234567"', '7712345678901234567'));
  };
  assert.deepEqual(await tiktokTrends({market: 'US', days: '30'}, fakeFetch), [{url: tiktok, title: 'Teste', views: 1000000}]);
  assert.equal(urls[0].hostname, 'ads.us.tiktok.com');
  assert.equal(urls[1].searchParams.get('periodDimension'), '5');
  assert.equal(urls[1].searchParams.get('countryCode'), 'US');
  assert.equal(urls[1].searchParams.get('limit'), '4');
  assert.equal(await resolveTikTokVideo('https://vm.tiktok.com/Z123/', async () =>
    new Response(null, {status: 302, headers: {location: tiktok + '?share=1'}})), tiktok);
  assert.throws(() => tiktokVideoUrl('https://tiktok.com.evil.test/@example/video/7712345678901234567'));
});

test('SSSTik selection keeps identification and prefers HD, ignoring advertising and MP3', () => {
  assert.equal(identifiedDownload([
    {label: 'Baixar sem marca d’água HD', href: 'https://ssstik.io/sem.mp4'},
    {label: 'Baixar original', href: 'https://random.example/orig.mp4'},
    {label: 'Baixar com marca d’água', href: 'https://ssstik.io/standard.mp4'},
    {label: 'Baixar com marca d’água HD', href: 'https://ssstik.io/hd.mp4'},
    {label: 'Baixar original MP3', href: 'https://ssstik.io/audio.mp3'},
  ])?.pathname, '/hd.mp4');
  assert.equal(identifiedDownload([{label: 'Without watermark HD', href: 'https://ssstik.io/sem.mp4'}]), null);
});

test('Creative Center recovery accepts the requested public video and only official media hosts', async () => {
  const id = '7712345678901234567';
  const media = 'https://v16m-default.tiktokcdn-us.com/video/a/';
  let other = {itemID: id, videoURL: 'https://tiktokcdn-us.com.example.com/video/a/'};
  const periods: string[] = [];
  const request: typeof fetch = async input => {
    const url = new URL(String(input));
    const BaseResp = {StatusCode: 0};
    if (url.pathname.endsWith('GetTopContentsOverview')) return Response.json({BaseResp, lastDailyEndTimestamp: 1795651200});
    assert.equal(url.searchParams.get('itemID'), id);
    const period = url.searchParams.get('periodDimension')!;
    periods.push(period);
    if (url.hostname === 'ads.us.tiktok.com' && period === '3') return Response.json({BaseResp: {StatusCode: 38001001}});
    const itemInfo = url.hostname === 'ads.us.tiktok.com' ? {itemID: id, videoURL: media} : other;
    const body = JSON.stringify({BaseResp, entityInfo: {itemInfo}}).replaceAll('"' + id + '"', id);
    return new Response(body);
  };
  assert.deepEqual(await Array.fromAsync(creativeVideoUrls(id, request), url => url.href), [media]);
  assert.deepEqual(periods, ['3', '5', '3', '5']);
  other = {itemID: '7712345678901234568', videoURL: 'https://v16m.tiktokcdn.com/video/other/'};
  assert.deepEqual(await Array.fromAsync(creativeVideoUrls(id, request), url => url.href), [media]);
});

test('persisted queue deduplicates a source and retakes interrupted work or imports a verified MP4', async () => {
  const source = join(dataDir, 'fixture.mp4');
  await ffmpeg(['-f', 'lavfi', '-i', 'color=blue:s=96x54:r=30',
    '-f', 'lavfi', '-i', 'sine=frequency=330', '-t', '4', '-c:v', 'libx264', '-c:a', 'aac', source]);
  const waveform = join(dataDir, 'voice.wav');
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=1.6', waveform]);
  const bytes = await readFile(source);
  let transcriptions = 0, syntheses = 0;
  const worker = new ChannelVideoWorker({
    download: async (url, output) => {
      if (url === tiktok) throw new AppError('SSSTik indisponível.', 502);
      await copyFile(source, output);
    },
    dub: (folder, duration, voice) => dubChannelVideo(folder, duration, voice, {
      transcribe: async () => {
        transcriptions++;
        return {language: 'en', cues: [{start: 1.5, end: 1.9, text: 'Hello'}, {start: 1.95, end: 2.15, text: 'World.'}]};
      },
      synthesize: async (work, language, phrases, profile) => {
        assert.equal(language, 'en');
        assert.equal(profile, syntheses < 2 ? 'pm_alex' : 'pm_santa');
        assert.deepEqual(phrases.map(phrase => phrase.text), ['Hello World.']);
        assert.ok(phrases[0].end - phrases[0].earliest >= 1.6, 'nearby silence gives the translated phrase room to breathe');
        if (++syntheses === 1) throw new AppError('Modelos indisponíveis.', 502);
        await copyFile(waveform, join(work, '0.wav'));
        return [1.6];
      },
    }),
  });
  const id = (await (await submit('', {url: tiktok})).json()).id;
  const duplicate = await submit('', {url: tiktok.replace('@example', '@renamed') + '?share=1', title: 'Vídeo salvo'});
  assert.equal((await duplicate.json()).id, id);
  await Promise.all([worker.processNext(), worker.processNext()]);
  let {items} = await (await fetch(base)).json();
  assert.equal(items[0].status, 'download_failed');
  assert.equal(items[0].title, 'Vídeo salvo');
  assert.equal((await submit('/' + id + '/dub')).status, 409);
  assert.equal((await submit('/' + id + '/retry')).status, 202);
  await worker.processNext();
  const upload = (body: Buffer | string) => fetch(base + '/' + id + '/source', {
    method: 'POST', headers: {'Content-Type': 'video/mp4'}, body: typeof body === 'string' ? body : new Uint8Array(body),
  });
  assert.equal((await upload('not a video')).status, 400);
  assert.equal((await upload(bytes)).status, 200);
  assert.equal((await upload(bytes)).status, 409);
  const original = await fetch(base + '/' + id + '/media/original?download=1');
  assert.match(original.headers.get('content-disposition')!, /attachment/);
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), bytes);
  const folder = join(dataDir, 'channel-videos', id);
  await copyFile(source, join(folder, dubFilename(1)));
  await copyFile(source, join(folder, dubFilename(2, 'pm_alex')));
  await pool.query("UPDATE channel_videos SET status='dubbed',dub_version=2,dub_voice='pm_alex' WHERE id=$1", [id]);
  assert.equal((await submit('/' + id + '/dub', {voice: '../../outra'})).status, 400);
  const queued = await submit('/' + id + '/dub', {voice: 'pm_alex'});
  assert.equal(queued.status, 202);
  assert.equal((await queued.json()).requestedDubVoice, 'pm_alex');
  assert.equal((await submit('/' + id + '/dub', {voice: 'pm_santa'})).status, 409);
  await worker.processNext();
  ({items} = await (await fetch(base)).json());
  assert.equal(items[0].status, 'dub_failed');
  assert.equal(items[0].dubVersion, 2);
  assert.equal(items[0].dubVoice, 'pm_alex');
  assert.equal(items[0].requestedDubVoice, 'pm_alex');
  const previousDub = await fetch(base + '/' + id + '/media/pt-br');
  assert.deepEqual(Buffer.from(await previousDub.arrayBuffer()), bytes);
  const legacyDub = await fetch(base + '/' + id + '/media/pt-br?v=1');
  assert.deepEqual(Buffer.from(await legacyDub.arrayBuffer()), bytes);
  assert.equal((await submit('/' + id + '/dub')).status, 202);
  await pool.query("UPDATE channel_videos SET status='dubbing' WHERE id=$1", [id]);
  await worker.processNext();
  ({items} = await (await fetch(base)).json());
  assert.equal(items[0].status, 'dubbed');
  assert.equal(items[0].dubVersion, dubVersion);
  assert.equal(items[0].dubVoice, 'pm_alex');
  assert.equal(items[0].requestedDubVoice, null);
  assert.equal((await (await submit('/' + id + '/dub')).json()).status, 'dubbed');
  assert.deepEqual({transcriptions, syntheses}, {transcriptions: 1, syntheses: 2});
  const dubbed = join(folder, dubFilename(dubVersion, 'pm_alex'));
  const packets = async (file: string) => (await exec('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=data_hash',
    '-show_data_hash', 'sha256', '-of', 'csv=p=0', file,
  ])).stdout;
  assert.equal(await packets(dubbed), await packets(source), 'video stream is copied without re-encoding');
  const peak = async (start: string) => {
    const {stdout} = await exec('ffmpeg', [
      '-nostdin', '-loglevel', 'error', '-ss', start, '-i', dubbed, '-t', '0.15', '-vn', '-f', 's16le', '-',
    ], {encoding: 'buffer'});
    let largest = 0;
    for (let index = 0; index + 1 < stdout.length; index += 2) largest = Math.max(largest, Math.abs(stdout.readInt16LE(index)));
    return largest;
  };
  assert.ok(await peak('0.25') < 20, 'original audio is absent');
  assert.ok(await peak('1.65') > 1000, 'dubbing starts at the source speech timestamp');
  assert.ok(await peak('2.68') > 1000, 'the translated phrase uses nearby silence to avoid excessive acceleration');
  assert.ok(await peak('3.15') < 20, 'dubbing fits the expanded speech window');
  const preview = await fetch(base + '/' + id + '/media/pt-br', {headers: {Range: 'bytes=0-31'}});
  assert.equal(preview.status, 206);
  assert.equal((await preview.arrayBuffer()).byteLength, 32);

  assert.equal((await (await submit('/' + id + '/dub', {voice: 'pm_santa'})).json()).status, 'dub_queued');
  const whileQueued = await fetch(base + '/' + id + '/media/pt-br', {headers: {Range: 'bytes=0-31'}});
  assert.equal(whileQueued.status, 206);
  await whileQueued.arrayBuffer();
  await worker.processNext();
  const library = await (await fetch(base)).json();
  assert.deepEqual(library.dubVoices.map((voice: {id: string}) => voice.id), ['pf_dora', 'pm_alex', 'pm_santa']);
  assert.equal(library.items[0].dubVoice, 'pm_santa');
  const namedPreview = await fetch(base + '/' + id + '/media/pt-br?v=' + dubVersion + '&voice=pm_alex&download=1');
  assert.match(namedPreview.headers.get('content-disposition')!, /pt-br-pm_alex\.mp4/);
  assert.equal(namedPreview.status, 200);
  await namedPreview.arrayBuffer();
  await submit('/' + id + '/dub', {voice: 'pm_alex'});
  await worker.processNext();
  assert.equal((await (await fetch(base)).json()).items[0].dubVoice, 'pm_alex');
  assert.equal(syntheses, 3, 'a completed voice can be selected again without synthesizing it');

  const next = (await (await submit('', {url: tiktok.replace(/7$/, '8')})).json()).id;
  await pool.query("UPDATE channel_videos SET status='downloading' WHERE id=$1", [next]);
  await worker.processNext();
  const firstPage = await (await fetch(base + '?limit=1')).json();
  assert.equal(firstPage.items[0].status, 'ready');
  assert.equal(firstPage.items[0].id, next);
  const secondPage = await (await fetch(base + '?limit=1&cursor=' + firstPage.pagination.nextCursor)).json();
  assert.equal(secondPage.items[0].id, id);
});
