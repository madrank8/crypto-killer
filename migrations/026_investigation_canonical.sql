-- ═══════════════════════════════════════════════════════════════════════════
-- 026_investigation_canonical.sql
-- Phase 1 — canonical investigation data model. 2026-08-31.
--
-- Adds the canonical fields the investigation record needs and the existing
-- schema had no home for. Everything is NULLABLE with no default value on
-- purpose: an empty column means "not yet established", which the page
-- renders as an omitted row. It must never render as "0 regulator warnings",
-- because that is a factual claim we have not made.
--
-- Nothing here duplicates an existing store:
--   threat score      → stays on scam_brands.scam_score / reviews.scam_score
--   days active       → derived, never written (scam_brands.lifespan_days is
--                       an upstream cache the model only compares against)
--   creatives/geos/   → stay on scam_brands.total_* and the *_list arrays
--   celebrities
--   evidence sources  → stay on reviews.sources / reviews.citations
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Entity identity the ad data cannot give us ─────────────────────────────
-- Landing-page hostnames in brand_landing_pages are CLOAKED FAKE-NEWS
-- LANDERS (breaking24.novinky-cz.com, swisschronicle.click, …), not the
-- platform's own domain. They are surfaced to analysts as candidates by
-- lib/investigation-model.js::collectDomainCandidates but are never promoted
-- automatically, so primary_domain has to be set by a human.
ALTER TABLE scam_brands ADD COLUMN IF NOT EXISTS primary_domain    text;
ALTER TABLE scam_brands ADD COLUMN IF NOT EXISTS alternate_domains text[];

-- ── Classification inputs ──────────────────────────────────────────────────
-- scam_types:         e.g. {celebrity_deepfake, fake_trading_platform, recovery_scam}
-- detected_platforms: ad platforms the creatives were served on. No upstream
--                     source populates this today (the creatives table has no
--                     platform column) — left empty rather than guessed.
ALTER TABLE scam_brands ADD COLUMN IF NOT EXISTS scam_types        text[];
ALTER TABLE scam_brands ADD COLUMN IF NOT EXISTS detected_platforms text[];

-- ── External corroboration — the CONFIRMED (80+) evidentiary test ──────────
-- Published methodology: an entity is "confirmed" only with regulator-issued
-- warnings, multi-jurisdiction enforcement, or documented consumer harm.
-- lib/threat-classification.js reads these three columns and refuses
-- definitive scam language without at least one of them.
--
--   regulators_checked: [{ regulator, jurisdiction, register_url, checked_at,
--                          result: 'not_listed'|'listed'|'warned' }]
--   regulator_warnings: [{ regulator, jurisdiction, url, published_at, title }]
--   victim_reports:     { count, source, first_report_at, last_report_at }
ALTER TABLE scam_brands ADD COLUMN IF NOT EXISTS regulators_checked jsonb;
ALTER TABLE scam_brands ADD COLUMN IF NOT EXISTS regulator_warnings jsonb;
ALTER TABLE scam_brands ADD COLUMN IF NOT EXISTS victim_reports     jsonb;

-- ── Editorial override ─────────────────────────────────────────────────────
-- { classification, reason, analyst, set_at }. May only move the register to
-- a MORE cautious band; an override that would loosen language is refused at
-- runtime and recorded with `refused: true`. Reason and analyst are both
-- mandatory — an unattributed override is ignored.
ALTER TABLE scam_brands ADD COLUMN IF NOT EXISTS classification_override jsonb;
ALTER TABLE reviews     ADD COLUMN IF NOT EXISTS classification_override jsonb;

-- ── Evidence classes on findings ───────────────────────────────────────────
-- [{ id, claim, evidence_class: OBSERVED|REGULATORY|REPORTED|INFERRED,
--    source_url, observed_from, observed_to, metric_key }]
-- INFERRED and REPORTED findings must never be rendered with OBSERVED
-- styling; lib/evidence-labels.js is the only place that decides the label.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS evidence_items jsonb;

-- Snapshot of the canonical record at publish time, for auditability: it is
-- what the page asserted, independent of how the brand row later moves.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS canonical_snapshot jsonb;

-- Result of the last consistency-validator run (blocking + warning findings).
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS validation_report jsonb;

COMMENT ON COLUMN scam_brands.primary_domain IS
  'Analyst-set. NOT derivable from brand_landing_pages — those hostnames are cloaked ad landers, not the platform domain.';
COMMENT ON COLUMN scam_brands.regulator_warnings IS
  'Satisfies part of the CONFIRMED (80+) evidentiary test. Empty = no warning on file, which is NOT the same as "no warning exists" and must not be rendered as a finding.';
COMMENT ON COLUMN reviews.evidence_items IS
  'Findings tagged OBSERVED | REGULATORY | REPORTED | INFERRED. See lib/evidence-labels.js.';
