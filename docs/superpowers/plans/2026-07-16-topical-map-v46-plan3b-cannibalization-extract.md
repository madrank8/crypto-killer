# Topical Map v4.6 Port — Plan 3b: extract + golden-test cannibalization logic

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the cannibalization/dedup check logic out of `stageQa` into a pure, tested module `lib/topical-map/cannibalization.js` (behavior-preserving), so the actual reorder (Plan 3c — running these checks on the clustered pool *before* the map is built) has a golden safety net over the flag output.

**Architecture:** Move the deterministic per-node loop (currently `stages.js` lines ~804-853) verbatim into `buildCannibalizationReport(nodes, ctx)`; `stageQa` keeps its DB fetch + context-building and calls the new function. Golden `node:test` over the extracted function with a fixture that exercises every flag type. No behavior change; every expected value below was captured by running the current code.

**Tech Stack:** Node 20 (`node:test`), CommonJS `lib/`.

## Global Constraints

- **No new dependencies.** Node built-ins only. Baseline on `main` is 30 passing tests (`npm test` runs the drift-check then `node --test test/`).
- **`lib/` is CommonJS.**
- **Behavior-preserving.** The extracted loop must be logic-identical to the current `stageQa` body (lines ~804-853). This is a move, not a rewrite. The function still stamps `node._qa_flags` (some callers read it).
- **Do not change `stageQa`'s observable output** (`{ artifacts: { structure, qa_report }, summary }`) or any other stage.
- The extracted module requires `tokenize`/`jaccard` from `./text-utils` (already on `main`).

## Plan renumbering note

The final review of Plan 3a required a golden test of the cannibalization flag output *before* the reorder. That prerequisite is THIS plan (3b). Consequently: **3b = extract + golden-test (safety net); 3c = the actual reorder (cannibalization on the clustered pool before `structure`); 3d = new stages (RPP/node_function/publishing-metadata/briefs + provenance wiring).**

---

## File Structure

- `lib/topical-map/cannibalization.js` — new; `buildCannibalizationReport(nodes, ctx)` (extracted verbatim).
- `lib/topical-map/stages.js` — modify: replace the inline loop in `stageQa` (~804-853) with a call; add a require.
- `test/topical-map/cannibalization.test.js` — new; golden tests.

---

### Task 1: Extract cannibalization logic, rewire stageQa, golden-test

**Files:**
- Create: `lib/topical-map/cannibalization.js`
- Modify: `lib/topical-map/stages.js` (`stageQa`, and one require near the top)
- Create: `test/topical-map/cannibalization.test.js`

**Interfaces:**
- Consumes: `tokenize`, `jaccard` from `./text-utils`.
- Produces: `buildCannibalizationReport(nodes, { existingKeywords, existingSlugs, existingTitleTokens }) -> { flags, counts, total_nodes, clean_nodes }` (also mutates `node._qa_flags`). `module.exports = { buildCannibalizationReport }`. Plan 3c reuses this on the clustered pool.

- [ ] **Step 1: Write the golden tests**

