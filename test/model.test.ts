import { describe,expect,it } from 'vitest';
import { DateTime } from 'luxon';
import { classify,delayMinutes } from '../src/model.js';
const advertised=new Date('2026-03-29T00:30:00Z');
describe('passage semantics',()=>{
  it('treats a late explicit cancellation as cancellation even with actual time',()=>expect(classify({Canceled:true,AdvertisedTimeAtLocation:advertised,TimeAtLocation:new Date()},new Date())).toBe('cancelled'));
  it('keeps a future missing actual pending',()=>expect(classify({Canceled:false,AdvertisedTimeAtLocation:advertised},new Date('2026-03-29T01:00:00Z'),6)).toBe('pending'));
  it('classifies an old missing actual as data gap, not cancellation',()=>expect(classify({Canceled:false,AdvertisedTimeAtLocation:advertised},new Date('2026-03-30T00:00:00Z'),6)).toBe('data_gap'));
  it('calculates signed delay',()=>expect(delayMinutes({Canceled:false,AdvertisedTimeAtLocation:advertised,TimeAtLocation:new Date(advertised.getTime()+7*60_000)})).toBe(7));
  it('handles Stockholm DST through instants',()=>{
    const before=DateTime.fromISO('2026-03-29T01:30',{zone:'Europe/Stockholm'}).toUTC();
    const after=before.plus({hours:1}).setZone('Europe/Stockholm');
    expect(after.hour).toBe(3);
  });
});
