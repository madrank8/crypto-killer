# DataForSEO API Integration

DataForSEO API v3 integration reference for the topical-map-creation skill's Tool-Assisted mode. Verified against `docs.dataforseo.com/v3/` (May 2026).

> **Honesty note:** Endpoint paths, response structures, and rate limits in this file are verified against current DataForSEO v3 documentation. Pricing tiers change — always check live pricing at `dataforseo.com/pricing` before quoting cost estimates to a user.

---

## Authentication

- **Auth method:** HTTP Basic Auth (base64-encoded `login:password`)
- **Username:** your DataForSEO account login email (Madrank uses `office@madrank.com`)
- **Password:** API password from Dashboard → Settings → API Access (NOT the account login password)
- **Base URL (Live, production):** `https://api.dataforseo.com/v3/`
- **Base URL (Sandbox, free testing):** `https://sandbox.dataforseo.com/v3/`

Sandbox returns structurally identical responses without consuming credits. Develop against Sandbox; promote to Live only when ready.

### Auth header construction

```bash
login="office@madrank.com"
password="<API_PASSWORD>"
cred="$(printf '%s' "${login}:${password}" | base64)"
curl --location "https://api.dataforseo.com/v3/serp/endpoints" \
     --header "Authorization: Basic ${cred}" \
     --header "Content-Type: application/json"
```

---

## API families used in topical-map-creation

| API | Purpose in topical mapping | Method preference |
|-----|---------------------------|-------------------|
| **SERP API** | Top-10 organic for SERP clustering (Step 10), PAA extraction (Step 8.3), SERP feature presence | Live (Advanced) |
| **Keywords Data API** | Search volume, CPC, monthly trends, related queries | Standard (cheap) or Live |
| **DataForSEO Labs API** | Ranked keywords, content gap, keyword ideas, SERP competitors, ranked competitors | Live only (Labs has no Standard) |
| **Backlinks API** | Competitor authority validation (Step 8.1 Tool-Assisted) | Live |
| **AI Optimization API** | LLM Mentions tracking, AI Overview presence | Live |

---

## Method types

**Live:** Real-time, no separate POST/GET, highest cost. Use when you need immediate response (interactive Tool-Assisted sessions).

**Standard:** POST a task, retrieve later via Task GET or `tasks_ready` endpoint. Cheaper. Two priority tiers: 1 (slower, cheaper) and 2 (faster, more expensive but still cheaper than Live). Use for batch jobs (topical map for 100+ keywords).

**Rate limits (per DataForSEO docs, May 2026):**
- Combined POST + GET: 2,000 calls/minute
- Max simultaneous requests: 30
- Max tasks per POST: 100

---

## Pipeline — 3 phases for topical map building

### Phase 1: Keyword Discovery → Volume

**Goal:** Convert the raw topic list from Phase 2 (`procedure-detailed.md`) into a keyword set with volume data.

#### 1.1 Seed expansion

Endpoint: `POST /v3/dataforseo_labs/google/keyword_suggestions/live`

Input: seed keyword (e.g., "sweepstakes casino")
Output: up to ~500 related keyword suggestions with metrics

```json
[{
  "keyword": "sweepstakes casino",
  "language_code": "en",
  "location_code": 2840,
  "limit": 500,
  "include_serp_info": false
}]
```

#### 1.2 Search volume per keyword

Endpoint: `POST /v3/keywords_data/google_ads/search_volume/live`

Input: list of keywords (up to 1,000 per call)
Output: monthly volume, competition, CPC

```json
[{
  "keywords": ["sweepstakes casino", "free sweepstakes casino", "..."],
  "language_code": "en",
  "location_code": 2840
}]
```

Cost note: cheap per call; ~$0.05 per 1,000 keywords (verify current).

#### 1.3 Related keywords for fan-out

Endpoint: `POST /v3/dataforseo_labs/google/related_keywords/live`

Use to populate Query Fan-Out trees (Step 8.7).

---

### Phase 2: SERP Analysis → Clustering

**Goal:** Get top-10 organic results per keyword to enable SERP-based clustering (Step 10).

