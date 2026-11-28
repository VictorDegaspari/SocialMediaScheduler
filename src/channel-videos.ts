import {randomUUID} from 'node:crypto';
import {mkdir, rename, rm, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {Router} from 'express';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import {AppError, dataDir, logger} from './config.js';
import {pool} from './db.js';
import {validateVideo} from './media.js';
import {cursorFields, keysetClause, pageLimit, paginateRows, parsePagination} from './pagination.js';
import {resolveTikTokVideo, tiktokSourceKey, tiktokTrendQuery, tiktokTrends} from './channel-video-source.js';
import {downloadChannelVideo, writeChannelVideo} from './ssstik-download.js';
import {defaultDubVoice, dubChannelVideo, dubFilename, dubVersion, dubVoices, maxDubSeconds, type DubVoice} from './channel-dubbing.js';

export type ChannelVideoStatus = 'download_queued' | 'downloading' | 'download_failed' | 'ready' |
  'dub_queued' | 'dubbing' | 'dub_failed' | 'dubbed';
export type SavedChannelVideo = {
  id: string; url: string; title: string | null; status: ChannelVideoStatus;
  duration: number | null; error: string | null; dubVersion: number | null;
  dubVoice: DubVoice | null; requestedDubVoice: DubVoice | null;
};
const fields = 'id,url,title,status,duration,error,dub_version AS "dubVersion",dub_voice AS "dubVoice",requested_dub_voice AS "requestedDubVoice"';
const directory = (id: string) => join(dataDir, 'channel-videos', id);
const apiPath = '/api/channel-videos';
const idSchema = z.string().uuid();
const newVideo = z.object({url: z.string().trim().min(1).max(500), title: z.string().trim().min(1).max(500).optional()}).strict();
const voiceSchema = z.enum(dubVoices.map(voice => voice.id));
const dubRequest = z.object({voice: voiceSchema.optional()}).strict();
const dubMediaQuery = z.object({v: z.coerce.number().int().min(1).max(dubVersion).optional(), voice: voiceSchema.optional()});
const missing = () => new AppError('Vídeo não encontrado.', 404);
const hasFile = async (path: string) => (await stat(path).catch(() => null))?.isFile() ?? false;

const media: {
  download: (url: string, output: string) => Promise<Awaited<ReturnType<typeof validateVideo>> | void>;
  dub: typeof dubChannelVideo;
} = {download: downloadChannelVideo, dub: dubChannelVideo};

async function saveDownload(job: SavedChannelVideo, operations: typeof media) {
  const folder = directory(job.id);
  await mkdir(folder, {recursive: true});
  const source = join(folder, 'source.mp4'), partial = join(folder, 'download.part');
  if (await hasFile(source)) return validateVideo(source, 'any', Infinity);
  try {
    await rm(partial, {force: true});
    const video = await operations.download(job.url, partial) ?? await validateVideo(partial, 'any', Infinity);
    await rename(partial, source);
    return video;
  } finally {
    await rm(partial, {force: true}).catch(() => {});
  }
}

export class ChannelVideoWorker {
  private timer?: ReturnType<typeof setInterval>;
  private working?: Promise<void>;

  constructor(private readonly operations = media) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.wake(), 2500);
    this.timer.unref();
    this.wake();
  }

  private wake() {
    this.working ??= this.processNext().catch(() =>
      logger.warn({event: 'channel_video_worker'}, 'A fila de vídeos será reavaliada no próximo ciclo.'),
    ).finally(() => { this.working = undefined; });
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.working;
  }

  async processNext() {
    const db = await pool.connect();
    let locked = false;
    let releaseError: Error | undefined;
    try {
      locked = (await db.query('SELECT pg_try_advisory_lock(74839137) AS locked')).rows[0].locked;
      if (!locked) return;
      const {rows: [job]} = await db.query<SavedChannelVideo>(`
        SELECT ${fields} FROM channel_videos
        WHERE status IN ('download_queued','downloading','dub_queued','dubbing')
        ORDER BY updated_at,id LIMIT 1
      `);
      if (job) await this.processJob(db, job);
    } finally {
      try {
        if (locked) await db.query('SELECT pg_advisory_unlock(74839137)');
      } catch {
        releaseError = new Error('Could not release channel video lock');
      } finally { db.release(releaseError); }
    }
  }

  private async processJob(db: PoolClient, job: SavedChannelVideo) {
    const dub = job.status === 'dub_queued' || job.status === 'dubbing';
    const voice = job.requestedDubVoice ?? defaultDubVoice;
    await db.query('UPDATE channel_videos SET status=$2,error=NULL,updated_at=now() WHERE id=$1',
      [job.id, dub ? 'dubbing' : 'downloading']);
    let duration = job.duration;
    try {
      if (dub) {
        const folder = directory(job.id);
        if (!await hasFile(join(folder, dubFilename(dubVersion, voice)))) await this.operations.dub(folder, duration!, voice);
      } else {
        duration = (await saveDownload(job, this.operations)).duration;
      }
    } catch (cause) {
      const error = cause instanceof AppError ? cause.message : 'Não foi possível processar o vídeo. Tente novamente.';
      await db.query('UPDATE channel_videos SET status=$2,error=$3,updated_at=now() WHERE id=$1',
        [job.id, dub ? 'dub_failed' : 'download_failed', error]);
      return;
    }
    await db.query(`UPDATE channel_videos SET status=$2,duration=$3,dub_version=$4,dub_voice=$5,
      requested_dub_voice=NULL,updated_at=now() WHERE id=$1`,
      [job.id, dub ? 'dubbed' : 'ready', duration, dub ? dubVersion : null, dub ? voice : null]);
  }
}

