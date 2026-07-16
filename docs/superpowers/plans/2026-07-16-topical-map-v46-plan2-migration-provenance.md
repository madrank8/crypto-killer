# Topical Map v4.6 Port — Plan 2: migration 018 + structural provenance

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the genuinely-missing topic/run columns for the v4.6 port, and ship a pure provenance module that makes the skill's HONESTY RULES structural — a metric value with no measured/estimated source can never be read as fact.

**Architecture:** One idempotent SQL migration (`db-migrations/018_...sql`, applied via Supabase, matching the repo's existing convention) plus a dependency-free CommonJS module `lib/topical-map/provenance.js` with full `node:test` coverage. No pipeline wiring in this plan — later plans consume the module.

**Tech Stack:** Node 20 (`node:test`), CommonJS `lib/`, idempotent SQL applied to Supabase project `rqyfuioazbdixflqngcs`.

## Global Constraints

- **No new dependencies.** Node built-ins only (test harness from Plan 1 is live: `npm test` runs `node scripts/methodology-check.mjs && node --test test/`).
- **`lib/` is CommonJS** (`require`/`module.exports`).
- **Migrations** live in `db-migrations/`, are idempotent (`ADD COLUMN IF NOT EXISTS`), numbered; next free number is **018**. Header convention: `-- Run in Supabase SQL Editor. Idempotent.`
- **Provenance levels are exactly** `measured` | `estimated` | `unresolved`. Absence of provenance is `unresolved` — never treated as fact (spec section 6).
- **Live-schema reality (verified 2026-07-16):** `topics` ALREADY has `node_type`, `aio_risk`, `fan_out_tag`, `page_role`, `macro_vector`, `format_code`, `search_intent`, `cluster_key`, `publication_wave`, `keyword_data_source`, etc. (migrations 014-016). Do NOT re-add them. This plan adds ONLY the columns confirmed absent.

---

## Correction to spec section 7

Spec section 7 was written from `stages.js`, before checking the live DB. Against the live schema, several proposed columns already exist. This plan adds only what is genuinely missing:

**`topics`** (confirmed absent): `node_function`, `rpp_score`, `rpp_provenance`, `metric_provenance`, `winning_page_type`.
**`topical_map_runs`** (confirmed absent): `methodology_version`.

`site_type` and `mode` (spec section 7) are NOT added as columns — they are run inputs and belong in the existing `config` jsonb (YAGNI: no migration for values that already have a home). `node_type`, `aio_risk`, `fan_out_tag` are NOT added — they already exist.

---

## File Structure

- `db-migrations/018_topical_map_v46_provenance.sql` — the migration (new).
- `lib/topical-map/provenance.js` — pure provenance helper (new, CommonJS).
- `test/topical-map/provenance.test.js` — tests (new).

---

### Task 1: Migration 018 (author + apply + verify)

**Files:**
- Create: `db-migrations/018_topical_map_v46_provenance.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: columns `topics.node_function`, `topics.rpp_score`, `topics.rpp_provenance`, `topics.metric_provenance`, `topics.winning_page_type`, `topical_map_runs.methodology_version`. Later plans and Task 2's consumers rely on `metric_provenance` (jsonb) and `rpp_provenance` (text).

Migrations here are not unit-tested (repo convention: idempotent SQL applied in Supabase). Verification is applying it and checking `information_schema`. The controller applies it via the Supabase MCP at execution time; the acceptance check is the information_schema query in Step 3.

- [ ] **Step 1: Write the migration**

Create `db-migrations/018_topical_map_v46_provenance.sql`:

```sql
-- Migration: 018_topical_map_v46_provenance.sql
-- v4.6 topical-map port: node function taxonomy, RPP score, winning page type,
-- and structural provenance for the skill's HONESTY RULES.
-- Run in Supabase SQL Editor. Idempotent.
--
-- NOTE: node_type, aio_risk, fan_out_tag, page_role, macro_vector, format_code
-- already exist (migrations 014-016) and are intentionally NOT touched here.

-- node_function: orthogonal to node_type. One of:
-- authority | reinforcement | retrieval | entity | commercial
ALTER TABLE topics ADD COLUMN IF NOT EXISTS node_function text;

-- rpp_score: Rank-Probability-Potential prioritization score (numeric).
-- rpp_provenance: measured | estimated | unresolved (honesty rule for the score)
ALTER TABLE topics ADD COLUMN IF NOT EXISTS rpp_score numeric;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS rpp_provenance text;

-- winning_page_type: the page type the SERP actually rewards for this topic
-- (from the SERP-Overlap / Winning Page Type analysis).
ALTER TABLE topics ADD COLUMN IF NOT EXISTS winning_page_type text;

-- metric_provenance: per-field provenance map, e.g.
-- {"search_volume":"measured","keyword_difficulty":"estimated","rpp_score":"unresolved"}
-- A field absent from this map is treated as 'unresolved' by lib/topical-map/provenance.js.
-- Never fabricated: a value with no measured/estimated entry must not render as fact.
ALTER TABLE topics ADD COLUMN IF NOT EXISTS metric_provenance jsonb;

-- methodology_version: which vendored methodology version produced this run
-- (attribution; e.g. '4.6'). site_type and mode live in topical_map_runs.config.
ALTER TABLE topical_map_runs ADD COLUMN IF NOT EXISTS methodology_version text;

CREATE INDEX IF NOT EXISTS idx_topics_node_function ON topics(node_function);
```

- [ ] **Step 2: Apply the migration to Supabase**

The controller applies it via the Supabase MCP `apply_migration` (project `rqyfuioazbdixflqngcs`, name `topical_map_v46_provenance`, the SQL above). This is a production-DB change; it is additive and idempotent (nullable columns, `IF NOT EXISTS`), so it is safe on existing rows.

- [ ] **Step 3: Verify columns exist (acceptance check)**

Run via the Supabase MCP `execute_sql`:

```sql
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema='public'
  AND ( (table_name='topics' AND column_name IN
          ('node_function','rpp_score','rpp_provenance','metric_provenance','winning_page_type'))
     OR (table_name='topical_map_runs' AND column_name='methodology_version') )
ORDER BY table_name, column_name;
```

Expected: 6 rows (5 topics + 1 run). `metric_provenance` type `jsonb`, `rpp_score` `numeric`, the rest `text`.

- [ ] **Step 4: Commit**

```bash
git add db-migrations/018_topical_map_v46_provenance.sql
git commit -m "feat(topical-map): migration 018 - node_function, rpp_score, provenance columns"
```

---

### Task 2: Provenance module (pure, TDD)

**Files:**
- Create: `lib/topical-map/provenance.js`
- Create: `test/topical-map/provenance.test.js`

**Interfaces:**
- Consumes: nothing (Node built-ins only).
- Produces (all `module.exports`):
  - `PROVENANCE` — frozen `{ MEASURED:'measured', ESTIMATED:'estimated', UNRESOLVED:'unresolved' }`.
  - `normalize(level) -> string` — any invalid/absent input maps to `'unresolved'`.
  - `provenanceOf(provenanceMap, field) -> string` — a missing field is `'unresolved'`.
  - `isGrounded(provenanceMap, field) -> boolean` — true only for measured/estimated.
  - `ungroundedValues(topic, provenanceMap, fields) -> string[]` — fields with a non-null value but not grounded (the fabrication risks).
  - `buildProvenance(entries) -> object` — normalized `{field: level}` map.
  Later plans (stage writers, the Tier-1 table renderer) consume these.

- [ ] **Step 1: Write the failing tests**

Create `test/topical-map/provenance.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  PROVENANCE, normalize, provenanceOf, isGrounded, ungroundedValues, buildProvenance,
} = require('../../lib/topical-map/provenance')

