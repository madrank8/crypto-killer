-- Migration: multilingual reviews via review_translations table.
--
-- ─── Why ───
-- V1 launches with 6 locales: en (master), it, es, de, fr, pt-BR. Each brand
-- gets a single canonical Review row (master, en) plus zero-or-more
-- translation rows. Translations live in a side table so they don't bloat
-- the main reviews table and so each can have independent slug / status /
-- published_at / freshness tracking.
--
-- ─── YMYL policy (V1) ───
-- Per agreed scope, V1 translations are AI-translated and marked
-- translation_method = 'ai_assisted' with translator_name =
-- 'Crypto Killer Editorial Team', reviewed_at set at creation time. This
-- ships translations without per-translation human review while still
-- recording provenance honestly. The defense-in-depth trigger below
-- prevents future regressions where someone tries to publish an
-- 'ai_full' translation without setting reviewed_at — kept for when V2
-- adds stricter review workflow.
--
-- ─── Cross-codebase ───
-- The crypto-killer Vercel app owns translation generation and editing.
-- The cryptokiller.org Replit deployment reads these rows directly from
-- Supabase to render public pages and emit hreflang/canonical/sitemap
-- entries. See docs/REPLIT_TRANSLATIONS_HANDOFF.md (added in this round)
-- for the consumer-side spec.

BEGIN;

-- ─── reviews: add master/locale identity ───
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS locale     text    NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS is_master  boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN reviews.locale IS
  'Locale of the master review content. V1 always en. Translation locales live in review_translations.';
COMMENT ON COLUMN reviews.is_master IS
  'True for the canonical/master review. Reserved for V2 if we ever decouple master from EN.';

-- ─── review_translations ───
CREATE TABLE IF NOT EXISTS review_translations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id    uuid NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  locale       text NOT NULL CHECK (locale IN ('it', 'es', 'de', 'fr', 'pt-BR')),
  slug         text NOT NULL,
  status       text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review_pending', 'published', 'stale')),

  -- Translatable content fields (mirror reviews translatable subset)
  title                text,
  meta_description     text,
  headline             text,
  alternative_headline text,
  summary              text,
  how_it_works         text,
  verdict              text,
  full_article         text,
  red_flags            jsonb DEFAULT '[]'::jsonb,
  faq                  jsonb DEFAULT '[]'::jsonb,
  key_takeaways        jsonb DEFAULT '[]'::jsonb,
  not_for_you          text,
  protection_steps     text,
  methodology          text,
  disclaimer           text,
  expertise_depth      text,

  -- Provenance / trust
  source_review_updated_at timestamptz, -- snapshot of master.updated_at at translation time
  translation_method       text NOT NULL DEFAULT 'ai_assisted'
    CHECK (translation_method IN ('ai_full', 'ai_assisted', 'human_only')),
  ai_model                 text,
  ai_prompt_version        text DEFAULT 'translate-v1',
  translator_name          text DEFAULT 'Crypto Killer Editorial Team',
  translator_credentials   text,
  reviewed_at              timestamptz,

  word_count   integer DEFAULT 0,
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- Per-review, one row per locale
  UNIQUE (review_id, locale),
  -- Per-locale, slug must be unique so /it/review/<slug> routes are stable
  UNIQUE (locale, slug)
);

COMMENT ON TABLE review_translations IS
  'Per-locale translations of a master review. One row per (review_id, locale). slug is per-locale (native-language slug override supported).';

-- ─── Publish gate ───
-- Defense-in-depth: ai_full translations cannot reach status='published'
-- without reviewed_at being set. V1 defaults translation_method to
-- 'ai_assisted' so this doesn't block the V1 flow.
CREATE OR REPLACE FUNCTION enforce_human_review_before_publish()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'published'
     AND NEW.translation_method = 'ai_full'
     AND NEW.reviewed_at IS NULL THEN
    RAISE EXCEPTION 'YMYL policy: ai_full translation cannot be published without reviewed_at set (translation %)', NEW.id
      USING HINT = 'Set translation_method=ai_assisted with translator_name + reviewed_at, OR flip translation_method=human_only after a real human review.';
  END IF;
  -- Auto-bump updated_at on any UPDATE
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS review_translations_publish_gate ON review_translations;
CREATE TRIGGER review_translations_publish_gate
  BEFORE INSERT OR UPDATE ON review_translations
  FOR EACH ROW EXECUTE FUNCTION enforce_human_review_before_publish();

-- ─── Staleness flagging helper ───
-- Marks a translation as 'stale' when master.updated_at advances past
-- the snapshot taken at translation time. Called by a daily cron in V2;
-- for now exposed for manual invocation.
CREATE OR REPLACE FUNCTION mark_stale_translations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  marked int := 0;
BEGIN
  WITH stale AS (
    UPDATE review_translations rt
    SET status = 'stale'
    FROM reviews r
    WHERE rt.review_id = r.id
      AND rt.status = 'published'
      AND rt.source_review_updated_at IS NOT NULL
      AND r.updated_at > rt.source_review_updated_at + interval '1 hour'
    RETURNING 1
  )
  SELECT COUNT(*) INTO marked FROM stale;

  RETURN jsonb_build_object(
    'marked_stale', marked,
    'timestamp',    now()
  );
END;
$$;

-- ─── Indexes ───
CREATE INDEX IF NOT EXISTS rt_review_locale_idx       ON review_translations (review_id, locale);
CREATE INDEX IF NOT EXISTS rt_locale_status_slug_idx  ON review_translations (locale, status, slug);
CREATE INDEX IF NOT EXISTS rt_status_idx              ON review_translations (status);
-- Trigram on title for admin search across translations
CREATE INDEX IF NOT EXISTS rt_title_trgm_idx          ON review_translations USING gin (title gin_trgm_ops);

COMMIT;
