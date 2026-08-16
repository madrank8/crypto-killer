# Quality Fix Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared OpenAI-flagship Quality Fix Agent that clears publish hard fails for topical `content` and brand `reviews` (deterministic → surgical → research), re-audits, and auto-publishes when hard fails are gone — via post-generation hooks and a manual Fix & Publish button.

**Architecture:** One orchestrator (`lib/quality-fix-agent.js`) classifies each hard fail, runs deterministic remediations first, then GPT-5.4 surgical patches, then Gemini research only for load-bearing claims. Thin adapters patch the right table and call existing audit + publish routes (never `override: true`). Content ships first; reviews reuse the same core.

**Tech Stack:** Next.js 14 App Router API (SSE), `callModel` / `extractJSON` from `lib/ai-models.js`, Supabase REST via `supaFetch`, `node --test`, Tailwind admin UI.

## Global Constraints

- Never invent URLs, numbers, testimonials, or credentials.
- Never call publish with `override: true`.
- One agent cycle per invocation (`cycle: 1`); no inner retry loops.
- Auto-publish when hard fails clear; score is warning-only (does not block).
- Hybrid: surgical remove/soften by default; research only for load-bearing claims with HEAD-verified URLs.
- No new npm dependencies.
- Follow existing patterns: `verifyAdmin`, `supaFetch`, `callModel`, SSE `maxDuration = 300`.
- Dual module style: Next routes use ESM `import`; tests use `require` — match neighboring lib files (`module.exports` like `lib/ai-models.js` / `lib/source-verify.js`, or ESM + working require like `lib/remediate-content.js`). Prefer **`module.exports` + named exports object** for new pure libs so `node --test` is unambiguous.
- No em-dashes in user-facing copy (colons / hyphens / semicolons).
- Spec: `docs/superpowers/specs/2026-08-13-quality-fix-agent-design.md`

## File map

| File | Responsibility |
|---|---|
| `lib/ai-models.js` | Add `gpt-5.4` flagship pin |
| `lib/quality-fix-classify.js` | Map hard-fail keys / gate reasons → tactic |
| `lib/quality-fix-surgical.js` | Prompt + apply JSON patch list from GPT-5.4 |
| `lib/quality-fix-research.js` | Gemini research + HEAD verify for load-bearing claims |
| `lib/quality-fix-agent.js` | Orchestrator: classify → fix → reaudit → publish decision |
| `lib/quality-fix-content.js` | Content row load/patch/audit/publish adapter |
| `lib/quality-fix-review.js` | Review row load/patch/audit/publish adapter |
| `app/api/admin/content/[id]/quality-fix/route.js` | Content SSE endpoint |
| `app/api/admin/reviews/[id]/quality-fix/route.js` | Review SSE endpoint |
| `app/admin/content/[id]/page.js` | Fix & Publish UI |
| `app/admin/review/[id]/page.js` | Fix & Publish UI |
| `app/api/admin/content/fill/route.js` | Post-audit hook behind `QUALITY_FIX_AUTO` |
| `app/api/admin/reviews/[id]/polish/route.js` | Post-audit hook behind `QUALITY_FIX_AUTO` |
| `test/quality-fix-classify.test.js` | Classifier tests |
| `test/quality-fix-surgical.test.js` | Patch applicator tests |
| `test/quality-fix-research.test.js` | Research verify gate tests |
| `test/quality-fix-agent.test.js` | Orchestrator dry-run tests |

---

### Task 1: Pin OpenAI flagship `gpt-5.4`

**Files:**
- Modify: `lib/ai-models.js`
- Test: `test/quality-fix-model-pin.test.js`

**Interfaces:**
- Produces: `MODELS['gpt-5.4']` with `{ provider: 'openai', model: 'gpt-5.4', maxTokens: 16384, label: 'GPT-5.4' }`

- [ ] **Step 1: Write the failing test**

```javascript
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { MODELS } = require('../lib/ai-models')

test('MODELS includes gpt-5.4 OpenAI flagship pin', () => {
  assert.ok(MODELS['gpt-5.4'])
  assert.equal(MODELS['gpt-5.4'].provider, 'openai')
  assert.equal(MODELS['gpt-5.4'].model, 'gpt-5.4')
  assert.ok(MODELS['gpt-5.4'].maxTokens >= 8192)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/quality-fix-model-pin.test.js`
Expected: FAIL (key missing)

- [ ] **Step 3: Add the pin**

In `lib/ai-models.js`, inside `MODELS`, after the existing `gpt-5.4-nano` entry, add:

```javascript
  'gpt-5.4': {
    provider: 'openai',
    model: 'gpt-5.4',
    maxTokens: 16384,
    label: 'GPT-5.4',
  },
```

Update the file header comment that says only mini/nano are pinned. Keep `callOpenAI`'s existing `gpt-5*` `max_completion_tokens` + `reasoning_effort` handling (already covers this ID).

Note: `lib/run-quality-audit.js` comments that a past `gpt-5.4` call 403/404'd on the live auditor account. That is an account/tier issue, not a reason to skip the pin. The agent should request `gpt-5.4` with `effort: 'high'`; if the provider key is missing, existing `resolveModel` fallback applies. If the API returns 403/404 at runtime, the orchestrator (Task 5) must surface `needs_review` — do not silently invent a different flagship ID without updating this plan.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/quality-fix-model-pin.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/ai-models.js test/quality-fix-model-pin.test.js
git commit -m "$(cat <<'EOF'
feat(ai): pin gpt-5.4 for quality fix agent

EOF
)"
```

---

### Task 2: Classifier

**Files:**
- Create: `lib/quality-fix-classify.js`
- Test: `test/quality-fix-classify.test.js`

**Interfaces:**
- Produces: `classifyFail(fail: { key?: string, reason?: string }, gateReason?: string) -> { key: string, tactic: 'deterministic' | 'surgical' | 'research_candidate' | 'unfixable' | 'skip', operator_action?: string }`
- Produces: `classifyFails(fails: Array, gateReasons?: string[]) -> Array<classified>`

Tactic rules (from spec):

| key / reason match | tactic |
|---|---|
| `missing_risk_or_ftc_disclosure` | `deterministic` |
| visual placeholder / placeholder-box | `deterministic` |
| dead source / blocked citation / CITATION_ | `deterministic` (drop) with optional later research for replacements |
| skeleton / taxonomy / short section / placeholder link / author stutter / anti-slop / lint | `surgical` |
| `unverified_claims_in_article`, `{{VERIFY}}`, `source_ledger_claims_without_links` | `research_candidate` (orchestrator decides load-bearing → research else surgical) |
| `fabricated_source_or_stat`, `fabricated_reviews_or_testimonials` | `surgical` |
| `commodity_no_information_gain` | `unfixable` |
| `item_reviewed_typed` on blog (no item) | `skip` (gate already skips; if present as fail, skip) |
| unknown | `unfixable` |

- [ ] **Step 1: Write the failing tests**

```javascript
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { classifyFail, classifyFails } = require('../lib/quality-fix-classify')

test('disclosure → deterministic', () => {
  assert.equal(classifyFail({ key: 'missing_risk_or_ftc_disclosure' }).tactic, 'deterministic')
})

test('unverified claims → research_candidate', () => {
  assert.equal(classifyFail({ key: 'unverified_claims_in_article' }).tactic, 'research_candidate')
})

test('commodity → unfixable with operator_action', () => {
  const c = classifyFail({ key: 'commodity_no_information_gain', reason: 'no IG' })
  assert.equal(c.tactic, 'unfixable')
  assert.match(c.operator_action, /first-party|original data|firsthand/i)
})

test('fabricated stat → surgical', () => {
  assert.equal(classifyFail({ key: 'fabricated_source_or_stat' }).tactic, 'surgical')
})

test('gate reason with skeleton opener → surgical', () => {
  assert.equal(
    classifyFail({}, "section \"Intro\" body opens with a skeleton meta-description").tactic,
    'surgical',
  )
})

test('unknown key → unfixable', () => {
  assert.equal(classifyFail({ key: 'some_future_check' }).tactic, 'unfixable')
})

test('classifyFails preserves order and keys', () => {
  const out = classifyFails([
    { key: 'missing_risk_or_ftc_disclosure' },
    { key: 'commodity_no_information_gain' },
  ])
  assert.equal(out[0].tactic, 'deterministic')
  assert.equal(out[1].tactic, 'unfixable')
})
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `node --test test/quality-fix-classify.test.js`

- [ ] **Step 3: Implement `lib/quality-fix-classify.js`**

