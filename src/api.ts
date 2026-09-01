import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { pool } from './db.js';
import { config } from './config.js';
const app=new Hono();
app.get('/health',c=>c.json({ok:true}));
app.get('/status',async c=>{
  const [runs,fresh,dead]=await Promise.all([
    pool.query(`SELECT * FROM ingest_runs WHERE started_at>now()-interval '24 hours' ORDER BY started_at DESC`),
    pool.query('SELECT max(last_seen_at) freshness, max(advertised_time_at_location) latest_event FROM announcements'),
    pool.query(`SELECT count(*)::int count FROM dead_letters WHERE failed_at>now()-interval '24 hours'`)
  ]); return c.json({freshness:fresh.rows[0],deadLettersLast24h:dead.rows[0].count,runs:runs.rows});
});
app.get('/stations/:signature/departures',async c=>{
  const signature=c.req.param('signature').toUpperCase();
  const from=c.req.query('from')??new Date(Date.now()-3_600_000).toISOString();
  const to=c.req.query('to')??new Date(Date.now()+6*3_600_000).toISOString();
  const r=await pool.query(`SELECT * FROM announcements WHERE location_signature=$1 AND activity_type='Avgang' AND advertised IS DISTINCT FROM false AND advertised_time_at_location >= $2 AND advertised_time_at_location < $3 ORDER BY advertised_time_at_location`,[signature,from,to]);
  return c.json(r.rows);
});
app.get('/stations/:signature/stats',async c=>{
  const signature=c.req.param('signature').toUpperCase(); const days=Math.min(365,Math.max(1,Number(c.req.query('days')??30)));
  const r=await pool.query(`WITH x AS (SELECT canceled,time_at_location,advertised_time_at_location,EXTRACT(EPOCH FROM(time_at_location-advertised_time_at_location))/60 delay FROM announcements WHERE location_signature=$1 AND activity_type='Avgang' AND advertised IS DISTINCT FROM false AND advertised_time_at_location >= now()-($2||' days')::interval AND advertised_time_at_location < now()) SELECT count(*)::int total,count(*) FILTER(WHERE canceled)::int cancelled,count(*) FILTER(WHERE NOT canceled AND time_at_location IS NULL)::int data_gaps,round(percentile_cont(.5) WITHIN GROUP(ORDER BY delay) FILTER(WHERE NOT canceled AND time_at_location IS NOT NULL)::numeric,1) median_delay_minutes,round(percentile_cont(.9) WITHIN GROUP(ORDER BY delay) FILTER(WHERE NOT canceled AND time_at_location IS NOT NULL)::numeric,1) p90_delay_minutes,round(100.0*count(*) FILTER(WHERE NOT canceled AND delay<=5)/NULLIF(count(*) FILTER(WHERE NOT canceled AND time_at_location IS NOT NULL),0),1) on_time_within_5_percent,round(100.0*count(*) FILTER(WHERE canceled)/NULLIF(count(*),0),1) cancellation_percent FROM x`,[signature,days]); return c.json({station:signature,days,...r.rows[0]});
});
serve({fetch:app.fetch,port:config.PORT},info=>console.log(`API on http://localhost:${info.port}`));
