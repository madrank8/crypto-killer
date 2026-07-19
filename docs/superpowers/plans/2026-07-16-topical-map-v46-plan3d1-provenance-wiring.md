# Topical Map v4.6 Port — Plan 3d-1: wire structural provenance into saved topics

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the (already-built, unwired) provenance module so every saved topic carries a `metric_provenance` map derived from its keyword data source — making the skill's HONESTY RULES structural: a metric with no measured/estimated grounding is recorded as `unresolved`, never rendered as fact.

**Architecture:** Add two pure helpers to `lib/topical-map/provenance.js` mapping the pipeline's existing `keyword_data_source` vocab (`dataforseo`/`llm-estimated`/`unverified`) to provenance levels (`measured`/`estimated`/`unresolved`), then populate the `metric_provenance` column in `stageSave`'s topic row. `metric_provenance` (jsonb) already exists on `topics` (migration 018).

**Tech Stack:** Node 20/22 (`node:test`), CommonJS `lib/`.

## Global Constraints

- **No new dependencies.** Node built-ins only. Baseline on `main` is 48 passing tests. (`npm test` = `node scripts/methodology-check.mjs && node --test 'test/**/*.test.js'`.)
- **`lib/` is CommonJS.**
- **Provenance levels are exactly** `measured` | `estimated` | `unresolved` (from `provenance.js` `PROVENANCE`).
- **Vocab mapping (fixed):** `dataforseo` -> `measured`; `llm-estimated` -> `estimated`; `unverified` / unknown / null -> `unresolved`.
- **Metric fields tagged:** the five keyword-derived metrics saved on a topic: `search_volume`, `keyword_difficulty`, `cpc`, `volume_trend_yearly`, `traffic_potential`. They share one source (`node._metrics.keyword_data_source`), so all get the same level.
- **Only `stageSave` changes in stages.js.** Do not touch other stages.

## Context (verified against live code)

- `stageSave` builds each topic `row` (stages.js ~939-972) from `node._metrics` and sets `keyword_data_source: node._metrics?.keyword_data_source || 'unverified'`. It does NOT set `metric_provenance`.
- `keyword_data_source` is produced upstream as `dataforseo` (metrics/competitor stages), `llm-estimated` (structure stage for keywords the LLM invented), or `unverified` (no grounding). See stages.js:371, 523, 750, 959.
- `metric_provenance` jsonb exists on `topics` (migration 018, already applied to prod).
- `provenance.js` exports `PROVENANCE`, `normalize`, `provenanceOf`, `isGrounded`, `ungroundedValues`, `buildProvenance`.

---

## File Structure

- `lib/topical-map/provenance.js` — modify: add `fromKeywordDataSource` + `keywordMetricProvenance`, export both.
- `test/topical-map/provenance.test.js` — modify: add tests for the two new functions.
- `lib/topical-map/stages.js` — modify `stageSave` only: require the helper, set `metric_provenance` on the row.

---

### Task 1: provenance vocab-mapping helpers + tests

**Files:**
- Modify: `lib/topical-map/provenance.js`
- Modify: `test/topical-map/provenance.test.js`

**Interfaces:**
- Consumes: `PROVENANCE` (same file).
- Produces (added to exports):
  - `fromKeywordDataSource(source) -> 'measured'|'estimated'|'unresolved'`.
  - `keywordMetricProvenance(source) -> { search_volume, keyword_difficulty, cpc, volume_trend_yearly, traffic_potential }` all set to `fromKeywordDataSource(source)`. `stageSave` consumes this.

- [ ] **Step 1: Add the failing tests**

Append to `test/topical-map/provenance.test.js` (keep the existing tests + imports; add `fromKeywordDataSource, keywordMetricProvenance` to the destructured import at the top of the file):

```js
test('fromKeywordDataSource maps the pipeline vocab to provenance levels', () => {
  assert.equal(fromKeywordDataSource('dataforseo'), 'measured')
  assert.equal(fromKeywordDataSource('llm-estimated'), 'estimated')
  assert.equal(fromKeywordDataSource('unverified'), 'unresolved')
  assert.equal(fromKeywordDataSource('something-else'), 'unresolved')
  assert.equal(fromKeywordDataSource(null), 'unresolved')
  assert.equal(fromKeywordDataSource(undefined), 'unresolved')
})

test('keywordMetricProvenance tags all five keyword metrics with one level', () => {
  assert.deepEqual(keywordMetricProvenance('dataforseo'), {
    search_volume: 'measured',
    keyword_difficulty: 'measured',
    cpc: 'measured',
    volume_trend_yearly: 'measured',
    traffic_potential: 'measured',
  })
  assert.deepEqual(keywordMetricProvenance('llm-estimated'), {
    search_volume: 'estimated',
    keyword_difficulty: 'estimated',
    cpc: 'estimated',
    volume_trend_yearly: 'estimated',
    traffic_potential: 'estimated',
  })
  assert.equal(keywordMetricProvenance('unverified').search_volume, 'unresolved')
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm test`
Expected: FAIL — `fromKeywordDataSource`/`keywordMetricProvenance` are undefined.

