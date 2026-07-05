# AI Advisor — Implementation Plan

An AI analyst inside /admin/analytics that reads all three data domains (traffic, GSC, content ops) plus scraper/brand velocity, and produces prioritized, deep-linked suggestions. Runs weekly (cron) and on-demand ("Analyze now"). Model: claude-sonnet via the existing `lib/ai-models.js` `callModel()` — no new API plumbing.

## Architecture

```
gsc_daily ─┐
analytics_events (RPCs) ─┤→ lib/advisor-data.js → compact JSON snapshot
reviews/content/topics ──┤      (~10-15k tokens)
sync_runs/scam_brands ───┘            │
                                      ▼
                          lib/advisor.js → callModel('sonnet')
                                      │ structured JSON out
                                      ▼
                          advisor_reports (Supabase) ← history
                                      │
                                      ▼
                          /admin/analytics → Advisor tab
```

## 1. Data snapshot — `lib/advisor-data.js`

One function `buildAdvisorSnapshot(days = 28)` assembling pre-computed, top-N-only data (never raw rows):

- **Traffic**: summary + prior-period deltas, top 10 pages, referrers, countries, devices, top outbound clicks (existing RPCs).
- **Search**: from `gsc_daily` — clicks/impressions trend (weekly buckets), top 10 pages, **opportunity queries** (impressions ≥ 50, CTR < 1.5% → title/meta rewrite candidates), **position movers** (Δposition ≥ 3 vs prior period), pages with impressions but zero clicks.
- **Content ops**: publish velocity trend, pipeline counts, translation coverage per locale, 10 stalest published reviews (with slugs).
- **Opportunity radar**: surging/rising `scam_brands` (velocity) that have **no review yet** — the highest-value suggestion source; recent scraper health.

Numbers only, pre-aggregated. Include site context header (what CryptoKiller is, locales, monetization) so advice is grounded.

## 2. Analysis engine — `lib/advisor.js`

`runAdvisor({ trigger })`:
1. Build snapshot.
2. `callModel` with `sonnet` (fallback chain from ai-models.js), system prompt = senior growth/SEO advisor for a crypto-scam-review YMYL site; must cite specific numbers from the snapshot in every suggestion; forbidden from inventing data.
3. Output schema (validated via `extractJSON`):

```json
{
  "summary": "2-3 sentence executive read",
  "health_score": 0-100,
  "insights": [{ "title", "detail", "trend": "up|down|flat", "severity": "info|warn|critical" }],
  "suggestions": [{
    "id": "stable-fingerprint",
    "title", "why",            // why = cites snapshot numbers
    "priority": "P0|P1|P2",
    "impact": "high|medium|low",
    "effort": "minutes|hours|days",
    "action_type": "new_review|refresh_review|fix_ctr|translate|new_content|scraper|other",
    "target": "slug-or-query",
    "deep_link": "/admin/..."
  }]
}
```

4. Deep links validated server-side against a whitelist map (`action_type` → route template); invalid links nulled, never rendered raw from model output.
5. Persist to `advisor_reports`.

## 3. Persistence — migration `010_advisor.sql`

- `advisor_reports` (id, created_at, trigger_type manual|cron, period_days, model, report jsonb, tokens_in, tokens_out, status). RLS enabled, no policies (service-role only).
- `advisor_suggestion_states` (fingerprint pk, state done|dismissed, updated_at) — so recurring suggestions stay marked across reports.

## 4. API routes

| Route | What |
|---|---|
| `POST /api/admin/advisor/run` | On-demand run (maxDuration 120, rate-limited: reject if a report exists < 30 min old unless `force`) |
| `GET /api/admin/advisor/reports?limit=10` | History (list + latest) |
| `PATCH /api/admin/advisor/suggestion` | Mark done / dismissed / reopen |
| `GET /api/cron/advisor` | Weekly run — Monday 07:00 UTC, after the 06:30 GSC sync (add to vercel.json). Skips politely if GSC/traffic tables are empty |

All admin routes behind `verifyAdmin`; cron behind CRON_SECRET (same pattern as gsc-sync).

## 5. UI — "Advisor" tab in /admin/analytics

- Header: health score dial, report date, trigger type, model, **Analyze now** button (with running state, ~30-60 s).
- Executive summary card.
- Suggestions grouped P0 → P2: card = title, why (with the cited numbers), impact/effort chips, **Open →** deep-link button, ✓ Done / ✕ Dismiss. Done/dismissed collapse into a footer section.
- Insights strip (trend arrows, severity colors).
- History dropdown to load previous reports (diff badge: "3 new suggestions since last run").
- Empty state before first run: explain + button.

## 6. Guardrails & cost

- Sonnet, snapshot capped ~15k input tokens → ~$0.05–0.15/run; weekly cron ≈ < $1/month.
- Token usage stored per report (visible in UI footer).
- Model told: only recommend actions the admin can actually take; every claim must reference a snapshot number.
- No auto-execution in v1 — suggestions link to admin pages; a human clicks.

## Phases

1. **Phase 1 (core)**: migration + advisor-data + advisor lib + run route + Advisor tab with suggestions/insights. → usable same day.
2. **Phase 2**: weekly cron, history, done/dismiss persistence, health score trend.
3. **Phase 3 (later, optional)**: one-click Execute for safe actions (queue review refresh, create review draft from surging brand), advisor chat ("why do you say this?").

Files touched: 1 migration, 2 libs, 4 routes, 1 UI tab, vercel.json. No new dependencies.
