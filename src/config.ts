import 'dotenv/config';
import { z } from 'zod';

export const config = z.object({
  DATABASE_URL: z.string().min(1),
  TRAFIKVERKET_API_KEY: z.string().optional(),
  TRAFIKVERKET_SCHEMA_VERSION: z.string().default('1.9'),
  PORT: z.coerce.number().default(3001),
  POLL_INTERVAL_MS: z.coerce.number().min(30_000).default(60_000),
  WINDOW_LOOKBACK_MINUTES: z.coerce.number().default(90),
  WINDOW_LOOKAHEAD_MINUTES: z.coerce.number().default(240),
  MISSING_ACTUAL_GRACE_HOURS: z.coerce.number().default(6)
}).parse(process.env);
