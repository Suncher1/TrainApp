import { ingest } from './ingest.js';
import { pool } from './db.js';
const [startArg,endArg,locationArg]=process.argv.slice(2);
if(!startArg||!endArg) throw new Error('Usage: npm run backfill -- <ISO start> <ISO end> [location signature]');
const location=locationArg?.toUpperCase();
let cursor=new Date(startArg); const end=new Date(endArg);
if(isNaN(cursor.valueOf())||isNaN(end.valueOf())||cursor>=end) throw new Error('Invalid date range');
while(cursor<end) { const next=new Date(Math.min(end.getTime(),cursor.getTime()+6*3_600_000)); console.log(await ingest(cursor,next,location)); cursor=next; }
await pool.end();
