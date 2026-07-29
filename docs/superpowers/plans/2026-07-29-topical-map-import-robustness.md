# Topical Map Import Robustness + Write Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make spreadsheet import all-or-nothing and Write-ready (B+C sheet fields), then auto-gather Sullivan evidence from our stack and Firecrawl without inventing.

**Architecture:** Hard-validate the sheet → consolidate → coverage-assert → atomic persist with count verification and hard orphan cleanup → post-import readiness job that fills `content_briefs` only from cited stack/Firecrawl evidence.

**Tech Stack:** Node.js (`node:test`), Next.js API routes on Vercel, Supabase REST via `supaFetch`, optional Firecrawl HTTP API (`FIRECRAWL_API_KEY`).

**Spec:** [`docs/superpowers/specs/2026-07-29-topical-map-import-robustness-design.md`](../specs/2026-07-29-topical-map-import-robustness-design.md)

## Global Constraints

- Never invent Sullivan `forcing_inputs` (honesty rule 6 / `lib/content-brief/sullivan.js`).
- Evidence order: **Supabase + live cryptokiller.org first**, then **Firecrawl** if still short.
- Missing required sheet cells → **whole import fails** (422) before any DB write.
- Persist failure → map + topics **must** be deleted; cleanup failure is a critical error, not silent success.
- `stats` counts = **actual** inserted rows after verify.
- No em-dashes in user-facing copy (project convention: colons / hyphens / semicolons).
- Tests: `node --test 'test/**/*.test.js'` (or scoped path). Prefer TDD per task.

## File map

| File | Responsibility |
|---|---|
| `lib/topical-map/import/validate-sheet.js` | Required headers + per-page required cells |
| `lib/topical-map/import/coverage.js` | Sheet pages ↔ consolidated tree coverage |
| `lib/topical-map/import/persist.js` | Atomic verify + hard cleanup + accurate stats |
| `app/api/admin/topical-map/import/route.js` | Wire gates; trigger readiness; optional replace |
| `lib/topical-map/readiness/propose-sullivan-type.js` | Deterministic Sullivan type proposal (or null) |
| `lib/topical-map/readiness/gather-stack.js` | Portfolio/site evidence extraction |
| `lib/topical-map/readiness/gather-firecrawl.js` | Firecrawl scrape + cite |
| `lib/topical-map/readiness/run-map.js` | Orchestrate per-topic readiness upsert |
| `app/api/admin/topical-map/[id]/readiness/route.js` | POST run / GET status |
| `app/admin/topical-map/page.js` | Import 422 UI + readiness badges / re-run |
| `test/topical-map/validate-sheet.test.js` | Gate tests |
| `test/topical-map/coverage.test.js` | Coverage tests |
| `test/topical-map/persist-atomic.test.js` | Mocked persist rollback |
| `test/topical-map/readiness.test.js` | Gather + no-invent tests |
| `docs/topical-map-import.md` | Operator runbook |

### Resolved open points (from spec §11)

1. **Internal Links To:** required only for sheet rows that become **supporting** topics (not pillar/cluster shells).
2. **Notes / Angle:** warn only (not hard-fail).
3. **Readiness:** **auto-start** after successful import (fire-and-forget / best-effort await with timeout), plus manual **Re-run readiness**.

---

### Task 1: Sheet validation module

**Files:**
- Create: `lib/topical-map/import/validate-sheet.js`
- Create: `test/topical-map/validate-sheet.test.js`
- Modify: `lib/topical-map/import/field-map.js` (export any helpers validation needs; keep `PAGE_MAP_HEADERS` as source of truth)

**Interfaces:**
- Consumes: remapped page rows from `mapPageRow` / `parseSheetInput` pages (`rolling_placeholder`, title, url_path, target_keyword, search_intent, publication_wave, internal_links_raw, cluster_raw, section)
- Produces: `validateImportedPages(pages) -> { ok: boolean, errors: Array<{ row: number, title: string, missing_columns: string[] }>, warnings: string[] }`

- [ ] **Step 1: Write the failing test**

