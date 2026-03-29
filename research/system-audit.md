# Crypto Killer System Audit

**Date**: March 29, 2026
**Project**: Crypto Killer — Crypto scam detection and intelligence platform
**Scope**: Next.js app, SpyOwl scraper, Supabase database
**Purpose**: Understand existing architecture, identify reusable components, and define gaps for two new features: (1) Admin Dashboard/Scraper Control Panel, (2) Review Article Content Pipeline

---

## Executive Summary

The Crypto Killer system is a **three-layer intelligence pipeline** that automatically detects crypto scams, aggregates them into branded threat profiles, and publishes SEO-optimized review articles:

1. **SpyOwl Scraper** (Node.js): Pulls ad creatives from SpyOwl API → stores in local SQLite → identifies normalized scam brands
2. **Sync Engine** (Node.js): Aggregates creatives into brands, calculates scam scores, generates draft reviews → syncs to Supabase
3. **Next.js Web App**: Reads from Supabase REST API → displays dashboard, scams list, and published reviews

**Key Findings**:
- **What Exists**: Fully functional data collection and brand detection pipeline with 1000 brands, 1000 creatives, and published review articles. Well-structured Next.js frontend with filtering, pagination, and SEO metadata.
- **What's Reusable**: Supabase schema, REST API queries, scam score algorithm, velocity trend logic, red flag generation, review templates, JSON-LD schema markup, styling components (stat cards, tables, badges).
- **What's Missing**: Admin dashboard for scraper control, real-time sync status, review generation triggers, content approval workflow, LLM-powered red flag/verdict enhancement, publishing pipeline with scheduling.

---

## 1. Architecture Overview

### Data Flow

```
SpyOwl API (api.spyowl.icu)
    ↓ [scraper.js - fetch creatives]
SQLite (spyowl.db)
    ↓ [sync.js - aggregate + upload]
Supabase REST API
    ↓ [Next.js - read & display]
Web App (next.js)
```

### Technology Stack

| Layer | Technology | Version | Role |
|-------|-----------|---------|------|
| **Data Collection** | Playwright, Node.js | 1.45.0 | Browser automation for SpyOwl API |
| **Local Storage** | SQLite, better-sqlite3 | 11.0.0 | Persist creatives locally |
| **Sync Engine** | Node.js | 18+ | Transform & upload to Supabase |
| **Backend API** | Supabase REST | v1 | PostgreSQL with HTTP interface |
| **Frontend** | Next.js 14 App Router | 14.0.0 | React 18, SSR + static generation |
| **Styling** | Tailwind CSS | 3.3.6 | Utility-first dark theme |
| **Database** | PostgreSQL (Supabase) | Latest | Cloud-hosted relational DB |

---

## 2. Next.js Web Application

### Current File Structure

```
/app
  ├── layout.js (root layout + navigation)
  ├── page.js (home/hero + trending scams)
  ├── dashboard/page.js (intelligence dashboard - KPIs, trends, geo data)
  ├── scams/page.js (browse all scams - search, filter, sort, pagination)
  ├── review/[slug]/page.js (dynamic review page - server-side rendered + static)
  └── api/search/route.js (search endpoint - ILIKE pattern matching)
/lib
  └── supabase.js (REST API helper)
```

### Page Components

