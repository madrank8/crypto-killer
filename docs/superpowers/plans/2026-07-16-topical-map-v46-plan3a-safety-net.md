# Topical Map v4.6 Port — Plan 3a: safety net (extract + characterize pure logic)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the pure text helpers out of `stages.js` into a testable module and pin the deterministic pipeline logic (`text-utils` + `clustering`) with characterization tests, so the upcoming cannibalization reorder (Plan 3b) can change stage ORDER without silently changing behavior.

**Architecture:** A behavior-preserving extraction (`slugify`/`tokenize`/`jaccard` move verbatim from `stages.js` into `lib/topical-map/text-utils.js`; `stages.js` requires them), plus `node:test` characterization tests over `text-utils` and the already-exported `clustering.js`. No logic changes. Every expected value below was captured by running the real current code.

**Tech Stack:** Node 20 (`node:test`), CommonJS `lib/`.

## Global Constraints

- **No new dependencies.** Node built-ins only. `npm test` already runs `node scripts/methodology-check.mjs && node --test test/`.
- **`lib/` is CommonJS.**
- **Behavior-preserving.** The extracted `slugify`/`tokenize`/`jaccard` must be BYTE-IDENTICAL to the current definitions in `stages.js` (lines ~78-101). This is a move, not a rewrite. Do not "improve" them.
- **Scope fence.** `lib/review-prompts.js` and several `app/api/admin/*/route.js` files have their OWN local copies of similar helpers. Do NOT touch them (a future dedup, not this plan).
- **Characterization tests pin CURRENT behavior**, including quirks (e.g. `tokenize` drops tokens of length <= 2; `slugify` returns `'topic'` for empty/punctuation-only input). If a test value looks odd, it is the real current output — keep it.

---

## File Structure

- `lib/topical-map/text-utils.js` — new; `slugify`, `tokenize`, `jaccard` (moved verbatim).
- `lib/topical-map/stages.js` — modify: remove the 3 local defs, `require` them from `./text-utils`.
- `test/topical-map/text-utils.test.js` — new; characterization tests.
- `test/topical-map/clustering.test.js` — new; characterization tests (no change to `clustering.js`).

---

### Task 1: Extract text-utils and pin it (behavior-preserving)

**Files:**
- Create: `lib/topical-map/text-utils.js`
- Modify: `lib/topical-map/stages.js` (remove local defs at ~78-101; add a require)
- Create: `test/topical-map/text-utils.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (all `module.exports`): `slugify(text) -> string`, `tokenize(s) -> Set<string>`, `jaccard(a, b) -> number`. `stages.js` and Plan 3b's new cannibalization stage consume these.

- [ ] **Step 1: Write the characterization tests (capture current behavior)**

Create `test/topical-map/text-utils.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { slugify, tokenize, jaccard } = require('../../lib/topical-map/text-utils')

test('slugify: lowercases, hyphenates non-alnum, trims edges', () => {
  assert.equal(slugify('Crypto Scam Reviews!'), 'crypto-scam-reviews')
})

test('slugify: empty / punctuation-only falls back to "topic"', () => {
  assert.equal(slugify(''), 'topic')
  assert.equal(slugify('---'), 'topic')
  assert.equal(slugify(null), 'topic')
})

test('slugify: caps length at 180', () => {
  assert.equal(slugify('a'.repeat(200)).length, 180)
})

test('tokenize: lowercases, splits on non-alnum, drops tokens <= 2 chars', () => {
  assert.deepEqual([...tokenize('The Big Scam Review')], ['the', 'big', 'scam', 'review'])
})

test('tokenize: all-short input yields empty set', () => {
  assert.deepEqual([...tokenize('a to be it')], [])
  assert.equal(tokenize('').size, 0)
})