export const channelVideoWorker = new ChannelVideoWorker();
export const channelVideoRoutes = Router();

channelVideoRoutes.get(apiPath + '/trends', async (req, res) => {
  res.json(await tiktokTrends(tiktokTrendQuery.parse(req.query)));
});

channelVideoRoutes.get(apiPath, async (req, res) => {
  const page = parsePagination(req.query, {scope: 'channel-videos', defaultLimit: 12});
  const values: unknown[] = [];
  const {rows} = await pool.query<SavedChannelVideo>(`
    SELECT ${fields},${cursorFields('created_at', 'id')} FROM channel_videos WHERE true
    ${keysetClause(page, 'created_at', 'id', values)} ORDER BY created_at DESC,id DESC ${pageLimit(page, values)}
  `, values);
  res.json({...paginateRows(rows, page), maxDubSeconds, dubVersion, dubVoices, defaultDubVoice});
});

channelVideoRoutes.post(apiPath, async (req, res) => {
  const input = newVideo.parse(req.body);
  const url = await resolveTikTokVideo(input.url);
  const {rows: [video]} = await pool.query<SavedChannelVideo>(`
    INSERT INTO channel_videos(id,source_key,url,title) VALUES ($1,$2,$3,$4)
    ON CONFLICT(source_key) DO UPDATE SET title=COALESCE(channel_videos.title,EXCLUDED.title)
    RETURNING ${fields}
  `, [randomUUID(), tiktokSourceKey(url), url, input.title ?? null]);
  res.status(202).json(video);
});

channelVideoRoutes.post(apiPath + '/:id/retry', async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const {rows: [video]} = await pool.query<SavedChannelVideo>(`
    UPDATE channel_videos SET status='download_queued',error=NULL,updated_at=now()
    WHERE id=$1 AND status='download_failed' RETURNING ${fields}
  `, [id]);
  if (!video) throw new AppError('Somente downloads com falha podem ser retomados.', 409);
  res.status(202).json(video);
});