test('PROVENANCE has the three levels and is frozen', () => {
  assert.equal(PROVENANCE.MEASURED, 'measured')
  assert.equal(PROVENANCE.ESTIMATED, 'estimated')
  assert.equal(PROVENANCE.UNRESOLVED, 'unresolved')
  assert.ok(Object.isFrozen(PROVENANCE))
})

test('normalize: valid passes through, everything else is unresolved', () => {
  assert.equal(normalize('measured'), 'measured')
  assert.equal(normalize('estimated'), 'estimated')
  assert.equal(normalize('unresolved'), 'unresolved')
  assert.equal(normalize('MEASURED'), 'unresolved') // case-sensitive on purpose
  assert.equal(normalize('guess'), 'unresolved')
  assert.equal(normalize(null), 'unresolved')
  assert.equal(normalize(undefined), 'unresolved')
  assert.equal(normalize(42), 'unresolved')
})

test('provenanceOf: missing field or bad map is unresolved', () => {
  assert.equal(provenanceOf({ search_volume: 'measured' }, 'search_volume'), 'measured')
  assert.equal(provenanceOf({ search_volume: 'measured' }, 'keyword_difficulty'), 'unresolved')
  assert.equal(provenanceOf(null, 'x'), 'unresolved')
  assert.equal(provenanceOf(undefined, 'x'), 'unresolved')
  assert.equal(provenanceOf({ x: 'garbage' }, 'x'), 'unresolved')
})

test('isGrounded: true only for measured/estimated', () => {
  assert.equal(isGrounded({ a: 'measured' }, 'a'), true)
  assert.equal(isGrounded({ a: 'estimated' }, 'a'), true)
  assert.equal(isGrounded({ a: 'unresolved' }, 'a'), false)
  assert.equal(isGrounded({}, 'a'), false) // absence is not trust
})

