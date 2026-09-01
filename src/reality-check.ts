import { writeFile } from 'node:fs/promises';
import { DateTime } from 'luxon';
import { fetchAnnouncements } from './trafikverket.js';
const location=(process.argv[2]??'THN').toUpperCase();
const start=DateTime.now().setZone('Europe/Stockholm').startOf('day').toUTC();
const rows:any[]=await fetchAnnouncements(start.toJSDate(),start.plus({days:1}).toJSDate(),location) as any[];
const file=`train-announcements-${location}-${start.toISODate()}.json`;
await writeFile(file,JSON.stringify(rows,null,2));
console.log({file,total:rows.length,withActual:rows.filter(x=>x.TimeAtLocation).length,withoutActual:rows.filter(x=>!x.TimeAtLocation).length,cancelled:rows.filter(x=>x.Canceled).length});