channelVideoRoutes.post(apiPath + '/:id/dub', async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const {voice} = dubRequest.parse(req.body ?? {});
  const {rows: [current]} = await pool.query<SavedChannelVideo>(`SELECT ${fields} FROM channel_videos WHERE id=$1`, [id]);
  if (!current) throw missing();
  if (!current.duration) throw new AppError('Baixe ou importe o MP4 antes de dublar.', 409);
  if (current.duration > maxDubSeconds) throw new AppError('A dublagem aceita vídeos de até 5 minutos.');
  const {rows: [updated]} = await pool.query<SavedChannelVideo>(`
    UPDATE channel_videos SET status='dub_queued',error=NULL,updated_at=now(),
      requested_dub_voice=COALESCE($3,requested_dub_voice,dub_voice,$4)
    WHERE id=$1 AND (status IN ('ready','dub_failed') OR (status='dubbed' AND
      (dub_version<$2 OR dub_voice IS DISTINCT FROM COALESCE($3,dub_voice,$4)))) RETURNING ${fields}
  `, [id, dubVersion, voice, defaultDubVoice]);
  if (updated) return res.status(202).json(updated);
  const {rows: [latest]} = await pool.query<SavedChannelVideo>(`SELECT ${fields} FROM channel_videos WHERE id=$1`, [id]);
  if (!latest) throw missing();
  if (voice && (latest.status === 'dub_queued' || latest.status === 'dubbing') &&
    voice !== (latest.requestedDubVoice ?? defaultDubVoice)) throw new AppError('Aguarde a dublagem que já está em andamento.', 409);
  return res.status(202).json(latest);
});

channelVideoRoutes.post(apiPath + '/:id/source', async (req, res) => {
  if (!req.is('video/mp4')) throw new AppError('Selecione um arquivo MP4.', 415);
  const id = idSchema.parse(req.params.id);
  const folder = directory(id);
  const part = join(folder, 'upload.part');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const {rows: [video]} = await db.query<SavedChannelVideo>(`SELECT ${fields} FROM channel_videos WHERE id=$1 FOR UPDATE`, [id]);
    if (!video) throw missing();
    if (video.status !== 'download_failed') throw new AppError('A importação está disponível após uma falha no download.', 409);
    await mkdir(folder, {recursive: true});
    const source = join(folder, 'source.mp4');
    try {
      await rm(part, {force: true});
      const length = req.get('content-length');
      await writeChannelVideo(req, part, length ? Number(length) : undefined, AbortSignal.timeout(120_000));
      const {duration} = await validateVideo(part, 'any', Infinity);
      await rename(part, source);
      const {rows: [updated]} = await db.query<SavedChannelVideo>(`
        UPDATE channel_videos SET status='ready',duration=$2,error=NULL,updated_at=now()
        WHERE id=$1 RETURNING ${fields}
      `, [id, duration]);
      await db.query('COMMIT');
      res.json(updated);
    } finally { await rm(part, {force: true}).catch(() => {}); }
  } catch (cause) {
    await db.query('ROLLBACK').catch(() => {});
    throw cause;
  } finally { db.release(); }
});

channelVideoRoutes.get(apiPath + '/:id/media/:variant', async (req, res, next) => {
  const id = idSchema.parse(req.params.id);
  const variant = z.enum(['original', 'pt-br']).parse(req.params.variant);
  const {rows: [video]} = await pool.query<SavedChannelVideo>(`SELECT ${fields} FROM channel_videos WHERE id=$1`, [id]);
  const dubbed = variant === 'pt-br';
  if (!video?.duration) throw missing();
  let filename = 'source.mp4';
  if (dubbed) {
    if (video.dubVersion === null) throw missing();
    const selection = dubMediaQuery.parse(req.query);
    const voice = selection.voice ?? (selection.v === undefined ? video.dubVoice : null) ?? defaultDubVoice;
    filename = dubFilename(selection.v ?? video.dubVersion, voice);
  }
  const path = join(directory(id), filename);
  if (!await hasFile(path)) throw new AppError('O arquivo MP4 não está disponível.', 404);
  if (req.query.download === '1') res.attachment('tiktok-' + id + '-' + (dubbed ? filename.replace(/-v\d+/, '') : 'original.mp4'));
  res.sendFile(path, {cacheControl: false}, error => { if (error) next(error); });
});