```javascript
const OPERATOR_ACTIONS = {
  commodity_no_information_gain:
    'Add first-party evidence: original data, screenshots, or a firsthand test. This is a content decision, not a formatting one.',
  unknown:
    'Read the audit hard_fail_reason and fix what it names, then re-run Fix & Publish.',
}

const DETERMINISTIC_KEYS = new Set(['missing_risk_or_ftc_disclosure'])
const SURGICAL_KEYS = new Set([
  'fabricated_source_or_stat',
  'fabricated_reviews_or_testimonials',
  'fake_or_unmarked_freshness',
  'not_for_you_block_present',
])
const RESEARCH_CANDIDATE_KEYS = new Set([
  'unverified_claims_in_article',
  'source_ledger_claims_without_links',
])
const UNFIXABLE_KEYS = new Set(['commodity_no_information_gain'])
const SKIP_KEYS = new Set(['item_reviewed_typed'])

function classifyFromReasonText(text) {
  const t = String(text || '').toLowerCase()
  if (/visual placeholder|placeholder-box|\[.*needed/i.test(t)) return 'deterministic'
  if (/dead source|blocked.*url|citation_blocked|hard-dead/i.test(t)) return 'deterministic'
  if (/skeleton|taxonomy trailer|minimum 40|placeholder target_slug|author_bio leads|anti-slop|banned phrase/i.test(t)) {
    return 'surgical'
  }
  if (/verify\}\}|unverified claim|not supported by any source/i.test(t)) return 'research_candidate'
  return null
}

function classifyFail(fail = {}, gateReason) {
  const key = fail.key || 'unknown'
  const reasonBlob = [fail.reason, gateReason].filter(Boolean).join(' ')

  if (SKIP_KEYS.has(key)) return { key, tactic: 'skip' }
  if (DETERMINISTIC_KEYS.has(key)) return { key, tactic: 'deterministic' }
  if (UNFIXABLE_KEYS.has(key)) {
    return { key, tactic: 'unfixable', operator_action: OPERATOR_ACTIONS[key] || OPERATOR_ACTIONS.unknown }
  }
  if (RESEARCH_CANDIDATE_KEYS.has(key)) return { key, tactic: 'research_candidate' }
  if (SURGICAL_KEYS.has(key)) return { key, tactic: 'surgical' }

  const fromReason = classifyFromReasonText(reasonBlob)
  if (fromReason) return { key, tactic: fromReason, reason: reasonBlob }

  return {
    key,
    tactic: 'unfixable',
    operator_action: OPERATOR_ACTIONS[key] || OPERATOR_ACTIONS.unknown,
    reason: fail.reason || gateReason || 'unrecognized quality gate failure',
  }
}

function classifyFails(fails = [], gateReasons = []) {
  const fromFails = (Array.isArray(fails) ? fails : []).map((f) => classifyFail(f))
  const fromGates = (Array.isArray(gateReasons) ? gateReasons : []).map((r, i) =>
    classifyFail({ key: `gate_${i}`, reason: r }, r),
  )
  return [...fromFails, ...fromGates]
}

module.exports = { classifyFail, classifyFails, OPERATOR_ACTIONS }
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `node --test test/quality-fix-classify.test.js`

- [ ] **Step 5: Commit**

```bash
git add lib/quality-fix-classify.js test/quality-fix-classify.test.js
git commit -m "$(cat <<'EOF'
feat(quality-fix): classify gate fails into fix tactics

EOF
)"
```

---

### Task 3: Surgical patch applicator

**Files:**
- Create: `lib/quality-fix-surgical.js`
- Test: `test/quality-fix-surgical.test.js`

**Interfaces:**
- Produces: `applySurgicalPatches(row: object, patches: Array) -> { patch: object, applied: Array<{ what: string }>, rejected: Array<{ why: string }> }`
- Produces: `surgicalFixPrompt({ kind: 'content'|'review', fails, rowExcerpt }) -> { system, user }`
- Allowed patch ops only:
  - `{ op: 'replace_span', field: 'full_article'|'summary'|..., find: string, replace: string }` — `find` must exist exactly once; `replace` must not introduce new `http` hosts not already in row sources/citations, and must not introduce new digit-runs longer than 1 that were not in `find` (blocks invented stats). Exception: linking existing ledger URLs is allowed when `op: 'insert_ledger_link'`.
  - `{ op: 'set_section_body', index: number, body: string }`
  - `{ op: 'set_field', field: string, value: any }` for allowlisted scalar fields: `not_for_you`, `meta_description`, `summary`, `disclaimer` (reviews)
  - `{ op: 'remove_source_urls', urls: string[] }`
  - `{ op: 'insert_ledger_link', field: 'full_article', find: string, url: string, anchor?: string }` — `url` must already exist on `row.sources` or `row.citations`

- [ ] **Step 1: Write the failing tests**

```javascript
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { applySurgicalPatches } = require('../lib/quality-fix-surgical')

