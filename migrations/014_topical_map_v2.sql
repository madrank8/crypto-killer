-- Migration: 014_topical_map_v2.sql
-- Topical Map v2 — staged pipeline runs + canon (v4.3) topic columns.
-- Run in Supabase SQL Editor. Idempotent (IF NOT EXISTS everywhere).

-- 1. Pipeline runs — one row per generation run, resumable stage-by-stage.
CREATE TABLE IF NOT EXISTS topical_map_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id uuid REFERENCES topical_maps(id) ON DELETE SET NULL,
  seed_keyword text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled'
  )),
  current_stage text NOT NULL DEFAULT 'foundation',
  -- config: { poolCap, serpTopK, competitorDomains[], locationName, languageCode, waveSize, skipSerp }
  config jsonb NOT NULL DEFAULT '{}',
  -- artifacts: { foundation, pool, clusters, structure, linked, qa_report, save }
  artifacts jsonb NOT NULL DEFAULT '{}',
  stage_log jsonb NOT NULL DEFAULT '[]',
  error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tm_runs_status ON topical_map_runs(status);
CREATE INDEX IF NOT EXISTS idx_tm_runs_created ON topical_map_runs(created_at DESC);

-- 2. Canon v4.3 columns on topics
ALTER TABLE topics ADD COLUMN IF NOT EXISTS section text; -- 'core' | 'outer'
ALTER TABLE topics ADD COLUMN IF NOT EXISTS search_intent text; -- informational|commercial|transactional|navigational|generative
ALTER TABLE topics ADD COLUMN IF NOT EXISTS cpc numeric;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS volume_trend_yearly numeric;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS keyword_data_source text; -- 'dataforseo' | 'llm-estimated'
ALTER TABLE topics ADD COLUMN IF NOT EXISTS page_role text; -- Root | Core | Outer
ALTER TABLE topics ADD COLUMN IF NOT EXISTS macro_vector text;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS node_type text; -- quality | trending | standard
ALTER TABLE topics ADD COLUMN IF NOT EXISTS format_code text; -- canon Format column (e.g. LIST, HOWTO, DEF, COMP)
ALTER TABLE topics ADD COLUMN IF NOT EXISTS aio_risk text; -- low | medium | high | critical
ALTER TABLE topics ADD COLUMN IF NOT EXISTS fan_out_tag text;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS serp_features jsonb DEFAULT '[]';
ALTER TABLE topics ADD COLUMN IF NOT EXISTS paa_questions jsonb DEFAULT '[]';
ALTER TABLE topics ADD COLUMN IF NOT EXISTS cluster_key text;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS publication_wave int;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS qa_flags jsonb DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_topics_wave ON topics(publication_wave);
CREATE INDEX IF NOT EXISTS idx_topics_node_type ON topics(node_type);

-- 3. Map-level provenance
ALTER TABLE topical_maps ADD COLUMN IF NOT EXISTS run_id uuid;
ALTER TABLE topical_maps ADD COLUMN IF NOT EXISTS seed_keyword text;
ALTER TABLE topical_maps ADD COLUMN IF NOT EXISTS core_components jsonb;
