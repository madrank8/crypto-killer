-- 011_content_outline_sections.sql
-- Preserve the approved outline across fill re-runs (audit 2026-07-05, A6).
-- fill overwrites content.sections with {heading, body}; the outline's
-- description/key_points/word targets live here so regeneration keeps context.
-- (Already applied to production via Supabase MCP on 2026-07-05.)
alter table content add column if not exists outline_sections jsonb;