#### **1. Root Layout** (`app/layout.js`)
- **Purpose**: Site chrome, navigation, global styles
- **Features**:
  - Sticky navigation with links: `/`, `/scams`, `/dashboard`
  - Footer with copyright
  - Dark theme (bg-dark-bg, text-gray-100)
  - Red accent color for scam severity (#dc2626, #ef4444)
  - JSON-LD Organization schema for SEO
- **Data Fetching**: None (static layout)
- **Reusable**: Navigation structure, CSS classes, schema markup

#### **2. Home Page** (`app/page.js`)
- **Purpose**: Hero landing, featured scams, stats
- **Features**:
  - Search bar (calls `/api/search?q=`)
  - KPI stat cards: totalBrands, totalCreatives, totalGeos
  - "Latest Detected Scams" grid (recent 10)
  - "Top Trending Up" and "Top Trending Down" sections (5 each)
- **Data Fetching**:
  - `GET /scam_brands?select=id,scam_score` (KPIs)
  - `GET /scam_brands?select=...&velocity_trend=eq.up&order=...&limit=10` (trending)
  - `GET /creatives?select=id` (creative count)
- **Reusable**: ScamScoreGauge component, stat card layout, trending section logic

#### **3. Intelligence Dashboard** (`app/dashboard/page.js`)
- **Purpose**: Executive view of scam intelligence
- **Features**:
  - KPI cards: totalBrands, totalCreatives, totalGeos, avgScamScore
  - Top 10 Rising Brands (with progress bars)
  - Top 10 Declining Brands (with progress bars)
  - New Detections table (last 7 days)
  - Geographic Distribution heatmap
- **Data Fetching**:
  - Aggregates multiple API calls
  - Calculates avgScamScore client-side
  - Geo data grouped and sorted by creative_count
- **Reusable**: Stat card design, table layout, progress bar component, geo aggregation logic

#### **4. Browse All Scams** (`app/scams/page.js`)
- **Purpose**: Searchable, filterable scams directory
- **Features**:
  - Search by brand name (real-time input)
  - Sort: by scam_score, total_creatives, total_geos, name
  - Sort order: desc, asc
  - Filter by status: all, detected, active, inactive
  - Filter by trend: all, up, down, stable
  - Pagination: 20 items per page
- **Data Fetching**: Single call to GET /scam_brands, client-side filtering/sorting
- **Reusable**: Filter UI (dropdowns, input), pagination logic, table layout

#### **5. Dynamic Review Page** (`app/review/[slug]/page.js`)
- **Purpose**: Detailed scam investigation report
- **Features**:
  - Server-side rendering with static generation
  - Generates static paths from published reviews
  - Generates metadata (title, description, Open Graph tags) for SEO
  - ScamScoreGauge visualization
  - Risk level badge (CRITICAL/HIGH/MEDIUM/LOW)
  - Sections: Overview, Red Flags (up to 8), How It Works, Verdict
  - Sidebar: Brand info (status, locations, creatives, celebrities, dates), Related Scams
  - JSON-LD ClaimReview schema for fact-checking markup
- **Data Fetching**:
  - `GET /reviews?slug=eq.{slug}&select=...` (review content)
  - `GET /scam_brands?id=eq.{review.brand_id}&select=...` (brand info)
  - `GET /scam_brands?velocity_trend=eq.{brand.trend}&id=neq.{brand.id}&...` (related scams)
- **Reusable**: ScamScoreGauge, risk level badge logic, red flag display, JSON-LD schema generation, related items pattern

#### **6. Search API** (`app/api/search/route.js`)
- **Purpose**: Autocomplete/search endpoint
- **Features**:
  - Query parameter: `q` (search term, min 2 chars)
  - Returns: id, slug, name, scam_score (max 10 results)
  - Uses ILIKE (case-insensitive pattern matching)
- **Data Fetching**: `GET /scam_brands?select=...&name=ilike.%{query}%&limit=10`
- **Reusable**: Query pattern, ILIKE search logic

### Supabase Integration Pattern (`lib/supabase.js`)

```javascript
async function supabaseRequest(path, options = {}) {
  // Constructs: ${SUPABASE_URL}/rest/v1${path}
  // Headers: Authorization Bearer token + apikey
  // Returns: response.json()
}
```

**Usage in pages**: All pages import `supabaseRequest` and call it directly in useEffect (client) or directly in component (server). No middleware layer.

**Reusable**: REST API helper, authentication pattern, error handling

### Styling & Components

**Theme**: Dark theme (dark-bg, dark-surface, dark-card)
**Accent**: Red (#dc2626 active/danger, #ef4444 lighter)
**Component Classes**:
- `.stat-card` — KPI display
- `.card` — Content container
- `.badge` — Status/risk indicator (.badge-danger, .badge-warning, .badge-info, .badge-success)
- `.btn-primary` — Primary action button
- `.search-input` — Search input field
- `.section-title` — Page heading

**Reusable**: Entire Tailwind CSS setup, component naming, dark theme palette

---

## 3. SpyOwl Scraper & Sync Engine

### Scraper Architecture (`scraper.js`)

**Entry Point**: `npm run scrape [options]`

**Options**:
- `--geo <codes>` — Comma-separated geo codes (e.g., "US,GB,DE")
- `--all-geos` — Scrape all geos in system
- `--days <N>` — Fetch last N days of creatives
- `--limit <N>` — Max creatives per geo

**Process**:
1. Authenticate to SpyOwl API using cookie from `cookies.txt`
2. Iterate through geos
3. Fetch creatives in batches of 500 from `/creative/all` endpoint
4. Insert creatives into SQLite with fields:
   - id, offer_name, celebrity_name, geo, is_video, land_language, is_favorite, created_at
   - first_seen_at, last_seen_at, scrape_count, normalized_offer
5. Record scrape_run with metrics: geo_filter, total_api, new_creatives, updated_creatives, status

**Reusable**: Batch processing logic, SpyOwl API pattern, database transaction pattern

### Sync Engine (`sync.js`)

**Entry Point**: `npm run sync`

**Three-Step Process**:

#### Step 1: Sync Creatives to Supabase
- Batch inserts (1000 at a time) from SQLite → Supabase `creatives` table
- Fields: id, offer_name, normalized_offer, celebrity_name, geo, is_video, is_favorite, created_at, first_seen_at, last_seen_at

#### Step 2: Build Scam Brands
- Groups creatives by normalized_offer
- For each brand, aggregates:
  - `total_creatives` — count of creatives
  - `total_geos` — distinct geo codes
  - `total_celebrities` — distinct celebrity names
  - `total_videos`, `total_photos` — by is_video flag
  - `lifespan_days` — days from first_seen to last_seen
  - `velocity_7d` — new creatives in last 7 days
  - `velocity_prev_7d` — new creatives in 7 days before
- Calculates **Scam Score** (0-100):
  - Creative Volume: min(total_creatives / 100, 25)
  - Geo Spread: min(total_geos / 2, 25)
  - Celebrity Misuse: min(total_celebrities / 10, 25)
  - Longevity: min(lifespan_days / 30, 15)
  - Velocity: (velocity_7d > 0) ? 10 : 0
- Determines **Velocity Trend**:
  - Surging: velocity_7d >= 1.5 × velocity_prev_7d
  - Rising: velocity_7d >= 1.0 × velocity_prev_7d
  - Stable: velocity_7d >= 0.5 × velocity_prev_7d
  - Declining: velocity_7d > 0 and below stable threshold
  - Dead: velocity_7d == 0
- Inserts/updates brands in Supabase `scam_brands` table

#### Step 3: Generate Draft Reviews
- For each brand with 10+ creatives (up to 500 brands), creates a draft review
- Generates:
  - **slug**: kebab-case name
  - **title**: "{Name} Review: Scam or Legit? [{YEAR} Investigation]"
  - **headline**: "{Name}: Confirmed Scam — {red_flag_count} Red Flags Found"
  - **meta_description**: "Is {Name} a scam? Our investigation found {red_flag_count} red flags across {total_geos} countries. Read the full review."
  - **summary**: "Our SpyOwl intelligence detected {total_creatives} unique ads across {total_geos} countries. Uses likenesses of {celebrities}..."
  - **red_flags**: JSON array with 6 standard flags (multi-country, fake endorsements, aggressive spending, deepfakes, long-running, currently active)
  - **how_it_works**: "Operates through paid Facebook ads... victims lured with promises... registration page collects info... $250 minimum investment stolen..."
  - **verdict**: "Confirmed scam. Do not deposit. If invested, contact bank and report to authorities."
  - **scam_score**: from brand calculation
  - **status**: "draft" (not published)
- Inserts reviews into Supabase `reviews` table

**Reusable**: Scam score algorithm, velocity trend calculation, red flag templates, review generation templates, review slug/title/description patterns

### Local SQLite Schema (`db.js`)

**Tables**:

**creatives**
```sql
CREATE TABLE creatives (
  id TEXT PRIMARY KEY,
  offer_name TEXT,
  normalized_offer TEXT,
  celebrity_name TEXT,
  geo TEXT,
  geo_region_id TEXT,
  is_video INTEGER,
  land_language TEXT,
  is_favorite INTEGER,
  created_at TEXT,
  first_seen_at TEXT,
  last_seen_at TEXT,
  scrape_count INTEGER,
  INDEX idx_offer_name ON offer_name,
  INDEX idx_celebrity ON celebrity_name,
  INDEX idx_geo ON geo,
  INDEX idx_created ON created_at,
  INDEX idx_normalized ON normalized_offer
)
```

**scrape_runs**
```sql
CREATE TABLE scrape_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT,
  finished_at TEXT,
  geo_filter TEXT,
  total_api INTEGER,
  new_creatives INTEGER,
  updated_creatives INTEGER,
  status TEXT
)
```

**Reusable**: Schema design, indexing strategy, batch insert patterns

---

## 4. Supabase Database

### Database Schema

**Project ID**: rqyfuioazbdixflqngcs
**URL**: https://rqyfuioazbdixflqngcs.supabase.co
**API**: REST v1 (via /rest/v1 endpoints)

#### Table: `creatives` (1000 rows)

| Column | Type | Source |
|--------|------|--------|
| id | TEXT | SpyOwl API id |
| offer_name | TEXT | Ad offer name from SpyOwl |
| normalized_offer | TEXT | Normalized/standardized offer name |
| celebrity_name | TEXT | Celebrity name used in ad |
| geo | TEXT | Country code (e.g., US, GB, DE) |
| geo_region_id | TEXT | SpyOwl geo region identifier |
| is_video | BOOLEAN | True if ad is video, false if image/photo |
| land_language | TEXT | Landing page language code |
| is_favorite | BOOLEAN | User marked as favorite |
| created_at | TIMESTAMP | When creative was created in SpyOwl |
| first_seen_at | TIMESTAMP | When first detected by scraper |
| last_seen_at | TIMESTAMP | Most recent detection |
| scrape_count | INTEGER | Number of scrape runs that found it |
| synced_at | TIMESTAMP | When synced to Supabase |

**Indexes**: id (primary), offer_name, celebrity_name, geo, created_at, normalized_offer

#### Table: `scam_brands` (1000 rows)

| Column | Type | Source |
|--------|------|--------|
| id | UUID | Generated |
| slug | TEXT | URL-friendly brand name (kebab-case) |
| name | TEXT | Brand/offer name |
| normalized_name | TEXT | Normalized variant |
| scam_score | INTEGER | 0-100 calculated score |
| total_creatives | INTEGER | Count of ad creatives |
| total_geos | INTEGER | Count of distinct countries |
| total_celebrities | INTEGER | Count of distinct celebrities used |
| total_videos | INTEGER | Count of video ads |
| total_photos | INTEGER | Count of photo/image ads |
| lifespan_days | INTEGER | Days from first to last seen |
| velocity_7d | INTEGER | New creatives in last 7 days |
| velocity_trend | TEXT | Enum: surging, rising, stable, declining, dead, active |
| celebrity_list | TEXT[] | Array of celebrity names |
| geo_list | TEXT[] | Array of country codes |
| language_list | TEXT[] | Array of language codes |
| status | TEXT | Enum: active, detected, inactive |
| first_seen_at | TIMESTAMP | When brand first detected |
| last_seen_at | TIMESTAMP | Most recent ad detection |
| created_at | TIMESTAMP | When brand record created |
| updated_at | TIMESTAMP | When brand record last updated |
| review_status | TEXT | Enum: draft, published, archived |

**Sample Brands** (Top 5 by creative count):
- Quantum AI (3076 creatives, 45 geos, score 95)
- Senvix (1000 creatives, 18 geos, score 95)
- WhatsApp AI (569 creatives, 22 geos, score 100) ← Most active
- Trade Vector AI (409 creatives, 19 geos, score 85, status: inactive)
- Prime Aura (366 creatives, 33 geos, score 95)

#### Table: `reviews` (1000 rows)

| Column | Type | Source |
|--------|------|--------|
| id | UUID | Generated |
| brand_id | UUID | Foreign key to scam_brands (nullable) |
| slug | TEXT | URL-friendly review slug |
| title | TEXT | SEO title (e.g., "{Brand} Review: Scam or Legit? [2026 Investigation]") |
| headline | TEXT | Short headline (e.g., "{Brand}: Confirmed Scam — 6 Red Flags Found") |
| meta_description | TEXT | SEO description (160 chars) |
| summary | TEXT | Overview paragraph |
| red_flags | JSON | Array of {flag, detail} objects (6 standard flags) |
| how_it_works | TEXT | Explanation of scam mechanics |
| verdict | TEXT | Final recommendation |
| scam_score | INTEGER | 0-100 score (from brand) |
| schema_json | TEXT | JSON-LD schema (currently null) |
| status | TEXT | Enum: draft, published, archived |
| published_at | TIMESTAMP | When published (null if draft) |
| created_at | TIMESTAMP | When review created |
| updated_at | TIMESTAMP | When review last modified |

**Sample Review Fields**:
- Quantum AI Review: title, headline, summary, 6 red flags, how_it_works, verdict, scam_score 95, status published
- Senvix Review: similar structure, scam_score 95, status published
- WhatsApp AI Review: similar structure, scam_score 100, status published

**Empty Tables**:
- `geo_regions` — 0 rows (not actively used in webapp)
- `sync_runs` — 0 rows (scraper runs not synced to Supabase)

### Data Access Pattern

**Authentication**: Bearer token + apikey header
**Endpoint Pattern**: `GET /rest/v1/{table}?select=...&filter=...&order=...&limit=...`
**Filters**: URL-encoded queries (e.g., `name=ilike.%Tesla%`, `status=eq.active`, `velocity_trend=eq.up`)
**Limits**: API enforces default pagination

**Reusable**: Authentication pattern, query construction, filter syntax, pagination

---

## 5. What Exists (Implemented Features)

### ✓ Data Collection Pipeline
- SpyOwl scraper fetches 500 creatives per batch
- SQLite stores local copy with normalized offer names
- Sync engine aggregates into brands and calculates scam scores
- Automated review draft generation for brands with 10+ creatives

### ✓ Public Web Application
- Home page with hero, search, trending sections
- Browse all scams with filtering, sorting, pagination
- Dynamic review pages with server-side rendering and static generation
- Dashboard with KPI metrics and geographic heatmap
- SEO metadata and JSON-LD schema markup
- Responsive dark-themed UI with Tailwind CSS

### ✓ Search Functionality
- Real-time search API (ILIKE pattern matching)
- Autocomplete-ready endpoint returning top 10 results

### ✓ Database Infrastructure
- PostgreSQL via Supabase with 1000+ brands and creatives
- REST API for seamless frontend integration
- Proper schema with indexes for performance

---

## 6. What's Missing (Gaps for New Features)

### A. Admin Dashboard / Scraper Control Panel

**Missing Endpoints/UI**:
1. **Scraper Management**
   - Endpoint to trigger scrape (--geo, --all-geos, --days, --limit parameters)
   - Endpoint to list available geos in SpyOwl system
   - Endpoint to check scraper status (running/idle)
   - UI: Big red "Run Scrape" button with parameter forms

2. **Scraper Statistics**
   - Endpoint to fetch historical scrape_runs from Supabase (currently 0 rows, not synced)
   - Endpoint to get real-time scraper metrics (last run, total creatives, last N days activity)
   - UI: Scrape history timeline, success/failure rates, creative discovery rate

3. **Brand Triage & Review Management**
   - Endpoint to list draft reviews (currently 1000 reviews in draft/published mix)
   - Endpoint to update brand status (active/detected/inactive)
   - Endpoint to update review status (draft/published/archived)
   - Endpoint to edit review content (title, headline, verdict, red flags)
   - UI: Draft review queue, edit forms, publish workflows, status change buttons

4. **Content Pipeline Visibility**
   - Endpoint to show brands pending review generation
   - Endpoint to show recently synced creatives
   - Endpoint to show brands updated in last N hours
   - UI: Real-time activity feed, pipeline status cards

**Database Changes Needed**:
- Sync scrape_runs to Supabase (currently only in SQLite)
- Add review_edits audit table to track changes
- Add publish_schedule table for scheduled reviews

**Backend Changes Needed**:
- Create API routes: /api/admin/scrape, /api/admin/scrape-status, /api/admin/scrape-history
- Create API routes: /api/admin/drafts, /api/admin/draft/{id}, /api/admin/draft/{id}/publish
- Create API routes: /api/admin/brands/{id}, /api/admin/brands/{id}/status
- Implement background job runner for scheduled publishes
- Add authentication/authorization for admin routes (not currently present)

### B. Review Article Content Pipeline

**Missing Features**:
1. **Review Content Enhancement**
   - LLM integration (Claude API) to generate more detailed verdicts and "how it works" sections
   - Fact-checking and brand research integration
   - Red flag detection beyond the 6 hardcoded templates
   - Sentiment analysis on generated content

2. **Publishing Workflow**
   - Review approval step before publication
   - Scheduled publishing (publish at specific time)
   - Bulk publish by trend/status
   - Rollback/unpublish functionality

3. **Content Customization**
   - Template system for review sections (not currently present)
   - Multi-language support for reviews (only single language)
   - Brand-specific content overrides
   - Custom red flag definitions per brand

4. **SEO Optimization**
   - Automated sitemap.xml generation
   - Open Graph image generation (og:image meta tag)
   - Structured data validation (JSON-LD)
   - Internal linking suggestions between related scams

5. **Monitoring & Analytics**
   - Endpoint to track review views/clicks
   - Endpoint to track which reviews drive traffic
   - Integration with Google Search Console API
   - Publication rate metrics

**Database Changes Needed**:
- Add reviews.llm_generated BOOLEAN to track AI-generated content
- Add reviews.approval_status (pending/approved/rejected)
- Add reviews.published_scheduled_at for scheduled publishes
- Add reviews_analytics table for view tracking
- Add reviews_ai_versions table to store multiple AI-generated versions

**Backend Changes Needed**:
- Create API routes: /api/reviews/{id}/generate-enhancement (LLM call)
- Create API routes: /api/reviews/{id}/approve, /api/reviews/{id}/publish, /api/reviews/{id}/unpublish
- Create API routes: /api/reviews/bulk-publish
- Implement Claude API integration for content generation
- Implement scheduled task runner (cron or queue-based) for scheduled publishes
- Create /api/reviews/analytics endpoint for monitoring

**Frontend Changes Needed**:
- Admin UI: Review editor with preview
- Admin UI: Approval queue with approve/reject buttons
- Admin UI: Publish scheduler with date/time picker
- Admin UI: Analytics dashboard showing review performance

---

## 7. Reusable Components & Patterns

### Code Reusable

| Component | Location | Reusable For |
|-----------|----------|--------------|
| **ScamScoreGauge** | app/review/[slug]/page.js | Any page showing scam score (dashboard, cards, profile) |
| **Badge (status)** | CSS classes | Admin dashboard, approval workflows |
| **Table Layout** | app/scams/page.js, app/dashboard/page.js | Analytics tables, brand lists, scrape history |
| **Pagination Logic** | app/scams/page.js | Draft queue, publish history, any list page |
| **Filter/Sort UI** | app/scams/page.js | Admin filters (by status, trend, created_date) |
| **Search API** | app/api/search/route.js | Can be extended to search reviews, creatives |

### Database Reusable

| Schema | Reusable For |
|--------|--------------|
| **scam_score algorithm** | Weighting new scam detections, impact calculations |
| **velocity_trend logic** | Trending features, alert prioritization |
| **normalized_offer** | Deduplication, brand consolidation |
| **red_flags JSON** | Admin dashboard red flag editor |
| **review templates** | Content generation, approval workflows |

### API Patterns Reusable

| Pattern | Reusable For |
|---------|--------------|
| **supabaseRequest()** | All new endpoints (admin routes, analytics, publishing) |
| **ILIKE filtering** | Search functionality, admin searches |
| **URL path construction** | Dynamic admin pages /admin/draft/[id], /admin/brand/[id] |
| **Batch inserts** | Bulk operations (publish multiple, update multiple) |

---

## 8. Technology Recommendations

### For Admin Dashboard

**Backend Stack** (already compatible):
- Extend app/api/ with new routes for scraper control
- Use supabaseRequest() for all data operations
- Implement Node.js child_process to trigger scraper.js from API
- Use node-cron or Bull queue for background jobs

**Frontend Stack** (already compatible):
- Create /admin layout and routes
- Reuse existing Tailwind components
- Use React forms for review editing
- Reuse existing table/card components

**Example Route**: `app/api/admin/scrape/route.js`
```javascript
export async function POST(request) {
  const { geo, days, limit } = await request.json();
  // Trigger: exec('npm run scrape -- --geo=' + geo, ...)
  // Or: spawn child process running scraper.js
  // Return status and tracking ID
}
```

### For Review Content Pipeline

**Backend Stack**:
- Claude API integration for LLM content generation
- Supabase edge functions for scheduled publishes (or external cron job)
- Implement review approval workflow in DB and API

**Frontend Stack**:
- Rich text editor for review editing (e.g., TipTap, Slate)
- Markdown preview for how_it_works and verdict
- Calendar widget for publish scheduling

**Example Integration**:
```javascript
// app/api/reviews/[id]/enhance/route.js
async function enhanceReview(review) {
  const prompt = `Given this scam brand: ${review.name}...`;
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY },
    body: JSON.stringify({ model: 'claude-opus-4-1', messages: [...] })
  });
  return response.json();
}
```

---

## 9. Implementation Roadmap

### Phase 1: Admin Dashboard (2-3 weeks)
1. Create `/admin` layout and authentication middleware
2. Add scrape_runs syncing to Supabase
3. Create scraper control endpoints (/api/admin/scrape, /api/admin/scrape-status)
4. Create brand triage UI and endpoints (/api/admin/brands, /api/admin/drafts)
5. Create review editor UI

### Phase 2: Publishing Workflow (1-2 weeks)
1. Add review approval status to schema
2. Implement publish/unpublish endpoints
3. Create approval queue UI
4. Add publish scheduler table and background job runner

### Phase 3: Content Enhancement (2-3 weeks)
1. Integrate Claude API for verdict/how_it_works generation
2. Create /api/reviews/{id}/enhance endpoint
3. Build LLM preview UI with edit/accept/reject
4. Implement version history for AI-generated content

### Phase 4: Analytics & Monitoring (1 week)
1. Add review analytics table
2. Create analytics dashboard
3. Integrate Google Search Console (optional)

---

## 10. Summary: What to Build

### Admin Dashboard Checklist

- [ ] Scraper Control UI: Run scrape with geo/days/limit selectors
- [ ] Scrape History: Timeline of past runs with success rate
- [ ] Brand Triage: List brands by status, update status in bulk
- [ ] Draft Review Queue: List draft reviews, bulk edit/publish
- [ ] Sync Status: Real-time visibility into creative syncing

### Content Pipeline Checklist

- [ ] Review Editor: Edit title, headline, summary, red flags, verdict
- [ ] Approval Workflow: Draft → Review → Approved → Publish
- [ ] Scheduled Publishing: Pick publish date/time, bulk schedule
- [ ] LLM Enhancement: Generate better verdicts, how_it_works using Claude API
- [ ] Analytics: Track which reviews get traffic, refine templates

---

## Appendix A: Key Metrics

| Metric | Count | Notes |
|--------|-------|-------|
| Creatives in DB | 1,000 | From SpyOwl scrapes |
| Scam Brands | 1,000 | Aggregated from creatives |
| Published Reviews | ~100 | Estimated from visible data |
| Avg Creatives per Brand | 1,000 | Range: 10-3,076 |
| Max Scam Score | 100 | WhatsApp AI |
| Min Creatives for Review | 10 | Hardcoded threshold |
| Top Geo | 45 countries | Quantum AI |

---

## Appendix B: Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=https://rqyfuioazbdixflqngcs.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

For admin features, add:
```bash
ANTHROPIC_API_KEY=sk-...  # For LLM enhancements
SUPABASE_SERVICE_KEY=...  # For admin operations (server-side)
SCRAPER_WEBHOOK_SECRET=...  # For triggering scrapes securely
```

---

**Document Generated**: March 29, 2026
**Last Updated**: March 29, 2026
