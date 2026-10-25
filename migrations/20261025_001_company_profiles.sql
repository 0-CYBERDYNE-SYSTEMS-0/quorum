-- Replace agricultural profiles and weather cache with business company profiles.
BEGIN;

CREATE TABLE IF NOT EXISTS company_profiles (
  id serial PRIMARY KEY,
  user_id integer NOT NULL UNIQUE REFERENCES users(id),
  company_name text NOT NULL DEFAULT 'My Company',
  industry text NOT NULL DEFAULT '',
  stage text NOT NULL DEFAULT '',
  headcount text NOT NULL DEFAULT '',
  revenue_band text NOT NULL DEFAULT '',
  business_model text NOT NULL DEFAULT '',
  markets text[] DEFAULT '{}',
  constraints text NOT NULL DEFAULT '',
  risk_appetite text NOT NULL DEFAULT 'balanced',
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

DROP TABLE IF EXISTS farm_profiles;
DROP TABLE IF EXISTS weather_cache;
ALTER TABLE conversations ALTER COLUMN title SET DEFAULT 'New board session';

COMMIT;
