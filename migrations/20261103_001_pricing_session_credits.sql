-- Pricing v1: one-time session credits (Single Session $5, Boardroom Session $15).
-- Additive only: no existing table or column is modified destructively, and no
-- rows are deleted. Safe to run on a live database.
BEGIN;

CREATE TABLE IF NOT EXISTS session_credits (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'available',
  stripe_checkout_session_id text NOT NULL,
  conversation_id integer REFERENCES conversations(id) ON DELETE SET NULL,
  ai_spend_usd double precision NOT NULL DEFAULT 0,
  created_at timestamp DEFAULT now(),
  used_at timestamp
);

-- Idempotency: a replayed Stripe webhook cannot grant the same credit twice.
CREATE UNIQUE INDEX IF NOT EXISTS session_credits_checkout_session_unique
  ON session_credits (stripe_checkout_session_id);

CREATE INDEX IF NOT EXISTS session_credits_user_status_idx
  ON session_credits (user_id, status);

-- A credit conversation keeps its limits for life, so the link is stored once.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS session_credit_id integer;

COMMIT;
