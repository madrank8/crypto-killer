-- 012_ai_disclosure.sql
-- AI disclosure text (canon seo-blog-generator Step 6.8, audit 2026-07-05 W4c).
-- Deterministically generated per row (lib/ai-disclosure.js); rendered
-- Replit-side as a "How this was created" block near the byline.
-- (Already applied to production via Supabase MCP on 2026-07-05.)
alter table reviews add column if not exists ai_disclosure text;
alter table content add column if not exists ai_disclosure text;
