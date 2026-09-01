import { pool } from './db.js';
import { announcementSchema } from './model.js';
import { fetchAnnouncements } from './trafikverket.js';

export async function ingest(windowStart:Date,windowEnd:Date,location?:string) {
  const run=(await pool.query('INSERT INTO ingest_runs(window_start,window_end) VALUES($1,$2) RETURNING id',[windowStart,windowEnd])).rows[0].id;
  let fetched=0,upserted=0,dead=0;
  try {
    const rows=await fetchAnnouncements(windowStart,windowEnd,location); fetched=rows.length;
    for(const payload of rows) {
      // Landing is committed independently so malformed rows remain replayable.
      const modified=typeof payload==='object'&&payload ? (payload as any).ModifiedTime ?? null:null;
      const raw=(await pool.query('INSERT INTO raw_announcements(window_start,window_end,source_modified_at,payload) VALUES($1,$2,$3,$4) RETURNING id',[windowStart,windowEnd,modified,payload])).rows[0].id;
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        const a=announcementSchema.parse(payload);
        const result=await client.query(`INSERT INTO announcements(advertised_train_ident,technical_train_ident,location_signature,activity_type,advertised_time_at_location,estimated_time_at_location,time_at_location,modified_time,canceled,advertised,operator,train_type,track_at_location,deviations,other_information,raw_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
          ON CONFLICT(advertised_train_ident,location_signature,advertised_time_at_location,activity_type) DO UPDATE SET
          technical_train_ident=EXCLUDED.technical_train_ident,estimated_time_at_location=EXCLUDED.estimated_time_at_location,time_at_location=EXCLUDED.time_at_location,modified_time=EXCLUDED.modified_time,canceled=EXCLUDED.canceled,advertised=EXCLUDED.advertised,operator=EXCLUDED.operator,train_type=EXCLUDED.train_type,track_at_location=EXCLUDED.track_at_location,deviations=EXCLUDED.deviations,other_information=EXCLUDED.other_information,raw_id=EXCLUDED.raw_id,last_seen_at=now()
          WHERE EXCLUDED.modified_time > announcements.modified_time`,[a.AdvertisedTrainIdent,a.TechnicalTrainIdent,a.LocationSignature,a.ActivityType,a.AdvertisedTimeAtLocation,a.EstimatedTimeAtLocation,a.TimeAtLocation,a.ModifiedTime,a.Canceled,a.Advertised,a.Operator,JSON.stringify(a.TypeOfTraffic),a.TrackAtLocation,JSON.stringify(a.Deviation),JSON.stringify(a.OtherInformation),raw]);
        upserted+=result.rowCount ?? 0;
        await client.query('COMMIT');
      } catch(e) {
        await client.query('ROLLBACK'); dead++;
        await pool.query('INSERT INTO dead_letters(ingest_run_id,error,payload) VALUES($1,$2,$3)',[run,e instanceof Error?e.stack??e.message:String(e),payload]);
      } finally { client.release(); }
    }
    await pool.query(`INSERT INTO ingest_cursors(name,high_water_mark) VALUES('train_announcements',$1) ON CONFLICT(name) DO UPDATE SET high_water_mark=GREATEST(ingest_cursors.high_water_mark,EXCLUDED.high_water_mark),updated_at=now()`,[windowEnd]);
    await pool.query('UPDATE ingest_runs SET finished_at=now(),rows_fetched=$2,rows_upserted=$3,rows_dead_lettered=$4 WHERE id=$1',[run,fetched,upserted,dead]);
    return {runId:run,rowsFetched:fetched,rowsUpserted:upserted,rowsDeadLettered:dead};
  } catch(e) {
    await pool.query('UPDATE ingest_runs SET finished_at=now(),rows_fetched=$2,rows_upserted=$3,rows_dead_lettered=$4,error=$5 WHERE id=$1',[run,fetched,upserted,dead,e instanceof Error?e.stack??e.message:String(e)]);
    throw e;
  }
}