test('replace_span rewrites the exact span once', () => {
  const row = { full_article: '<p>Lost $2M last year.</p>', sources: [] }
  const { patch, applied, rejected } = applySurgicalPatches(row, [
    { op: 'replace_span', field: 'full_article', find: 'Lost $2M last year.', replace: 'Victims reported large losses.' },
  ])
  assert.equal(rejected.length, 0)
  assert.equal(applied.length, 1)
  assert.match(patch.full_article, /Victims reported large losses/)
  assert.doesNotMatch(patch.full_article, /\$2M/)
})

test('rejects replace_span that invents a new URL host', () => {
  const row = { full_article: '<p>See report.</p>', sources: [{ url: 'https://ic3.gov/a' }] }
  const { rejected } = applySurgicalPatches(row, [
    { op: 'replace_span', field: 'full_article', find: 'See report.', replace: 'See https://evil.example/x .' },
  ])
  assert.ok(rejected.some((r) => /url|host/i.test(r.why)))
})

test('rejects replace_span that invents a new multi-digit number', () => {
  const row = { full_article: '<p>Lost money.</p>', sources: [] }
  const { rejected } = applySurgicalPatches(row, [
    { op: 'replace_span', field: 'full_article', find: 'Lost money.', replace: 'Lost $950000.' },
  ])
  assert.ok(rejected.some((r) => /number|stat/i.test(r.why)))
})

test('insert_ledger_link only allows existing source URLs', () => {
  const row = {
    full_article: '<p>FBI warns about pig butchering.</p>',
    sources: [{ url: 'https://www.ic3.gov/PSA/2023/PSA230928' }],
  }
  const ok = applySurgicalPatches(row, [
    { op: 'insert_ledger_link', field: 'full_article', find: 'FBI warns', url: 'https://www.ic3.gov/PSA/2023/PSA230928' },
  ])
  assert.equal(ok.rejected.length, 0)
  assert.match(ok.patch.full_article, /ic3\.gov/)

  const bad = applySurgicalPatches(row, [
    { op: 'insert_ledger_link', field: 'full_article', find: 'FBI warns', url: 'https://not-in-ledger.example/' },
  ])
  assert.ok(bad.rejected.length > 0)
})

test('remove_source_urls drops matching sources', () => {
  const row = {
    full_article: '<p>x</p>',
    sources: [{ url: 'https://dead.example/a' }, { url: 'https://ok.example/b' }],
  }
  const { patch } = applySurgicalPatches(row, [
    { op: 'remove_source_urls', urls: ['https://dead.example/a'] },
  ])
  assert.equal(patch.sources.length, 1)
  assert.equal(patch.sources[0].url, 'https://ok.example/b')
})
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `node --test test/quality-fix-surgical.test.js`

- [ ] **Step 3: Implement applicator + prompt builder**

Implement `applySurgicalPatches` with the guards above. Implement `surgicalFixPrompt` that:

- Lists classified fails and quotes offending spans from `hard_fail_reason` / gate reasons
- Instructs: return JSON `{ patches: [...], load_bearing_claims: [{ text, why_load_bearing }], notes }`
- Bans inventing stats/URLs; says prefer remove/soften; mark load-bearing only when removing guts the section thesis
- Includes allowlisted ops exactly as above

```javascript
function surgicalFixPrompt({ kind, fails, rowExcerpt }) {
  return {
    system: `You fix YMYL publish-gate failures surgically. Return JSON only. Never invent numbers, URLs, testimonials, or credentials. Prefer removing or softening unverified claims. Mark load_bearing_claims only when removing the claim would gut the section thesis.`,
    user: JSON.stringify({ kind, fails, rowExcerpt, allowed_ops: [
      'replace_span', 'set_section_body', 'set_field', 'remove_source_urls', 'insert_ledger_link',
    ] }, null, 2),
  }
}

module.exports = { applySurgicalPatches, surgicalFixPrompt }
```

Keep `rowExcerpt` construction in the adapter (Task 6/9): title, hard_fail_reason, full_article truncated to ~12k chars, sections headings+body snippets, sources urls, not_for_you.

- [ ] **Step 4: Run tests — expect PASS**

Run: `node --test test/quality-fix-surgical.test.js`

- [ ] **Step 5: Commit**

```bash
git add lib/quality-fix-surgical.js test/quality-fix-surgical.test.js
git commit -m "$(cat <<'EOF'
feat(quality-fix): surgical patch applicator with anti-fabrication guards

EOF
)"
```

---

### Task 4: Research escalation helper

**Files:**
- Create: `lib/quality-fix-research.js`
- Test: `test/quality-fix-research.test.js`