#### 2.1 SERP fetch (top 10 organic)

Endpoint: `POST /v3/serp/google/organic/live/advanced`

Input:

```json
[{
  "language_code": "en",
  "location_code": 2840,
  "keyword": "best sweepstakes casino",
  "depth": 10,
  "device": "desktop",
  "calculate_rectangles": false
}]
```

Output: top-10 URLs + SERP features (AI Overview, PAA, Featured Snippet, Knowledge Panel, etc.)

#### 2.2 SERP clustering algorithm

For each pair of keywords (k₁, k₂):

1. Fetch top-10 organic for k₁ and k₂
2. Count shared URLs across both top-10 sets
3. If shared count ≥ 3 → same cluster (one page targets both)
4. If shared count = 1–2 → flag for human judgment
5. If shared count = 0 → distinct pages

For N keywords, this is O(N²) SERP calls. Budget accordingly:
- 50 keywords → 50 SERPs needed (one per keyword), then 1,225 pairwise comparisons (no extra API calls — done in-memory after fetch)
- 200 keywords → 200 SERPs, 19,900 pairwise comparisons

#### 2.3 PAA (People Also Ask) extraction

PAA appears in the `serp_results[*].items[*].type == "people_also_ask"` block of the Advanced response. Extract:
- The PAA questions themselves (input for Step 8.3, Step 8.7)
- The cited URLs (signal of authority for the answer)

#### 2.4 AI Overview presence

In responses with AI Overview, `items[*].type == "ai_overview"` is present with:
- The AI Overview text content
- The cited sources (URLs Google chose to cite in the Overview)

Capture this for Share of Model measurement (`v41-additions.md` Section F).

---

### Phase 3: Competitor Analysis (Step 8.1 Tool-Assisted)

**Goal:** Identify topics competitors cover that we don't, and where their coverage is weak.

#### 3.1 Ranked keywords for a competitor

Endpoint: `POST /v3/dataforseo_labs/google/ranked_keywords/live`

```json
[{
  "target": "competitor.com",
  "language_code": "en",
  "location_code": 2840,
  "limit": 1000,
  "filters": [["keyword_data.keyword_info.search_volume", ">", 100]],
  "order_by": ["ranked_serp_element.serp_item.rank_group,asc"]
}]
```

Output: all keywords the competitor ranks for, with rank position, volume, traffic estimate, and SERP feature presence.

#### 3.2 Content gap (we vs. them)

Endpoint: `POST /v3/dataforseo_labs/google/keywords_for_site/live`

Or use: `POST /v3/dataforseo_labs/google/ranked_keywords/live` for each (us, them) and diff the result sets.

Output the gap as:
- Keywords they rank top-10 for, we don't rank top-100 for → topic gap
- Keywords both rank for, but they outrank us → optimization gap
- Keywords we rank for, they don't → our advantage

#### 3.3 Backlink validation (optional)

If considering whether a topic is worth pursuing despite a strong competitor presence, validate the competitor's authority:

Endpoint: `POST /v3/backlinks/summary/live`

```json
[{ "target": "competitor.com", "include_subdomains": true }]
```

Check `referring_domains` and `rank` — gives a directional read on whether the competitor is genuinely authoritative or thin.

---

## AI Optimization API (LLM Mentions)

For Share of Model and AI visibility measurement (v4.1 Section F):

Endpoint: `POST /v3/ai_optimization/llm_mentions/live`

```json
[{
  "target": ["sweepdogs.com", "competitor.com"],
  "platform": "chatgpt",
  "query": "what are the best sweepstakes casinos in 2026"
}]
```

`platform` values: `chatgpt`, `gemini`, `perplexity`, `claude` (verify current list at DataForSEO).

Returns: presence/absence of target in the LLM response, frequency, position, citation URLs.

---

## Response envelope

All DataForSEO responses share this top-level structure:

```json
{
  "version": "...",
  "status_code": 20000,
  "status_message": "Ok.",
  "time": "0.xxx sec.",
  "cost": 0.0xx,
  "tasks_count": 1,
  "tasks_error": 0,
  "tasks": [
    {
      "id": "...",
      "status_code": 20000,
      "status_message": "Ok.",
      "result_count": 1,
      "path": ["v3", "...", "..."],
      "data": { /* request echo */ },
      "result": [ /* actual data */ ]
    }
  ]
}
```

