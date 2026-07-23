-- Migration: 022_regen_queue_audit_retries.sql
-- Bounded auto-retry for the content pipeline: when a polished review fails the
-- quality audit, the cron re-queues it for regeneration up to AUDIT_RETRY_MAX
-- times before parking it for a human. This counter is distinct from `attempts`
-- (which is per-stage and resets on stage advance). Applied to prod. Idempotent.
ALTER TABLE regen_queue ADD COLUMN IF NOT EXISTS audit_retries integer NOT NULL DEFAULT 0;
