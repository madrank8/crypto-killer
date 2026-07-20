-- Migration: 020_content_briefs.sql
-- Full 12-section content brief (content-brief-generator v1.4). Persisted rather
-- than computed because two things MUST survive a reload:
--   1. `forcing_inputs` — human-supplied Sullivan Gate (SC-098) evidence. These
--      come from the user/team/dataset and are never inferable, so losing them
--      would mean asking the author to re-enter them every time.
--   2. `status` — the draft → approved → in-production → published lifecycle.
-- Run in Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS content_briefs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id    uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  map_id      uuid REFERENCES topical_maps(id) ON DELETE SET NULL,

  -- cbr-[url-slug]-[YYYY-MM-DD] per the template's Section 1.
  brief_id    text,
  status      text NOT NULL DEFAULT 'draft',

  -- Section 3.5 — Sullivan Gate. sullivan_ok is the validated verdict; a brief may
  -- only leave 'draft' when it is true. forcing_inputs is verbatim human input.
  content_type   text,
  forcing_inputs jsonb,
  sullivan_ok    boolean NOT NULL DEFAULT false,

  -- The assembled 12-section brief. Placeholders ([NO DATA…], [UNVERIFIED…],
  -- [UNRESOLVED…], [PENDING…]) are meaningful values, not nulls to be filled in.
  brief       jsonb,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One current brief per topic; regeneration upserts in place.
CREATE UNIQUE INDEX IF NOT EXISTS content_briefs_topic_id_key ON content_briefs (topic_id);
CREATE INDEX IF NOT EXISTS content_briefs_map_id_idx ON content_briefs (map_id);
CREATE INDEX IF NOT EXISTS content_briefs_status_idx ON content_briefs (status);
