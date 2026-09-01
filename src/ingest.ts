import { pool } from './db.js';
import { announcementSchema, type Announcement } from './model.js';
import { fetchAnnouncements } from './trafikverket.js';

const BATCH_SIZE = 500;

type NormalizedAnnouncement = {
  advertised_train_ident: string;
  technical_train_ident: string | null;
  location_signature: string;
  activity_type: 'Ankomst' | 'Avgang';
  advertised_time_at_location: string;
  estimated_time_at_location: string | null;
  time_at_location: string | null;
  modified_time: string;
  canceled: boolean;
  advertised: boolean | null;
  operator: string | null;
  train_type: unknown[];
  track_at_location: string | null;
  deviations: string[];
  other_information: string[];
  raw_id: string;
};

function normalize(a: Announcement, rawId: string): NormalizedAnnouncement {
  return {
    advertised_train_ident: a.AdvertisedTrainIdent,
    technical_train_ident: a.TechnicalTrainIdent ?? null,
    location_signature: a.LocationSignature,
    activity_type: a.ActivityType,
    advertised_time_at_location: a.AdvertisedTimeAtLocation.toISOString(),
    estimated_time_at_location: a.EstimatedTimeAtLocation?.toISOString() ?? null,
    time_at_location: a.TimeAtLocation?.toISOString() ?? null,
    modified_time: a.ModifiedTime.toISOString(),
    canceled: a.Canceled,
    advertised: a.Advertised ?? null,
    operator: a.Operator ?? null,
    train_type: a.TypeOfTraffic,
    track_at_location: a.TrackAtLocation ?? null,
    deviations: a.Deviation,
    other_information: a.OtherInformation,
    raw_id: rawId
  };
}

function naturalKey(a: NormalizedAnnouncement) {
  return `${a.advertised_train_ident}\u0000${a.location_signature}\u0000${a.advertised_time_at_location}\u0000${a.activity_type}`;
}

async function upsertBatch(batch: NormalizedAnnouncement[]) {
  const result = await pool.query(`
    INSERT INTO announcements(
      advertised_train_ident, technical_train_ident, location_signature,
      activity_type, advertised_time_at_location, estimated_time_at_location,
      time_at_location, modified_time, canceled, advertised, operator,
      train_type, track_at_location, deviations, other_information, raw_id
    )
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
      advertised_train_ident text, technical_train_ident text,
      location_signature text, activity_type text,
      advertised_time_at_location timestamptz,
      estimated_time_at_location timestamptz, time_at_location timestamptz,
      modified_time timestamptz, canceled boolean, advertised boolean,
      operator text, train_type jsonb, track_at_location text,
      deviations jsonb, other_information jsonb, raw_id bigint
    )
    ON CONFLICT(advertised_train_ident, location_signature,
                advertised_time_at_location, activity_type) DO UPDATE SET
      technical_train_ident = EXCLUDED.technical_train_ident,
      estimated_time_at_location = EXCLUDED.estimated_time_at_location,
      time_at_location = EXCLUDED.time_at_location,
      modified_time = EXCLUDED.modified_time,
      canceled = EXCLUDED.canceled,
      advertised = EXCLUDED.advertised,
      operator = EXCLUDED.operator,
      train_type = EXCLUDED.train_type,
      track_at_location = EXCLUDED.track_at_location,
      deviations = EXCLUDED.deviations,
      other_information = EXCLUDED.other_information,
      raw_id = EXCLUDED.raw_id,
      last_seen_at = now()
    WHERE EXCLUDED.modified_time > announcements.modified_time
  `, [JSON.stringify(batch)]);
  return result.rowCount ?? 0;
}

export async function ingest(windowStart: Date, windowEnd: Date, location?: string) {
  const run = (await pool.query(
    'INSERT INTO ingest_runs(window_start,window_end) VALUES($1,$2) RETURNING id',
    [windowStart, windowEnd]
  )).rows[0].id as string;
  let fetched = 0, upserted = 0, dead = 0;

  try {
    const rows = await fetchAnnouncements(windowStart, windowEnd, location);
    fetched = rows.length;

    // One replayable landing record per source response, committed before parsing.
    const rawId = (await pool.query(
      'INSERT INTO raw_announcements(window_start,window_end,payload) VALUES($1,$2,$3) RETURNING id',
      [windowStart, windowEnd, rows]
    )).rows[0].id as string;

    const newestByNaturalKey = new Map<string, NormalizedAnnouncement>();
    for (const payload of rows) {
      const parsed = announcementSchema.safeParse(payload);
      if (!parsed.success) {
        dead++;
        await pool.query(
          'INSERT INTO dead_letters(ingest_run_id,error,payload) VALUES($1,$2,$3)',
          [run, parsed.error.message, payload]
        );
        continue;
      }

      const normalized = normalize(parsed.data, rawId);
      const key = naturalKey(normalized);
      const existing = newestByNaturalKey.get(key);
      if (!existing || normalized.modified_time > existing.modified_time) {
        newestByNaturalKey.set(key, normalized);
      }
    }

    const valid = [...newestByNaturalKey.values()];
    for (let offset = 0; offset < valid.length; offset += BATCH_SIZE) {
      upserted += await upsertBatch(valid.slice(offset, offset + BATCH_SIZE));
      await pool.query(
        'UPDATE ingest_runs SET rows_fetched=$2,rows_upserted=$3,rows_dead_lettered=$4 WHERE id=$1',
        [run, fetched, upserted, dead]
      );
    }

    await pool.query(`
      INSERT INTO ingest_cursors(name,high_water_mark)
      VALUES('train_announcements',$1)
      ON CONFLICT(name) DO UPDATE SET
        high_water_mark=GREATEST(ingest_cursors.high_water_mark,EXCLUDED.high_water_mark),
        updated_at=now()
    `, [windowEnd]);
    await pool.query(
      'UPDATE ingest_runs SET finished_at=now(),rows_fetched=$2,rows_upserted=$3,rows_dead_lettered=$4 WHERE id=$1',
      [run, fetched, upserted, dead]
    );
    return { runId: run, rowsFetched: fetched, rowsUpserted: upserted, rowsDeadLettered: dead };
  } catch (error) {
    await pool.query(
      'UPDATE ingest_runs SET finished_at=now(),rows_fetched=$2,rows_upserted=$3,rows_dead_lettered=$4,error=$5 WHERE id=$1',
      [run, fetched, upserted, dead, error instanceof Error ? error.stack ?? error.message : String(error)]
    );
    throw error;
  }
}

