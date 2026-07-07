# last30days Pre-Pass Runbook

How to feed a brand's last-30-day community evidence into the review generator.
Run this from **Cowork/Claude**, once per brand you're about to (re)generate.
~5–10 min per brand.

**Where the engine lives (verified 2026-07-07).** `last30days` v3.11.0 is installed
on the Mac at `~/Projects/ai-brain/skills/user/last30days` — NOT as a Cowork skill,
so the sandbox can't run it. Claude drives it through **Desktop Commander**
(`start_process`), which executes on the Mac. Keys are configured in
`~/.config/last30days/.env` (ScrapeCreators for TikTok/IG; `FROM_BROWSER=auto` for
X via the logged-in browser). All 8 sources verified live.

**Drive it as the planner — always pass `--plan`.** Run headless it falls back to a
shallow 1-subquery planner. Claude (you) generate the query plan and pass
`--plan /tmp/<brand>-plan.json`. This is where the disambiguation below lives.

---

## Step 0 — Brand suitability triage (do this FIRST; it decides whether to run at all)

The 2026-07-07 pilot proved community evidence only pays off for a **middle band**
of brands. Triage before spending a run:

- **Generic / collision-prone name** (contains common tech words — "Quantum AI",
  "WhatsApp AI", "Bitcoin Prime", "Immediate Edge"): the raw name pulls mostly
  noise (post-quantum cryptography, market chatter, tickers) and the only
  brand-named hits are often affiliate funnel videos. **Do NOT run on the bare
  name** — use the tightened plan in Step 2 (scam-context anchor on every subquery,
  HackerNews dropped) and the strict gate in Step 2.5. If it still returns only
  funnel/promo, **store nothing**.
- **Distinctive name** ("Legacy Bitfundex", "Justo Credovia"): clean results, no
  collision — run normally. Expect **low volume** (often 0–2 genuine mentions).
- **Freshly-launched / ad-only brand** (high `velocity_7d`, no organic recognition):
  likely **near-zero** community evidence. Usually skip — a run costs more than it
  returns.

Rule of thumb: run only on brands recognizable enough to have organic victim
chatter. Community evidence is a **capped corroboration layer, never primary**.

## Step 1 — Gather brand inputs

From `scam_brands` (or the admin brand record): brand **name**, **aliases**, the
brand **id** (for the upsert), and the captured **landing/scam domains**
(`landing_urls`). Note whether the name is generic or distinctive (Step 0).

## Step 2 — Run the recency pull (tightened plan)

Write a `--plan` JSON and run via Desktop Commander:
`python3 scripts/last30days.py "<BRAND> scam" --plan /tmp/<brand>-plan.json --emit json --output /tmp/<brand>.json`

Plan rules learned from the pilot — **bake the scam context into the queries, not
just the brand name**:

- **Anchor EVERY subquery** with scam-context tokens, never the bare brand:
  `"<BRAND> scam"`, `"<BRAND> withdrawal problem lost money"`,
  `"<BRAND> fake celebrity endorsement"`. Mirror the anchor in each `ranking_query`.
- **Primary sources:** `reddit, x, youtube, tiktok, instagram`. **Drop `hackernews`
  and `polymarket` for collision-prone names** — on "Quantum AI" they dragged in
  post-quantum-cryptography and prediction-market noise. Add them back only for a
  distinctive name where they're harmless.
- Keep it to **2–3 subqueries** (primary + withdrawal + fake-endorsement). More just
  adds noise.
- Distinctive names: the simple `"<BRAND> scam"` primary is enough.

Then apply `storm-research` grounding (Mode: RESEARCH, YMYL flag ON) over the pulled
items — verify each is real and brand-specific, assign stance/verdict/confidence,
drop `[UNVERIFIED]`.

## Step 2.5 — Strict grounding gate (the pilot's hard-won filters)

Apply these drops before normalizing. Each one caught real garbage on Quantum AI:

1. **Brand-adjacency gate.** Keep only items whose title/snippet/url contain the
   brand token(s) *adjacent* (`"quantum ai"`, not a bare `"quantum"`). Bare-token
   matches are the #1 noise source (post-quantum crypto, generic "AI trading").
2. **Scam-context gate.** The item must also carry a scam-context token
   (scam/fraud/withdraw/lost/refund/warn/avoid/deposit). Brand-name-only mentions
   without scam context are usually market chatter.
