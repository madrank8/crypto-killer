# Replit Handoff: 3 renderer changes after the 2026-07-05 pipeline audit

The Vercel admin pipeline shipped 5 waves of fixes (see `generation-pipeline-audit-2026-07-05.md`). Three items need matching changes in the **cryptokiller (Replit) repo**. Priority order:

---

## 1. Render the `ai_disclosure` block (NEW FIELD — needed before regenerating content)

**What changed:** every review and blog article now carries an `ai_disclosure` text column (plain text, deterministic, ~2-4 sentences: "How this investigation was created: …"). It ships in the sync payload for both reviews and blog posts.

**What to do:** render it as a "How this was created" block near the byline/methodology area on both review pages (`prerender.ts` + ReviewPage client) and blog posts. Plain text in, wrap/style it — suggested: a muted, bordered box with a small "ℹ️ How this was created" heading.

**Why:** Google E-E-A-T "How" signal (using-gen-ai-content guidance) — ai-brain canon marks this MANDATORY. The Vercel publish gate currently only warns when it's missing; it upgrades to a **blocking error** once you confirm the renderer displays it.

**Schema note:** if you also want it machine-readable, add to the Article JSON-LD: nothing standard exists for disclosure text — leave it out of schema, visible text is what matters.

## 2. Extend `{{platform_stat:KEY}}` substitution to BLOG article bodies

**What changed:** article section writers now weave live stat tokens ({{platform_stat:total_brands_tracked}}, total_creatives_analyzed, avg_scam_score, total_brands_with_celebrity_abuse) into `full_article` body prose of BLOG posts. Previously those tokens only appeared in review pages.

**What to do:** confirm the token-substitution layer (`platformStatTokens.ts`, fed by the hourly `/api/sync/platform-aggregates` webhook) runs on the blog rendering path, not just `/review/*`. If it's review-only, apply the same substitution to blog `full_article` before render.

**Why:** without this, new blog articles can render literal `{{platform_stat:total_brands_tracked}}` text to users.

**Test:** after wiring, generate any article on Vercel, sync, and grep the live blog HTML for `{{platform_stat` — must be zero hits.

## 3. Check `content.claims` consumer for `.claimReviewed` assumptions

**What changed:** blog-path `claims[]` are now honest **Claim** nodes: `{"@type":"Claim","text":"…","author":{…},"firstAppearance":"…"}`. Previously they were fake ClaimReview nodes with `claimReviewed` + `ratingValue:5 "Verified"` (fabricated fact-checks — removed for FTC/Google structured-data risk). Review-path claims (real debunks) are UNCHANGED.

**What to do:** in `blogSchemaEnrichment.ts`, find the ClaimReview builder fed by `content.claims`. If it reads `.claimReviewed`, it will now silently skip (fine) or mis-render (fix). Correct behavior: emit the Claim nodes as-is (they're already valid JSON-LD), or attach them as `Article.about`-adjacent claims — do NOT wrap them back into ClaimReview "Verified" nodes.

**Also:** legacy content rows synced from now on are canonicalized by the new `lib/content-sync-shape.js` on the Vercel side (flat shapes → JSON-LD), so dual-accept code for `how_to.steps` vs `.step` etc. on the blog path can eventually be simplified — not urgent.

---

## Not needed on Replit
- Analytics tracker: already installed (verified live).
- All publish gates, prompts, auditor changes: Vercel-side only.
- New review sidebar blocks (Ratings at a Glance, comparables table, dynamic regulator badges): baked into `full_article` HTML — render automatically via the existing sync.

## Sequencing
Do #2 before generating new blog articles. Do #1 whenever — then tell the Vercel side to upgrade the disclosure gate from warning to blocking. #3 is a 10-minute inspection.
