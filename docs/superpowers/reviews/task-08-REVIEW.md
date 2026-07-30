---
phase: topical-map-import-robustness-task-08
reviewed: 2026-07-29T15:33:00Z
depth: deep
files_reviewed: 2
files_reviewed_list:
  - app/admin/topical-map/page.js
  - docs/topical-map-import.md
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase Task 8: Code Review Report

**Reviewed:** 2026-07-29T15:33:00Z  
**Depth:** deep  
**Files Reviewed:** 2  
**Status:** issues_found

## Summary

Task 8 adds import-gate error surfacing, readiness badges, a re-run control, and an operator runbook. The implementation matches the import and readiness API contracts, preserves admin Bearer auth, and keeps new user-facing copy free of em-dashes. No critical defects (silent 422 drop, auth bypass, or honesty-rule contradictions) were found. Two warnings remain: background readiness badges do not auto-refresh, and the runbook overstates 422 coverage for persist failures.

## Narrative Findings (AI reviewer)

### WR-01: Background readiness badges never auto-refresh

**File:** `app/admin/topical-map/page.js:2435-2438`  
**Issue:** After a successful import, the modal states "Per-topic badges will update when it finishes," but nothing polls `loadMaps()` or the readiness GET endpoint when the fire-and-forget job completes. Badges and the header summary (`selectedMap.stats.readiness`) only update after a manual page refresh, map re-select, or "Re-run readiness."  
**Fix:** Poll `GET /api/admin/topical-map/${mapId}/readiness` (or re-call `loadMaps()`) on an interval while `importResult?.readiness?.started` until `stats.readiness.ran_at` is set, then stop polling.

### WR-02: Runbook lists persist verification under HTTP 422

**File:** `docs/topical-map-import.md:36-51`  
**Issue:** The "Hard-fail (422)" section includes persist count verification, but `persistImportedMap` failures are thrown as generic `Error` and returned by the import route as **500**, not 422 with `validation_errors` / `coverage_errors`. Operators expecting a row-level 422 table will not get one for count-mismatch failures.  
**Fix:** Split persist verification into its own subsection ("Hard-fail, HTTP 500, no row table") or adjust the 422 heading to cover only pre-persist gates.

### IN-01: Runbook overgeneralizes 422 UI as row/table for all failures

**File:** `docs/topical-map-import.md:59-60`  
**Issue:** Copy says the UI shows "every failing row, its row number, title, and which columns are missing." That applies to `validation_errors` only; `coverage_errors` render as string bullets plus optional `missing_titles` list.  
**Fix:** Clarify: validation gate → row table; coverage gate → error list + missing titles.

### IN-02: Badge placement uses leaf heuristic, not `topic_type`

**File:** `app/admin/topical-map/page.js:1089`  
**Issue:** `EvidenceBadge` renders on leaf rows only (`isLeaf`), not explicitly on `topic_type === 'supporting'`. This works in practice because `stats.readiness.topics` only keys supporting topics, so non-supporting leaves show no badge. A supporting topic with unexpected children would not show a badge on the parent row.  
**Fix:** Optional hardening: `topic.topic_type === 'supporting' && <EvidenceBadge ... />` on leaf rows.

---

_Reviewed: 2026-07-29T15:33:00Z_  
_Reviewer: Claude (gsd-code-reviewer)_  
_Depth: deep_
