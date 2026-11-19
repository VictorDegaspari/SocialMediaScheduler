import assert from 'node:assert/strict';
import {test} from 'node:test';

process.env.ENCRYPTION_KEY ||= '00'.repeat(32);
const {AppError} = await import('../src/config.js');
const {lookupYoutubeChannel, youtubeChannelUrl} = await import('../src/youtube-channel-lookup.js');

const id = 'UCabcdefghijklmnopqrstuv';
const channel = 'https://www.youtube.com/channel/' + id;
const entry = (id: string, fields: Record<string, unknown> = {}) => ({
  id, title: 'Vídeo ' + id, url: 'https://www.youtube.com/watch?v=' + id, ...fields,
});

test('normaliza @, links de canal e IDs sem aceitar URLs de vídeos ou outros hosts', () => {
  for (const reference of ['@canal', 'canal', 'youtube.com/@canal', 'https://m.youtube.com/@canal/shorts?x=1']) {
    assert.equal(youtubeChannelUrl(reference), 'https://www.youtube.com/@canal');
  }
  assert.equal(youtubeChannelUrl('@canalSãoPaulo'), 'https://www.youtube.com/@canalS%C3%A3oPaulo');
  assert.equal(youtubeChannelUrl(id), channel);
  assert.equal(youtubeChannelUrl(channel + '/videos/'), channel);
  assert.equal(youtubeChannelUrl('https://youtube.com/user/Canal'), 'https://www.youtube.com/user/Canal');
  for (const value of ['https://youtube.com.evil.test/@canal', 'https://youtube.com@evil.test/@canal',
    'https://www.youtube.com/watch?v=GHIJKLmn_45', 'https://youtu.be/GHIJKLmn_45', '--force', 'https://youtube.com/@canal%2Fvideos']) {
    assert.throws(() => youtubeChannelUrl(value), AppError);
  }
});

test('seleciona até três vídeos públicos distintos da aba Vídeos na ordem do YouTube', async () => {
  const video = entry('GHIJKLmn_45', {duration: 38});
  const result = await lookupYoutubeChannel(id, async url => {
    if (url.endsWith('/streams')) throw {stderr: 'This channel does not have a streams tab'};
    assert.equal(url, channel + '/videos');
    return {
      id, channel: 'Meu canal',
      entries: [
        entry('ShortFake12', {url: 'https://www.youtube.com/shorts/ShortFake12'}),
        entry('VideoLive12', {live_status: 'is_live'}),
        entry('VideoSoon12', {live_status: 'is_upcoming'}),
        entry('VideoPriv12', {availability: 'subscriber_only'}),
        video,
        video,
        entry('GHIJKLmn_46', {duration: 600}),
        entry('GHIJKLmn_47'),
        entry('GHIJKLmn_48'),
      ],
    };
  });
  assert.deepEqual(result, {id, name: 'Meu canal', videos: [
    {id: video.id, title: video.title, duration: 38, kind: 'video'},
    {id: 'GHIJKLmn_46', title: 'Vídeo GHIJKLmn_46', duration: 600, kind: 'video'},
    {id: 'GHIJKLmn_47', title: 'Vídeo GHIJKLmn_47', duration: null, kind: 'video'},
  ]});
});

test('combina uploads e lives encerradas por data e exclui lives agendadas, ativas e indisponíveis', async () => {
  const upload = entry('GHIJKLmn_45', {timestamp: 5000});
  const replay = entry('GHIJKLmn_46', {timestamp: 6000, live_status: 'was_live'});
  const olderReplay = entry('GHIJKLmn_47', {timestamp: 4000, live_status: 'was_live'});
  const result = await lookupYoutubeChannel(id, async url => {
    if (url.endsWith('/videos')) {
      return {id, entries: [upload, entry(replay.id, {timestamp: 3000}), entry('GHIJKLmn_48', {timestamp: 2000})]};
    }
    return {id, entries: [
      entry('VideoSoon12', {timestamp: 10000, live_status: 'is_upcoming'}),
      entry('VideoLive12', {timestamp: 9000, live_status: 'is_live'}),
      entry('VideoPost12', {timestamp: 8000, live_status: 'post_live'}),
      entry('VideoPriv12', {timestamp: 7000, live_status: 'was_live', availability: 'subscriber_only'}),
      replay,
      olderReplay,
    ]};
  });
  assert.deepEqual(result.videos.map(video => [video.id, video.kind]), [
    [replay.id, 'live'], [upload.id, 'video'], [olderReplay.id, 'live'],
  ]);
});

test('um canal sem aba Vídeos continua exibindo suas lives encerradas', async () => {
  const replay = entry('GHIJKLmn_46', {live_status: 'was_live'});
  const result = await lookupYoutubeChannel(id, async url => {
    if (url.endsWith('/videos')) throw {stderr: 'This channel does not have a videos tab'};
    assert.match(url, /\/streams$/);
    return {id, channel: 'Canal de lives', entries: [replay]};
  });
  assert.deepEqual(result, {id, name: 'Canal de lives', videos: [
    {id: replay.id, title: replay.title, duration: null, kind: 'live'},
  ]});
});

test('reconhece uma live encerrada também na aba Vídeos', async () => {
  const archived = entry('GHIJKLmn_46', {duration: 18000, timestamp: 6000, live_status: 'was_live'});
  const result = await lookupYoutubeChannel(id, async url => {
    if (url.endsWith('/streams')) throw {stderr: 'This channel does not have a streams tab'};
    return {id, entries: [archived]};
  });
  assert.deepEqual(result.videos, [{id: archived.id, title: archived.title, duration: 18000, kind: 'live'}]);
});

test('canais que só têm Shorts podem ser acompanhados com a lista de vídeos vazia', async () => {
  const seen: string[] = [];
  const result = await lookupYoutubeChannel('@canal', async url => {
    seen.push(url);
    if (url.endsWith('/videos')) throw {stderr: 'This channel does not have a videos tab'};
    if (url.endsWith('/streams')) throw {stderr: 'This channel does not have a streams tab'};
    return {channel_id: id, channel: 'Só Shorts', entries: []};
  });
  assert.deepEqual(seen, ['https://www.youtube.com/@canal/videos', 'https://www.youtube.com/@canal/streams', 'https://www.youtube.com/@canal/about']);
  assert.deepEqual(result, {id, name: 'Só Shorts', videos: []});
});

test('indisponibilidade do YouTube gera erro e não é interpretada como canal vazio', async () => {
  await assert.rejects(lookupYoutubeChannel(id, async () => {throw new Error('private diagnostic');}),
    (error: unknown) => error instanceof AppError && error.status === 502 && !error.message.includes('diagnostic'));
  await assert.rejects(lookupYoutubeChannel(id, async () => {throw {stderr: 'This channel does not exist'};}),
    (error: unknown) => error instanceof AppError && error.status === 404);
});
