# Topical Map v4.6 Port — Plan 3c-1: pool-level cannibalization capability

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ability to run cannibalization checks on the *clustered pool* (cluster summaries), before the map is built — a pure normalization + report function with a pool-shaped test that proves `slug_collision` correctly does NOT fire pre-structure. NO stage wiring in this plan.

**Architecture:** Two new pure functions in `lib/topical-map/cannibalization.js`: `clusterToCannibalizationNode(cluster)` maps a cluster summary to the node shape `buildCannibalizationReport` expects (deliberately omitting `_slug`/`content_type` so the slug and exemption checks are inert pre-structure), and `buildPoolCannibalizationReport(clusters, ctx)` maps + delegates. Golden-tested with cluster-shaped fixtures.

**Tech Stack:** Node 20 (`node:test`), CommonJS `lib/`.

## Global Constraints

- **No new dependencies.** Node built-ins only. Baseline on `main` is 35 passing tests.
- **`lib/` is CommonJS.**
- **No wiring / no stage change.** This plan only ADDS functions + tests to `cannibalization.js`. It does not touch `stages.js` or the STAGES registry. The actual reorder is Plan 3c-2.
- **Pre-structure semantics (the whole point):** a pool node has NO `_slug` (so `slug_collision` must not fire — slugs are stamped by the linking stage) and NO `content_type` (so the `brand_review`/`pillar_page` zero-demand exemptions and the `expands_slug` keyword exemption are inert). This is CORRECT, not a bug: those checks belong post-structure.
- **Keyword-casing contract:** `buildCannibalizationReport` compares `node.target_keyword` against `existingKeywords` WITHOUT lowercasing. The caller of `buildPoolCannibalizationReport` must build `existingKeywords` with lowercased keys and pass clusters whose `head_keyword` is already lowercase (DataForSEO keywords are). Do not add lowercasing here — match the existing contract.

## Context: the data shapes (verified against live code)

- `serp_clustering` produces `artifacts.clusters` = array of summaries, each:
  `{ cluster_key, head_keyword, keywords: [{ keyword, search_volume, keyword_difficulty, search_intent, covered_by, keyword_data_source? }], covered_count, total_volume, dominant_intent, aio_risk, serp_features, paa_questions, top_domains }`.
- `structure` consumes `artifacts.clusters`. The reorder (3c-2) will run pool cannibalization on `artifacts.clusters` between `competitor_gap` and `structure`.

---

## File Structure

- `lib/topical-map/cannibalization.js` — modify: add two exported functions (keep `buildCannibalizationReport` unchanged).
- `test/topical-map/cannibalization-pool.test.js` — new; pool-shaped golden tests.

---

### Task 1: pool normalization + report, with pool-shaped golden tests

**Files:**
- Modify: `lib/topical-map/cannibalization.js`
- Create: `test/topical-map/cannibalization-pool.test.js`

**Interfaces:**
- Consumes: existing `buildCannibalizationReport` (same file).
- Produces (added to `module.exports`):
  - `clusterToCannibalizationNode(cluster) -> node` — `{ title: cluster.head_keyword, target_keyword: cluster.head_keyword, _metrics: { search_volume: cluster.total_volume, keyword_data_source: <'llm-estimated' if EVERY keyword is llm-estimated, else undefined> }, _cluster_key: cluster.cluster_key }`. No `_slug`, no `content_type`.
  - `buildPoolCannibalizationReport(clusters, ctx) -> { report, nodes }` — maps clusters via the above, calls `buildCannibalizationReport(nodes, ctx)`, returns both. Plan 3c-2 uses `nodes` (with `_cluster_key`) to map flags back to clusters for filtering.

- [ ] **Step 1: Write the failing tests**