3. **Affiliate-funnel drop — critical.** Reject any item whose URL or body links to
   a signup/redirect funnel (e.g. `?r=<Brand>`, `?f=<Brand>`, known redirector
   domains, "Official Site / Direct access" YouTube "SCAM OR LEGIT?" videos). On
   Quantum AI these were the *only* brand-named results and they are **promo dressed
   as reviews** — storing them would poison the review. Mark `stance:"promo"` and
   drop.
4. **Stance drop.** Drop `promo` and `neutral`; keep `victim_report`, `warning`,
   `contradiction`.
5. **Cap + rank.** Keep the strongest ≤12 by engine `final_score`, regulator/named
   victims first.

If, after this gate, **0 items remain (Quantum-AI case) → store nothing and skip the
brand.** A thin pool (1–2 items, the Bitfundex case) is fine and worth storing.

## Step 3 — Normalize to the pool schema

Ask Claude to emit a JSON array where each item is:

```jsonc
{
  "source": "reddit",            // reddit|x|youtube|tiktok|hackernews|polymarket|other
  "url": "https://…",
  "title": "short label",
  "snippet": "grounded, quotable excerpt",
  "engagement": { "score": 312, "comments": 88 },
  "date": "2026-06-24",
  "stance": "victim_report",     // victim_report|warning|promo|neutral|contradiction
  "verdict": "Supported",        // storm-research verdict
  "confidence": "high"
}
```

Drop anything storm-research marked `[UNVERIFIED]` or `Contradicted`. Keep the
strongest 8–15 items.

## Step 4 — Push to Supabase

POST the normalized pool to the ingestion endpoint (admin-auth):

```bash
curl -X POST "$SITE/api/admin/brands/<BRAND_ID>/recency" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "pool": [ … the array from Step 3 … ],
    "window_start": "2026-06-07",
    "window_end": "2026-07-07",
    "dossier_md": "…full storm-research dossier (optional, for audit)…",
    "run_note": "manual pre-pass"
  }'
```

Response confirms `stored_items`, `dropped`, and the derived `summary`. Re-POSTing
the same brand **overwrites** (upsert on `brand_id`).

> In Cowork, Claude can run this curl directly — just give it the brand ID.

## Step 5 — Generate the review

Regenerate the review as usual. When `RECENCY_EVIDENCE_ENABLED=1`, Phase 2.6
merges the pool as `[COMMUNITY]` ledger entries and the writer uses them as dated,
attributed experience evidence.

---

## Activation (one-time, Niro)

The app side is **gated off** until you flip the flag:

1. In **Vercel → Project → Settings → Environment Variables**, add
   `RECENCY_EVIDENCE_ENABLED=1`. (Leave unset to keep it dormant — production is a
   no-op without it, even with data in the table.)
2. Do a Phase-2 review of the writer prompt rules (`community_report` block in
   `lib/review-pipeline.js`) on one brand in **preview** before enabling in prod.

## Manual steps that stay with you

- **Push the code:** commit in the sandbox is not done here (no git on the mounted
  repo). Push `migrations/017…`, `lib/recency-evidence.js`, the new
  `app/api/admin/brands/[id]/recency/route.js`, and the edits to
  `app/api/admin/reviews/generate/route.js` + `lib/review-pipeline.js` via GitHub
  Desktop → Vercel auto-deploys.
- **Migration is already applied** to Supabase `rqyfuioazbdixflqngcs` (table
  `brand_recency_evidence`, RLS on, service-role policy). The committed SQL file
  is for repo parity.
- **X cookies expire.** `FROM_BROWSER=auto` reads the logged-in browser; if X pulls
  start returning 0, re-log into x.com in Safari. For unattended runs, an
  `XAI_API_KEY` / `XQUIK_API_KEY` in `~/.config/last30days/.env` is more durable.

## Optional — automate the refresh (Phase 3)

A 30-day window decays fast. **The weekly scheduled task
(`crypto-killer-recency-refresh`) is currently PAUSED** — it was written for a
native Cowork skill, but the engine + keys live only on the Mac. To re-enable, it
must be rewritten to drive the engine via **Desktop Commander** (`start_process` →
run the tightened plan → apply the Step 2.5 gate → upsert), and only refresh the
handful of brands that pass Step 0 triage (recognizable, distinctive names) — not
the whole top-N, most of which return nothing.
