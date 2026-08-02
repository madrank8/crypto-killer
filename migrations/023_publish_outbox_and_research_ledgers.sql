-- 023_publish_outbox_and_research_ledgers.sql
-- Wave 1 durability (2026-07-30):
--   1. publish_outbox — durable Replit sync queue with retries
--   2. research_ledgers — cache verified source ledgers across generate passes
--
-- Publish routes enqueue after the Supabase status flip; /api/cron/publish-outbox
-- drains pending rows. Research ledgers let outline/generate reuse verified
-- sources within the TTL instead of re-researching on every SSE run.

create table if not exists publish_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('review', 'content')),
  entity_id uuid not null,
  slug text,
  action text not null check (action in ('publish', 'unpublish')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'succeeded', 'failed', 'dead')),
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  last_attempt_at timestamptz,
  succeeded_at timestamptz,
  -- Optional snapshot; null means the worker rebuilds from live Supabase rows.
  payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_publish_outbox_drain
  on publish_outbox (status, next_attempt_at, created_at)
  where status in ('pending', 'failed');

create index if not exists idx_publish_outbox_entity
  on publish_outbox (kind, entity_id, created_at desc);

alter table publish_outbox enable row level security;

create table if not exists research_ledgers (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('topic', 'brand', 'content', 'review')),
  subject_key text not null,
  sources jsonb not null default '[]'::jsonb,
  citations jsonb,
  meta jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_type, subject_key)
);

create index if not exists idx_research_ledgers_expires
  on research_ledgers (expires_at);

alter table research_ledgers enable row level security;