- [ ] **Step 3: Implement the helpers**

In `lib/topical-map/provenance.js`, add ABOVE the `module.exports` line:

```js
// Map the topical-map pipeline's keyword_data_source vocab onto provenance
// levels. dataforseo = a tool call returned it; llm-estimated = a model
// produced it; anything else (unverified / unknown / null) = not grounded.
function fromKeywordDataSource(source) {
  if (source === 'dataforseo') return PROVENANCE.MEASURED
  if (source === 'llm-estimated') return PROVENANCE.ESTIMATED
  return PROVENANCE.UNRESOLVED
}

// The five keyword-derived metrics a topic saves all come from the same source,
// so they share one provenance level. Returns the metric_provenance map.
function keywordMetricProvenance(source) {
  const level = fromKeywordDataSource(source)
  return {
    search_volume: level,
    keyword_difficulty: level,
    cpc: level,
    volume_trend_yearly: level,
    traffic_potential: level,
  }
}
```

Extend the exports to add both names (keep the existing six):

```js
module.exports = { PROVENANCE, normalize, provenanceOf, isGrounded, ungroundedValues, buildProvenance, fromKeywordDataSource, keywordMetricProvenance }
```

- [ ] **Step 4: Run and verify pass**

Run: `npm test`
Expected: PASS — 48 baseline + 2 new = `# tests 50 # pass 50 # fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/topical-map/provenance.js test/topical-map/provenance.test.js
git commit -m "feat(topical-map): provenance helpers mapping keyword_data_source to levels"
```

---

### Task 2: populate metric_provenance in stageSave

**Files:**
- Modify: `lib/topical-map/stages.js` (`stageSave` topic-row build only)

**Interfaces:**
- Consumes: `keywordMetricProvenance` (Task 1).
- Produces: every inserted topic row includes `metric_provenance` (jsonb) derived from `keyword_data_source`.

Note: `stageSave` does live DB inserts (supaFetch POST) and is not unit-tested; the pure mapping it uses is covered by Task 1. Verification here is: build passes, the row includes the field, and `require('./stages')` loads.

- [ ] **Step 1: Add the require**

In `lib/topical-map/stages.js`, near the top requires, add (or merge if a provenance require exists — it does not yet):

```js
const { keywordMetricProvenance } = require('./provenance')
```

- [ ] **Step 2: Set the field on the topic row**

In `stageSave`, in the `row` object, immediately after the existing line
`      keyword_data_source: node._metrics?.keyword_data_source || 'unverified',`
add:

```js
      metric_provenance: keywordMetricProvenance(node._metrics?.keyword_data_source),
```

- [ ] **Step 3: Verify build + load + suite**

Run: `node -e "const s=require('./lib/topical-map/stages'); console.log('stages loads:', typeof s.executeCurrentStage==='function')"`
Expected: `stages loads: true`.

Run: `npm test`
Expected: PASS — `# tests 50 # pass 50 # fail 0` (unchanged from Task 1; stageSave is not unit-tested).

Run: `grep -n "metric_provenance: keywordMetricProvenance" lib/topical-map/stages.js`
Expected: one match inside `stageSave`.

- [ ] **Step 4: Commit**

```bash
git add lib/topical-map/stages.js
git commit -m "feat(topical-map): stageSave records metric_provenance on each topic"
```

---

## Self-Review

**Spec coverage:** Activates spec section 6 (honesty rules as data) end-to-end: the provenance primitive (Plan 2) is now populated by the save stage from the real `keyword_data_source` signal, so a downstream consumer (rendering / the writing flow) can distinguish grounded from ungrounded metrics via `provenanceOf`/`ungroundedValues`. Correct scope; the RPP-score provenance (`rpp_provenance`) is deferred until an RPP stage exists.

**Placeholder scan:** No TBD/TODO. Every step has complete code and exact commands. The vocab mapping is fixed and matches the pipeline's real `keyword_data_source` values (verified at stages.js:371/523/750/959). PASS.

**Type consistency:** `fromKeywordDataSource(source) -> string` and `keywordMetricProvenance(source) -> {5 fields}` identical across the module (T1 S3), the tests (T1 S1), and the stage (T2 S2). Levels are exactly `PROVENANCE` values. Test chain: 48 (main) -> 50 (T1: +2) -> 50 (T2: +0). PASS.

**Risk note:** Task 2 edits the topic-row build in `stageSave` (adds one field). It cannot break existing rows (additive jsonb column, already on prod). Do not touch the insert logic or other row fields.
