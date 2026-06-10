# Replit Agent Handoff — ThreatGauge tier violation + funnelStages dedupe guard

**Date:** 2026-06-10
**Repo:** madrank8/cryptokiller (the Replit render side)
**Trigger incident:** https://cryptokiller.org/review/crest-fundgrove — a 13/100 "Low Signal" review rendered with (a) a sidebar instruction "Do not deposit any money." and (b) 5 funnel-stage cards with Stage 4 duplicated and one image-only stage.

The funnel-stage *data* corruption was a Vercel-side bug and is already fixed there (the generate-route card builder, `parseFunnelStages` in sync-shape, and the new review pipeline all now enforce exactly 4 prose stages). This handoff covers the **two defects that live in THIS repo**. Both are small, surgical changes. Do not refactor anything beyond what is specified.

---

## Task 1 — ThreatGauge: "Do not deposit any money." must be tier-conditional (PRIORITY: legal exposure)

**File:** `artifacts/crypto-review/src/pages/ReviewPage.tsx` (the `ThreatGauge` component, around line 188).

**Problem:** The sidebar "Final Verdict" block unconditionally renders the line **"Do not deposit any money."** for every review. The editorial system has a strict threat-tier language policy: declarative warnings like "Do Not Deposit" are BANNED for any brand scoring **below 60/100** (tiers: `confirmed` ≥80, `high` ≥60 → declarative allowed; `elevated` ≥40, `watchlist` ≥20, `low` <20 → hedged language only). Crest Fundgrove scores 13/100 ("shows limited signals") yet the page commands readers not to deposit — internally contradictory and a defamation-exposure problem the Vercel pipeline carefully avoids everywhere else.

**Fix:** Make the line conditional on the review's threat score (the field is already available on the review object — the same score the gauge displays):

- `score >= 60` → keep exactly the current line: `Do not deposit any money.`
- `40 <= score < 60` → `Exercise extreme caution before depositing any money.`
- `score < 40` → `Verify regulatory registration independently before depositing.`

Apply the same threshold logic to any other hardcoded declarative warning strings in ReviewPage.tsx / ThreatGauge (search the file for "Do not", "Avoid all contact", "confirmed scam" in static JSX). Do NOT change the verdict text itself — that arrives pre-normalized from the sync payload.

**Also check:** the sidebar "Status" chip renders **"Active Scam"** — if that string is hardcoded, make it tier-conditional too: `score >= 60` → "Active Scam"; below → "Active Campaign".

**Acceptance test:** reload `/review/crest-fundgrove` (score 13) → sidebar shows the hedged line and "Active Campaign"; spot-check any review with score ≥80 → unchanged.

---

## Task 2 — funnelStages dedupe guard in the reviews API

**File:** `artifacts/api-server/src/routes/reviews.ts` (the `GET /api/reviews/:slug` handler).

**Problem:** The handler returns `funnel_stages` rows verbatim with no dedupe. The SSR prerender (`artifacts/crypto-review/server/prerender.ts` ~lines 772–801) already has a defensive collapse-by-`stage_number` guard, added after the WhatsApp Bot incident (2026-04-28, stage 4 rendered 3×). The API route never got the same guard, so the client-rendered page displayed Crest Fundgrove's corrupted 5-row set raw.

**Fix:** Before returning funnel stages from `GET /api/reviews/:slug`, apply the same normalization the prerender uses:

1. Collapse duplicates by `stage_number` (keep the row with the longest `description` when duplicates exist).
2. Drop any stage whose `description`, after stripping `<img>`/`<figure>`/HTML tags and markdown images, contains fewer than 40 characters of prose (image-only stages must never render as cards).
3. Cap the result at 4 stages, ordered by `stage_number`.

Extract the prerender's existing dedupe into a shared helper if trivial; otherwise duplicate the ~20 lines with a comment cross-referencing prerender.ts. Do not change the sync ingestion route (`routes/sync.ts`) — its delete-then-insert behavior is correct.

**Optional hardening (only if quick):** in `routes/sync.ts`, reject or clamp payload stages with `stage_number` outside 1–4 before insert, logging a warning.

**Acceptance test:** for the current (corrupted) crest-fundgrove rows, `GET /api/reviews/crest-fundgrove` must return ≤4 stages, unique stage_numbers, no image-only descriptions. (The row data itself will be replaced when the review is regenerated from the admin — this guard is defense-in-depth, not the data fix.)

---

## Out of scope

- Do not modify statTokens.ts, platformStatTokens.ts, schema builders, or any sync field mapping.
- Do not "improve" funnel card styling or copy beyond the conditional strings in Task 1.
- The FAQ wording oddity on crest-fundgrove ("has not met the threshold for a Low Signal designation") is generated content — it gets fixed by regeneration on the Vercel side, not here.