**Interfaces:**
- Produces: `async researchSourcesForClaims({ claims, topicTitle, existingUrls, callModelFn, headCheckFn }) -> { sources: Array<{url,title,type,extract}>, rejected: Array }`
- Produces: `mergeVerifiedSources(row, sources) -> { sources: Array, citations?: Array }`
- Default `headCheckFn`: reuse `headCheckUrl` from `lib/source-verify.js` if exported; if not exported, export it or duplicate the thin wrapper already in `app/api/admin/reviews/[id]/auto-fix/route.js` into this module and call `verifySourceLedger` on the candidate list.

Prefer: call `verifySourceLedger` from `lib/source-verify.js` on candidate sources and keep only those with `verified: true`.

- [ ] **Step 1: Write the failing tests** (mock callModel + headCheck)

```javascript
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { researchSourcesForClaims, mergeVerifiedSources } = require('../lib/quality-fix-research')

test('drops sources whose head check fails', async () => {
  const callModelFn = async () => ({
    text: JSON.stringify({
      sources: [
        { url: 'https://dead.example/x', title: 'Dead', type: 'government', extract: '...' },
        { url: 'https://www.ic3.gov/ok', title: 'IC3', type: 'government', extract: 'PSA' },
      ],
    }),
  })
  const headCheckFn = async (url) => ({ ok: url.includes('ic3.gov') })
  const { sources, rejected } = await researchSourcesForClaims({
    claims: [{ text: '72-hour liquidity unlock' }],
    topicTitle: 'Crypto scam checker',
    existingUrls: new Set(),
    callModelFn,
    headCheckFn,
  })
  assert.equal(sources.length, 1)
  assert.equal(sources[0].url, 'https://www.ic3.gov/ok')
  assert.equal(rejected.length, 1)
})

test('mergeVerifiedSources appends without duplicating URLs', () => {
  const row = { sources: [{ url: 'https://a.example/' }] }
  const merged = mergeVerifiedSources(row, [
    { url: 'https://a.example/', title: 'dup' },
    { url: 'https://b.example/', title: 'new', type: 'government' },
  ])
  assert.equal(merged.sources.length, 2)
})
```

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement**

Use `gemini-flash` with `searchGrounding: true` via injected `callModelFn` (production passes `callModel`). Prompt: return JSON sources relevant to the listed claims; exclude `existingUrls`. After parse, filter with `headCheckFn`. Never return a source that failed verification.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/quality-fix-research.js test/quality-fix-research.test.js
git commit -m "$(cat <<'EOF'
feat(quality-fix): research helper with HEAD-verified sources only

EOF
)"
```

---

### Task 5: Orchestrator (dry-run / injectable deps)

**Files:**
- Create: `lib/quality-fix-agent.js`
- Test: `test/quality-fix-agent.test.js`

**Interfaces:**
- Produces:

```typescript
async function runQualityFixAgent(ctx: {
  kind: 'content' | 'review',
  row: object,
  hardFails: Array<{ key: string, reason: string }>,
  gateReasons?: string[],
  autoPublish?: boolean, // default true
  deps: {
    remediateDeterministic: (row, fails) => { patch, applied, unfixable },
    runSurgicalModel: (prompt) => Promise<object>, // parsed JSON
    applySurgicalPatches: typeof applySurgicalPatches,
    researchSourcesForClaims: typeof researchSourcesForClaims,
    persistPatch: (patch) => Promise<object>, // returns updated row
    reaudit: (row) => Promise<{ row, hardFails: Array }>,
    publish: (row) => Promise<{ ok: boolean, status?: number, body?: object }>,
    send?: (event: object) => void,
  }
}) => Promise<{
  ok: boolean,
  ready: boolean,
  published: boolean,
  applied: Array,
  unfixable: Array,
  audit_summary: object,
  reasons: string[],
  row?: object,
}>
```

Flow (one cycle):
1. `send({ step: 'classify' })` → `classifyFails`
2. If any `unfixable` and no other tactics will clear publish alone — still attempt fixable ones; unfixable always stay in report
3. Deterministic: merge patches from `remediateDeterministic` for deterministic keys (content: `remediateContent`; reviews: map to `review-remediate` / disclosure helpers)
4. Split `research_candidate`: call surgical model first asking for `load_bearing_claims`; non-load-bearing → surgical patches; load-bearing → `researchSourcesForClaims` then surgical `insert_ledger_link` / soften if research empty
5. Other surgical keys → surgical model + apply
6. `persistPatch` if non-empty
7. `reaudit`
8. If `hardFails.length === 0` and `autoPublish !== false` → `publish` (must not pass override)
9. Stamp result metadata shape for adapters to write into `ai_audit.quality_fix`

- [ ] **Step 1: Write orchestrator tests with mocks**

```javascript
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { runQualityFixAgent } = require('../lib/quality-fix-agent')