**Error handling:** `status_code` follows DataForSEO's own taxonomy. `20000` = success. `40xxx` = client errors (auth, malformed). `50xxx` = server errors. Full list: `docs.dataforseo.com/v3/appendix/errors`.

---

## Cost estimation for a topical map run

Sample run for a 60-topic medium-niche map (Tool-Assisted mode, Live methods):

| Phase | Calls | Approx. cost (verify current pricing) |
|-------|-------|----------------------------------------|
| Phase 1.1 seed expansion (5 seeds) | 5 | very small |
| Phase 1.2 volume (60 keywords) | 1 batch | small |
| Phase 1.3 related (5 seeds) | 5 | small |
| Phase 2.1 SERP advanced (60 keywords) | 60 | small per call × 60 |
| Phase 2.3/2.4 PAA + AI Overview parsing | 0 extra (in-memory) | — |
| Phase 3.1 competitor ranked keywords (3 competitors) | 3 | moderate per call |
| Phase 3.2 content gap | 0 extra (in-memory diff) | — |

Quote ranges, not exact numbers. Always check live pricing before quoting cost to a user.

---

## Integration with topical-map-creation steps

| Topical map step | DataForSEO endpoint(s) |
|------------------|-------------------------|
| Step 8.1 — Competitor coverage | `dataforseo_labs/google/ranked_keywords/live` |
| Step 8.3 — Database finding (PAA) | `serp/google/organic/live/advanced` → PAA blocks |
| Step 8.7 — Query Fan-Out | `dataforseo_labs/google/related_keywords/live` + `keyword_suggestions/live` |
| Step 9 — RPP (Popularity input) | `keywords_data/google_ads/search_volume/live` |
| Step 9b — Intent (5-type, partial) | `dataforseo_labs/google/keyword_ideas/live` returns intent classification; check `search_intent_info` |
| Step 10 — SERP clustering | `serp/google/organic/live/advanced` × N keywords |
| Step 13/14 — Quality/Trending node validation | `serp/google/organic/live/advanced` + `keywords_data` for volume trend |
| Tier 3 — Share of Model | `ai_optimization/llm_mentions/live` |

---

## n8n integration pattern (per Madrank infrastructure)

DataForSEO calls flow through `madrank.app.n8n.cloud`. Standard nodes:

1. HTTP Request node → DataForSEO endpoint
2. Function node → parse response envelope, error-check
3. Supabase node → write results to topical-map staging table
4. Webhook → notify Claude/n8n orchestrator when batch complete

Webhook URL pattern: `https://madrank.app.n8n.cloud/webhook/topical-map-dataforseo-complete`

Use Standard method with Priority 1 for cost-sensitive batches (acceptable when run is overnight or in background). Use Live for interactive Tool-Assisted sessions.

---

## Verifying behavior

After any DataForSEO call:

1. **Check `status_code == 20000`** before parsing `result`
2. **Check `cost`** matches expected budget
3. **Check `tasks_error == 0`**
4. **Inspect `result[0]` actually contains data** — empty arrays are common when no SERP results exist for an obscure keyword
5. **Cite the call in topical map output:** "Volume per DataForSEO `keywords_data/google_ads/search_volume/live` (call ID `...`) returned [date]."

Never claim volume data without a citable tool call.

---

## What NOT to use DataForSEO for

- **Google Custom Search JSON API replacement** — Google CSE is closed to new customers per Madrank memory. Use Claude `web_search` instead of DataForSEO for general web search needs; DataForSEO is for structured SERP/keyword data, not raw page content.
- **Page content fetching** — use `web_fetch` or `tavily-retrieval` skill.
- **Image search** — use `image_search` tool.
- **Site audit** — use Ahrefs Site Audit MCP or `MADRANKER` skill, not DataForSEO. DataForSEO On-Page API exists but is less feature-complete than Ahrefs for audit work.
