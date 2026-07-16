# Topical Map v4.6 Port — Plan 3c-3: per-keyword collision narrowing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 3c-2 governance concern that a head-keyword collision drops the WHOLE cluster (losing non-colliding long-tail). Change `keyword_collision` from a whole-cluster drop to per-keyword removal: strip only the colliding keyword(s), re-head the cluster, keep its survivors. A cluster is dropped only if ALL its keywords collide (emptied) or it hits a cluster-level flag (`intra_map_duplicate`/`zero_demand`).

**Architecture:** Rewrite the pure `filterClustersByCannibalization(clusters, ctx)`: (1) per-keyword prune each cluster against live keywords, re-head + recompute `total_volume`, drop clusters emptied by pruning; (2) run the cluster-level report on the pruned set and drop `intra_map_duplicate`/`zero_demand`. Returns `{ survivors, dropped, pruned, report }` with drop reasons. The stage records the richer detail; `structure`/`linking`/`qa` unchanged.

**Tech Stack:** Node 20 (`node:test`), CommonJS `lib/`.

## Global Constraints

- **No new dependencies.** Node built-ins only. Baseline on `main` is 46 passing tests.
- **`lib/` is CommonJS.**
- **`keyword_collision` no longer whole-drops.** The cluster-level drop set becomes exactly `{ intra_map_duplicate, zero_demand }`. Colliding keywords are removed per-cluster; a cluster is dropped by collision ONLY if it is emptied.
- **Re-head deterministically:** after pruning, the new `head_keyword` is the surviving keyword with the highest `search_volume`; `total_volume` is the sum of surviving keywords' `search_volume`.
- **Casing:** compare each keyword lowercased against `existingKeywords` (which the caller lowercases). No `expands_slug` exemption pre-structure (clusters don't have it) — unchanged from 3c-1/3c-2.
- **Do not change `stageStructure`/`stageLinking`/`stageQa`.** They read `run.artifacts.clusters`; the stage still overwrites it with survivors.
- **Rename `DROP_FLAGS` -> `CLUSTER_DROP_FLAGS`** to reflect it is now cluster-level only. Update all references + tests.

## Verified behavior (prototype against real modules)

Input clusters (ctx.existingKeywords = {`binance scam`, `taken kw`}):
- `A` head `binance scam`(vol 500) + `binance withdrawal scam`(vol 100): head collides, long-tail survives -> KEPT, re-headed to `binance withdrawal scam`, total_volume 100, pruned `[binance scam]`.
- `B` only `taken kw`(collides): emptied -> dropped `emptied_by_collision`.
- `C` `clean kw`(300): clean -> survivor.
- `D` `zero kw`(vol 0): dropped `zero_demand`.
- `E` `clean kw`(250): duplicate head of C -> dropped `intra_map_duplicate`.

Result: survivors `[A(re-headed), C]`; dropped `[{B,emptied_by_collision},{D,zero_demand},{E,intra_map_duplicate}]`; pruned `[{A,[binance scam]}]`.

---

## File Structure

- `lib/topical-map/cannibalization.js` — modify: rewrite `filterClustersByCannibalization`, rename export to `CLUSTER_DROP_FLAGS`.
- `test/topical-map/cannibalization-filter.test.js` — rewrite for the new behavior.
- `lib/topical-map/stages.js` — modify `stageCannibalization` only (consume the new return shape; richer `pool_cannibalization`).
- `test/topical-map/stage-cannibalization.test.js` — update expectations.

---

### Task 1: rewrite the filter (per-keyword) + tests

**Files:**
- Modify: `lib/topical-map/cannibalization.js`
- Modify: `test/topical-map/cannibalization-filter.test.js`

**Interfaces:**
- Consumes: existing `buildPoolCannibalizationReport`.
- Produces: `CLUSTER_DROP_FLAGS` (`Set` of `intra_map_duplicate`, `zero_demand`) and `filterClustersByCannibalization(clusters, ctx) -> { survivors, dropped, pruned, report }`:
  - `survivors`: kept clusters (pruned ones carry updated `keywords`/`head_keyword`/`total_volume`).
  - `dropped`: `[{ cluster_key, reason: 'emptied_by_collision'|'intra_map_duplicate'|'zero_demand', removed_keywords? }]`.
  - `pruned`: `[{ cluster_key, removed_keywords: string[] }]` for survivors that lost keywords.
  - `report`: the cluster-level report on the pruned set.

- [ ] **Step 1: Rewrite the tests**

Replace `test/topical-map/cannibalization-filter.test.js` with:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { filterClustersByCannibalization, CLUSTER_DROP_FLAGS } = require('../../lib/topical-map/cannibalization')

function ctx() {
  return { existingKeywords: new Map([['binance scam', 'x'], ['taken kw', 'y']]), existingSlugs: new Set(), existingTitleTokens: [] }
}

test('CLUSTER_DROP_FLAGS no longer includes keyword_collision', () => {
  assert.deepEqual([...CLUSTER_DROP_FLAGS].sort(), ['intra_map_duplicate', 'zero_demand'])
})

test('per-keyword: head collision prunes the keyword and re-heads instead of dropping the cluster', () => {
  const clusters = [
    { cluster_key: 'A', head_keyword: 'binance scam', total_volume: 600, keywords: [{ keyword: 'binance scam', search_volume: 500 }, { keyword: 'binance withdrawal scam', search_volume: 100 }] },
  ]
  const { survivors, pruned } = filterClustersByCannibalization(clusters, ctx())
  assert.equal(survivors.length, 1)
  assert.equal(survivors[0].head_keyword, 'binance withdrawal scam') // re-headed to top surviving
  assert.equal(survivors[0].total_volume, 100)                       // recomputed
  assert.deepEqual(survivors[0].keywords.map((k) => k.keyword), ['binance withdrawal scam'])
  assert.deepEqual(pruned, [{ cluster_key: 'A', removed_keywords: ['binance scam'] }])
})

test('cluster emptied by collision is dropped with reason', () => {
  const clusters = [{ cluster_key: 'B', head_keyword: 'taken kw', total_volume: 200, keywords: [{ keyword: 'taken kw', search_volume: 200 }] }]
  const { survivors, dropped } = filterClustersByCannibalization(clusters, ctx())
  assert.equal(survivors.length, 0)
  assert.deepEqual(dropped, [{ cluster_key: 'B', reason: 'emptied_by_collision', removed_keywords: ['taken kw'] }])
})

test('intra_map_duplicate and zero_demand still drop whole clusters (post-prune)', () => {
  const clusters = [
    { cluster_key: 'C', head_keyword: 'clean kw', total_volume: 300, keywords: [{ keyword: 'clean kw', search_volume: 300 }] },
    { cluster_key: 'D', head_keyword: 'zero kw', total_volume: 0, keywords: [{ keyword: 'zero kw', search_volume: 0 }] },
    { cluster_key: 'E', head_keyword: 'clean kw', total_volume: 250, keywords: [{ keyword: 'clean kw', search_volume: 250 }] },
  ]
  const { survivors, dropped } = filterClustersByCannibalization(clusters, ctx())
  assert.deepEqual(survivors.map((c) => c.cluster_key), ['C'])
  assert.deepEqual(dropped.map((d) => `${d.cluster_key}:${d.reason}`).sort(), ['D:zero_demand', 'E:intra_map_duplicate'])
})

test('empty input', () => {
  const { survivors, dropped, pruned } = filterClustersByCannibalization([], ctx())
  assert.deepEqual(survivors, [])
  assert.deepEqual(dropped, [])
  assert.deepEqual(pruned, [])
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm test`
Expected: FAIL — `CLUSTER_DROP_FLAGS` is undefined (still named `DROP_FLAGS`), and the new behavior assertions fail against the old whole-drop logic.

- [ ] **Step 3: Rewrite the function**

In `lib/topical-map/cannibalization.js`, REPLACE the existing `DROP_FLAGS` const and `filterClustersByCannibalization` function with:

```js
// Cluster-level drops (whole cluster). keyword_collision is handled per-keyword
// (below) and is NOT here — a collision prunes the colliding keyword, not the cluster.
const CLUSTER_DROP_FLAGS = new Set(['intra_map_duplicate', 'zero_demand'])

// Partition clustered-pool summaries by cannibalization. Two phases:
//  1. Per-keyword collision pruning: remove keywords that collide with live
//     content; re-head + recompute total_volume; drop a cluster only if pruning
//     empties it (reason 'emptied_by_collision').
//  2. Cluster-level: drop intra_map_duplicate / zero_demand on the pruned set.
// Pure: no DB, no I/O.
function filterClustersByCannibalization(clusters, ctx) {
  const list = Array.isArray(clusters) ? clusters : []
  const existingKeywords = ctx?.existingKeywords instanceof Map ? ctx.existingKeywords : new Map()

  const kept = []
  const dropped = []
  const pruned = []

  for (const c of list) {
    const kws = Array.isArray(c.keywords) ? c.keywords : []
    const removed = []
    const survKws = kws.filter((k) => {
      if (existingKeywords.has(String(k.keyword || '').toLowerCase())) {
        removed.push(k.keyword)
        return false
      }
      return true
    })
    if (kws.length > 0 && survKws.length === 0) {
      dropped.push({ cluster_key: c.cluster_key, reason: 'emptied_by_collision', removed_keywords: removed })
      continue
    }
    if (removed.length > 0) {
      const head = survKws.slice().sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0))[0]
      kept.push({
        ...c,
        keywords: survKws,
        head_keyword: head.keyword,
        total_volume: survKws.reduce((s, k) => s + (k.search_volume || 0), 0),
      })
      pruned.push({ cluster_key: c.cluster_key, removed_keywords: removed })
    } else {
      kept.push(c)
    }
  }

  const { report, nodes } = buildPoolCannibalizationReport(kept, ctx)
  const flagsByKey = new Map(nodes.map((n) => [n._cluster_key, (n._qa_flags || []).map((f) => f.type)]))
  const survivors = []
  for (const c of kept) {
    const hit = (flagsByKey.get(c.cluster_key) || []).find((f) => CLUSTER_DROP_FLAGS.has(f))
    if (hit) dropped.push({ cluster_key: c.cluster_key, reason: hit })
    else survivors.push(c)
  }

  return { survivors, dropped, pruned, report }
}
```

Update the exports: replace `DROP_FLAGS` with `CLUSTER_DROP_FLAGS` (keep the other four names):

```js
module.exports = {
  buildCannibalizationReport,
  clusterToCannibalizationNode,
  buildPoolCannibalizationReport,
  CLUSTER_DROP_FLAGS,
  filterClustersByCannibalization,
}
```

- [ ] **Step 4: Run and verify pass**

Run: `npm test`
Expected: PASS — the filter file goes from 4 tests to 5, so the suite total moves from 46 to `# tests 47 # pass 47 # fail 0`. (If the stage test — Task 2 — has not been updated yet, it will FAIL here; that is expected and Task 2 fixes it. If running tasks together, expect the failures to be ONLY in `stage-cannibalization.test.js`.)

- [ ] **Step 5: Commit**

```bash
git add lib/topical-map/cannibalization.js test/topical-map/cannibalization-filter.test.js
git commit -m "feat(topical-map): keyword_collision prunes per-keyword instead of dropping whole cluster"
```

---

### Task 2: update the stage to the new shape

**Files:**
- Modify: `lib/topical-map/stages.js` (`stageCannibalization` only)
- Modify: `test/topical-map/stage-cannibalization.test.js`

**Interfaces:**
- Consumes: `filterClustersByCannibalization` (new shape) from Task 1.
- Produces: `stageCannibalization` writes `artifacts.pool_cannibalization = { kept, dropped, dropped_detail, pruned, guard_kept_all }` and overwrites `artifacts.clusters` with survivors (guarded).

- [ ] **Step 1: Update the integration test**

Replace `test/topical-map/stage-cannibalization.test.js` with:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { executeCurrentStage, stageIndex } = require('../../lib/topical-map/stages')

function fakeSupaFetch(url) {
  if (url.startsWith('/topics')) return Promise.resolve([{ slug: 'x', title: 'Taken', target_keyword: 'taken kw', map_id: 'm' }])
  return Promise.resolve([])
}

const CLUSTERS = [
  { cluster_key: 'A', head_keyword: 'alpha collide', total_volume: 600, keywords: [{ keyword: 'alpha collide', search_volume: 500 }, { keyword: 'alpha longtail', search_volume: 100 }] }, // head collides -> prune + re-head, KEEP
  { cluster_key: 'B', head_keyword: 'taken kw', total_volume: 200, keywords: [{ keyword: 'taken kw', search_volume: 200 }] }, // emptied -> drop
  { cluster_key: 'C', head_keyword: 'clean kw', total_volume: 300, keywords: [{ keyword: 'clean kw', search_volume: 300 }] }, // clean
  { cluster_key: 'D', head_keyword: 'zero kw', total_volume: 0, keywords: [{ keyword: 'zero kw', search_volume: 0 }] }, // zero_demand -> drop
]

test('cannibalization stage sits between competitor_gap and structure', () => {
  assert.equal(stageIndex('cannibalization'), stageIndex('competitor_gap') + 1)
  assert.equal(stageIndex('structure'), stageIndex('cannibalization') + 1)
})

test('stage prunes head collisions (keeps re-headed cluster) and drops emptied/zero clusters', async () => {
  // NOTE: existingKeywords also needs 'alpha collide' to be a live collision.
  const supa = (url) => {
    if (url.startsWith('/topics')) return Promise.resolve([
      { slug: 'x', title: 'T', target_keyword: 'taken kw', map_id: 'm' },
      { slug: 'y', title: 'A', target_keyword: 'alpha collide', map_id: 'm' },
    ])
    return Promise.resolve([])
  }
  const run = { current_stage: 'cannibalization', artifacts: { clusters: CLUSTERS } }
  const res = await executeCurrentStage(run, { supaFetch: supa })
  assert.deepEqual(res.artifacts.clusters.map((c) => c.cluster_key), ['A', 'C']) // A kept (re-headed), C clean
  assert.equal(res.artifacts.clusters.find((c) => c.cluster_key === 'A').head_keyword, 'alpha longtail')
  const pc = res.artifacts.pool_cannibalization
  assert.equal(pc.kept, 2)
  assert.deepEqual(pc.dropped_detail.map((d) => `${d.cluster_key}:${d.reason}`).sort(), ['B:emptied_by_collision', 'D:zero_demand'])
  assert.deepEqual(pc.pruned, [{ cluster_key: 'A', removed_keywords: ['alpha collide'] }])
  assert.equal(pc.guard_kept_all, false)
  assert.equal(res.current_stage, 'structure')
  assert.equal(res.status, 'running')
})

test('guard: if every cluster would be dropped, keep them all', async () => {
  const allZero = [
    { cluster_key: 'z1', head_keyword: 'a', total_volume: 0, keywords: [{ keyword: 'a', search_volume: 0 }] },
    { cluster_key: 'z2', head_keyword: 'b', total_volume: 0, keywords: [{ keyword: 'b', search_volume: 0 }] },
  ]
  const run = { current_stage: 'cannibalization', artifacts: { clusters: allZero } }
  const res = await executeCurrentStage(run, { supaFetch: fakeSupaFetch })
  assert.equal(res.artifacts.clusters.length, 2)
  assert.equal(res.artifacts.pool_cannibalization.guard_kept_all, true)
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm test`
Expected: FAIL in `stage-cannibalization.test.js` — the stage still emits the old `pool_cannibalization` shape (`dropped_count`/`dropped_keys`, no `pruned`/`dropped_detail`).

- [ ] **Step 3: Update `stageCannibalization`**

In `lib/topical-map/stages.js`, replace the body of `stageCannibalization` FROM the `filterClustersByCannibalization(...)` call to the `return` with:

```js
  const { survivors, dropped, pruned } = filterClustersByCannibalization(clusters, {
    existingKeywords, existingSlugs, existingTitleTokens,
  })

  // structure throws on an empty cluster set. If filtering would drop everything,
  // keep them all and flag it for review rather than hard-failing.
  const guardKeptAll = survivors.length === 0 && clusters.length > 0
  const keptClusters = guardKeptAll ? clusters : survivors

  return {
    artifacts: {
      clusters: keptClusters,
      pool_cannibalization: {
        kept: keptClusters.length,
        dropped: guardKeptAll ? 0 : dropped.length,
        dropped_detail: guardKeptAll ? [] : dropped,
        pruned: guardKeptAll ? [] : pruned,
        guard_kept_all: guardKeptAll,
      },
    },
    summary: guardKeptAll
      ? `All ${clusters.length} clusters flagged — guard kept them; review pool_cannibalization`
      : `${keptClusters.length}/${clusters.length} clusters kept; dropped ${dropped.length}, pruned ${pruned.length}`,
  }
```

Leave the require, the DB-context building, and the empty-clusters early-return above it unchanged.

- [ ] **Step 4: Run tests + stage-order guard**

Run: `npm test`
Expected: PASS — `# tests 47 # pass 47 # fail 0`.

Run: `node -e "const s=require('./lib/topical-map/stages'); const i=s.STAGES.map(x=>x.key); console.log('order ok:', i.indexOf('cannibalization')===i.indexOf('competitor_gap')+1 && i.indexOf('structure')===i.indexOf('cannibalization')+1)"`
Expected: `order ok: true`.

- [ ] **Step 5: Commit**

```bash
git add lib/topical-map/stages.js test/topical-map/stage-cannibalization.test.js
git commit -m "feat(topical-map): cannibalization stage records per-keyword pruning + drop reasons"
```

---

## Self-Review

**Spec coverage:** Addresses 3c-2 final-review concern #2 (whole-cluster drop discards long-tail): `keyword_collision` now prunes per-keyword and re-heads, dropping a cluster only when emptied. `intra_map_duplicate`/`zero_demand` still drop whole clusters. The audit artifact gains `pruned` + per-drop `reason`. The operator-review concern (#1) is the separate follow-up (the `cannibalization_review` checkpoint). Correct scope.

**Placeholder scan:** No TBD/TODO. Every step has complete code and exact commands. All expected values (survivors `[A,C]`, A re-headed + recomputed volume, drop reasons, pruned list, guard) were captured by running a prototype against the real modules. PASS.

**Type consistency:** `filterClustersByCannibalization(clusters, ctx) -> { survivors, dropped, pruned, report }` identical across the module (T1 S3), the stage (T2 S3), and both tests. `CLUSTER_DROP_FLAGS` replaces `DROP_FLAGS` everywhere (module + tests). `pool_cannibalization` shape (`kept`/`dropped`/`dropped_detail`/`pruned`/`guard_kept_all`) consistent between the stage and the integration test. Test count: 46 (main) -> 47 (Task 1 rewrites the 4-test filter file to 5; Task 2 keeps the stage file at 3). PASS.

**Risk note for the executor:** Tasks are coupled — Task 1's filter shape change breaks the OLD stage test; Task 2 fixes it. If running task-by-task, the suite is red between them (only in `stage-cannibalization.test.js`), which is expected. Do not "fix" the stage in Task 1. `stageStructure`/`stageLinking`/`stageQa` stay untouched.
