import {pool} from './db.js';
import type {Reservation} from './native-schedule.js';
export async function accountCalendar(channel:string,db:Pick<typeof pool,'query'>=pool,excludeId:string|null=null):Promise<Reservation[]> {
  // 48h includes today's entire local date in every supported timezone. Keep the
  // latest older reservation as well, to preserve interval cadence after long pauses.
  const eligible="id IS DISTINCT FROM $2::uuid AND (status NOT IN ('duplicate','cancelled') OR upload_started_at>now()-interval '24 hours') AND (status<>'failed' OR session IS NOT NULL OR upload_started_at IS NOT NULL)";
  const {rows}=await db.query(`WITH relevant AS (
    SELECT id,status,planned_at,upload_started_at FROM deliveries WHERE integration_id=$1 AND planned_at>=now()-interval '48 hours' AND ${eligible}
    UNION
    SELECT id,status,planned_at,upload_started_at FROM deliveries WHERE integration_id=$1 AND upload_started_at>now()-interval '24 hours' AND ${eligible}
    UNION
    (SELECT id,status,planned_at,upload_started_at FROM deliveries WHERE integration_id=$1 AND planned_at<now()-interval '48 hours'
      AND status NOT IN ('duplicate','cancelled') AND ${eligible} ORDER BY planned_at DESC LIMIT 1)
    ) SELECT id,CASE WHEN status IN ('duplicate','cancelled') THEN NULL ELSE planned_at END AS "plannedAt",upload_started_at AS "startedAt" FROM relevant`,[channel,excludeId]);
  if(channel.startsWith('browser:tiktok:')) {
    const legacyScope="kind='upload' AND delivery_id IS NULL AND COALESCE(config->>'profileId','default')=$1 AND status NOT IN ('empty','cancelled','duplicate') AND (status<>'failed' OR upload_started)";
    const legacy=await db.query(`WITH relevant AS (
      SELECT id,planned_at,upload_started,started_at FROM browser_commands WHERE ${legacyScope} AND planned_at>=now()-interval '48 hours'
      UNION
      SELECT id,planned_at,upload_started,started_at FROM browser_commands WHERE ${legacyScope} AND started_at>now()-interval '24 hours'
      UNION
      (SELECT id,planned_at,upload_started,started_at FROM browser_commands WHERE ${legacyScope} AND planned_at<now()-interval '48 hours' ORDER BY planned_at DESC LIMIT 1)
      ) SELECT planned_at AS "plannedAt",CASE WHEN upload_started THEN started_at END AS "startedAt" FROM relevant`,[channel.slice('browser:tiktok:'.length)]);
    rows.push(...legacy.rows);
  }
  return rows;
}
