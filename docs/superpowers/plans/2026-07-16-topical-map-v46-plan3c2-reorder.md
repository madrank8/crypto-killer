# Topical Map v4.6 Port — Plan 3c-2: the cannibalization reorder

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run cannibalization on the clustered pool BEFORE the map is built (the skill's Phase-5-before-Phase-6 order): insert a `cannibalization` stage between `competitor_gap` and `structure` that drops the unambiguously-cannibalizing clusters, so `structure` builds only from survivors. This is the actual reorder; everything before it (3a/3b/3c-1) was the safety net.

**Architecture:** A pure `filterClustersByCannibalization(clusters, ctx)` (drops `intra_map_duplicate`/`keyword_collision`/`zero_demand`, keeps the rest, tested in isolation) plus a thin `stageCannibalization(run, { supaFetch })` that builds the DB context (like `stageQa`), calls the filter, guards against emptying the pool, and writes the survivors back to `artifacts.clusters`. `structure`/`linking` consume `artifacts.clusters` unchanged. The post-structure `qa` stage is left as-is (its `slug_collision` check still only makes sense post-structure).

**Tech Stack:** Node 20 (`node:test`), CommonJS `lib/`.

## Global Constraints

- **No new dependencies.** Node built-ins only. Baseline on `main` is 39 passing tests.
- **`lib/` is CommonJS.**
- **Conservative auto-drop.** Only drop clusters flagged `intra_map_duplicate`, `keyword_collision` (collides with LIVE content, non-expansion), or `zero_demand`. KEEP (flag only) `unverified_keyword` and `title_similarity`. Never drop ALL clusters — if the filter would leave zero survivors, keep the full set and record that the guard fired (`structure` throws on empty clusters).
- **No new checkpoint.** `stageCannibalization` auto-advances (no `checkpointAfter`). A `cannibalization_review` checkpoint needs dashboard UI and is deferred to Plan 4. The dropped clusters are recorded in `artifacts.pool_cannibalization` for audit.
- **Do not change `stageStructure`, `stageLinking`, or `stageQa`.** They already read `run.artifacts.clusters`; overwriting it upstream is the entire wiring.
- **Keyword-casing contract:** build `existingKeywords` with lowercased keys (as `stageQa` does); cluster `head_keyword`s are already lowercase (DataForSEO).

## Context (verified against live code)

- `executeCurrentStage` merges artifacts: `{ ...run.artifacts, ...result.artifacts }`. So returning `artifacts: { clusters: survivors, pool_cannibalization: ... }` overwrites `artifacts.clusters` with survivors.
- `stageStructure` reads `run.artifacts.clusters` (line ~556) and throws if it is empty. `stageLinking` also reads it (~677).
- STAGES today: `... serp_clustering (checkpoint pool_review) → competitor_gap → structure → linking → qa (checkpoint qa_review) → save`. The new stage goes between `competitor_gap` and `structure`.

---

## File Structure

- `lib/topical-map/cannibalization.js` — modify: add `filterClustersByCannibalization` + `DROP_FLAGS` export.
- `test/topical-map/cannibalization-filter.test.js` — new; filter golden tests.
- `lib/topical-map/stages.js` — modify: add `stageCannibalization`, insert into `STAGES` and `STAGE_FNS`, require the filter.
- `test/topical-map/stage-cannibalization.test.js` — new; integration test through `executeCurrentStage`.

---

### Task 1: pure cluster filter + golden tests

**Files:**
- Modify: `lib/topical-map/cannibalization.js`
- Create: `test/topical-map/cannibalization-filter.test.js`

**Interfaces:**
- Consumes: existing `buildPoolCannibalizationReport` (same file).
- Produces (added to exports): `DROP_FLAGS` (a `Set`) and `filterClustersByCannibalization(clusters, ctx) -> { survivors, dropped, report }`. `survivors`/`dropped` are subsets of the input `clusters` (same objects). Task 2's stage consumes this.

- [ ] **Step 1: Write the failing tests**

Create `test/topical-map/cannibalization-filter.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { filterClustersByCannibalization, DROP_FLAGS } = require('../../lib/topical-map/cannibalization')

function ctx() {
  return { existingKeywords: new Map([['taken kw', 'live-slug']]), existingSlugs: new Set(), existingTitleTokens: [] }
}

test('DROP_FLAGS is exactly the three unambiguous flags', () => {
  assert.deepEqual([...DROP_FLAGS].sort(), ['intra_map_duplicate', 'keyword_collision', 'zero_demand'])
})

test('drops intra-dup / keyword-collision / zero-demand; keeps clean + unverified', () => {
  const clusters = [
    { cluster_key: 'c1', head_keyword: 'alpha kw', total_volume: 500, keywords: [{ keyword: 'alpha kw' }] }, // clean -> keep
    { cluster_key: 'c2', head_keyword: 'alpha kw', total_volume: 400, keywords: [{ keyword: 'alpha kw' }] }, // intra_map_duplicate -> drop
    { cluster_key: 'c3', head_keyword: 'taken kw', total_volume: 200, keywords: [{ keyword: 'taken kw' }] },  // keyword_collision -> drop
    { cluster_key: 'c4', head_keyword: 'zeta kw', total_volume: 0, keywords: [{ keyword: 'zeta kw' }] },      // zero_demand -> drop
    { cluster_key: 'c5', head_keyword: 'eta kw', total_volume: 50, keywords: [{ keyword: 'eta kw', keyword_data_source: 'llm-estimated' }] }, // unverified -> KEEP
  ]
  const { survivors, dropped, report } = filterClustersByCannibalization(clusters, ctx())
  assert.deepEqual(survivors.map((c) => c.cluster_key), ['c1', 'c5'])
  assert.deepEqual(dropped.map((c) => c.cluster_key), ['c2', 'c3', 'c4'])
  assert.deepEqual(report.counts, { intra_map_duplicate: 1, keyword_collision: 1, zero_demand: 1, unverified_keyword: 1 })
})

test('empty input yields empty survivors/dropped', () => {
  const { survivors, dropped } = filterClustersByCannibalization([], ctx())
  assert.deepEqual(survivors, [])
  assert.deepEqual(dropped, [])
})

test('all-cannibalizing input drops all (the stage, not the filter, guards emptying)', () => {
  const clusters = [
    { cluster_key: 'z1', head_keyword: 'a', total_volume: 0, keywords: [{ keyword: 'a' }] },
    { cluster_key: 'z2', head_keyword: 'b', total_volume: 0, keywords: [{ keyword: 'b' }] },
  ]
  const { survivors, dropped } = filterClustersByCannibalization(clusters, { existingKeywords: new Map(), existingSlugs: new Set(), existingTitleTokens: [] })
  assert.equal(survivors.length, 0)
  assert.equal(dropped.length, 2)
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm test`
Expected: FAIL — `filterClustersByCannibalization` / `DROP_FLAGS` undefined.

- [ ] **Step 3: Implement**

In `lib/topical-map/cannibalization.js`, add ABOVE the `module.exports` line:

```js
// Clusters carrying any of these flags are unambiguously cannibalizing and are
// dropped before the map is built. unverified_keyword and title_similarity are
// KEPT (flag only): the first is a metrics-confidence issue, the second is a
// weak head-keyword signal pre-structure. slug_collision cannot fire pre-structure.
const DROP_FLAGS = new Set(['intra_map_duplicate', 'keyword_collision', 'zero_demand'])

// Partition clustered-pool summaries into survivors/dropped by cannibalization.
// Pure: no DB, no I/O. Returns the report too. Does NOT guard against dropping
// everything — that is the stage's job (structure needs a non-empty pool).
function filterClustersByCannibalization(clusters, ctx) {
  const list = Array.isArray(clusters) ? clusters : []
  const { report, nodes } = buildPoolCannibalizationReport(list, ctx)
  const dropKeys = new Set()
  for (const node of nodes) {
    const flags = node._qa_flags || []
    if (flags.some((f) => DROP_FLAGS.has(f.type))) dropKeys.add(node._cluster_key)
  }
  const survivors = list.filter((c) => !dropKeys.has(c.cluster_key))
  const dropped = list.filter((c) => dropKeys.has(c.cluster_key))
  return { survivors, dropped, report }
}
```

Extend the exports to add `DROP_FLAGS` and `filterClustersByCannibalization` (keep the existing four):

```js
module.exports = {
  buildCannibalizationReport,
  clusterToCannibalizationNode,
  buildPoolCannibalizationReport,
  DROP_FLAGS,
  filterClustersByCannibalization,
}
```

- [ ] **Step 4: Run and verify pass**

Run: `npm test`
Expected: PASS — 39 baseline + 4 new = `# tests 43 # pass 43 # fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/topical-map/cannibalization.js test/topical-map/cannibalization-filter.test.js
git commit -m "feat(topical-map): pure cluster cannibalization filter (drop policy + survivors/dropped)"
```

---

### Task 2: cannibalization stage + registry wiring + integration test

**Files:**
- Modify: `lib/topical-map/stages.js`
- Create: `test/topical-map/stage-cannibalization.test.js`

**Interfaces:**
- Consumes: `filterClustersByCannibalization` (Task 1); `executeCurrentStage`, `STAGES`, `stageIndex` (already exported from stages.js).
- Produces: a new `cannibalization` stage between `competitor_gap` and `structure`. After it runs, `run.artifacts.clusters` holds only survivors and `run.artifacts.pool_cannibalization` holds `{ report, dropped_count, dropped_keys, guard_kept_all }`.

- [ ] **Step 1: Write the integration test (through the real dispatcher)**

Create `test/topical-map/stage-cannibalization.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { executeCurrentStage, STAGES, stageIndex } = require('../../lib/topical-map/stages')

// Fake supaFetch: no existing topics/content/reviews except one live keyword collision.
function fakeSupaFetch(url) {
  if (url.startsWith('/topics')) return Promise.resolve([{ slug: 'live-slug', title: 'Taken', target_keyword: 'taken kw', map_id: 'm' }])
  if (url.startsWith('/content')) return Promise.resolve([])
  if (url.startsWith('/reviews')) return Promise.resolve([])
  return Promise.resolve([])
}

const CLUSTERS = [
  { cluster_key: 'c1', head_keyword: 'alpha kw', total_volume: 500, keywords: [{ keyword: 'alpha kw' }] },
  { cluster_key: 'c2', head_keyword: 'alpha kw', total_volume: 400, keywords: [{ keyword: 'alpha kw' }] }, // intra dup
  { cluster_key: 'c3', head_keyword: 'taken kw', total_volume: 200, keywords: [{ keyword: 'taken kw' }] },  // live collision
  { cluster_key: 'c4', head_keyword: 'zeta kw', total_volume: 0, keywords: [{ keyword: 'zeta kw' }] },      // zero demand
]

test('cannibalization stage sits between competitor_gap and structure', () => {
  assert.equal(stageIndex('cannibalization'), stageIndex('competitor_gap') + 1)
  assert.equal(stageIndex('structure'), stageIndex('cannibalization') + 1)
})

test('stage drops cannibalizing clusters and overwrites artifacts.clusters with survivors', async () => {
  const run = { current_stage: 'cannibalization', artifacts: { clusters: CLUSTERS } }
  const res = await executeCurrentStage(run, { supaFetch: fakeSupaFetch })
  assert.deepEqual(res.artifacts.clusters.map((c) => c.cluster_key), ['c1'])       // only clean survivor
  assert.equal(res.artifacts.pool_cannibalization.dropped_count, 3)
  assert.deepEqual(res.artifacts.pool_cannibalization.dropped_keys.sort(), ['c2', 'c3', 'c4'])
  assert.equal(res.artifacts.pool_cannibalization.guard_kept_all, false)
  assert.equal(res.current_stage, 'structure') // advances to structure
  assert.equal(res.status, 'running')          // no checkpoint
})

test('guard: if every cluster would be dropped, keep them all so structure has input', async () => {
  const allZero = [
    { cluster_key: 'z1', head_keyword: 'a', total_volume: 0, keywords: [{ keyword: 'a' }] },
    { cluster_key: 'z2', head_keyword: 'b', total_volume: 0, keywords: [{ keyword: 'b' }] },
  ]
  const run = { current_stage: 'cannibalization', artifacts: { clusters: allZero } }
  const res = await executeCurrentStage(run, { supaFetch: fakeSupaFetch })
  assert.equal(res.artifacts.clusters.length, 2)                         // kept all
  assert.equal(res.artifacts.pool_cannibalization.guard_kept_all, true)
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm test`
Expected: FAIL — `stageIndex('cannibalization')` returns -1 (stage not registered), so the first assertion throws.

- [ ] **Step 3: Implement the stage**

In `lib/topical-map/stages.js`:

(a) Add to the require block near the top (next to the existing `require('./cannibalization')` import — MERGE into that destructure so there is one import line):

```js
const { buildCannibalizationReport, filterClustersByCannibalization } = require('./cannibalization')
```

(replace the existing `const { buildCannibalizationReport } = require('./cannibalization')` line with the above.)

(b) Add the stage function immediately BEFORE `async function stageStructure` :

```js
// ── Stage: cannibalization (Phase 5, before build) ───────────────────────
// Runs the cannibalization checks on the CLUSTERED POOL and drops the
// unambiguously-cannibalizing clusters before the map is structured. Survivors
// overwrite artifacts.clusters; structure/linking consume them unchanged.
// slug_collision is NOT run here (no slugs pre-structure) — it stays in stageQa.
async function stageCannibalization(run, { supaFetch }) {
  const clusters = run.artifacts?.clusters || []
  if (clusters.length === 0) {
    return { artifacts: {}, summary: 'No clusters to review' }
  }

  const [existingTopics, existingContent, existingReviews] = await Promise.all([
    supaFetch('/topics?select=slug,title,target_keyword,map_id&limit=2000'),
    supaFetch('/content?select=slug,title&limit=1000'),
    supaFetch('/reviews?select=slug&limit=1000'),
  ])
  const existingKeywords = new Map()
  for (const t of existingTopics || []) {
    if (t.target_keyword) existingKeywords.set(String(t.target_keyword).toLowerCase(), t.slug)
  }
  const existingSlugs = new Set([
    ...(existingTopics || []).map((t) => t.slug),
    ...(existingContent || []).map((c) => c.slug),
    ...(existingReviews || []).map((r) => r.slug),
  ].filter(Boolean))
  const existingTitleTokens = [
    ...(existingTopics || []).map((t) => ({ title: t.title, tokens: tokenize(t.title) })),
    ...(existingContent || []).map((c) => ({ title: c.title, tokens: tokenize(c.title) })),
  ]

  const { survivors, dropped, report } = filterClustersByCannibalization(clusters, {
    existingKeywords, existingSlugs, existingTitleTokens,
  })

  // Guard: structure throws on an empty cluster set. If the filter would drop
  // everything, keep them all and flag it — a human should look, but the run
  // must not hard-fail here.
  const guardKeptAll = survivors.length === 0 && clusters.length > 0
  const keptClusters = guardKeptAll ? clusters : survivors

  return {
    artifacts: {
      clusters: keptClusters,
      pool_cannibalization: {
        report,
        dropped_count: guardKeptAll ? 0 : dropped.length,
        dropped_keys: guardKeptAll ? [] : dropped.map((c) => c.cluster_key),
        guard_kept_all: guardKeptAll,
      },
    },
    summary: guardKeptAll
      ? `All ${clusters.length} clusters flagged — guard kept them; review pool_cannibalization`
      : `${keptClusters.length}/${clusters.length} clusters kept; dropped ${dropped.length} (${JSON.stringify(report.counts)})`,
  }
}
```

(c) Insert `cannibalization` into the `STAGES` array between `competitor_gap` and `structure`:

```js
  { key: 'competitor_gap', label: 'Competitor gap' },
  { key: 'cannibalization', label: 'Cannibalization (Phase 5 — dedup pool before build)' },
  { key: 'structure', label: 'Map structuring (LLM on real clusters)' },
```

(d) Add to the `STAGE_FNS` map:

```js
  competitor_gap: stageCompetitorGap,
  cannibalization: stageCannibalization,
  structure: stageStructure,
```

- [ ] **Step 4: Run tests + prove stages.js loads and dispatches**

Run: `npm test`
Expected: PASS — 43 after Task 1 + 3 new = `# tests 46 # pass 46 # fail 0`.

Run: `node -e "const s=require('./lib/topical-map/stages'); const i=s.STAGES.map(x=>x.key); console.log('order ok:', i.indexOf('cannibalization')===i.indexOf('competitor_gap')+1 && i.indexOf('structure')===i.indexOf('cannibalization')+1)"`
Expected: `order ok: true`.

- [ ] **Step 5: Commit**

```bash
git add lib/topical-map/stages.js test/topical-map/stage-cannibalization.test.js
git commit -m "feat(topical-map): cannibalization stage runs before structure (Phase 5 reorder)"
```

---

## Self-Review

**Spec coverage:** Implements spec section 5's headline correctness fix — cannibalization now runs on the pool BEFORE `structure` (Phase 5 before Phase 6), instead of `qa` flagging the built tree afterward. `slug_collision` correctly stays post-structure in `qa`. The reorder is backed by the extracted, characterized logic from 3a/3b/3c-1. Correct.

**Placeholder scan:** No TBD/TODO. Every step has complete code and exact commands. All expected values (survivors `[c1,c5]`, dropped `[c2,c3,c4]`, the guard behavior, the stage order, the dispatcher return `current_stage='structure'`/`status='running'`) were captured by running prototypes against the real code. PASS.

**Type consistency:** `filterClustersByCannibalization(clusters, ctx) -> { survivors, dropped, report }` identical across the module (T1 S3), the stage (T2 S3), and both test files. `DROP_FLAGS` is a `Set`. `executeCurrentStage(run, { supaFetch })` return fields (`artifacts`, `current_stage`, `status`) match how the integration test reads them. Test-count chain: 39 (main) -> 43 (T1: +4) -> 46 (T2: +3). PASS.

**Risk notes for the executor:**
- Task 2 edits `stages.js` in three surgical spots (require merge, new function before `stageStructure`, two registry insertions). Do NOT touch `stageStructure`/`stageLinking`/`stageQa`.
- The `qa` stage is intentionally LEFT running post-structure: it still catches `slug_collision` (only meaningful once slugs exist) and is a belt-and-suspenders check on the built tree. This is not redundant with the pool cannibalization.
- Behavior change on a live pipeline: clusters flagged zero_demand / live-keyword-collision / intra-dup are now dropped before structuring. This is the intended Phase-5 behavior, conservative (only unambiguous drops), non-emptying (guard), and fully recorded in `artifacts.pool_cannibalization`. A review checkpoint for the drops is Plan 4.