```js
'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { validateImportedPages } = require('../../lib/topical-map/import/validate-sheet')

describe('validateImportedPages', () => {
  it('fails when Primary Query Cluster / Search Intent / Phase / Internal Links missing on a page row', () => {
    const pages = [
      {
        title: 'Pig Butchering Scam Explained',
        url_path: '/wiki/pig-butchering/',
        target_keyword: null,
        search_intent: 'informational', // normalizeIntent defaults — simulate blank by marking _blankIntent
        publication_wave: 3,
        internal_links_raw: [],
        section: 'core',
        cluster_raw: '1. Wiki',
        rolling_placeholder: false,
        _sheet: {
          'Primary Query Cluster': '',
          'Search Intent': '',
          Phase: '',
          'Internal Links To': '',
          'Page Title (Title Tag Style)': 'Pig Butchering Scam Explained',
          'Suggested URL': '/wiki/pig-butchering/',
          Section: 'CORE',
          Cluster: '1. Wiki',
        },
      },
    ]
    const result = validateImportedPages(pages)
    assert.equal(result.ok, false)
    assert.ok(result.errors[0].missing_columns.includes('Primary Query Cluster'))
    assert.ok(result.errors[0].missing_columns.includes('Search Intent'))
    assert.ok(result.errors[0].missing_columns.includes('Phase'))
    assert.ok(result.errors[0].missing_columns.includes('Internal Links To'))
  })

  it('skips rolling placeholders', () => {
    const result = validateImportedPages([
      {
        title: 'Ongoing alerts',
        rolling_placeholder: true,
        _sheet: {},
      },
    ])
    assert.equal(result.ok, true)
    assert.equal(result.errors.length, 0)
  })

  it('warns when Notes / Angle blank but does not fail', () => {
    const result = validateImportedPages([
      {
        title: 'Checker',
        url_path: '/check/',
        target_keyword: 'crypto scam checker',
        search_intent: 'transactional',
        publication_wave: 1,
        internal_links_raw: ['crypto-scams'],
        section: 'core',
        cluster_raw: '4. Verification',
        rolling_placeholder: false,
        notes: null,
        _sheet: {
          'Primary Query Cluster': 'crypto scam checker',
          'Search Intent': 'Transactional',
          Phase: '1',
          'Internal Links To': '/blog/crypto-scams/',
          'Notes / Angle': '',
        },
      },
    ])
    assert.equal(result.ok, true)
    assert.ok(result.warnings.some((w) => /Notes/i.test(w)))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/topical-map/validate-sheet.test.js`  
Expected: FAIL (module missing)

- [ ] **Step 3: Implement `validateImportedPages`**

```js
'use strict'

function sheetCell(page, header) {
  const s = page?._sheet || {}
  return String(s[header] ?? '').trim()
}

/**
 * Hard-gate supporting page rows before persist.
 * Uses raw _sheet cells so normalizeIntent defaults cannot hide blanks.
 */
function validateImportedPages(pages) {
  const errors = []
  const warnings = []
  ;(pages || []).forEach((page, idx) => {
    if (page?.rolling_placeholder) return
    if (!page?.title) return

    const missing = []
    if (!sheetCell(page, 'Page Title (Title Tag Style)') && !page.title) missing.push('Page Title (Title Tag Style)')
    if (!sheetCell(page, 'Suggested URL') && !page.url_path) missing.push('Suggested URL')
    if (!sheetCell(page, 'Section') && !page.section) missing.push('Section')
    if (!sheetCell(page, 'Cluster') && !page.cluster_raw) missing.push('Cluster')
    if (!sheetCell(page, 'Primary Query Cluster')) missing.push('Primary Query Cluster')
    if (!sheetCell(page, 'Search Intent')) missing.push('Search Intent')
    if (!sheetCell(page, 'Phase')) missing.push('Phase')
    if (!sheetCell(page, 'Internal Links To')) missing.push('Internal Links To')

    if (missing.length) {
      errors.push({ row: idx + 2, title: page.title, missing_columns: missing }) // +2 ≈ header + 1-index
    } else if (!sheetCell(page, 'Notes / Angle') && !page.notes) {
      warnings.push(`Row ${idx + 2} "${page.title}": Notes / Angle is blank`)
    }
  })
  return { ok: errors.length === 0, errors, warnings }
}

module.exports = { validateImportedPages }
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `node --test test/topical-map/validate-sheet.test.js`

- [ ] **Step 5: Commit**

```bash
git add lib/topical-map/import/validate-sheet.js test/topical-map/validate-sheet.test.js
git commit -m "$(cat <<'EOF'
feat(import): hard-gate required sheet cells before persist