function baseDeps(overrides = {}) {
  return {
    remediateDeterministic: () => ({ patch: { full_article: '<p>with disclosure</p>' }, applied: [{ key: 'missing_risk_or_ftc_disclosure', what: 'appended' }], unfixable: [] }),
    runSurgicalModel: async () => ({ patches: [], load_bearing_claims: [] }),
    applySurgicalPatches: () => ({ patch: {}, applied: [], rejected: [] }),
    researchSourcesForClaims: async () => ({ sources: [], rejected: [] }),
    persistPatch: async (patch) => ({ id: '1', full_article: patch.full_article || '', ai_audit: {} }),
    reaudit: async (row) => ({ row, hardFails: [] }),
    publish: async () => ({ ok: true, status: 200 }),
    send: () => {},
    ...overrides,
  }
}

test('auto-publishes when reaudit clears hard fails', async () => {
  const out = await runQualityFixAgent({
    kind: 'content',
    row: { id: '1', full_article: '<p>x</p>' },
    hardFails: [{ key: 'missing_risk_or_ftc_disclosure', reason: 'missing' }],
    autoPublish: true,
    deps: baseDeps(),
  })
  assert.equal(out.ready, true)
  assert.equal(out.published, true)
  assert.equal(out.ok, true)
})

test('does not publish when unfixable remains after reaudit', async () => {
  const out = await runQualityFixAgent({
    kind: 'content',
    row: { id: '1' },
    hardFails: [{ key: 'commodity_no_information_gain', reason: 'commodity' }],
    deps: baseDeps({
      remediateDeterministic: () => ({ patch: {}, applied: [], unfixable: [{ key: 'commodity_no_information_gain', reason: 'commodity', operator_action: 'add evidence' }] }),
      reaudit: async (row) => ({ row, hardFails: [{ key: 'commodity_no_information_gain', reason: 'commodity' }] }),
      publish: async () => { throw new Error('publish must not be called') },
    }),
  })
  assert.equal(out.published, false)
  assert.equal(out.ready, false)
  assert.ok(out.unfixable.length >= 1)
})

test('never calls publish with override', async () => {
  let publishArgs = null
  const out = await runQualityFixAgent({
    kind: 'content',
    row: { id: '1' },
    hardFails: [{ key: 'missing_risk_or_ftc_disclosure', reason: 'x' }],
    deps: baseDeps({
      publish: async (row, opts) => {
        publishArgs = opts
        return { ok: true, status: 200 }
      },
    }),
  })
  assert.equal(out.published, true)
  assert.equal(publishArgs?.override, undefined)
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `runQualityFixAgent`** exactly per flow above. On deps throwing: return `{ ok: false, ready: false, published: false, reasons: [message], applied, unfixable }`.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/quality-fix-agent.js test/quality-fix-agent.test.js
git commit -m "$(cat <<'EOF'
feat(quality-fix): orchestrator with auto-publish on clean hard fails

EOF
)"
```

---

### Task 6: Content adapter + SSE route

**Files:**
- Create: `lib/quality-fix-content.js`
- Create: `app/api/admin/content/[id]/quality-fix/route.js`

**Interfaces:**
- Produces: `buildContentAgentDeps({ id, token, send })` wiring real:
  - `remediateDeterministic` → `remediateContent` from `lib/remediate-content.js`
  - `runSurgicalModel` → `callModel('gpt-5.4', ..., { jsonMode: true, effort: 'high', timeoutMs: 120000 })` + `extractJSON`
  - `researchSourcesForClaims` → real helper with `callModel` + source-verify
  - `persistPatch` → `supaFetch` PATCH content
  - `reaudit` → `runQualityAudit` + `mergeAuditVerdict` + `evaluateHardFails` + persist `ai_audit`
  - `publish` → internal call equivalent to POST publish **without** override: either import/shared extract of publish core, or `fetch` to same-origin `/api/admin/content/${id}/publish` with admin bearer and `{ action: 'publish' }` only

Prefer same-origin fetch with the request's Authorization header so outbox/sync behavior stays in one place (spec: one writer of publish logic).

- [ ] **Step 1: Implement `lib/quality-fix-content.js`**

```javascript
// Pseudocode structure — expand fully in implementation
async function loadContent(id) { /* supaFetch select=* */ }
async function buildContentAgentContext(id, { authorization, send, autoPublish }) {
  const row = await loadContent(id)
  const hardFails = evaluateHardFails(row.ai_audit, row).failed
  // also pass validateForPublish reasons if you re-run gate pre-check
  return { kind: 'content', row, hardFails, autoPublish, deps: { /* wired */ send } }
}
module.exports = { loadContent, buildContentAgentContext, runContentQualityFix }
```

`runContentQualityFix` calls `runQualityFixAgent` then stamps `ai_audit.quality_fix` on the row.

- [ ] **Step 2: Implement SSE route**

```javascript
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { runContentQualityFix } from '@/lib/quality-fix-content'

export const maxDuration = 300

export async function POST(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const autoPublish = body.auto_publish !== false
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        try {
          send({ step: 'init', status: 'active' })
          const result = await runContentQualityFix(id, {
            authorization: request.headers.get('authorization'),
            send,
            autoPublish,
          })
          send({ step: result.published ? 'done' : 'needs_review', status: 'done', ...result })
        } catch (e) {
          send({ step: 'error', status: 'failed', message: e.message })
        }
        controller.close()
      },
    })
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    })
  } catch (error) {
    if (error.message?.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
```

- [ ] **Step 3: Manual smoke (no full publish required)**

With admin token against staging/local:

```bash
curl -N -X POST "$BASE/api/admin/content/e346d80e-b41a-4eca-bf7e-57afaf2e824f/quality-fix" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"auto_publish":false}'
```

Expected: SSE steps; `applied` includes disclosure and/or claim edits; ends `needs_review` or `done` with `ready` reflecting reaudit. Use `auto_publish:false` for first smoke.

- [ ] **Step 4: Commit**

```bash
git add lib/quality-fix-content.js app/api/admin/content/\[id\]/quality-fix/route.js
git commit -m "$(cat <<'EOF'
feat(content): quality-fix SSE endpoint wired to shared agent

EOF
)"
```

---

### Task 7: Content editor Fix & Publish UI

**Files:**
- Modify: `app/admin/content/[id]/page.js`

- [ ] **Step 1: Add state + SSE consumer**

Near existing `publishGate` / `rerunAuditAndRetry`:

```javascript
const [fixingQuality, setFixingQuality] = useState(false);
const [qualityFixReport, setQualityFixReport] = useState(null);

