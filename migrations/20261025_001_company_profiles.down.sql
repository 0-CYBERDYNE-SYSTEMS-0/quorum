-- Roll back the company profile schema. Dropped agricultural profile data
-- and cached weather responses cannot be reconstructed by this migration.
BEGIN;

DROP TABLE IF EXISTS company_profiles;
ALTER TABLE conversations ALTER COLUMN title SET DEFAULT 'New Conversation';

CREATE TABLE IF NOT EXISTS farm_profiles (
  id serial PRIMARY KEY,
  user_id integer NOT NULL UNIQUE REFERENCES users(id),
  farm_name text NOT NULL DEFAULT 'My Farm',
  location text NOT NULL DEFAULT '',
  lat text,
  lng text,
  acres integer DEFAULT 0,
  crops text[] DEFAULT '{}',
  soil_type text DEFAULT '',
  water_source text DEFAULT '',
  climate_zone text DEFAULT '',
  hardiness_zone text DEFAULT '',
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS weather_cache (
  id serial PRIMARY KEY,
  lat text NOT NULL,
  lng text NOT NULL,
  data json NOT NULL,
  fetched_at timestamp DEFAULT now()
);

COMMIT;
