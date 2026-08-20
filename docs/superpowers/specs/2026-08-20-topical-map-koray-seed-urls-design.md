# Design: Koray seed-folder URLs + honest sheet import

**Date:** 2026-08-20
**Status:** approved
**Repo:** crypto-killer
**Sheet:** [Growth Partner page-map](https://docs.google.com/spreadsheets/d/1yQa39Yu2swM1mGaPOhiiYfcSdMUdElDXguJx8tGIYIE/edit)

---

## Problem

Spreadsheet import succeeds (8 / 10 / 49 topics) but persists the wrong category URLs and weakens Write-ready fields:

1. Synthetic grouping pillars get slugified titles (`/victim-journey/`, `/safe-crypto-education/`, `/exchange-safety-reports/`, `/data-link-magnets/`) that are not in the sheet.
2. Seed folders that *are* in the sheet taxonomy (`/scams/`, `/safety/`, `/research/`) never land on cluster/pillar rows (`url_path` null).
3. Internal-link nicknames (`Pillar`, `honeypot page`, `alerts index`) mostly fail to resolve.
4. Blank KD is stored as `0`, which inflates `priority_score`.
5. Parenthetical-only Primary Query Cluster (State of Crypto Scams) yields `target_keyword` null.

## Decisions

| Topic | Decision |
|---|---|
| Network Root | Exactly one: `/crypto-scams/` (sheet hub). Other consolidator branches stay `topic_type=pillar` for the admin tree; they are Koray **Seeds**, not extra Roots. |
| Seed folder URLs | Wiki cluster → `/scams/`. Alerts pillar → `/alerts/`. Safety pillar → `/safety/`. Research pillar → `/research/`. Checker pillar → `/check/` (existing hub). AI-bot pillar → `/scams/ai-trading-bots/` (existing hub). |
| Grouping-only nodes | Victim Journey pillar and Recover/Report clusters: `url_path` null. Education pillar: `url_path` null (`/guides/` is a how-to template, not a contextual category). |
| Leaf URLs | Always the sheet Suggested URL. Do not rewrite `/guides/…` leaves. |
| Invented paths | Never `/${slugify(title)}/` when no hub and no `def.url_path`. |
| Seed metrics | Only copy volume/KD from a real hub row. Do not max() child volume onto a folder. |
| Internal links | Resolve nicknames: branch-scoped `Pillar` → that branch’s pillar; suffix strip; word overlap; small alias map. Skip set-refs (`Every /review/ page`). Unmapped E-E-A-T URLs (`/methodology`) stay unresolved. |
| Blank KD | Store `null`, provenance `unresolved`. Priority uses KD=50 (neutral), not 0. |
| Keyword fallback | If Primary Query Cluster is empty after stripping parentheses, use the title segment before `:`, lowercased. |

## Non-goals

- Changing live `/blog/{slug}` publishing.
- Rewriting `topics.slug` to include category prefixes (leaf slug stays; full path is `url_path`).
- Changing `page_role` Root/Core/Outer mapping (tree depth ≠ Koray Root/Seed/Node).
- Re-importing production in this change set (operator runs Import after deploy).

## Files

- `lib/topical-map/import/koray-structure.js` — seed `url_path` on defs; no slugified fallback; cluster hub URLs; link resolver.
- `lib/topical-map/import/field-map.js` — KD null; keyword fallback; per-field provenance.
- `lib/topical-map/import/persist.js` — persist null KD.
- `test/topical-map/import.test.js` — coverage.
- `docs/topical-map-import.md` — operator note on seed folders.