test('jaccard: intersection over union', () => {
  assert.equal(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd'])), 0.5)
})

test('jaccard: identical sets = 1, empty operand = 0', () => {
  assert.equal(jaccard(new Set(['x', 'y']), new Set(['x', 'y'])), 1)
  assert.equal(jaccard(new Set(), new Set(['a'])), 0)
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../../lib/topical-map/text-utils'`.

- [ ] **Step 3: Create the module (verbatim move)**

Create `lib/topical-map/text-utils.js` with the CURRENT definitions copied exactly from `stages.js`:

```js
'use strict'

// Pure text helpers used across the topical-map pipeline. Extracted verbatim
// from stages.js so they can be unit-tested and reused (e.g. by the
// cannibalization stage). Behavior is intentionally unchanged.

function slugify(text) {
  return (
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 180) || 'topic'
  )
}

function tokenize(s) {
  return new Set(
    String(s || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2)
  )
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter += 1
  return inter / (a.size + b.size - inter)
}

module.exports = { slugify, tokenize, jaccard }
```

- [ ] **Step 4: Rewire stages.js to use the module**

In `lib/topical-map/stages.js`: DELETE the three local function definitions (`function slugify...`, `function tokenize...`, `function jaccard...`, currently around lines 78-101). Add a require alongside the other `require('./...')` lines near the top (near `require('./clustering')` / `require('./prompts')`):

```js
const { slugify, tokenize, jaccard } = require('./text-utils')
```

Do not change any call site — all 24 uses keep the same names.

- [ ] **Step 5: Run tests and verify pass, and that stages.js still loads**

Run: `npm test`
Expected: PASS — previous 7 tests + 7 new = `# tests 14 # pass 14 # fail 0`. (Baseline is 7: this branch is off `main`, which has Plan 1 only; Plan 2's provenance tests are on unmerged PR #47.)

Run: `node -e "require('./lib/topical-map/stages')" && echo "stages.js loads OK"`
Expected: `stages.js loads OK` (proves the require rewiring did not break module load / leave a dangling reference).

- [ ] **Step 6: Commit**

```bash
git add lib/topical-map/text-utils.js lib/topical-map/stages.js test/topical-map/text-utils.test.js
git commit -m "refactor(topical-map): extract slugify/tokenize/jaccard to text-utils + characterization tests"
```

---

### Task 2: Characterize clustering.js (pin current behavior, no code change)

**Files:**
- Create: `test/topical-map/clustering.test.js`

**Interfaces:**
- Consumes: `clusterBySerpOverlap`, `scoreAioRisk`, `summarizeClusters`, `SHARED_URL_THRESHOLD` — already exported by `lib/topical-map/clustering.js`. No change to that file.
- Produces: characterization tests. Plan 3b relies on these to keep clustering stable while the reorder inserts cannibalization between clustering and structure.

- [ ] **Step 1: Write the characterization tests (verified expected values)**

Create `test/topical-map/clustering.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  SHARED_URL_THRESHOLD, clusterBySerpOverlap, scoreAioRisk, summarizeClusters,
} = require('../../lib/topical-map/clustering')

test('SHARED_URL_THRESHOLD is 3', () => {
  assert.equal(SHARED_URL_THRESHOLD, 3)
})

test('clusterBySerpOverlap: keywords sharing >= 3 URLs merge; others stay separate', () => {
  const serp = new Map([
    ['a', { urls: ['u1', 'u2', 'u3', 'u9'] }],
    ['b', { urls: ['u1', 'u2', 'u3', 'u8'] }], // shares u1,u2,u3 with a -> merge
    ['c', { urls: ['z1', 'z2'] }],             // isolated
  ])
  assert.deepEqual([...clusterBySerpOverlap(serp).entries()], [['a', ['a', 'b']], ['c', ['c']]])
})

test('clusterBySerpOverlap: exactly 2 shared URLs does NOT merge', () => {
  const serp = new Map([
    ['a', { urls: ['u1', 'u2', 'x'] }],
    ['b', { urls: ['u1', 'u2', 'y'] }],
  ])
  assert.deepEqual([...clusterBySerpOverlap(serp).entries()], [['a', ['a']], ['b', ['b']]])
})

test('scoreAioRisk: AI overview + informational is critical', () => {
  assert.equal(scoreAioRisk({ features: ['ai_overview'] }, 'informational'), 'critical')
})

test('scoreAioRisk: AI overview + non-informational is high', () => {
  assert.equal(scoreAioRisk({ features: ['ai_overview'] }, 'transactional'), 'high')
})

test('scoreAioRisk: featured snippet + informational is high', () => {
  assert.equal(scoreAioRisk({ features: ['featured_snippet'] }, 'informational'), 'high')
})

test('scoreAioRisk: informational (null intent counts as informational) is medium', () => {
  assert.equal(scoreAioRisk({ features: [] }, 'informational'), 'medium')
  assert.equal(scoreAioRisk({ features: [] }, null), 'medium')
})

test('scoreAioRisk: transactional with no features, or null serp, is low', () => {
  assert.equal(scoreAioRisk({ features: [] }, 'transactional'), 'low')
  assert.equal(scoreAioRisk(null, 'transactional'), 'low')
})

test('summarizeClusters: head is highest-volume member; volumes summed; head intent drives aio_risk', () => {
  const clusters = new Map([['a', ['a', 'b']]])
  const pool = new Map([
    ['a', { keyword: 'a', search_volume: 100, search_intent: 'informational' }],
    ['b', { keyword: 'b', search_volume: 300, search_intent: 'transactional' }],
  ])
  const serpBy = new Map([['a', { features: ['ai_overview'], paa: ['q1'], domains: ['d1', 'd2'] }]])
  const out = summarizeClusters(clusters, pool, serpBy)
  assert.equal(out.length, 1)
  assert.equal(out[0].head_keyword, 'b')          // highest volume
  assert.equal(out[0].total_volume, 400)
  assert.equal(out[0].dominant_intent, 'transactional')
  assert.equal(out[0].aio_risk, 'high')           // ai_overview + head intent (transactional)
  assert.deepEqual(out[0].top_domains, ['d1', 'd2'])
})
```

- [ ] **Step 2: Run and verify pass** (no source change; these pin existing behavior)

Run: `npm test`
Expected: PASS — `# tests 23 # pass 23 # fail 0` (14 after Task 1 + 9 new).

- [ ] **Step 3: Commit**

```bash
git add test/topical-map/clustering.test.js
git commit -m "test(topical-map): characterization tests for clustering (SERP overlap, AIO risk, summaries)"
```

---

## Self-Review

**Spec coverage:** This plan implements spec section 9's "the harness must land first / the qa -> cannibalization reorder is the riskiest edit; add tests before touching order." It is the safety net for Plan 3b. It does NOT implement the reorder itself (3b) or new stages (3c) — correct.

**Placeholder scan:** No TBD/TODO/"handle errors". Every step has complete code and exact commands. Every expected value was captured by running the current code (clustering + text-utils), not guessed. PASS.

**Type consistency:** `slugify`/`tokenize`/`jaccard` signatures identical in the module (Task 1 Step 3), the require (Step 4), and the tests (Step 1). `clustering.js` exports referenced in Task 2 (`SHARED_URL_THRESHOLD`, `clusterBySerpOverlap`, `scoreAioRisk`, `summarizeClusters`) match its actual `module.exports`. Test counts chain correctly: 7 (Plan 1 on main; Plan 2's tests are on unmerged PR #47) -> 14 (Task 1: +7) -> 23 (Task 2: +9). PASS.

**Risk note for the executor:** Task 1 Step 4 edits the 1106-line `stages.js`. The ONLY change is removing the three function definitions and adding one require. Do not touch any call site. Step 5's `node -e "require('./lib/topical-map/stages')"` is the guard that the rewiring left no dangling reference.