EOF
)"
```

---

### Task 2: Coverage assert (sheet ↔ tree)

**Files:**
- Create: `lib/topical-map/import/coverage.js`
- Create: `test/topical-map/coverage.test.js`
- Modify: `lib/topical-map/import/koray-structure.js` only if consolidator drops named clusters without warning (prefer fail in coverage, fix consolidator if bug)

**Interfaces:**
- Consumes: `pages` from parse; `{ structure, counts, warnings }` from `consolidateKoray`
- Produces: `assertImportCoverage({ pages, structure, counts }) -> { ok, errors: string[], expected_supporting, actual_supporting, missing_titles: string[] }`

- [ ] **Step 1: Write the failing test**

```js
'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { assertImportCoverage } = require('../../lib/topical-map/import/coverage')

describe('assertImportCoverage', () => {
  it('fails when a non-rolling sheet page title is absent from the tree', () => {
    const pages = [
      {
        title: 'Exchange Safety Report: Binance',
        rolling_placeholder: false,
        cluster_raw: '8. Exchange Safety Reports',
        url_path: '/review/binance-safety/',
      },
    ]
    const structure = {
      pillars: [
        {
          section: 'core',
          pillar: { title: 'Only Pillar', slug: 'only' },
          clusters: [{ title: 'Other', slug: 'other', supporting: [] }],
        },
      ],
    }
    const result = assertImportCoverage({
      pages,
      structure,
      counts: { pillars: 1, clusters: 1, supporting: 0 },
    })
    assert.equal(result.ok, false)
    assert.ok(result.missing_titles.includes('Exchange Safety Report: Binance'))
  })

  it('passes when every non-rolling page title appears under supporting or as pillar page', () => {
    const pages = [
      { title: 'Leaf A', rolling_placeholder: false, url_path: '/a/' },
    ]
    const structure = {
      pillars: [
        {
          section: 'core',
          pillar: { title: 'P', slug: 'p' },
          clusters: [
            {
              title: 'C',
              slug: 'c',
              supporting: [{ title: 'Leaf A', slug: 'a' }],
            },
          ],
        },
      ],
    }
    const result = assertImportCoverage({
      pages,
      structure,
      counts: { pillars: 1, clusters: 1, supporting: 1 },
    })
    assert.equal(result.ok, true)
  })
})
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

Run: `node --test test/topical-map/coverage.test.js`

- [ ] **Step 3: Implement coverage**

```js
'use strict'

function collectTreeTitles(structure) {
  const titles = new Set()
  for (const branch of structure.pillars || []) {
    if (branch.pillar?.title) titles.add(branch.pillar.title)
    for (const c of branch.clusters || []) {
      if (c.title) titles.add(c.title)
      for (const s of c.supporting || []) {
        if (s.title) titles.add(s.title)
      }
    }
  }
  return titles
}

function countSupporting(structure) {
  let n = 0
  for (const branch of structure.pillars || []) {
    for (const c of branch.clusters || []) n += (c.supporting || []).length
  }
  return n
}

function assertImportCoverage({ pages, structure, counts }) {
  const errors = []
  const treeTitles = collectTreeTitles(structure)
  const expectedPages = (pages || []).filter((p) => p?.title && !p.rolling_placeholder)
  const missing_titles = expectedPages
    .map((p) => p.title)
    .filter((t) => !treeTitles.has(t))

  if (missing_titles.length) {
    errors.push(
      `${missing_titles.length} sheet page(s) missing from consolidated tree: ${missing_titles.slice(0, 8).join('; ')}`
    )
  }

  const actual_supporting = countSupporting(structure)
  const expected_supporting = expectedPages.length
  // Allow small variance only if consolidator documents merges; default: supporting count must equal non-rolling pages that are not themselves pillar roots.
  // Practical rule: every expected page title must be in tree (above). Count mismatch is an extra signal.
  if (counts && typeof counts.supporting === 'number' && counts.supporting !== actual_supporting) {
    errors.push(
      `counts.supporting (${counts.supporting}) != tree supporting (${actual_supporting})`
    )
  }

  return {
    ok: errors.length === 0,
    errors,
    expected_supporting,
    actual_supporting,
    missing_titles,
  }
}

module.exports = { assertImportCoverage, collectTreeTitles, countSupporting }
```

