-- 017_brand_recency_evidence.sql
-- last30days → storm-research recency evidence pool (2026-07-07).
--
-- One row per brand. Populated by an agent-side pre-pass (Cowork):
--   last30days(brand) → storm-research(YMYL) → normalized, grounded pool
--   → POST /api/admin/brands/:id/recency (upsert).
-- Consumed by /api/admin/reviews/generate Phase 2.6 as a `community_report`
-- source class, gated behind RECENCY_EVIDENCE_ENABLED.
--
-- pool / summary are JSONB so the evidence-item shape can evolve without
-- a migration. See last30days-integration-plan.md §4 for the contract.

create table if not exists brand_recency_evidence (
  brand_id      uuid primary key references scam_brands (id) on delete cascade,
  pool          jsonb not null default '[]'::jsonb,
  summary       jsonb not null default '{}'::jsonb,
  dossier_md    text,
  window_start  date,
  window_end    date,
  grounded_by   text not null default 'last30days+storm-research',
  run_note      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table brand_recency_evidence is
  'Grounded last-30-day community evidence pool per brand (last30days + storm-research). Read by the review generator as the community_report source class.';

-- Fast "is this pool stale?" filter on the freshness date.
create index if not exists idx_brand_recency_window_end
  on brand_recency_evidence (window_end desc);

-- Keep updated_at honest on upsert.
create or replace function set_brand_recency_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_brand_recency_updated_at on brand_recency_evidence;
create trigger trg_brand_recency_updated_at
  before update on brand_recency_evidence
  for each row execute function set_brand_recency_updated_at();

-- RLS: locked down. Only the service role (server routes) touches this table;
-- the anon/authenticated client keys get no access. Matches the posture of the
-- other admin-only tables in this schema.
alter table brand_recency_evidence enable row level security;

drop policy if exists brand_recency_service_all on brand_recency_evidence;
create policy brand_recency_service_all
  on brand_recency_evidence
  for all
  to service_role
  using (true)
  with check (true);
