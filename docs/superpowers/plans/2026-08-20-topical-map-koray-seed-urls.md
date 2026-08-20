# Koray Seed-Folder Import Implementation Plan

> **For agentic workers:** Execute inline in this session. TDD per task.

**Goal:** Import the Growth Partner page-map with Koray seed-folder URLs, resolvable internal-link nicknames, honest blank KD, and title-based keyword fallback.

**Architecture:** Keep consolidator tree (8 branches). Stop inventing slugified pillar URLs. Assign sheet folder paths to Seed hubs (`/scams/`, `/safety/`, `/research/`, `/alerts/`). Leaves keep Suggested URL. Link resolver becomes nickname-aware. KD null ≠ 0.

**Tech Stack:** Node test runner, existing `lib/topical-map/import/*` CJS modules.

## Global Constraints

- No new npm dependencies.
- Do not modify the brand-review pipeline.
- Use `supaFetch` / existing persist; no schema migration (nullable `keyword_difficulty` already).
- `topics.slug` stays leaf-only; category lives on `url_path`.
- `page_role` mapping unchanged (pillar=Root for admin tree).

---

### Task 1: Seed-folder URLs

**Files:**
- Modify: `lib/topical-map/import/koray-structure.js`
- Test: `test/topical-map/import.test.js`

- [x] Failing tests for Root `/crypto-scams/`, wiki `/scams/`, safety `/safety/`, research `/research/`, victim-journey + education `url_path` null, no `/safe-crypto-education/`.
- [x] Set `url_path` on defs; `makePillarNode` uses hub || def.url_path || null; `makeClusterNode` accepts optional path; wiki child `url_path: '/scams/'`.
- [x] Tests pass.

### Task 2: Internal-link nicknames

**Files:**
- Modify: `lib/topical-map/import/koray-structure.js` (`resolveInternalLinks`)

- [x] Test: pig-butchering `Pillar` → crypto-scams slug; `honeypot page` → honeypot; skip `Every /review/ page`.
- [x] Branch-scoped Pillar; suffix strip; word overlap; skip set-refs. Hub rows copy `internal_links_raw` onto the pillar.

### Task 3: Blank KD + keyword fallback

**Files:**
- Modify: `lib/topical-map/import/field-map.js`, `persist.js`

- [x] Test: parenthetical-only cluster → keyword from title; blank KD stays null; priority not inflated vs KD=0.
- [x] Implement fallback + null KD + priority KD=50 when null.

### Task 4: Docs

**Files:**
- Modify: `docs/topical-map-import.md`
