import { config } from './config.js';

const endpoint='https://api.trafikinfo.trafikverket.se/v2/data.json';
const esc=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');

export function requestXml(start:Date,end:Date,location?:string) {
  const loc=location ? `<EQ name="LocationSignature" value="${esc(location)}"/>` : '';
  return `<REQUEST><LOGIN authenticationkey="${esc(config.TRAFIKVERKET_API_KEY ?? '')}"/><QUERY objecttype="TrainAnnouncement" schemaversion="${esc(config.TRAFIKVERKET_SCHEMA_VERSION)}" limit="100000"><FILTER><AND><GTE name="AdvertisedTimeAtLocation" value="${start.toISOString()}"/><LT name="AdvertisedTimeAtLocation" value="${end.toISOString()}"/>${loc}</AND></FILTER><INCLUDE>AdvertisedTrainIdent</INCLUDE><INCLUDE>TechnicalTrainIdent</INCLUDE><INCLUDE>LocationSignature</INCLUDE><INCLUDE>ActivityType</INCLUDE><INCLUDE>AdvertisedTimeAtLocation</INCLUDE><INCLUDE>EstimatedTimeAtLocation</INCLUDE><INCLUDE>TimeAtLocation</INCLUDE><INCLUDE>ModifiedTime</INCLUDE><INCLUDE>Canceled</INCLUDE><INCLUDE>Advertised</INCLUDE><INCLUDE>Operator</INCLUDE><INCLUDE>TypeOfTraffic</INCLUDE><INCLUDE>TrackAtLocation</INCLUDE><INCLUDE>Deviation</INCLUDE><INCLUDE>OtherInformation</INCLUDE></QUERY></REQUEST>`;
}

export async function fetchAnnouncements(start:Date,end:Date,location?:string):Promise<unknown[]> {
  if (!config.TRAFIKVERKET_API_KEY) throw new Error('TRAFIKVERKET_API_KEY is required');
  let last:unknown;
  for(let attempt=0;attempt<5;attempt++) {
    try {
      const res=await fetch(endpoint,{method:'POST',headers:{'content-type':'text/xml'},body:requestXml(start,end,location)});
      if(!res.ok) throw new Error(`Trafikverket HTTP ${res.status}: ${(await res.text()).slice(0,500)}`);
      const json:any=await res.json();
      const result=json?.RESPONSE?.RESULT?.[0];
      if(result?.ERROR) throw new Error(`Trafikverket: ${JSON.stringify(result.ERROR)}`);
      return result?.TrainAnnouncement ?? [];
    } catch(e) {
      last=e;
      if(attempt===4) break;
      const delay=Math.min(30_000,500*2**attempt)+Math.random()*750;
      await new Promise(r=>setTimeout(r,delay));
    }
  }
  throw last;
}