const fixAndPublish = async () => {
  if (!token || !id) return;
  setFixingQuality(true);
  setQualityFixReport(null);
  setError('');
  try {
    await save(); // reuse existing save if dirty
    const res = await fetch(`/api/admin/content/${id}/quality-fix`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_publish: true }),
    });
    if (!res.ok || !res.body) throw new Error('Quality fix failed to start');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let final = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const data = JSON.parse(line.slice(6));
        if (data.step === 'done' || data.step === 'needs_review' || data.step === 'error') final = data;
      }
    }
    setQualityFixReport(final);
    if (final?.published) {
      setPublishGate(null);
      setMsg('Published after quality fix');
      await fetchData(); // existing reload
    } else if (final?.step === 'error') {
      setError(final.message || 'Quality fix failed');
    }
  } catch (e) {
    setError(e.message);
  } finally {
    setFixingQuality(false);
  }
};
```

Adapt to the page's real helper names (`fetchContent`, `load`, etc.).

- [ ] **Step 2: Add button in `publishGate` panel**

Place **before** "Publish anyway (override)", style `bg-emerald-600 hover:bg-emerald-500 text-white`:

```jsx
<button
  type="button"
  onClick={fixAndPublish}
  disabled={publishing || saving || fixingQuality}
  className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
  title="Applies safe automatic fixes, re-runs the audit, and publishes only if hard fails clear."
>
  {fixingQuality ? 'Fixing…' : 'Fix & Publish'}
</button>
```

Render `qualityFixReport.applied` (green) and `qualityFixReport.unfixable` (amber with `operator_action`).

- [ ] **Step 3: Commit**

```bash
git add app/admin/content/\[id\]/page.js
git commit -m "$(cat <<'EOF'
feat(admin): Fix & Publish button on content editor

