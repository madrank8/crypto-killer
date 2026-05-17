-- 007_sync_runs_cleanup_indexes.sql
--
-- Background — incident 2026-04-27. The scraper admin page polls
-- /api/admin/scraper/history every 3s and runs an ActiveJobPanel tick every
-- 1s. Every call invoked cleanupStaleJobs() in lib/scraper.js, which issues
-- a PATCH on sync_runs filtered by `progress->>'last_heartbeat'` — a jsonb
-- expression with no supporting index. Each call did a sequential scan +
-- took row locks, and concurrent calls piled up holding locks on each other.
-- PostgREST's connection pool exhausted, Cloudflare returned 522 fleet-wide,
-- the frontend retried, and the system entered a feedback collapse.
--
-- The application-side fix debounces cleanup to once per 30s in lambda
-- memory. These indexes provide the matching DB-side fix so even unthrottled
-- callers (cron, ad-hoc DELETE handlers) get a fast partial index lookup
-- instead of a full table scan.
--
-- Both indexes are partial — they only cover the rows the cleanup query
-- actually inspects (status in 'pending'/'running'), keeping them tiny.
-- For the heartbeat index we use a btree on the jsonb text expression so
-- PostgREST's `progress->>last_heartbeat.lt.X` filter can use it.
--
-- Safe to apply with traffic: CONCURRENTLY avoids blocking the table.
-- Idempotent via IF NOT EXISTS.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sync_runs_active_started_at
  ON public.sync_runs (started_at)
  WHERE status IN ('pending', 'running');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sync_runs_active_heartbeat
  ON public.sync_runs (((progress->>'last_heartbeat')))
  WHERE status IN ('pending', 'running');

-- Sanity check — should report < 1ms for both predicates after the indexes
-- come online.
-- EXPLAIN (ANALYZE, BUFFERS)
--   SELECT id FROM sync_runs
--   WHERE status IN ('pending','running')
--     AND (started_at < now() - interval '6 minutes'
--          OR (progress->>'last_heartbeat') < to_char(now() - interval '3 minutes', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
