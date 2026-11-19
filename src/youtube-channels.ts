import {Router} from 'express';
import {z} from 'zod';
import {AppError} from './config.js';
import {pool} from './db.js';
import {lookupYoutubeChannel, youtubeChannelId, type ChannelVideo, type YoutubeChannel} from './youtube-channel-lookup.js';

export type FollowedYoutubeChannel = YoutubeChannel & {video: ChannelVideo | null; checkedAt: string; needsRefresh: boolean};

// Older rows contain only one video. Return it until the first successful refresh.
const columns = `channel_id AS id, name, latest_video AS video,
  COALESCE(recent_videos, CASE WHEN latest_video IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(latest_video) END) AS videos,
  checked_at AS "checkedAt", (recent_videos IS NULL OR NOT includes_live_replays) AS "needsRefresh"`;
const searchSchema = z.object({channel: z.string().trim().min(1).max(300)}).strict();

export function createYoutubeChannelRoutes(lookup = lookupYoutubeChannel) {
  const routes = Router();
  routes.get('/api/youtube-channels', async (_req, res) => {
    const {rows} = await pool.query<FollowedYoutubeChannel>(
      'SELECT ' + columns + ' FROM followed_youtube_channels ORDER BY created_at, channel_id',
    );
    res.json(rows);
  });
  routes.post('/api/youtube-channels', async (req, res) => {
    const {channel} = searchSchema.parse(req.body);
    const found = await lookup(channel);
    const {rows: [saved]} = await pool.query<FollowedYoutubeChannel>(`
      INSERT INTO followed_youtube_channels(channel_id, name, latest_video, recent_videos, includes_live_replays)
      VALUES($1, $2, $3::jsonb -> 0, $3::jsonb, true)
      ON CONFLICT(channel_id) DO UPDATE SET name = EXCLUDED.name, latest_video = EXCLUDED.latest_video,
        recent_videos = EXCLUDED.recent_videos, includes_live_replays = true, checked_at = now()
      RETURNING ${columns}`, [found.id, found.name, JSON.stringify(found.videos)]);
    res.status(201).json(saved);
  });
  routes.post('/api/youtube-channels/:id/refresh', async (req, res) => {
    const id = youtubeChannelId.parse(req.params.id);
    const {rows: [current]} = await pool.query<{version: string}>(
      'SELECT checked_at::text AS version FROM followed_youtube_channels WHERE channel_id = $1', [id],
    );
    if (!current) throw new AppError('Este canal deixou de ser acompanhado.', 404);
    const found = await lookup(id);
    if (found.id !== id) throw new AppError('O YouTube retornou dados de outro canal.', 502);
    const {rows: [updated]} = await pool.query<FollowedYoutubeChannel>(`
      UPDATE followed_youtube_channels SET name = $2, latest_video = $3::jsonb -> 0, recent_videos = $3::jsonb,
        includes_live_replays = true, checked_at = now()
      WHERE channel_id = $1 AND checked_at = $4 RETURNING ${columns}`, [id, found.name, JSON.stringify(found.videos), current.version]);
    if (updated) return void res.json(updated);
    const {rows: [saved]} = await pool.query<FollowedYoutubeChannel>(
      'SELECT ' + columns + ' FROM followed_youtube_channels WHERE channel_id = $1', [id],
    );
    if (!saved) throw new AppError('Este canal deixou de ser acompanhado.', 404);
    res.json(saved);
  });
  routes.delete('/api/youtube-channels/:id', async (req, res) => {
    const id = youtubeChannelId.parse(req.params.id);
    await pool.query('DELETE FROM followed_youtube_channels WHERE channel_id = $1', [id]);
    res.json({ok: true});
  });
  return routes;
}

export const youtubeChannelRoutes = createYoutubeChannelRoutes();
