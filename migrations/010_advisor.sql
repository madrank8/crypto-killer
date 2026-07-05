-- 010_advisor.sql
-- AI Advisor: persisted analysis reports + suggestion done/dismiss states.
-- RLS enabled with NO policies on both tables — service_role only.

create table if not exists advisor_reports (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  trigger_type text not null default 'manual' check (trigger_type in ('manual', 'cron')),
  period_days  integer not null default 28,
  model        text,
  status       text not null default 'complete' check (status in ('complete', 'error')),
  error        text,
  report       jsonb,
  tokens_in    integer,
  tokens_out   integer
);

create index if not exists idx_advisor_reports_created on advisor_reports (created_at desc);

alter table advisor_reports enable row level security;

-- Suggestion states survive across reports: the model emits a stable
-- fingerprint per suggestion (action_type + target), so "done" / "dismissed"
-- persists even when the next report re-derives the same suggestion.
create table if not exists advisor_suggestion_states (
  fingerprint text primary key,
  state       text not null check (state in ('done', 'dismissed')),
  updated_at  timestamptz not null default now()
);

alter table advisor_suggestion_states enable row level security;
