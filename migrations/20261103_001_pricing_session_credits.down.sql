-- Roll back pricing v1 session credits. Used credit rows are purchase records;
-- dropping them loses the one-time purchase history.
BEGIN;

ALTER TABLE conversations DROP COLUMN IF EXISTS session_credit_id;

DROP INDEX IF EXISTS session_credits_user_status_idx;
DROP INDEX IF EXISTS session_credits_checkout_session_unique;
DROP TABLE IF EXISTS session_credits;

COMMIT;