Create `test/topical-map/cannibalization-pool.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  clusterToCannibalizationNode, buildPoolCannibalizationReport,
} = require('../../lib/topical-map/cannibalization')

test('clusterToCannibalizationNode maps head_keyword + total_volume; no _slug/content_type', () => {
  const node = clusterToCannibalizationNode({
    cluster_key: 'c1', head_keyword: 'alpha kw', total_volume: 500,
    keywords: [{ keyword: 'alpha kw' }],
  })
  assert.equal(node.title, 'alpha kw')
  assert.equal(node.target_keyword, 'alpha kw')
  assert.equal(node._metrics.search_volume, 500)
  assert.equal(node._metrics.keyword_data_source, undefined) // not all estimated
  assert.equal(node._cluster_key, 'c1')
  assert.equal('_slug' in node, false)       // pre-structure: no slug
  assert.equal('content_type' in node, false)
})

test('clusterToCannibalizationNode marks keyword_data_source estimated only when EVERY keyword is', () => {
  const allEst = clusterToCannibalizationNode({
    cluster_key: 'c', head_keyword: 'k', total_volume: 10,
    keywords: [{ keyword: 'k', keyword_data_source: 'llm-estimated' }, { keyword: 'k2', keyword_data_source: 'llm-estimated' }],
  })
  assert.equal(allEst._metrics.keyword_data_source, 'llm-estimated')
  const mixed = clusterToCannibalizationNode({
    cluster_key: 'c', head_keyword: 'k', total_volume: 10,
    keywords: [{ keyword: 'k', keyword_data_source: 'llm-estimated' }, { keyword: 'k2' }],
  })
  assert.equal(mixed._metrics.keyword_data_source, undefined)
})

test('buildPoolCannibalizationReport: pre-structure checks fire; slug_collision NEVER does', () => {
  const ctx = {
    existingKeywords: new Map([['taken kw', 'live-slug']]),
    existingSlugs: new Set(['would-be-slug']), // present, but no pool node has _slug
    existingTitleTokens: [],
  }
  const clusters = [
    { cluster_key: 'c1', head_keyword: 'alpha kw', total_volume: 500, keywords: [{ keyword: 'alpha kw' }] }, // clean
    { cluster_key: 'c2', head_keyword: 'alpha kw', total_volume: 400, keywords: [{ keyword: 'alpha kw' }] }, // intra_map_duplicate
    { cluster_key: 'c3', head_keyword: 'taken kw', total_volume: 200, keywords: [{ keyword: 'taken kw' }] },  // keyword_collision
    { cluster_key: 'c4', head_keyword: 'zeta kw', total_volume: 0, keywords: [{ keyword: 'zeta kw' }] },      // zero_demand
    { cluster_key: 'c5', head_keyword: 'eta kw', total_volume: 50, keywords: [{ keyword: 'eta kw', keyword_data_source: 'llm-estimated' }] }, // unverified_keyword
  ]
  const { report, nodes } = buildPoolCannibalizationReport(clusters, ctx)
  assert.deepEqual(report.counts, {
    intra_map_duplicate: 1,
    keyword_collision: 1,
    zero_demand: 1,
    unverified_keyword: 1,
  })
  assert.equal('slug_collision' in report.counts, false) // the key correctness property
  assert.equal(report.total_nodes, 5)
  assert.equal(report.clean_nodes, 1)
  assert.equal(nodes.length, 5)
  assert.equal(nodes[0]._cluster_key, 'c1') // nodes carry cluster_key for later filtering
})

test('buildPoolCannibalizationReport: empty clusters -> empty report', () => {
  const { report, nodes } = buildPoolCannibalizationReport([], {
    existingKeywords: new Map(), existingSlugs: new Set(), existingTitleTokens: [],
  })
  assert.deepEqual(report, { flags: [], counts: {}, total_nodes: 0, clean_nodes: 0 })
  assert.deepEqual(nodes, [])
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm test`
Expected: FAIL — `clusterToCannibalizationNode` / `buildPoolCannibalizationReport` are not exported (`TypeError: ... is not a function` or undefined destructure).

- [ ] **Step 3: Implement the two functions**

In `lib/topical-map/cannibalization.js`, add ABOVE the `module.exports` line:

```js
// ── Pool-level cannibalization (pre-structure) ───────────────────────────
// Map a cluster summary (from serp_clustering) to the node shape
// buildCannibalizationReport expects. Deliberately omits _slug and
// content_type: pre-structure those do not exist, so slug_collision and the
// exemptions are correctly inert (slugs are stamped later, in the linking
// stage). Carries _cluster_key so callers can map flags back to clusters.
function clusterToCannibalizationNode(cluster) {
  const kws = Array.isArray(cluster.keywords) ? cluster.keywords : []
  const allEstimated = kws.length > 0 && kws.every((k) => k.keyword_data_source === 'llm-estimated')
  return {
    title: cluster.head_keyword,
    target_keyword: cluster.head_keyword,
    _metrics: {
      search_volume: cluster.total_volume,
      keyword_data_source: allEstimated ? 'llm-estimated' : undefined,
    },
    _cluster_key: cluster.cluster_key,
  }
}

// Run cannibalization on the clustered pool. Returns the report plus the mapped
// nodes (each with _cluster_key) so a caller can filter/merge clusters by flag.
// See clusterToCannibalizationNode for the pre-structure semantics.
function buildPoolCannibalizationReport(clusters, ctx) {
  const nodes = (Array.isArray(clusters) ? clusters : []).map(clusterToCannibalizationNode)
  const report = buildCannibalizationReport(nodes, ctx)
  return { report, nodes }
}
```

And extend the exports:

```js
module.exports = { buildCannibalizationReport, clusterToCannibalizationNode, buildPoolCannibalizationReport }
```

- [ ] **Step 4: Run and verify it passes**

Run: `npm test`
Expected: PASS — 35 baseline + 4 new = `# tests 39 # pass 39 # fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/topical-map/cannibalization.js test/topical-map/cannibalization-pool.test.js
git commit -m "feat(topical-map): pool-level cannibalization (cluster normalization + pre-structure report)"
```

---

## Self-Review

**Spec coverage:** Implements the Plan 3b final-review requirement for the reorder — a normalization layer for pool nodes and a pool-shaped characterization test proving `slug_collision` does not fire pre-structure. It does NOT wire the stage (that is 3c-2). Correct scope.

**Placeholder scan:** No TBD/TODO. Every step has complete code. All expected values (the 4-flag pool fixture, no slug_collision, node mapping, all-estimated rule, empty case) were captured by running a prototype against the real `buildCannibalizationReport`. PASS.

**Type consistency:** `clusterToCannibalizationNode(cluster)` and `buildPoolCannibalizationReport(clusters, ctx) -> { report, nodes }` signatures identical in the module (Step 3), exports, and tests (Step 1). Reuses the existing `buildCannibalizationReport(nodes, ctx) -> { flags, counts, total_nodes, clean_nodes }` unchanged. Baseline chain: 35 (main) -> 39 (Task 1: +4). PASS.

**Handoff to Plan 3c-2 (the reorder, NOT this plan):** 3c-2 inserts a `cannibalization` stage into STAGES after `competitor_gap`, before `structure`; it calls `buildPoolCannibalizationReport(run.artifacts.clusters, ctx)` (ctx built from the DB like stageQa does), uses the flags to drop/merge clusters, and passes the survivors to `structure`. `slug_collision` stays in the post-structure `qa` stage (slugs only exist then). 3c-2 must add its own stage-level test/verification of the filtered cluster output.
