# Crypto Killer — Product Spec (Draft)

**Author**: Niro
**Date**: March 29, 2026
**Status**: Draft — ready for review

---

## Context

Crypto Killer is a scam interception platform. SpyOwl (Niro's proprietary ad intelligence scraper) detects crypto scam brands by pulling ad creatives from paid feeds across 50+ GEOs, bypassing cloaking. The pipeline feeds a Next.js webapp that publishes SEO-optimized review articles targeting "[brand name] scam" queries, intercepting victims before they deposit.

**What exists today:**
- SpyOwl scraper: fetches creatives from api.spyowl.icu → SQLite → sync.js → Supabase (1,000 brands, 1,000 creatives synced)
- Next.js 14 webapp: home, /scams browse, /review/[slug] dynamic pages, /dashboard, /api/search
- Supabase schema: `creatives`, `scam_brands`, `reviews`, `geo_regions`, `sync_runs`
- Live at crypto-killer.vercel.app

**What's wrong:**
- Reviews are template stubs — 6 hardcoded red flags, identical "how it works" text, no real investigation. Not publishable content.
- No admin interface. Scraping requires SSH + CLI. No way to triage brands, generate reviews, or manage content from a browser.
- No publishing workflow. Reviews are either "draft" or "published" with no approval step or content quality gate.

**What we're building:**
Two surfaces — an Admin Dashboard for intelligence operations, and a Review Article Engine for SEO content production.

---

## Principles

1. **Solo operator first.** Niro is the only user. No multi-tenant auth, no team features, no role management. A simple shared secret or env-based auth gate on /admin routes is sufficient.

2. **Signal over noise.** The triage view should surface brands worth writing about — highest creative volume and fastest velocity growth — not dump 1,000 brands in a table. The default sort is the story.

3. **AI drafts, human publishes.** Claude generates review drafts using SEO skill patterns and writing rules. Niro reads, edits, and approves every article before it goes live. No auto-publish.

4. **Real articles, not templates.** Each review should be a genuine 2,000–2,500 word investigation: verdict → evidence stats → how the scam works → red flags with proof → FAQ. Not a mail-merge of the same 6 bullet points.

5. **SpyOwl data is the moat.** Every review is grounded in ad intelligence data — creative counts, geo spread, celebrity misuse, velocity trends. This is evidence competitors cannot replicate.

6. **Ship incrementally.** Dashboard first (unlock daily operations), then review generation (unlock content production), then polish (SEO schema, analytics, scheduled publishing).

---

## Design

### Surface 1: Admin Dashboard (`/admin`)

The dashboard is Niro's scraper control panel and brand triage workspace.

#### 1.1 Scraper Control

A section at the top of `/admin` with:

- **Run Scrape** button that triggers the SpyOwl scraper via API route
  - Parameters: geo codes (multi-select or "all"), days lookback, creative limit
  - Calls `POST /api/admin/scrape` which spawns the scraper process
  - Shows real-time status: idle / running / completed / failed
- **Last Scrape** card showing: timestamp, creatives found, new brands detected, duration
- **Scrape History** table: last 20 runs with geo_filter, total_api, new_creatives, updated_creatives, status, duration

**Backend**: The API route executes the scraper as a child process (or calls the scraper module directly). Scrape runs get logged to Supabase `sync_runs` table (currently empty — needs to be populated).

**Important constraint**: The scraper requires a SpyOwl auth cookie (`cookies.txt`) and Playwright for browser automation. On Vercel's serverless environment, running Playwright is not feasible. Two options:

- **Option A (recommended)**: Scraper runs locally or on a VPS. The admin dashboard shows status by reading `sync_runs` from Supabase. A "sync now" button calls a webhook on the scraper host. The scraper writes its run status to Supabase when done.
- **Option B**: Scraper runs inside a long-running Vercel function (max 300s on Pro plan). Feasible for small scrapes but not for full 50-GEO runs.

Decision: **Option A** — scraper stays external, dashboard reads results from Supabase. The admin UI is a viewer + trigger, not the execution environment.

#### 1.2 Intelligence Overview

KPI cards (already partially built in /dashboard, move to /admin):

- Total brands detected
- Total creatives in system
- Active brands (velocity_7d > 0)
- New brands (last 7 days)
- Reviews published / drafts pending

#### 1.3 Brand Triage

The core workflow surface. A table of scam brands, default-sorted by triage priority:

**Default sort**: Composite of `total_creatives` (volume) and `velocity_7d` (momentum). Surging brands with high volume float to top.

**Columns**:
- Brand name (linked to /review/[slug] if review exists)
- Scam score (0–100 gauge)
- Total creatives
- Velocity 7d (with trend badge: surging/rising/stable/declining/dead)
- GEOs (count)
- Celebrities (count)
- Review status: none / draft / published
- Action: **Generate Review** button (if no review) or **Edit Review** button (if draft/published)

**Filters**:
- Review status: all / no review / draft / published
- Velocity trend: all / surging / rising / stable / declining / dead
- Min creatives threshold (slider or input)

**Behavior**:
- Clicking "Generate Review" opens the review generation flow (Surface 2)
- Clicking "Edit Review" navigates to `/admin/review/[id]` editor
- Rows without a review but with high signal get a visual highlight (e.g., pulsing dot or gold border)

#### 1.4 Activity Feed

A sidebar or bottom section showing recent events:
- "Scrape completed: 2,400 new creatives across 12 GEOs" (2h ago)
- "New brand detected: CryptoGenius AI" (2h ago)
- "Review published: Quantum AI" (yesterday)

Populated from `sync_runs` + `reviews` + `scam_brands` timestamps.

---

### Surface 2: Review Article Engine

#### 2.1 Review Generation (`POST /api/admin/reviews/generate`)

When Niro clicks "Generate Review" on a brand:

1. **Collect brand intelligence** from Supabase:
   - Brand record: name, scam_score, total_creatives, total_geos, total_celebrities, celebrity_list, geo_list, velocity_7d, velocity_trend, lifespan_days, first_seen_at, last_seen_at
   - Creative sample: 10–20 representative creatives (different geos, celebrities, dates) for evidence grounding

2. **Build prompt** combining:
   - The review article template structure (from teardown research): verdict → stats → how it works → red flags → FAQ
   - SEO optimization rules (from seo-blog-generator skill): keyword placement, entity density, information gain
   - Writing rules (separate ruleset — TBD, see Open Questions)
   - Brand-specific intelligence data as grounding context

3. **Call Claude API** (`POST https://api.anthropic.com/v1/messages`):
   - Model: claude-sonnet-4-5 (fast, cost-effective for content generation)
   - System prompt: review generation instructions + writing rules
   - User message: brand intelligence data + "Write a 2,000–2,500 word scam review article"
   - Temperature: 0.7 (some creativity, but grounded in data)

4. **Parse response** into review fields:
   - title, headline, meta_description
   - summary (opening verdict paragraph)
   - how_it_works (detailed scam mechanics section)
   - red_flags (JSON array — dynamic, evidence-backed, not hardcoded)
   - verdict (final recommendation)
   - faq (JSON array of question/answer pairs)
   - full_article (complete markdown body for the public page)

5. **Save to Supabase** `reviews` table with status = "draft"

6. **Redirect to editor** at `/admin/review/[id]`

#### 2.2 Review Editor (`/admin/review/[id]`)

A full-page editor where Niro reviews, edits, and approves the AI-generated draft.

**Layout**: Two-column — editor on left, live preview on right.

**Editable fields**:
- Title (with character count — target 60 chars for SERP)
- Headline
- Meta description (with character count — target 155 chars)
- Full article body (markdown editor with toolbar)
- Red flags (add/remove/edit individual flags)
- FAQ entries (add/remove/edit Q&A pairs)
- Verdict

**Preview pane**: Renders the article as it would appear on the public `/review/[slug]` page, including:
- Scam score gauge
- Stats sidebar
- Red flag cards
- FAQ accordion
- Schema markup preview (collapsible JSON-LD viewer)

**Actions**:
- **Save Draft** — saves current state, stays on editor
- **Regenerate** — calls Claude API again with updated prompt (e.g., if Niro adds notes like "emphasize the celebrity deepfakes angle")
- **Publish** — sets status to "published", sets published_at timestamp, article goes live on /review/[slug]
- **Unpublish** — reverts to draft status, removes from public site
- **Delete** — removes review entirely (with confirmation)

#### 2.3 Review Article Public Page (existing, enhanced)

The current `/review/[slug]/page.js` already renders reviews. Enhancements needed:

- **Article body rendering**: Currently shows hardcoded sections. Needs to render the `full_article` markdown field as rich HTML.
- **FAQ section**: Render `faq` JSON as an accordion/expandable section.
- **Dynamic red flags**: Render from `red_flags` JSON instead of hardcoded templates.
- **Schema markup**: Generate Article + ClaimReview + FAQPage JSON-LD from the review data, not static templates.
- **Internal linking**: Auto-link to related scam reviews (same celebrity, same geo, similar score).
- **CTAs**: "Report this scam" button, "See legitimate alternatives" link, "Share this review" social buttons.

#### 2.4 Content Quality Signals

Each review in the triage table and editor shows quality indicators:
- Word count (target: 2,000–2,500)
- Red flag count (target: 5–8 unique, evidence-backed flags)
- FAQ count (target: 5–8 questions)
- Has custom "how it works" section (not template)
- Has specific evidence (celebrity names, geo counts, dates cited in body)
- Schema valid (JSON-LD passes validation)

---

### Database Changes

**New columns on `reviews` table:**

| Column | Type | Purpose |
|--------|------|---------|
| full_article | TEXT | Complete markdown article body (2,000+ words) |
| faq | JSONB | Array of {question, answer} objects |
| ai_model | TEXT | Which Claude model generated the draft |
| ai_prompt_version | TEXT | Version tag for the prompt template used |
| generation_notes | TEXT | Niro's notes/instructions for regeneration |
| word_count | INTEGER | Computed word count of full_article |
| published_at | TIMESTAMP | Already exists, ensure populated on publish |

**New columns on `sync_runs` table** (or create if not in Supabase):

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| started_at | TIMESTAMP | When scrape began |
| finished_at | TIMESTAMP | When scrape completed |
| geo_filter | TEXT | Which geos were scraped |
| total_api | INTEGER | Total creatives from API |
| new_creatives | INTEGER | New creatives inserted |
| updated_creatives | INTEGER | Existing creatives updated |
| new_brands | INTEGER | New brands detected this run |
| status | TEXT | completed / failed / running |

**No new tables needed** for v1. The existing schema handles everything with these additions.

---

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/admin/scrape` | POST | Trigger scrape (webhook to external scraper) |
| `/api/admin/scrape/status` | GET | Get current scraper status |
| `/api/admin/scrape/history` | GET | List recent sync_runs |
| `/api/admin/brands` | GET | List brands with triage sorting + filters |
| `/api/admin/reviews/generate` | POST | Generate AI review for a brand_id |
| `/api/admin/reviews/[id]` | GET | Get review for editing |
| `/api/admin/reviews/[id]` | PATCH | Update review fields |
| `/api/admin/reviews/[id]/publish` | POST | Set status=published |
| `/api/admin/reviews/[id]/unpublish` | POST | Set status=draft |
| `/api/admin/reviews/[id]/regenerate` | POST | Re-generate with Claude API |
| `/api/admin/stats` | GET | Dashboard KPIs |

**Auth**: All `/api/admin/*` routes check for a bearer token matching `ADMIN_SECRET` env var. Simple, no user system needed.

---

### URL Structure (Public)

Existing:
- `/` — home
- `/scams` — browse all brands
- `/dashboard` — public intelligence dashboard (keep or remove — see Open Questions)
- `/review/[slug]` — individual review article

**Change**: Review URL pattern stays as `/review/[slug]`. The slug format is already `brand-name-kebab-case`. No change needed here — this matches the winning URL pattern from competitor research (`/review/is-[brand]-a-scam` would be ideal but slug migration is a v2 concern).

---

## Alternatives Considered

### Review Generation Approach

| Option | Description | Tradeoff |
|--------|-------------|----------|
| **A: In-app AI (chosen)** | API route calls Claude, saves draft to Supabase | Full control, integrated workflow, cost per article (~$0.05–0.15) |
| B: External generation | Generate in separate tool (ChatGPT, Claude.ai), paste into CMS | No integration, manual copy-paste, breaks flow |
| C: Fully manual | Niro writes every review from scratch | Highest quality, lowest throughput, doesn't scale to 1000 brands |

**Decision**: Option A. The throughput gain is massive (generate in 30s, edit in 5min vs. write from scratch in 45min). Claude grounded in SpyOwl data produces articles that are already 80% there.

### Scraper Hosting

| Option | Description | Tradeoff |
|--------|-------------|----------|
| **A: External + webhook (chosen)** | Scraper on VPS/local, dashboard reads Supabase | Playwright works, no Vercel limits, slightly more infra |
| B: Vercel serverless | Run scraper in Vercel function | 300s timeout, no Playwright, limited |
| C: Vercel cron | Scheduled Vercel function | Same limits as B, less control |

**Decision**: Option A. SpyOwl scraper needs Playwright and long runtimes (50 GEOs × 500 creatives = minutes, not seconds). Dashboard is just the viewer.

### Admin Auth

| Option | Description | Tradeoff |
|--------|-------------|----------|
| **A: Shared secret (chosen)** | ADMIN_SECRET env var, sent as bearer token | Simple, solo operator, no user management |
| B: Supabase Auth | Full auth with email/password | Overkill for one user |
| C: No auth | Rely on obscure URLs | Insecure, bots will find it |

**Decision**: Option A. One env var, one operator, done.

---

## Open Questions

### 1. Writing Rules

The review generation prompt needs a "writing rules" document — tone, style, vocabulary, do/don't patterns. This is separate from the SEO structure (which comes from the teardown template). Questions:

- What tone? (Investigative journalist? Consumer advocate? Technical analyst?)
- Any phrases to always include or avoid?
- How aggressive should the verdict language be?
- Should reviews reference specific regulatory bodies by name?

**Resolution path**: Niro defines the writing rules in a markdown file. This becomes part of the Claude system prompt. Can iterate after seeing the first few generated articles.

### 2. "Good Enough to Publish" Criteria

Niro said this needs to be "sorted out separately." What makes a draft publishable?

Proposed minimum bar:
- Word count ≥ 1,800
- At least 5 unique, evidence-backed red flags
- "How it works" section cites specific data (creative counts, geo names, celebrity names)
- FAQ has ≥ 5 questions
- No template/placeholder text remaining
- Niro has manually reviewed and clicked Publish

**Resolution path**: Start with the proposed bar, adjust after publishing the first 10 reviews.

### 3. Public Dashboard

The current `/dashboard` page shows intelligence stats publicly. Options:
- Keep it (builds trust, shows transparency, differentiates from competitors)
- Remove it (reveals operational data to scammers)
- Limit it (show aggregate stats but not brand-level detail)

**Leaning**: Keep a limited public version (aggregate stats only). Move detailed brand-level intelligence to /admin.

### 4. Scraper Webhook Infrastructure

For Option A (external scraper), we need:
- A webhook endpoint the scraper calls to report status
- Or: scraper writes directly to Supabase `sync_runs` (simpler — scraper already has the service key)

**Leaning**: Scraper writes directly to Supabase. No webhook needed. Dashboard polls `sync_runs` table.

### 5. Review Slug Format

Current: `/review/quantum-ai` (brand name only)
Ideal for SEO: `/review/is-quantum-ai-a-scam` (matches search intent)

**Decision**: Migrate slugs to intent-format in v2. For now, keep existing format to avoid breaking deployed URLs.

---

## Closed Questions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Who uses the admin? | Niro only | Solo operator, no team |
| How often do we scrape? | Daily | Catches new brands early |
| How are brands triaged? | By volume + velocity, manually | Niro picks winners, not an algorithm |
| AI or manual reviews? | AI-generated, manually approved | Best throughput/quality balance |
| Which Claude model? | claude-sonnet-4-5 | Fast, cheap, good enough for content |
| Where does scraper run? | External (local/VPS) | Playwright + long runtime needs |
| How is admin auth handled? | ADMIN_SECRET env var | Solo operator, simple |
| Review word target? | 2,000–2,500 words | Validated by competitor teardown |
| Review structure? | Verdict → stats → how it works → red flags → FAQ | Winning SERP pattern from research |
| Schema markup? | Article + ClaimReview + FAQPage | Maximizes rich snippet eligibility |

---

## Validation Plan

### Phase 1: Admin Dashboard (build first)

**Build:**
- `/admin` layout with auth gate
- Scraper status viewer (reads sync_runs from Supabase)
- Brand triage table with volume/velocity sort
- Basic stats cards

**Test:**
- Run a full scrape manually, verify sync_runs appear in dashboard
- Verify brand sort order matches expectation (highest volume + surging on top)
- Confirm auth gate blocks unauthenticated access

**Success signal:** Niro can see the latest scrape results and identify the top 5 brands to write about — all from the browser.

### Phase 2: Review Generation (build second)

**Build:**
- `/api/admin/reviews/generate` endpoint with Claude integration
- Review editor page with markdown editing + preview
- Publish/unpublish flow

**Test:**
- Generate a review for Quantum AI (highest creative count brand)
- Verify the draft is 2,000+ words, has specific evidence, has unique red flags
- Edit the draft, publish it, verify it appears on /review/quantum-ai
- Generate 5 more reviews across different scam scores and verify quality consistency

**Success signal:** A generated review, after 5 minutes of manual editing, reads like a legitimate investigative article — not a template.

### Phase 3: Polish (build third)

**Build:**
- Enhanced JSON-LD schema per review
- Sitemap.xml auto-generation
- Internal linking between related reviews
- Quality indicators on triage table
- Activity feed

**Test:**
- Validate schema with Google Rich Results Test
- Submit sitemap to Google Search Console
- Verify internal links connect related brands

**Success signal:** First review indexed by Google with rich snippet (ClaimReview or FAQ markup visible in SERP).

---

*Spec generated: March 29, 2026*
*Research basis: system-audit.md, review-article-teardown.md, competitors.md*
