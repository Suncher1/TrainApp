import { z } from 'zod';

const stringArray = z.array(z.string()).catch([]);
export const announcementSchema = z.object({
  AdvertisedTrainIdent: z.union([z.string(), z.number()]).transform(String),
  TechnicalTrainIdent: z.union([z.string(), z.number()]).transform(String).optional(),
  LocationSignature: z.string(),
  ActivityType: z.enum(['Ankomst', 'Avgang']),
  AdvertisedTimeAtLocation: z.coerce.date(),
  EstimatedTimeAtLocation: z.coerce.date().optional(),
  TimeAtLocation: z.coerce.date().optional(),
  ModifiedTime: z.coerce.date(),
  Canceled: z.boolean().default(false),
  Advertised: z.boolean().optional(),
  Operator: z.string().optional(),
  TypeOfTraffic: z.array(z.object({ Code: z.string().optional(), Description: z.string().optional() }).passthrough()).catch([]),
  TrackAtLocation: z.string().optional(),
  Deviation: stringArray,
  OtherInformation: stringArray
}).passthrough();
export type Announcement = z.infer<typeof announcementSchema>;

export function classify(a: Pick<Announcement,'Canceled'|'TimeAtLocation'|'AdvertisedTimeAtLocation'>, now: Date, graceHours=6) {
  if (a.Canceled) return 'cancelled' as const;
  if (a.TimeAtLocation) return 'completed' as const;
  return now.getTime() <= a.AdvertisedTimeAtLocation.getTime() + graceHours*3_600_000 ? 'pending' as const : 'data_gap' as const;
}

export function delayMinutes(a: Pick<Announcement,'Canceled'|'TimeAtLocation'|'AdvertisedTimeAtLocation'>) {
  if (a.Canceled || !a.TimeAtLocation) return null;
  return (a.TimeAtLocation.getTime()-a.AdvertisedTimeAtLocation.getTime())/60_000;
}