Tune the expected_supporting equality if pillar rows are also in `pages` (Growth Partner sheet includes pillar URLs). Prefer **title membership** as the hard rule; use count checks as secondary.

- [ ] **Step 4: Add fixture regression** — load `test/topical-map/fixtures/page-map-sample.csv`, consolidate, assert coverage ok. If the real Google sheet CSV is available in CI as a fixture later, add it; for now sample + synthetic drop test is enough.

- [ ] **Step 5: Run tests — PASS, then commit**

```bash
git add lib/topical-map/import/coverage.js test/topical-map/coverage.test.js
git commit -m "$(cat <<'EOF'
feat(import): assert sheet pages appear in consolidated tree

EOF
)"
```

---

### Task 3: Atomic persist + hard orphan cleanup

**Files:**
- Modify: `lib/topical-map/import/persist.js`
- Create: `test/topical-map/persist-atomic.test.js`

**Interfaces:**
- Consumes: existing `persistImportedMap({ structure, ..., supaFetch })`
- Produces: same return shape `{ mapId, topicCount, ... }` but throws after cleanup on mismatch; `deleteOrphanMap` must rethrow or return `{ cleaned: boolean, error? }` and callers treat `cleaned === false` as critical

- [ ] **Step 1: Write failing test with mock `supaFetch`**

```js
'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { persistImportedMap } = require('../../lib/topical-map/import/persist')

function mockSupa(sequence) {
  let i = 0
  const calls = []
  const fn = async (path, opts = {}) => {
    calls.push({ path, opts })
    const step = sequence[i++]
    if (!step) throw new Error(`Unexpected call ${path}`)
    if (step.throw) throw new Error(step.throw)
    return step.return
  }
  fn.calls = calls
  return fn
}

describe('persistImportedMap atomicity', () => {
  it('deletes map when topic insert fails mid-way', async () => {
    const structure = {
      pillars: [
        {
          section: 'core',
          pillar: { title: 'P1', slug: 'p1', target_keyword: 'a' },
          clusters: [
            {
              title: 'C1',
              slug: 'c1',
              supporting: [{ title: 'S1', slug: 's1', target_keyword: 'b' }],
            },
          ],
        },
      ],
    }
    const supaFetch = mockSupa([
      { return: [] }, // loadExistingSlugs first page
      { return: [{ id: 'map-1' }] }, // map insert
      { return: [{ id: 't-pillar', slug: 'p1' }] }, // pillar
      { throw: 'cluster insert boom' },
      { return: null }, // delete topics
      { return: null }, // delete map
    ])

    await assert.rejects(
      () =>
        persistImportedMap({
          structure,
          mapName: 'Test',
          seedKeyword: 'crypto scams',
          source: 'test',
          warnings: [],
          counts: { pillars: 1, clusters: 1, supporting: 1 },
          supaFetch,
        }),
      /boom|Failed|insert/i
    )
    assert.ok(supaFetch.calls.some((c) => c.path.includes('/topics?map_id=eq.map-1') && c.opts.method === 'DELETE'))
    assert.ok(supaFetch.calls.some((c) => c.path.includes('/topical_maps?id=eq.map-1') && c.opts.method === 'DELETE'))
  })

  it('fails if post-insert count verify mismatches', async () => {
    // After all inserts succeed, a count GET returns fewer rows than topicCount → cleanup + throw
    // Implement sequence accordingly in the test once verify query is added.
  })
})
```

Adjust mock sequence to match real `loadExistingSlugs` pagination + insert count. Read current `persist.js` end-of-function for stats PATCH and expand.

- [ ] **Step 2: Run — expect FAIL** (cleanup best-effort / no verify)

- [ ] **Step 3: Implement**

In `persist.js`:

1. Replace silent `deleteOrphanMap` catch-all with:

```js
async function deleteOrphanMap(supaFetch, mapId) {
  if (!mapId) return { cleaned: true }
  const errors = []
  try {
    await supaFetch(`/topics?map_id=eq.${mapId}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
      useServiceRole: true,
    })
  } catch (e) {
    errors.push(`topics: ${e.message}`)
  }
  try {
    await supaFetch(`/topical_maps?id=eq.${mapId}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
      useServiceRole: true,
    })
  } catch (e) {
    errors.push(`map: ${e.message}`)
  }
  return { cleaned: errors.length === 0, errors }
}
```

2. After inserts, verify:

```js
const verify = await supaFetch(
  `/topics?map_id=eq.${mapId}&select=id&limit=1`,
  // Prefer a count header if PostgREST Prefer: count=exact is already used elsewhere; else select=id and paginate
)
// Use Prefer: count=exact + head if available in this codebase's supaFetch wrapper — grep first.
if (actualCount !== topicCount) {
  const cleanup = await deleteOrphanMap(supaFetch, mapId)
  const err = new Error(
    `Import count mismatch: inserted ${topicCount}, db has ${actualCount}. cleanup=${cleanup.cleaned}`
  )
  err.cleanup = cleanup
  throw err
}
```

3. On any catch in the insert try: call `deleteOrphanMap`; if `!cleaned`, append `CRITICAL: orphan map ${mapId}` to thrown message.

4. Patch `stats` with actual `topic_count`, pillar/cluster/supporting counts from the tree walk after success.

- [ ] **Step 4: Tests PASS, commit**

```bash
git add lib/topical-map/import/persist.js test/topical-map/persist-atomic.test.js
git commit -m "$(cat <<'EOF'
fix(import): verify topic counts and hard-delete orphan maps

EOF
)"
```

---

### Task 4: Wire import route (gates + readiness kickoff + replace)

**Files:**
- Modify: `app/api/admin/topical-map/import/route.js`
- Modify: `test/topical-map/import.test.js` (add unit-level integration of validate+coverage on fixture; route may stay thin)

**Interfaces:**
- Request JSON may include `replace_map_id?: string`
- Response 422: `{ error, validation_errors?, coverage_errors? }`
- Response 200: `{ map_id, topic_count, warnings, readiness: { started: boolean, error?: string } }`

- [ ] **Step 1: Update route flow**

After `parseSheetInput` / fetch:

```js
const { validateImportedPages } = require('@/lib/topical-map/import/validate-sheet')
const { assertImportCoverage } = require('@/lib/topical-map/import/coverage')

const gate = validateImportedPages(parsed.pages)
if (!gate.ok) {
  return NextResponse.json(
    { error: 'Sheet failed required-field gate', validation_errors: gate.errors },
    { status: 422 }
  )
}

const { structure, warnings, counts } = consolidateKoray(parsed.pages)
const coverage = assertImportCoverage({ pages: parsed.pages, structure, counts })
if (!coverage.ok) {
  return NextResponse.json(
    { error: 'Sheet failed coverage gate', coverage_errors: coverage.errors, missing_titles: coverage.missing_titles },
    { status: 422 }
  )
}

const saved = await persistImportedMap({ ... })

// Optional replace: only after new map verifies
if (replaceMapId) {
  await deleteOrphanMap(supaFetch, replaceMapId) // export deleteOrphanMap from persist
}

let readiness = { started: false }
try {
  // Dynamic import to avoid circular weight; do not await full map if > ~20s — await Promise.race or void run
  const { startMapReadiness } = require('@/lib/topical-map/readiness/run-map')
  void startMapReadiness({ mapId: saved.mapId, supaFetch }).catch((e) =>
    console.error('readiness', e)
  )
  readiness = { started: true }
} catch (e) {
  readiness = { started: false, error: e.message }
}

return NextResponse.json({ ...saved, warnings: [...gate.warnings, ...warnings], readiness })
```

Until Task 5–7 land, stub `startMapReadiness` as no-op exporting `{ started: true }` so the route compiles — or gate the require behind try/catch only.

- [ ] **Step 2: Fixture test** — `validateImportedPages` + `assertImportCoverage` on sample CSV after consolidate must `ok: true`.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(import): enforce sheet gates and kick off readiness

EOF
)"
```

---

### Task 5: Stack gather + Sullivan type proposal

**Files:**
- Create: `lib/topical-map/readiness/propose-sullivan-type.js`
- Create: `lib/topical-map/readiness/gather-stack.js`
- Create: `test/topical-map/readiness.test.js`

**Interfaces:**
- `proposeSullivanType(topic) -> 'firsthand_review' | 'infrastructure' | 'original_data_study' | 'case_study' | 'contrarian_opinion' | null`
- `gatherStackEvidence({ topic, supaFetch, fetchImpl }) -> { content_type, forcing_inputs, sources: Array<{ url, field, quote }>, missing: string[] }`
- Never call an LLM to fill forcing inputs.

Rules for `proposeSullivanType` (deterministic, conservative):

| Signal | Type |
|---|---|
| `content_type === 'brand_review'` or `/review/` in `url_path` | `firsthand_review` |
| glossary / wiki definition / FAQ hub in title or `content_format` | `infrastructure` |
| notes/title mention proprietary dataset / n= / survey | `original_data_study` |
| else | `null` (skip auto-Sullivan; leave needs_evidence) |

`gatherStackEvidence` for `firsthand_review`:

1. Query Supabase reviews by slug/brand from `url_path`.
2. Pull live `/api/reviews/{slug}` if present.
3. Build anecdotes only from **quoted** body sentences (min 3 distinct quotes) + credentials from author/org strings already on the page.
4. If &lt; 3 quotes, set `missing` to Sullivan field names; do not pad.

For `infrastructure`:

1. Require a real Wikidata Q-ID already stored on related content/schema — if none, **do not invent**; leave `entity_id` missing.
2. `internal_link_targets` from topic.internal_links_to (already on map) — allowed as portfolio links.
3. `sub_entities` only if found as linked child titles in our graph (min 3) else missing.

- [ ] **Step 1: Tests**

```js
it('does not invent Wikidata Q-IDs', async () => {
  const out = await gatherStackEvidence({
    topic: { title: 'Crypto Scam', url_path: '/wiki/crypto-scam/', content_type: 'educational', internal_links_to: ['a', 'b', 'c'] },
    proposeType: 'infrastructure',
    supaFetch: async () => [],
    fetchImpl: async () => ({ ok: false }),
  })
  assert.equal(out.forcing_inputs.entity_id, undefined)
  assert.ok(out.missing.includes('entity_id'))
})

it('fills anecdotes only from provided review HTML quotes', async () => {
  // mock review body with >=3 distinct sentences → forcing_inputs.direct_anecdotes length >= 3
})
```

- [ ] **Step 2: Implement + PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(readiness): gather Sullivan evidence from stack without inventing

EOF
)"
```

---

### Task 6: Firecrawl gatherer

**Files:**
- Create: `lib/topical-map/readiness/gather-firecrawl.js`
- Modify: `test/topical-map/readiness.test.js`
- Document env in `docs/topical-map-import.md` (created here or Task 8)

**Interfaces:**
- `gatherFirecrawlEvidence({ urls, apiKey, fetchImpl }) -> { pages: Array<{ url, markdown, links }>, error?: string }`
- `mergeFirecrawlIntoEvidence(stackResult, firecrawlPages, contentType) -> same shape as gatherStackEvidence`
- If `!process.env.FIRECRAWL_API_KEY`, return `{ skipped: true }` without throwing.

HTTP shape (Firecrawl v1 scrape — verify against current docs at implement time):

```js
async function scrapeUrl(url, apiKey, fetchImpl = fetch) {
  const res = await fetchImpl('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, formats: ['markdown', 'links'] }),
  })
  if (!res.ok) throw new Error(`Firecrawl ${res.status}`)
  return res.json()
}
```

Only scrape:

1. Our domain URLs already known from stack (`cryptokiller.org`, admin-linked paths).
2. Outbound URLs **already linked** on those pages (primary sources) — never arbitrary SERP competitors for anecdotes.

- [ ] **Step 1: Unit test with mocked fetchImpl** — markdown containing three quoted ops notes → anecdotes filled; empty key → skipped.

- [ ] **Step 2: Implement + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(readiness): optional Firecrawl scrape for cited evidence gaps

EOF
)"
```

---

### Task 7: Readiness orchestrator + API

**Files:**
- Create: `lib/topical-map/readiness/run-map.js`
- Create: `app/api/admin/topical-map/[id]/readiness/route.js`
- Optional migration note: store readiness progress in `topical_maps.stats.readiness` JSON (no new table required for v1)

**Interfaces:**
- `startMapReadiness({ mapId, supaFetch, fetchImpl }) -> { processed, sullivan_ok, needs_evidence, skipped }`
- Per topic: propose type → stack → firecrawl if missing → `validateSullivanGate` → upsert `content_briefs`

Upsert pattern (match Plan 6 routes):

```js
const gate = validateSullivanGate({ content_type, forcing_inputs })
const row = {
  topic_id: topic.id,
  map_id: mapId,
  content_type: content_type || null,
  forcing_inputs: forcing_inputs || {},
  sullivan_ok: gate.ok,
  status: 'draft',
  updated_at: new Date().toISOString(),
  // provenance: stash under brief null or stats — prefer forcing_inputs_meta in stats.readiness.topics[id]
}
```

GET readiness: read `topical_maps.stats.readiness` + optional join counts of `content_briefs` where `map_id` and `sullivan_ok`.

POST: `verifyAdmin`, run `startMapReadiness`, return summary.

Export `deleteOrphanMap` from persist for Task 4 replace path if not already.

- [ ] **Step 1: Tests for run-map with mocks** (3 topics: one ok from stack, one filled via firecrawl mock, one still missing).

- [ ] **Step 2: Implement route + orchestrator**

- [ ] **Step 3: Wire real `startMapReadiness` in import route (remove stub)**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(readiness): map-level Sullivan enrich API and import auto-start

EOF
)"
```