Create `test/topical-map/cannibalization.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { tokenize } = require('../../lib/topical-map/text-utils')
const { buildCannibalizationReport } = require('../../lib/topical-map/cannibalization')

// Context mirrors what stageQa builds from the DB.
function ctx() {
  return {
    existingKeywords: new Map([['taken kw', 'live-topic-slug']]),
    existingSlugs: new Set(['dup-slug']),
    existingTitleTokens: [
      { title: 'Crypto Recovery Scams Explained', tokens: tokenize('Crypto Recovery Scams Explained') },
    ],
  }
}

test('every flag type fires on the right node; exemptions keep nodes clean', () => {
  const nodes = [
    { title: 'Alpha Guide', target_keyword: 'alpha kw', _slug: 'alpha', _metrics: { search_volume: 500 }, content_type: 'guide' },   // clean
    { title: 'Beta Guide', target_keyword: 'alpha kw', _slug: 'beta', _metrics: { search_volume: 400 }, content_type: 'guide' },     // intra_map_duplicate
    { title: 'Gamma', target_keyword: 'taken kw', _slug: 'gamma', _metrics: { search_volume: 200 }, content_type: 'guide' },         // keyword_collision
    { title: 'Delta', target_keyword: 'delta kw', _slug: 'dup-slug', _metrics: { search_volume: 100 }, content_type: 'guide' },      // slug_collision
    { title: 'Crypto Recovery Scams Explained Fully', target_keyword: 'eps kw', _slug: 'eps', _metrics: { search_volume: 300 }, content_type: 'guide' }, // title_similarity
    { title: 'Zeta', target_keyword: 'zeta kw', _slug: 'zeta', _metrics: { search_volume: 0 }, content_type: 'guide' },              // zero_demand
    { title: 'Eta', target_keyword: 'eta kw', _slug: 'eta', _metrics: { search_volume: 50, keyword_data_source: 'llm-estimated' }, content_type: 'guide' }, // unverified_keyword
    { title: 'Theta Review', target_keyword: 'theta kw', _slug: 'theta', _metrics: { search_volume: 0 }, content_type: 'brand_review' }, // zero-demand EXEMPT -> clean
  ]
  const r = buildCannibalizationReport(nodes, ctx())
  assert.deepEqual(r.counts, {
    intra_map_duplicate: 1,
    keyword_collision: 1,
    slug_collision: 1,
    title_similarity: 1,
    zero_demand: 1,
    unverified_keyword: 1,
  })
  assert.equal(r.total_nodes, 8)
  assert.equal(r.clean_nodes, 2) // Alpha (clean) + Theta (brand_review exempt)
})

test('expands_slug exemption: declaring the page you extend suppresses keyword_collision', () => {
  const nodes = [
    { title: 'X', target_keyword: 'taken kw', expands_slug: 'live-topic-slug', _slug: 'x', _metrics: { search_volume: 100 }, content_type: 'guide' },
  ]
  const r = buildCannibalizationReport(nodes, ctx())
  assert.deepEqual(r.counts, {})
  assert.equal(r.clean_nodes, 1)
})

test('traffic_potential rescues zero search_volume from zero_demand', () => {
  const nodes = [
    { title: 'Y', target_keyword: 'y kw', _slug: 'y', _metrics: { search_volume: 0, traffic_potential: 80 }, content_type: 'guide' },
  ]
  const r = buildCannibalizationReport(nodes, { existingKeywords: new Map(), existingSlugs: new Set(), existingTitleTokens: [] })
  assert.deepEqual(r.counts, {})
})

test('empty node list yields an empty report', () => {
  const r = buildCannibalizationReport([], { existingKeywords: new Map(), existingSlugs: new Set(), existingTitleTokens: [] })
  assert.deepEqual(r, { flags: [], counts: {}, total_nodes: 0, clean_nodes: 0 })
})

test('mutates node._qa_flags on flagged nodes', () => {
  const node = { title: 'Dup', target_keyword: 'k', _slug: 'dup-slug', _metrics: { search_volume: 100 }, content_type: 'guide' }
  buildCannibalizationReport([node], { existingKeywords: new Map(), existingSlugs: new Set(['dup-slug']), existingTitleTokens: [] })
  assert.equal(node._qa_flags.length, 1)
  assert.equal(node._qa_flags[0].type, 'slug_collision')
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../../lib/topical-map/cannibalization'`.

- [ ] **Step 3: Create the module (verbatim extraction)**

Create `lib/topical-map/cannibalization.js` — the loop copied EXACTLY from `stages.js` `stageQa` (current lines ~804-853), wrapped as a function:

