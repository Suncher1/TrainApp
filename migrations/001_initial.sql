CREATE TABLE raw_announcements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  source_modified_at timestamptz,
  payload jsonb NOT NULL
);
CREATE INDEX raw_announcements_fetched_at_idx ON raw_announcements(fetched_at);

CREATE TABLE announcements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  advertised_train_ident text NOT NULL,
  technical_train_ident text,
  location_signature text NOT NULL,
  activity_type text NOT NULL CHECK (activity_type IN ('Ankomst','Avgang')),
  advertised_time_at_location timestamptz NOT NULL,
  estimated_time_at_location timestamptz,
  time_at_location timestamptz,
  modified_time timestamptz NOT NULL,
  canceled boolean NOT NULL DEFAULT false,
  advertised boolean,
  operator text,
  train_type jsonb NOT NULL DEFAULT '[]',
  track_at_location text,
  deviations jsonb NOT NULL DEFAULT '[]',
  other_information jsonb NOT NULL DEFAULT '[]',
  raw_id bigint NOT NULL REFERENCES raw_announcements(id),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(advertised_train_ident, location_signature, advertised_time_at_location, activity_type)
);
CREATE INDEX announcements_location_time_idx ON announcements(location_signature, advertised_time_at_location DESC);
CREATE INDEX announcements_modified_idx ON announcements(modified_time);
CREATE INDEX announcements_missing_actual_idx ON announcements(advertised_time_at_location)
  WHERE time_at_location IS NULL AND canceled = false;

CREATE TABLE ingest_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  rows_fetched integer NOT NULL DEFAULT 0,
  rows_upserted integer NOT NULL DEFAULT 0,
  rows_dead_lettered integer NOT NULL DEFAULT 0,
  error text
);

CREATE TABLE dead_letters (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ingest_run_id bigint REFERENCES ingest_runs(id),
  failed_at timestamptz NOT NULL DEFAULT now(),
  error text NOT NULL,
  payload jsonb NOT NULL
);

CREATE TABLE ingest_cursors (
  name text PRIMARY KEY,
  high_water_mark timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Defense in depth for Supabase's Data API. No anon/authenticated policies are
-- created: ingestion and reads go through trusted server-side connections/API.
ALTER TABLE raw_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dead_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingest_cursors ENABLE ROW LEVEL SECURITY;