---

### Task 8: Admin UI + operator doc

**Files:**
- Modify: `app/admin/topical-map/page.js` (import modal error rendering; readiness badge; Re-run button)
- Create: `docs/topical-map-import.md`

**UI requirements:**

1. On import 422, show scrollable list of `validation_errors` / `coverage_errors` (row + missing columns).
2. On import 200, toast if `readiness.started`; show link/note that brief readiness is running.
3. Per supporting topic actions: badge `evidence_ok` (green) / `needs_evidence` (amber) from brief fetch or map stats.
4. Map header: **Re-run readiness** → `POST /api/admin/topical-map/${mapId}/readiness`.

**Doc (`docs/topical-map-import.md`) must include:**

- Required sheet columns checklist
- Hard-fail vs warn list
- `FIRECRAWL_API_KEY` on Vercel
- Reminder: Replit publish is unrelated; this is Vercel admin only
- Honesty: we never invent Sullivan fields

- [ ] **Step 1: Implement UI + doc**

- [ ] **Step 2: Manual smoke** (operator): import sample CSV in preview or local; confirm 422 on blank Primary Query; confirm readiness endpoint with admin token.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(admin): surface import gates and readiness status

EOF
)"
```

---

## Spec coverage checklist

| Spec section | Task |
|---|---|
| §5 Sheet hard gate | Task 1 |
| §5 Coverage assert | Task 2 |
| §5 Persist atomicity | Task 3 |
| §5 Replace / re-import | Task 4 |
| §6 B+C fields (already largely in field-map/persist) | Verify in Task 4 fixture; fix gaps if any column not persisted |
| §7 Stack gather | Task 5 |
| §7 Firecrawl | Task 6 |
| §7 Orchestrator / Write vs brief gate | Task 7 |
| §8 UX errors | Task 8 |
| §9 Tests | Tasks 1–7 |
| §10 Runbook | Task 8 |

## Self-review notes

- No TBD placeholders left for core APIs; Firecrawl request body must be checked against live docs at Task 6 (URL path may be `/v1/scrape` vs newer — adjust in-task, keep interface stable).
- `proposeSullivanType` returning null is intentional (better blocked than wrong type).
- Plan 7 (outline gate on `sullivan_ok`) stays complementary; this plan only fills evidence so Plan 7 can pass honestly.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-29-topical-map-import-robustness.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — run tasks in this session with executing-plans checkpoints  

Which approach?