```js
'use strict'

const { tokenize, jaccard } = require('./text-utils')

// Cannibalization / dedup checks, extracted verbatim from stages.js stageQa so
// they can be unit-tested and reused. Given the flattened map nodes and the
// "already exists" context (built from the DB by the caller), produce the
// report and stamp node._qa_flags. Pure w.r.t. its inputs (no DB, no I/O).
//
// Plan 3c will call this on the CLUSTERED POOL before the map is built (skill
// Phase 5 before Phase 6); today stageQa calls it on the built structure.
function buildCannibalizationReport(allNodes, { existingKeywords, existingSlugs, existingTitleTokens }) {
  const seenKeywords = new Map()
  const report = { flags: [], counts: {} }
  const flag = (node, type, detail) => {
    node._qa_flags = node._qa_flags || []
    node._qa_flags.push({ type, detail })
    report.flags.push({ slug: node._slug, title: node.title, type, detail })
    report.counts[type] = (report.counts[type] || 0) + 1
  }

  for (const node of allNodes) {
    const kw = node.target_keyword
    // Intra-map duplicate keyword (canon 5.1/5.2)
    if (kw) {
      if (seenKeywords.has(kw)) {
        flag(node, 'intra_map_duplicate', `Same target_keyword as "${seenKeywords.get(kw)}" — merge or differentiate intent`)
      } else {
        seenKeywords.set(kw, node.title)
      }
      // Collision with live content — intentional expansions are exempt
      // when they declare the page they extend (site-aware generation)
      if (existingKeywords.has(kw) && existingKeywords.get(kw) !== node.expands_slug) {
        flag(node, 'keyword_collision', `Existing topic "${existingKeywords.get(kw)}" already targets this keyword`)
      }
    }
    // Slug collision
    if (node._slug && existingSlugs.has(node._slug)) {
      flag(node, 'slug_collision', `Slug "${node._slug}" already exists (topic/content/review)`)
    }
    // Title similarity vs live content (canon 5.1)
    const tokens = tokenize(node.title)
    for (const et of existingTitleTokens) {
      if (jaccard(tokens, et.tokens) >= 0.7) {
        flag(node, 'title_similarity', `~duplicate of existing "${et.title}"`)
        break
      }
    }
    // Zero-demand disposition (canon 5.3) — traffic_potential counts as demand
    const vol = node._metrics?.search_volume
    const tp = node._metrics?.traffic_potential
    if ((vol == null || vol === 0) && !(tp > 0) && node.content_type !== 'brand_review' && node.content_type !== 'pillar_page') {
      flag(node, 'zero_demand', 'No measurable volume or traffic potential — micro-context candidate (merge into parent unless strategic)')
    }
    // Unverified keyword (honesty)
    if (node._metrics?.keyword_data_source === 'llm-estimated') {
      flag(node, 'unverified_keyword', 'target_keyword not found in DataForSEO pool — metrics unverified, priority demoted')
    }
  }

  report.total_nodes = allNodes.length
  report.clean_nodes = allNodes.filter((n) => !(n._qa_flags || []).length).length
  return report
}

module.exports = { buildCannibalizationReport }
```

- [ ] **Step 4: Rewire stageQa to call the module**

In `lib/topical-map/stages.js`:

(a) Add near the other requires (next to `require('./text-utils')`):

```js
const { buildCannibalizationReport } = require('./cannibalization')
```

(b) In `stageQa`, DELETE the inline block from `const seenKeywords = new Map()` through the `report.clean_nodes = ...` line (current lines ~804-853) and replace it with:

```js
  const report = buildCannibalizationReport(allNodes, { existingKeywords, existingSlugs, existingTitleTokens })
```

Leave everything else in `stageQa` unchanged: the `structure` guard, the DB fetches, the `existingKeywords`/`existingSlugs`/`existingTitleTokens` construction, the `allNodes` flattening, and the final `return { artifacts: { structure, qa_report: report }, summary: ... }`.

- [ ] **Step 5: Run tests + prove stageQa still loads and behaves**

Run: `npm test`
Expected: PASS — 30 baseline + 5 new = `# tests 35 # pass 35 # fail 0`.

Run: `node -e "const s=require('./lib/topical-map/stages'); console.log('stages loads:', typeof s.executeCurrentStage==='function')"`
Expected: `stages loads: true`.

- [ ] **Step 6: Commit**

```bash
git add lib/topical-map/cannibalization.js lib/topical-map/stages.js test/topical-map/cannibalization.test.js
git commit -m "refactor(topical-map): extract cannibalization checks to a pure module + golden tests"
```

---

## Self-Review

**Spec coverage:** Implements the Plan 3a final-review requirement — a golden test over the cannibalization flag output before the reorder (spec section 5's Phase-5-before-Phase-6 fix lands in 3c). This plan is the safety net, not the reorder. Correct.

**Placeholder scan:** No TBD/TODO. Every step has complete code and exact commands. All expected values (the 6-flag fixture counts, the 2 clean nodes, the expands_slug and traffic_potential exemptions, the empty case, the `_qa_flags` mutation) were captured by running the current code. PASS.

**Type consistency:** `buildCannibalizationReport(nodes, { existingKeywords, existingSlugs, existingTitleTokens })` signature identical in the module (Task 1 Step 3), the stageQa call (Step 4), and every test (Step 1). Return shape `{ flags, counts, total_nodes, clean_nodes }` consistent. Baseline chain: 30 (main) -> 35 (Task 1: +5). PASS.

**Risk note for the executor:** Step 4 edits `stageQa` inside the 1100+-line `stages.js`. The ONLY changes are: one new require, and replacing the inline loop (804-853) with a single call. Do not alter the DB fetches or context building above it, or the return below it. Step 5's load guard + the unchanged `qa` behavior (same report shape) confirm the rewiring is clean. `stageQa` itself is not unit-tested (it needs supaFetch); the golden coverage is on the extracted pure function it now delegates to.
