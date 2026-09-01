import { config } from './config.js';
import { ingest } from './ingest.js';

let stopping=false;
for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{stopping=true;});
while(!stopping) {
  const now=new Date();
  const start=new Date(now.getTime()-config.WINDOW_LOOKBACK_MINUTES*60_000);
  const end=new Date(now.getTime()+config.WINDOW_LOOKAHEAD_MINUTES*60_000);
  try { console.log(JSON.stringify(await ingest(start,end))); } catch(e) { console.error(e); }
  if(!stopping) await new Promise(r=>setTimeout(r,config.POLL_INTERVAL_MS));
}
await poolEnd();
async function poolEnd(){ const {pool}=await import('./db.js'); await pool.end(); }