test('ungroundedValues: flags fields with a value but no grounding', () => {
  const topic = { search_volume: 500, keyword_difficulty: 12, rpp_score: null, cpc: 0 }
  const prov = { search_volume: 'measured', keyword_difficulty: 'unresolved' }
  const fields = ['search_volume', 'keyword_difficulty', 'rpp_score', 'cpc']
  // search_volume: has value + measured -> ok (not flagged)
  // keyword_difficulty: has value + unresolved -> FLAGGED
  // rpp_score: null value -> not flagged even though unresolved
  // cpc: value 0 is a real value, provenance absent -> FLAGGED
  assert.deepEqual(ungroundedValues(topic, prov, fields), ['keyword_difficulty', 'cpc'])
})

test('ungroundedValues: empty string counts as no value', () => {
  assert.deepEqual(ungroundedValues({ x: '' }, {}, ['x']), [])
})

test('buildProvenance normalizes every entry', () => {
  assert.deepEqual(
    buildProvenance({ a: 'measured', b: 'guess', c: null }),
    { a: 'measured', b: 'unresolved', c: 'unresolved' }
  )
  assert.deepEqual(buildProvenance(null), {})
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../../lib/topical-map/provenance'`.

- [ ] **Step 3: Implement the module**

Create `lib/topical-map/provenance.js`:

```js
'use strict'

// Provenance levels for any metric-bearing topic field. The topical-map skill's
// HONESTY RULES override all other instructions: a value that did not come from
// a tool call must never be presented as fact. We encode that as data so it is
// enforced structurally, not by prompt.
const PROVENANCE = Object.freeze({
  MEASURED: 'measured',     // a tool call (DataForSEO / Ahrefs / SERP) returned it
  ESTIMATED: 'estimated',   // a model/heuristic produced it, explicitly labeled
  UNRESOLVED: 'unresolved', // no grounded source; treat as unknown, never fact
})

const VALID = new Set([PROVENANCE.MEASURED, PROVENANCE.ESTIMATED, PROVENANCE.UNRESOLVED])

function normalize(level) {
  return VALID.has(level) ? level : PROVENANCE.UNRESOLVED
}

function provenanceOf(provenanceMap, field) {
  const m = provenanceMap && typeof provenanceMap === 'object' ? provenanceMap : {}
  return normalize(m[field])
}

function isGrounded(provenanceMap, field) {
  const p = provenanceOf(provenanceMap, field)
  return p === PROVENANCE.MEASURED || p === PROVENANCE.ESTIMATED
}

function ungroundedValues(topic, provenanceMap, fields) {
  const t = topic && typeof topic === 'object' ? topic : {}
  const out = []
  for (const f of fields) {
    const v = t[f]
    const hasValue = v !== null && v !== undefined && v !== ''
    if (hasValue && !isGrounded(provenanceMap, f)) out.push(f)
  }
  return out
}

function buildProvenance(entries) {
  const src = entries && typeof entries === 'object' ? entries : {}
  const out = {}
  for (const k of Object.keys(src)) out[k] = normalize(src[k])
  return out
}

module.exports = { PROVENANCE, normalize, provenanceOf, isGrounded, ungroundedValues, buildProvenance }
```

- [ ] **Step 4: Run and verify it passes**

Run: `npm test`
Expected: PASS — the methodology-check line, then previous 7 tests plus these 7 = `# tests 14 # pass 14 # fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/topical-map/provenance.js test/topical-map/provenance.test.js
git commit -m "feat(topical-map): structural provenance module (honesty rules as data)"
```

---

## Self-Review

**Spec coverage:**
- Spec section 6 (honesty rules structural, per-field provenance, absence = unresolved) -> Task 2 module + tests. COVERED.
- Spec section 7 (data model) -> Task 1 migration, CORRECTED against live schema (only genuinely-absent columns). COVERED, with the correction documented above.
- Spec sections 4, 5, 8, 9 -> Plan 1 (done) and later plans (3, 4). Out of scope here; correct.

**Placeholder scan:** No TBD/TODO/"handle errors". Every step has complete SQL or code. PASS.

**Type consistency:** `PROVENANCE` values (`measured`/`estimated`/`unresolved`) match the migration's comment on `metric_provenance`/`rpp_provenance` and the test assertions. `provenanceOf`/`isGrounded`/`ungroundedValues`/`buildProvenance` signatures are identical across the module (Task 2 Step 3) and its tests (Step 1). `metric_provenance` is `jsonb` in the migration and consumed as an object in the module. PASS.

**Migration/DB risk note for the executor:** Task 1 Step 2 applies DDL to the PRODUCTION Supabase. It is additive, nullable, and idempotent, so existing rows and the running admin are unaffected. Do not add `NOT NULL`, defaults that rewrite rows, or drops.