EOF
)"
```

---

### Task 8: Review adapter + SSE route

**Files:**
- Create: `lib/quality-fix-review.js`
- Create: `app/api/admin/reviews/[id]/quality-fix/route.js`

Mirror Task 6 with review specifics:

- Deterministic: import from `lib/review-remediate.js` (`remediateReview` / disclosure / scrub visuals). For `missing_risk_or_ftc_disclosure`, append the same YMYL disclosure helpers if reviews use `disclaimer` field — inspect polish/publish gate for the exact field names (`disclaimer`, `audit_hard_fail`).
- Hard fails source: prefer `evaluateHardFails`-compatible object if reviews store `ai_audit.hard_fail_checks`; else map `audit_hard_fail` / `audit_hard_fail_reason` into a synthetic fail list plus polish gate errors.
- Publish: `POST /api/admin/reviews/${id}/publish` with `{ action: 'publish' }` only (no override).
- Reaudit: either call polish audit subsection extracted, or POST existing polish is too heavy — prefer running the same auditor prompt path polish uses (read `polish/route.js` audit block) via a small shared helper if one exists; otherwise invoke `callModel` with `qualityAuditorPrompt` and persist `audit_hard_fail` flags the same way polish does.

- [ ] **Step 1: Implement adapter + route** (SSE identical shape to content)

- [ ] **Step 2: Smoke with `auto_publish:false` on a draft review that has `audit_hard_fail=true`**

- [ ] **Step 3: Commit**

```bash
git add lib/quality-fix-review.js app/api/admin/reviews/\[id\]/quality-fix/route.js
git commit -m "$(cat <<'EOF'
feat(reviews): quality-fix SSE endpoint for shared agent

EOF
)"
```

---

### Task 9: Review editor Fix & Publish UI

**Files:**
- Modify: `app/admin/review/[id]/page.js`

- [ ] **Step 1: Mirror content UI** — emerald Fix & Publish on the quality veto / publish-blocked panel (near the existing copy that says publish stays blocked until audit passes). Same SSE consumer pattern against `/api/admin/reviews/${id}/quality-fix`.

- [ ] **Step 2: Commit**

```bash
git add app/admin/review/\[id\]/page.js
git commit -m "$(cat <<'EOF'
feat(admin): Fix & Publish button on review editor

EOF
)"
```

---

### Task 10: Post-generation hooks (`QUALITY_FIX_AUTO`)

**Files:**
- Modify: `app/api/admin/content/fill/route.js`
- Modify: `app/api/admin/reviews/[id]/polish/route.js`

- [ ] **Step 1: Add helper**

```javascript
function qualityFixAutoEnabled() {
  const v = process.env.QUALITY_FIX_AUTO
  if (v === '0' || v === 'false') return false
  return true // default on per spec after smoke; set false in preview if needed
}
```

- [ ] **Step 2: Content fill** — after audit is stamped and hard fails exist, if `qualityFixAutoEnabled()`, `send({ step: 'quality_fix', ... })` and `await runContentQualityFix(contentId, { authorization, send, autoPublish: true })` **once**. Do not recurse if the agent returns remaining fails.

- [ ] **Step 3: Review polish** — after persisting `audit_hard_fail: true`, same one-shot call to `runReviewQualityFix`.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/content/fill/route.js app/api/admin/reviews/\[id\]/polish/route.js
git commit -m "$(cat <<'EOF'
feat(pipeline): auto-run quality fix agent after fill/polish

EOF
)"
```

---

### Task 11: Regression sweep

**Files:** none new

- [ ] **Step 1: Unit suite**

Run: `node --test 'test/quality-fix-*.test.js'`
Expected: all PASS

- [ ] **Step 2: Broader suite**

Run: `npm test`
Expected: PASS (or pre-existing failures documented; no new failures from these files)

- [ ] **Step 3: Integration checklist**

1. Content `e346d80e-b41a-4eca-bf7e-57afaf2e824f`: Fix & Publish → disclosure present; `$2M` / `72-hour` / `{{VERIFY}}` handled; either published or precise unfixable list.
2. A review with dead citation: Fix & Publish drops/replaces verified URL; no override stamp on row.
3. Commodity-only fail: not published.
4. Confirm `ai_audit.quality_fix.cycle === 1` and `published` boolean accurate.
5. Confirm agent never wrote `published_override`.

- [ ] **Step 4: Final commit if any fixups**

```bash
git add -A
git status
# commit only if fixups landed
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|---|---|
| Hybrid surgical + research | 3, 4, 5 |
| Auto-publish on clean hard fails | 5, 6, 8 |
| Content + reviews | 6–9 |
| Post-gen + Fix & Publish | 7, 9, 10 |
| Hard fails only for publish | 5 (ignores score) |
| `gpt-5.4` pin | 1 |
| Never override | 5 test + adapters |
| One cycle | 5, 10 |
| Unfixable commodity | 2, 5 |
| Motivating content row smoke | 6, 11 |
| `QUALITY_FIX_AUTO` | 10 |
| Metadata `ai_audit.quality_fix` | 5, 6, 8 |

No TBD placeholders remain. Rollout order matches spec (content first, then reviews, then hooks).
