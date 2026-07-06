-- Migration: 016_topical_map_roles_coverage.sql
-- Content-role taxonomy + existing-coverage linkage for Topical Map v2.
-- Run in Supabase SQL Editor. Idempotent.

-- content_role: money (reviews/comparisons — monetization), pillar (topical
-- authority hubs), supporting (informational fan-out), trust (E-E-A-T
-- builders: methodology, data studies, glossary, regulatory, victim resources)
ALTER TABLE topics ADD COLUMN IF NOT EXISTS content_role text;

-- expands_content_slug: slug of an EXISTING published page this topic
-- extends (expansion, not duplication — site-aware generation)
ALTER TABLE topics ADD COLUMN IF NOT EXISTS expands_content_slug text;

CREATE INDEX IF NOT EXISTS idx_topics_content_role ON topics(content_role);
