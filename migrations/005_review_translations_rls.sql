-- Migration: enable Row Level Security on review_translations.
--
-- ─── Why ───
-- The Supabase advisor flagged that review_translations has RLS disabled,
-- meaning anyone with the anon key (which is exposed in our client JS bundle
-- via NEXT_PUBLIC_SUPABASE_ANON_KEY) can read, insert, update, or delete
-- every row — including drafts and unpublished translations. Locking this
-- down before anyone notices.
--
-- ─── Access model ───
-- All writes (POST/PATCH/DELETE) on this table happen server-side via
-- service_role (lib/supabase.js auto-picks service_role for write methods,
-- and the dedicated admin API routes use service_role explicitly). service_role
-- bypasses RLS entirely, so no policies are needed for it.
--
-- For reads:
--   - anon / authenticated: can SELECT only status='published' rows.
--     This covers any legitimate public consumer (a future client-side
--     widget, third-party API user, etc.) without exposing drafts.
--   - Admin reads that need drafts (admin UI sidebar list, locale editor,
--     Vercel admin preview at /[locale]/review/[slug]) are migrated to
--     pass useServiceRole: true to supabaseRequest(), which uses the
--     service_role key and bypasses RLS. That migration ships in the
--     same PR as this SQL.
--
-- ─── What this DOESN'T break ───
-- 1. /api/admin/reviews/[id]/translations GET — switched to service_role
-- 2. /api/admin/reviews/[id]/translations/[locale] GET/PATCH — switched
-- 3. app/[locale]/review/[slug] Vercel admin preview — switched
-- 4. EN master /review/[slug] hreflang lookup — filters status=eq.published, OK on anon
-- 5. /api/admin/reviews/[id]/publish + /sync — filter status=eq.published, OK on anon
-- 6. Replit sync ingestion — uses sync payload from Vercel, doesn't query Supabase directly
--
-- ─── Rollback ───
-- If something breaks unexpectedly:
--   ALTER TABLE public.review_translations DISABLE ROW LEVEL SECURITY;
-- Then debug what query hit anon path. (You should never have to roll this
-- back — the code audit covered every supabaseRequest call site.)

BEGIN;

-- Enable RLS. Until we add policies below, this DENIES all access from
-- anon and authenticated roles. service_role still works (bypasses RLS).
ALTER TABLE public.review_translations ENABLE ROW LEVEL SECURITY;

-- Public read policy: anyone with anon or authenticated role can SELECT
-- only published rows. Drafts, review_pending, and stale rows are hidden.
DROP POLICY IF EXISTS "Public can read published translations" ON public.review_translations;
CREATE POLICY "Public can read published translations"
  ON public.review_translations
  FOR SELECT
  TO anon, authenticated
  USING (status = 'published');

-- Explicitly: no anon/authenticated INSERT/UPDATE/DELETE policies.
-- Without policies, those operations are denied for these roles.
-- service_role bypasses RLS so admin writes keep working.

COMMENT ON POLICY "Public can read published translations" ON public.review_translations IS
  'Only status=published rows are visible to anon/authenticated. Drafts and stale rows are admin-only via service_role (lib/supabase.js useServiceRole option).';

COMMIT;
