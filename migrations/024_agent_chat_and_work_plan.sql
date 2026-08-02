-- Agent chat threads + Work Plan queue for the living growth agent.
-- Applied via Supabase (Crypto Killer project).

-- ─── Chat ───────────────────────────────────────────────────────────
create table if not exists agent_chat_threads (
  id uuid primary key default gen_random_uuid(),
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references agent_chat_threads(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  citations_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_chat_messages_thread
  on agent_chat_messages (thread_id, created_at);

alter table agent_chat_threads enable row level security;
alter table agent_chat_messages enable row level security;

-- ─── Work Plan ──────────────────────────────────────────────────────
create table if not exists work_plan_items (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  action_type text not null,
  target text,
  title text not null,
  why text,
  priority text not null default 'P2' check (priority in ('P0', 'P1', 'P2')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'blocked', 'done', 'dismissed')),
  content_id uuid,
  deep_link text,
  last_error text,
  outcome_json jsonb,
  source_report_id uuid,
  executed_at timestamptz,
  baseline_clicks int,
  baseline_impressions int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_work_plan_status_priority
  on work_plan_items (status, priority, created_at desc);

alter table work_plan_items enable row level security;

-- ─── Agent action audit (autonomous publishes / runner events) ──────
create table if not exists agent_actions (
  id uuid primary key default gen_random_uuid(),
  action_type text not null,
  fingerprint text,
  content_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_actions_created
  on agent_actions (created_at desc);

alter table agent_actions enable row level security;
