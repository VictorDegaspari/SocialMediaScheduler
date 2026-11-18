import pg from 'pg';
import { Redis } from 'ioredis';
import { decrypt, encrypt, logger } from './config.js';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 1, lazyConnect: true });
redis.on('error', () => logger.warn({ event: 'redis_unavailable' }, 'Redis indisponível; persistência mantida no PostgreSQL.'));

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value text NOT NULL);
    CREATE TABLE IF NOT EXISTS watches (
      id uuid PRIMARY KEY, name text NOT NULL, folder_id text NOT NULL UNIQUE, folder_url text NOT NULL,
      recursive boolean NOT NULL DEFAULT true, enabled boolean NOT NULL DEFAULT true,
      scan_minutes int NOT NULL DEFAULT 5, cadence text NOT NULL DEFAULT 'interval',
      interval_minutes int NOT NULL DEFAULT 720, times jsonb NOT NULL DEFAULT '["08:00","20:00"]',
      timezone text NOT NULL DEFAULT 'America/Sao_Paulo', mode text NOT NULL DEFAULT 'draft',
      integration_ids jsonb NOT NULL DEFAULT '[]', import_existing boolean NOT NULL DEFAULT false,
      require_metadata boolean NOT NULL DEFAULT true, strip_metadata boolean NOT NULL DEFAULT true,
      initialized boolean NOT NULL DEFAULT false,
      last_scan_at timestamptz, next_scan_at timestamptz NOT NULL DEFAULT now(),
      next_upload_at timestamptz NOT NULL DEFAULT now(), last_error text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS videos (
      id uuid PRIMARY KEY, watch_id uuid NOT NULL REFERENCES watches(id), file_id text NOT NULL,
      name text NOT NULL, parent_id text NOT NULL, version text, size bigint NOT NULL DEFAULT 0,
      modified_at timestamptz, stable_since timestamptz NOT NULL DEFAULT now(), metadata jsonb,
      json_file_id text, json_version text,
      status text NOT NULL DEFAULT 'waiting', sha256 text, media jsonb,
      media_stripped_metadata boolean NOT NULL DEFAULT false, error text,
      attempts int NOT NULL DEFAULT 0, retry_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(watch_id, file_id)
    );
    ALTER TABLE watches ADD COLUMN IF NOT EXISTS strip_metadata boolean NOT NULL DEFAULT true;
    ALTER TABLE watches ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'google_drive';
    ALTER TABLE watches ADD COLUMN IF NOT EXISTS pack_defaults jsonb NOT NULL DEFAULT '{}';
    ALTER TABLE watches ADD COLUMN IF NOT EXISTS native_schedule jsonb NOT NULL DEFAULT '{}';
    ALTER TABLE videos ADD COLUMN IF NOT EXISTS media_stripped_metadata boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS deliveries (
      id uuid PRIMARY KEY, video_id uuid NOT NULL REFERENCES videos(id), integration_id text NOT NULL,
      provider text NOT NULL, status text NOT NULL DEFAULT 'pending', post_id text,
      payload_hash text, planned_at timestamptz, release_url text, error text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(video_id, integration_id)
    );
    ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS engine text NOT NULL DEFAULT 'postiz';
    ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS payload jsonb;
    ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS local_file text;
    ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS session text;
    ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;
    ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS retry_at timestamptz;
    ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS approved_at timestamptz;
    ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS upload_started_at timestamptz;
    CREATE TABLE IF NOT EXISTS events (
      id bigserial PRIMARY KEY, level text NOT NULL, message text NOT NULL, watch_id uuid,
      video_id uuid, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS content_claims (
      sha256 text NOT NULL, integration_id text NOT NULL, delivery_id uuid NOT NULL REFERENCES deliveries(id),
      PRIMARY KEY(sha256,integration_id)
    );
    CREATE TABLE IF NOT EXISTS oauth_states (
      hash text PRIMARY KEY, verifier text NOT NULL, expires_at timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS videos_queue ON videos(watch_id,status,retry_at);
    CREATE TABLE IF NOT EXISTS video_title_reviews (
      video_id uuid PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,source_version text NOT NULL,sha256 text NOT NULL,
      title text NOT NULL CHECK(char_length(title) BETWEEN 5 AND 100),evidence text NOT NULL,reviewed_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS deliveries_status ON deliveries(status);
    CREATE INDEX IF NOT EXISTS events_date ON events(created_at DESC);
    CREATE TABLE IF NOT EXISTS cut_jobs (
      id uuid PRIMARY KEY,url text NOT NULL,status text NOT NULL DEFAULT 'queued',
      title text,duration double precision,language text NOT NULL DEFAULT 'pt',
      clip_count int NOT NULL CHECK(clip_count BETWEEN 1 AND 5),
      target_seconds int NOT NULL CHECK(target_seconds BETWEEN 20 AND 180),
      transcript jsonb,error text,source_removed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS cuts (
      id uuid PRIMARY KEY,job_id uuid NOT NULL REFERENCES cut_jobs(id),
      title text NOT NULL,start_seconds double precision NOT NULL,end_seconds double precision NOT NULL,
      reason text NOT NULL,score double precision NOT NULL DEFAULT 0,
      framing text NOT NULL DEFAULT 'fit',captions jsonb NOT NULL DEFAULT '[]',
      status text NOT NULL DEFAULT 'queued',revision int NOT NULL DEFAULT 1,
      local_file text,delivery_id uuid REFERENCES deliveries(id),error text,
      created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT cuts_source_bounds CHECK(start_seconds>=0 AND end_seconds>start_seconds AND end_seconds<=7200.001)
    );
    ALTER TABLE cut_jobs ADD COLUMN IF NOT EXISTS replay_data jsonb;
    ALTER TABLE cut_jobs ADD COLUMN IF NOT EXISTS pending_analysis jsonb;
    ALTER TABLE cut_jobs ADD COLUMN IF NOT EXISTS analysis_message text;
    ALTER TABLE cuts ADD COLUMN IF NOT EXISTS caption_style jsonb NOT NULL DEFAULT '{}';
    ALTER TABLE cuts ADD COLUMN IF NOT EXISTS framing_options jsonb NOT NULL DEFAULT '{}';
    ALTER TABLE cuts ADD COLUMN IF NOT EXISTS excluded_ranges jsonb NOT NULL DEFAULT '[]';
    ALTER TABLE cuts ADD COLUMN IF NOT EXISTS output_duration double precision;
    ALTER TABLE cuts ADD COLUMN IF NOT EXISTS render_warnings jsonb NOT NULL DEFAULT '[]';
    ALTER TABLE cuts ADD COLUMN IF NOT EXISTS edited_from_cut_id uuid REFERENCES cuts(id);
    ALTER TABLE cuts DROP CONSTRAINT IF EXISTS cuts_check;
    UPDATE cuts SET output_duration=end_seconds-start_seconds WHERE output_duration IS NULL;
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='cuts'::regclass AND conname='cuts_source_bounds') THEN
        ALTER TABLE cuts ADD CONSTRAINT cuts_source_bounds CHECK(start_seconds>=0 AND end_seconds>start_seconds AND end_seconds<=7200.001);
      END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='cuts'::regclass AND conname='cuts_output_duration') THEN
        ALTER TABLE cuts ADD CONSTRAINT cuts_output_duration CHECK(output_duration IS NULL OR output_duration>0 AND output_duration<=180.001);
      END IF;
    END $$;
    CREATE INDEX IF NOT EXISTS cut_jobs_queue ON cut_jobs(status,created_at);
    CREATE INDEX IF NOT EXISTS cuts_job ON cuts(job_id,created_at);
    CREATE TABLE IF NOT EXISTS browser_settings (
      id boolean PRIMARY KEY DEFAULT true CHECK(id), folder text NOT NULL, enabled boolean NOT NULL DEFAULT false,
      cadence text NOT NULL DEFAULT 'daily', interval_minutes int NOT NULL DEFAULT 720,
      times jsonb NOT NULL DEFAULT '["08:00","20:00"]', timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
      strip_metadata boolean NOT NULL DEFAULT true, next_at timestamptz, retry_at timestamptz,
      revision int NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS browser_agent (
      id boolean PRIMARY KEY DEFAULT true CHECK(id), instance_id uuid NOT NULL,
      last_seen timestamptz NOT NULL DEFAULT now(), profile_saved boolean NOT NULL DEFAULT false,
      external_busy boolean NOT NULL DEFAULT false, desktop boolean NOT NULL DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS browser_commands (
      id uuid PRIMARY KEY, kind text NOT NULL, origin text NOT NULL DEFAULT 'manual', config jsonb NOT NULL,
      status text NOT NULL DEFAULT 'pending', phase text NOT NULL DEFAULT 'queued', message text,
      filename text, hash text, upload_started boolean NOT NULL DEFAULT false, agent_instance uuid,
      lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz,
      finished_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS browser_commands_status ON browser_commands(status,created_at);
    CREATE TABLE IF NOT EXISTS connected_accounts (
      provider text NOT NULL,external_id text NOT NULL,name text NOT NULL,label text,
      tokens text NOT NULL,config text NOT NULL,disabled boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(provider,external_id)
    );
    CREATE TABLE IF NOT EXISTS browser_profiles (
      id text PRIMARY KEY,name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO browser_profiles(id,name) VALUES('default','TikTok principal') ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS publishing_profiles (
      id uuid PRIMARY KEY,name text NOT NULL UNIQUE,watch_id uuid REFERENCES watches(id),
      youtube_id text,tiktok_profile_id text REFERENCES browser_profiles(id),created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE watches ADD COLUMN IF NOT EXISTS profile_id uuid;
    ALTER TABLE watches ADD COLUMN IF NOT EXISTS controlled_by_requests boolean NOT NULL DEFAULT false;
    ALTER TABLE watches ADD COLUMN IF NOT EXISTS managed_by_cuts boolean NOT NULL DEFAULT false;
    ALTER TABLE watches ADD COLUMN IF NOT EXISTS source_roots jsonb NOT NULL DEFAULT '[]';
    ALTER TABLE watches ADD COLUMN IF NOT EXISTS metadata_defaults jsonb NOT NULL DEFAULT '{}';
    ALTER TABLE watches DROP CONSTRAINT IF EXISTS watches_folder_id_key;
    CREATE UNIQUE INDEX IF NOT EXISTS watches_legacy_folder_unique ON watches(folder_id) WHERE profile_id IS NULL;
    CREATE TABLE IF NOT EXISTS publication_requests (
      id uuid PRIMARY KEY,request_key text NOT NULL,profile_id uuid NOT NULL REFERENCES publishing_profiles(id),
      provider text NOT NULL,quantity int NOT NULL CHECK(quantity>0 AND quantity<=10000),
      config jsonb NOT NULL,status text NOT NULL DEFAULT 'active',message text,
      created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(request_key,provider)
    );
    ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS request_id uuid REFERENCES publication_requests(id);
    ALTER TABLE browser_commands ADD COLUMN IF NOT EXISTS request_id uuid REFERENCES publication_requests(id);
    ALTER TABLE browser_commands ADD COLUMN IF NOT EXISTS delivery_id uuid REFERENCES deliveries(id);
    ALTER TABLE browser_agent ADD COLUMN IF NOT EXISTS profiles jsonb NOT NULL DEFAULT '{}';
    CREATE TABLE IF NOT EXISTS manual_actions (
      id uuid PRIMARY KEY,request_id uuid NOT NULL REFERENCES publication_requests(id),kind text NOT NULL,
      message text NOT NULL,href text NOT NULL DEFAULT '/#requests',resolved_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(request_id,kind)
    );
    ALTER TABLE browser_settings ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'local';
    ALTER TABLE browser_settings ADD COLUMN IF NOT EXISTS pack_defaults jsonb NOT NULL DEFAULT '{}';
    ALTER TABLE browser_settings ADD COLUMN IF NOT EXISTS blocked_until timestamptz;
    ALTER TABLE browser_settings ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'review';
    ALTER TABLE browser_settings ADD COLUMN IF NOT EXISTS native_schedule jsonb NOT NULL DEFAULT '{}';
    ALTER TABLE browser_commands ADD COLUMN IF NOT EXISTS planned_at timestamptz;
    CREATE INDEX IF NOT EXISTS deliveries_native_calendar ON deliveries(integration_id,planned_at);
    CREATE INDEX IF NOT EXISTS deliveries_request_status ON deliveries(request_id,status);
    CREATE INDEX IF NOT EXISTS deliveries_upload_calendar ON deliveries(integration_id,upload_started_at) WHERE upload_started_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS browser_native_calendar ON browser_commands((COALESCE(config->>'profileId','default')),planned_at) WHERE kind='upload' AND delivery_id IS NULL;
    CREATE INDEX IF NOT EXISTS browser_upload_calendar ON browser_commands((COALESCE(config->>'profileId','default')),started_at) WHERE kind='upload' AND delivery_id IS NULL AND started_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS cut_jobs_visible_page ON cut_jobs(created_at DESC,id DESC) WHERE status<>'discarded';
    CREATE INDEX IF NOT EXISTS watches_visible_page ON watches(created_at DESC,id DESC) WHERE controlled_by_requests=false AND managed_by_cuts=false;
    CREATE INDEX IF NOT EXISTS events_page ON events(created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS videos_page ON videos(updated_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS publication_requests_page ON publication_requests(created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS manual_actions_open_page ON manual_actions(created_at DESC,id DESC) WHERE resolved_at IS NULL;
    CREATE INDEX IF NOT EXISTS browser_commands_page ON browser_commands(created_at DESC,id DESC);
    -- Remove the former implicit inheritance from TikTok. An explicit YouTube
    -- declaration and per-video JSON metadata remain authoritative.
    UPDATE watches SET pack_defaults=jsonb_set(pack_defaults,'{youtubeContainsSyntheticMedia}','false'::jsonb),
      metadata_defaults=CASE WHEN controlled_by_requests THEN metadata_defaults||jsonb_build_object('youtube',
        COALESCE(metadata_defaults->'youtube','{}'::jsonb)||'{"containsSyntheticMedia":false}'::jsonb) ELSE metadata_defaults END,
      next_scan_at=now()
      WHERE (source_type='gta6_pack' OR controlled_by_requests) AND NOT(pack_defaults?'youtubeContainsSyntheticMedia');
  `);
  const {migrateConnectedAccounts}=await import('./connected-accounts.js');await migrateConnectedAccounts();
  await redis.connect().catch(() => {});
}

export async function getSetting<T>(key: string): Promise<T | null> {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key=$1', [key]);
  return rows[0] ? decrypt<T>(rows[0].value) : null;
}
export async function getSettings<T=unknown>(keys:string[]):Promise<Record<string,T|null>> {
  const {rows}=await pool.query('SELECT key,value FROM settings WHERE key=ANY($1::text[])',[keys]);
  return Object.fromEntries([...keys.map(key=>[key,null]),...rows.map(row=>[row.key,decrypt<T>(row.value)])]);
}

export async function setSetting(key: string, value: unknown) {
  await pool.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value', [key, encrypt(value)]);
}

export async function event(level: string, message: string, watchId?: string, videoId?: string, details: unknown = {}) {
  const log=level==='error'?logger.error.bind(logger):level==='warning'?logger.warn.bind(logger):logger.info.bind(logger);
  log({ event: 'activity', activityLevel:level, watchId, videoId }, message);
  await pool.query('INSERT INTO events(level,message,watch_id,video_id,details) VALUES($1,$2,$3,$4,$5)', [level, message, watchId || null, videoId || null, JSON.stringify(details)]);
}

export interface Watch {
  id: string; name: string; source_type: 'google_drive' | 'local' | 'gta6_pack'; pack_defaults?:unknown; folder_id: string; folder_url: string; recursive: boolean; enabled: boolean;
  scan_minutes: number; cadence: 'interval' | 'daily'; interval_minutes: number; times: string[];
  timezone: string; mode: 'draft' | 'schedule' | 'native_schedule'; native_schedule?:unknown; integration_ids: string[]; import_existing: boolean;
  require_metadata: boolean; strip_metadata: boolean; initialized: boolean; next_upload_at: Date; next_scan_at: Date;
  profile_id?:string|null;controlled_by_requests?:boolean;last_error?:string|null;
  source_roots?:string[];metadata_defaults?:Record<string,unknown>;
}
