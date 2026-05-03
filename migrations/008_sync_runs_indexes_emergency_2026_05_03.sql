-- 008_sync_runs_indexes_emergency_2026_05_03.sql
-- Run in Supabase SQL Editor.
--
-- ─── BACKGROUND ──────────────────────────────────────────────────────
-- Companion / reconciliation to 007_sync_runs_cleanup_indexes.sql. The
-- 2026-04-27 incident left behind that 007 file documenting the indexes
-- the scraper needs to avoid 522-storming the PostgREST pool, but the
-- file was never applied to the live database — there's no migration
-- runner; migrations/ is just a folder.
--
-- Today, 2026-05-03, a scrape that started at 10:41 UTC ran into the
-- exact same failure mode predicted by the 007 comments: the scraper's
-- writes contended with the dashboard's heartbeat-stale-cleanup PATCH
-- (`progress->>'last_heartbeat'`-filtered) plus the history endpoint's
-- ORDER BY started_at, both unindexed. Cloudflare started returning
-- 522 across the board, the scraper lambda died, and the admin
-- dashboard locked into skeleton loaders.
--
-- Recovery this incident:
--   1. Manually cancelled the stuck job in the Supabase SQL Editor:
--        UPDATE sync_runs SET status='failed', finished_at=NOW(),
--          error_message='Manually cancelled — DB gridlock recovery 2026-05-03'
--        WHERE status IN ('pending','running');
--   2. Applied the indexes below (also in this file) directly via the
--      dashboard so they were in place before the next scrape.
--   3. Increased Supabase compute size for additional headroom.
--
-- Why this migration exists separately from 007 instead of just
-- applying 007:
--   - 007 uses CREATE INDEX CONCURRENTLY which can't run inside a
--     transaction. Supabase's apply_migration wraps in a transaction,
--     so 007 has to be applied via the dashboard's SQL Editor with the
--     CONCURRENTLY keyword removed (or via the CLI which streams
--     statement-by-statement).
--   - The dashboard apply during the incident dropped CONCURRENTLY,
--     which is fine on a small table under load that's about to drop
--     anyway. This file documents what was actually applied.
--
-- ─── INDEXES ─────────────────────────────────────────────────────────
--
-- Three load-bearing indexes for the scraper hot paths. All IF NOT
-- EXISTS so this migration is safe to re-run on a database that was
-- patched manually during the incident.
--
--   1. idx_sync_runs_started_at_desc — supports the history endpoint's
--      `ORDER BY started_at DESC LIMIT N` query that powers the admin
--      dashboard. Without this, the dashboard does a seq scan + sort on
--      every poll (8s cadence post-Tier-1).
--
--   2. idx_sync_runs_active_status — partial index on status for the
--      'pending'/'running' rows that getActiveJob and cleanupStaleJobs
--      filter on. The active set is usually 0-1 rows; partial keeps
--      the index tiny.
--
--   3. idx_sync_runs_heartbeat — expression index on
--      (progress->>'last_heartbeat'). cleanupStaleJobs filters jobs
--      WHERE progress->>'last_heartbeat' < cutoff. Without this, every
--      cleanup call seq-scans the whole table and JSON-extracts on
--      every row.
--
-- Migration 007 also creates partial composite indexes
-- (idx_sync_runs_active_started_at, idx_sync_runs_active_heartbeat)
-- limited to active rows. Apply 007 separately (after removing
-- CONCURRENTLY for the apply_migration path, or via the CLI for
-- CONCURRENTLY support) for the full belt-and-suspenders coverage.

CREATE INDEX IF NOT EXISTS idx_sync_runs_started_at_desc
  ON public.sync_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_runs_active_status
  ON public.sync_runs (status)
  WHERE status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS idx_sync_runs_heartbeat
  ON public.sync_runs ((progress->>'last_heartbeat'));

-- ─── VERIFICATION ────────────────────────────────────────────────────
-- After applying, run:
--
--   SELECT indexname FROM pg_indexes WHERE tablename = 'sync_runs'
--   ORDER BY indexname;
--
-- Expected (post 007 + 008):
--   sync_runs_pkey
--   idx_sync_runs_active_heartbeat       (007)
--   idx_sync_runs_active_started_at      (007)
--   idx_sync_runs_active_status          (008)
--   idx_sync_runs_heartbeat              (008)
--   idx_sync_runs_started_at_desc        (008)
--
-- ─── FOLLOW-UP ───────────────────────────────────────────────────────
-- This migrations/ folder needs an actual runner. Right now it's a
-- documentation directory only — files sit unapplied for days, as
-- happened with 007. Either:
--   (a) Wire `supabase db push` into the deploy pipeline
--   (b) Add a Vercel cron that checks supabase_migrations.schema_migrations
--       against the directory and warns when they diverge
--   (c) Move to a proper migration tool (drizzle-kit, prisma migrate)
-- That's a separate operational decision; this file just records that
-- the gap exists.
