-- ──────────────────────────────────────────────────────────────────────────
-- One-shot keyword pivot: romance-scammer-red-flags
--
-- Pre-pivot (current state):
--   target_keyword:    "romance scammer red flags"   (vol 20, KD n/a, TP n/a)
--   meta_description:  "Spot romance scammers before they take your money..."
--
-- Post-pivot (this update):
--   target_keyword:    "signs of a romance scammer"  (vol 250, KD 45, TP 4,900)
--   meta_description:  Leads with "signs of a romance scammer" + retains
--                      "red flags" secondary, keeps pig-butchering AIO hook
--
-- Rationale: the article body already covers "signs of a romance scammer"
-- intent verbatim across all 7 sections. The current target keyword has
-- 20 monthly searches and Ahrefs can't even compute traffic potential
-- on it — a parent-topic gap. Pivoting to the higher-TP phrase captures
-- the same intent with ~245x larger SERP demand, while keeping the
-- existing URL slug stable (no SEO damage from URL changes).
--
-- The H1 ("Romance Scammer Red Flags: How to Recognize the Setup Before
-- You Lose Money") stays intact — it already contains both phrases'
-- key terms ("Romance Scammer", "Recognize"). No regeneration needed.
--
-- The keyword pivot also propagates to JSON-LD's Article.keywords field
-- (the renderer reads row.targetKeyword) on next sync.
-- ──────────────────────────────────────────────────────────────────────────

-- Step 1: Update the topic-level target_keyword. This is the source of
-- truth — blog_posts.target_keyword on Replit gets re-synced from
-- content.topic.target_keyword on each publish, so updating the topic
-- propagates correctly on the next sync.
UPDATE topics
   SET target_keyword = 'signs of a romance scammer',
       updated_at     = NOW()
 WHERE id = '14ae1013-d9d0-47df-9264-53cb0edffee0';

-- Step 2: Update the content row's meta_description to lead with the new
-- keyword. The aux writer's meta_description leads with whatever keyword
-- it received; we override it directly here for an immediate effect on
-- the rendered <meta name="description"> + JSON-LD Article.description.
UPDATE content
   SET meta_description = 'Signs of a romance scammer: the 7 red flags every online dater should know in 2026, backed by FTC and FBI data — including pig butchering crypto pivots and AI-generated profiles.',
       updated_at = NOW()
 WHERE slug = 'romance-scammer-red-flags';

-- Step 3 (optional): Re-publish to fire the sync to Replit so the live
-- page picks up the new target_keyword + meta_description without a
-- full regen. Run this AFTER PR 2's renderer changes deploy:
--
-- INSERT INTO publish_jobs (content_id, action) VALUES
--   ('5181b95b-ae70-456a-942a-220b467b3441', 'publish');
--
-- Or simply click Publish on the admin UI — the unchanged article will
-- re-sync with the updated meta + keyword fields.
