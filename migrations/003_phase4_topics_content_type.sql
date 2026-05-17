-- Migration: 003_phase4_topics_content_type.sql
-- Phase 4 — extends topics.content_type CHECK so admin "New Content" can use
-- blog_post, informational_page, landing_page (matches app VALID_CONTENT_TYPES).
--
-- Run in Supabase SQL Editor (Dashboard → SQL → New query) against the project
-- that backs crypto-killer. Safe to re-run only after verifying constraint name
-- if the DROP below errors (see NOTE).

-- Default Postgres name for inline CHECK on topics.content_type is usually:
--   topics_content_type_check
-- If DROP fails, run:
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'public.topics'::regclass AND contype = 'c';

ALTER TABLE public.topics
  DROP CONSTRAINT IF EXISTS topics_content_type_check;

ALTER TABLE public.topics
  ADD CONSTRAINT topics_content_type_check CHECK (
    content_type IN (
      'pillar_page',
      'guide',
      'educational',
      'comparison',
      'recovery_guide',
      'prevention',
      'brand_review',
      'listicle',
      'glossary',
      'blog_post',
      'informational_page',
      'landing_page'
    )
  );
