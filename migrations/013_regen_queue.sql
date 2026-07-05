-- 013_regen_queue.sql
-- Content-maintenance regeneration queue (2026-07-05).
-- Processed by /api/cron/content-maintenance as a state machine:
-- queued → generating → generated → polishing → polished → published
--                                              ↘ needs_review / failed
-- (Already applied + seeded with the 24-review campaign via Supabase MCP.)
create table if not exists regen_queue (
  id           uuid primary key default gen_random_uuid(),
  review_id    uuid not null,
  brand_id     uuid not null,
  slug         text not null unique,
  priority     integer not null default 100,
  status       text not null default 'queued' check (status in
    ('queued','generating','generated','polishing','polished','published','needs_review','failed','skipped')),
  reason       text,
  note         text,
  attempts     integer not null default 0,
  last_error   text,
  stage_started_at timestamptz,
  queued_at    timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_regen_queue_status_priority on regen_queue (status, priority);
alter table regen_queue enable row level security;
