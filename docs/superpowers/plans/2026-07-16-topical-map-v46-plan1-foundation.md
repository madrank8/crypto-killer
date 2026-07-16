# Topical Map v4.6 Port — Plan 1: Foundation (test harness + methodology vendoring + drift check)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the repo's first test harness and vendor the topical-map-creation v4.6 methodology into the repo with a machine-checkable drift guard, so later plans can port the pipeline under TDD against a version-pinned methodology.

**Architecture:** Use Node 20's built-in `node:test` runner (zero new dependencies, runs on Vercel's Node 20). Copy the canonical skill from `~/.claude/skills/topical-map-creation/` into `lib/topical-map/methodology/` with a `VERSION` file and a `manifest.json` of SHA-256 hashes. A pure `computeManifest()` function plus a sync script (writes the manifest) and a check script (compares against source when source is present, no-op in CI) make drift a visible diff instead of silent divergence.

**Tech Stack:** Node.js 20 (`node:test`, `node:crypto`, `node:fs`), CommonJS (matches `lib/`), plain SQL migrations applied via Supabase.

## Global Constraints

- **Source of truth:** `~/.claude/skills/topical-map-creation/SKILL.md` and its `references/`. Methodology version is **4.6** / 31-step. The Obsidian wiki page (23-step) and plugin listing (v4.3) are STALE — never use them.
- **No new runtime dependencies.** `package.json` deliberately holds only next/react/tiptap. The test runner and scripts use only Node built-ins.
- **`lib/` is CommonJS** (`require`/`module.exports`). Match it. Do not introduce ESM into `lib/`.
- **No em-dashes** are NOT a rule in this repo (that rule is the sister `cryptokiller` repo). Normal punctuation is fine here.
- **Migrations** live in `db-migrations/`, are idempotent (`ADD COLUMN IF NOT EXISTS`), numbered; next free number is **018** (017 is taken). No migration in THIS plan.
- Vendored methodology files are **data, not code**: never `require()` them; read them as text at runtime in later plans.

---

## File Structure

- `package.json` — add `"test"`, `"methodology:sync"`, `"methodology:check"` scripts (modify).
- `lib/topical-map/methodology/` — vendored skill (new dir): `SKILL.md`, `references/*.md`, `VERSION`, `manifest.json`.
- `lib/topical-map/methodology-manifest.js` — pure `computeManifest(dir)` + `diffManifests(a, b)` (new, CommonJS).
- `scripts/methodology-sync.mjs` — copy from `~/.claude/skills/...` into the vendored dir, rewrite `VERSION` + `manifest.json` (new).
- `scripts/methodology-check.mjs` — recompute manifest of the vendored dir; if source is present, diff against it; fail on drift (new).
- `test/topical-map/methodology-manifest.test.js` — tests for the pure functions (new).
- `test/smoke.test.js` — proves the runner works (new, deleted at end of Task 1's not-needed... keep it; it's a cheap guard).

---

### Task 1: Test harness (node:test) with a passing smoke test

**Files:**
- Modify: `package.json` (scripts)
- Create: `test/smoke.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` runs every `test/**/*.test.js` via `node --test`. Later tasks add files under `test/`.

- [ ] **Step 1: Write the failing test**

Create `test/smoke.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')

test('test harness runs', () => {
  assert.equal(1 + 1, 2)
})
```

- [ ] **Step 2: Run it and verify it fails (no script yet)**

Run: `npm test`
Expected: FAIL — `npm error Missing script: "test"`. (This proves the script is genuinely absent before we add it.)

- [ ] **Step 3: Add the test script**

In `package.json` `"scripts"`, add (keep existing dev/build/start/lint):

```json
"test": "node --test test/",
"test:watch": "node --test --watch test/"
```

- [ ] **Step 4: Run and verify it passes**

Run: `npm test`
Expected: PASS — output contains `# pass 1` and `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add package.json test/smoke.test.js
git commit -m "test: add node:test harness (first tests in repo)"
```

---

### Task 2: Manifest functions (pure, TDD)

**Files:**
- Create: `lib/topical-map/methodology-manifest.js`
- Create: `test/topical-map/methodology-manifest.test.js`

**Interfaces:**
- Consumes: nothing (Node built-ins only).
- Produces:
  - `computeManifest(dir) -> { [relativePath]: sha256hex }` — SHA-256 of every file under `dir` recursively, keys are POSIX relative paths sorted, EXCLUDING `manifest.json` and `VERSION` themselves.
  - `diffManifests(expected, actual) -> { added: string[], removed: string[], changed: string[] }` — pure set/hash comparison.
  Both are `module.exports`. Scripts in Tasks 4-5 consume these.

- [ ] **Step 1: Write the failing tests**

Create `test/topical-map/methodology-manifest.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { computeManifest, diffManifests } = require('../../lib/topical-map/methodology-manifest')

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'meth-'))
}

test('computeManifest hashes files by posix relative path, sorted, excluding VERSION/manifest.json', () => {
  const d = tmpdir()
  fs.writeFileSync(path.join(d, 'SKILL.md'), 'hello')
  fs.mkdirSync(path.join(d, 'references'))
  fs.writeFileSync(path.join(d, 'references', 'a.md'), 'world')
  fs.writeFileSync(path.join(d, 'VERSION'), '4.6')
  fs.writeFileSync(path.join(d, 'manifest.json'), '{}')

  const m = computeManifest(d)
  assert.deepEqual(Object.keys(m), ['SKILL.md', 'references/a.md'])
  // sha256('hello')
  assert.equal(m['SKILL.md'], '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
})

test('computeManifest is stable regardless of file creation order', () => {
  const d1 = tmpdir(); const d2 = tmpdir()
  fs.writeFileSync(path.join(d1, 'b.md'), 'x'); fs.writeFileSync(path.join(d1, 'a.md'), 'y')
  fs.writeFileSync(path.join(d2, 'a.md'), 'y'); fs.writeFileSync(path.join(d2, 'b.md'), 'x')
  assert.deepEqual(computeManifest(d1), computeManifest(d2))
})

test('diffManifests reports added, removed, changed', () => {
  const expected = { 'a.md': 'h1', 'b.md': 'h2' }
  const actual = { 'a.md': 'h1', 'b.md': 'DIFFERENT', 'c.md': 'h3' }
  assert.deepEqual(diffManifests(expected, actual), {
    added: ['c.md'],
    removed: [],
    changed: ['b.md'],
  })
})

test('diffManifests on identical manifests is empty', () => {
  const m = { 'a.md': 'h1' }
  assert.deepEqual(diffManifests(m, { ...m }), { added: [], removed: [], changed: [] })
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../../lib/topical-map/methodology-manifest'`.

- [ ] **Step 3: Implement the module**

Create `lib/topical-map/methodology-manifest.js`:

```js
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const EXCLUDE = new Set(['VERSION', 'manifest.json'])

function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name)
    const rel = path.posix.join(base, name)
    const stat = fs.statSync(abs)
    if (stat.isDirectory()) {
      walk(abs, rel, out)
    } else if (!EXCLUDE.has(rel)) {
      out.push([rel, crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex')])
    }
  }
}

function computeManifest(dir) {
  const entries = []
  walk(dir, '', entries)
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return Object.fromEntries(entries)
}

function diffManifests(expected, actual) {
  const eKeys = new Set(Object.keys(expected))
  const aKeys = new Set(Object.keys(actual))
  const added = [...aKeys].filter((k) => !eKeys.has(k)).sort()
  const removed = [...eKeys].filter((k) => !aKeys.has(k)).sort()
  const changed = [...eKeys].filter((k) => aKeys.has(k) && expected[k] !== actual[k]).sort()
  return { added, removed, changed }
}

module.exports = { computeManifest, diffManifests }
```

- [ ] **Step 4: Run and verify it passes**

Run: `npm test`
Expected: PASS — `# pass 5` (smoke + 4 manifest tests), `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/topical-map/methodology-manifest.js test/topical-map/methodology-manifest.test.js
git commit -m "feat(topical-map): manifest hash + diff helpers for methodology drift check"
```

---

### Task 3: Sync script — vendor the v4.6 methodology into the repo

**Files:**
- Create: `scripts/methodology-sync.mjs`
- Create (generated): `lib/topical-map/methodology/**`, `.../VERSION`, `.../manifest.json`
- Modify: `package.json` (script)

**Interfaces:**
- Consumes: `computeManifest` from Task 2 (via dynamic import of the CJS module).
- Produces: a populated `lib/topical-map/methodology/` directory + `VERSION` (`4.6`) + `manifest.json`. Task 4 (check) and later plans read these.

- [ ] **Step 1: Write the sync script**

Create `scripts/methodology-sync.mjs`:

```js
// Vendors the topical-map-creation skill into the repo. Run on a workstation
// that has ~/.claude/skills/topical-map-creation. Not run in CI.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { computeManifest } = require('../lib/topical-map/methodology-manifest.js')

const SRC = path.join(os.homedir(), '.claude', 'skills', 'topical-map-creation')
const DEST = path.join(process.cwd(), 'lib', 'topical-map', 'methodology')

// Only the files the Tool-Assisted / Tier 1-3 port needs (see spec section 4).
const FILES = [
  'SKILL.md',
  'references/step-overview.md',
  'references/procedure-detailed.md',
  'references/procedure-addendum.md',
  'references/site-type-playbooks.md',
  'references/aio-risk-score.md',
  'references/dataforseo.md',
  'references/supplementary.md',
  'references/author-cluster-assignment.md',
]
const VERSION = '4.6'

if (!fs.existsSync(SRC)) {
  console.error(`Source skill not found at ${SRC}. Run this on a workstation with the skill installed.`)
  process.exit(1)
}

fs.rmSync(DEST, { recursive: true, force: true })
for (const rel of FILES) {
  const from = path.join(SRC, rel)
  const to = path.join(DEST, rel)
  if (!fs.existsSync(from)) {
    console.error(`Expected methodology file missing in source: ${rel}`)
    process.exit(1)
  }
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
}

fs.writeFileSync(path.join(DEST, 'VERSION'), VERSION + '\n')
const manifest = computeManifest(DEST)
fs.writeFileSync(path.join(DEST, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

console.log(`Vendored ${FILES.length} files at methodology v${VERSION}. Manifest has ${Object.keys(manifest).length} entries.`)
```

- [ ] **Step 2: Add the script to package.json**

In `"scripts"`:

```json
"methodology:sync": "node scripts/methodology-sync.mjs"
```

- [ ] **Step 3: Run the sync**

Run: `npm run methodology:sync`
Expected: `Vendored 9 files at methodology v4.6. Manifest has 9 entries.`

- [ ] **Step 4: Verify the vendored tree**

Run: `cat lib/topical-map/methodology/VERSION && ls lib/topical-map/methodology/references/ | wc -l`
Expected: `4.6` then `8`.

- [ ] **Step 5: Commit (vendored files included)**

```bash
git add scripts/methodology-sync.mjs package.json lib/topical-map/methodology/
git commit -m "feat(topical-map): vendor topical-map-creation v4.6 methodology into repo"
```

---

### Task 4: Drift-check script (fails on divergence, no-op without source)

**Files:**
- Create: `scripts/methodology-check.mjs`
- Modify: `package.json` (script)
- Create: `test/topical-map/methodology-vendored.test.js`

**Interfaces:**
- Consumes: `computeManifest`, `diffManifests` (Task 2); the vendored `manifest.json` + `VERSION` (Task 3).
- Produces: `npm run methodology:check` — exit 0 when the vendored tree matches its own manifest AND (if source present) the source; exit 1 on drift. A test asserts the vendored tree matches its committed manifest.

- [ ] **Step 1: Write the failing test**

Create `test/topical-map/methodology-vendored.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { computeManifest, diffManifests } = require('../../lib/topical-map/methodology-manifest')

const DIR = path.join(__dirname, '..', '..', 'lib', 'topical-map', 'methodology')

test('vendored methodology matches its committed manifest', () => {
  const committed = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'))
  const actual = computeManifest(DIR)
  assert.deepEqual(diffManifests(committed, actual), { added: [], removed: [], changed: [] })
})

test('vendored VERSION is 4.6', () => {
  assert.equal(fs.readFileSync(path.join(DIR, 'VERSION'), 'utf8').trim(), '4.6')
})
```

- [ ] **Step 2: Run and verify it passes** (Task 3 already produced the tree, so this test passes immediately — it is the regression guard, not red-first)

Run: `npm test`
Expected: PASS — now `# pass 7`.

- [ ] **Step 3: Write the check script**

Create `scripts/methodology-check.mjs`:

```js
// Verifies the vendored methodology has not drifted. Two checks:
//   1. Vendored tree matches its own committed manifest.json (always).
//   2. If the source skill is present, vendored tree matches source (dev only).
// Exit 1 on any drift. In CI (~/.claude absent) only check 1 runs.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { computeManifest, diffManifests } = require('../lib/topical-map/methodology-manifest.js')

const DEST = path.join(process.cwd(), 'lib', 'topical-map', 'methodology')
const committed = JSON.parse(fs.readFileSync(path.join(DEST, 'manifest.json'), 'utf8'))
const actual = computeManifest(DEST)
const selfDiff = diffManifests(committed, actual)
if (selfDiff.added.length || selfDiff.removed.length || selfDiff.changed.length) {
  console.error('Vendored methodology does not match manifest.json:', JSON.stringify(selfDiff, null, 2))
  process.exit(1)
}

const SRC = path.join(os.homedir(), '.claude', 'skills', 'topical-map-creation')
if (!fs.existsSync(SRC)) {
  console.log('Source skill not present (CI or non-dev machine); manifest self-check passed.')
  process.exit(0)
}

const srcManifest = {}
for (const rel of Object.keys(committed)) {
  const from = path.join(SRC, rel)
  if (!fs.existsSync(from)) { srcManifest[rel] = '__MISSING_IN_SOURCE__'; continue }
  const crypto = await import('node:crypto')
  srcManifest[rel] = crypto.createHash('sha256').update(fs.readFileSync(from)).digest('hex')
}
const srcDiff = diffManifests(committed, srcManifest)
if (srcDiff.changed.length || srcDiff.removed.length) {
  console.error('Vendored methodology has DRIFTED from the source skill. Re-run `npm run methodology:sync` and review:', JSON.stringify(srcDiff, null, 2))
  process.exit(1)
}
console.log('Vendored methodology matches source skill.')
```

- [ ] **Step 4: Add the script and run it**

In `"scripts"`:

```json
"methodology:check": "node scripts/methodology-check.mjs"
```

Run: `npm run methodology:check`
Expected: `Vendored methodology matches source skill.` (on your workstation), exit 0.

- [ ] **Step 5: Prove the drift guard actually catches drift**

Run:

```bash
printf '\nDRIFT\n' >> lib/topical-map/methodology/SKILL.md
npm run methodology:check; echo "exit=$?"
git checkout lib/topical-map/methodology/SKILL.md
```

Expected: prints `does not match manifest.json` with `SKILL.md` in `changed`, then `exit=1`. The `git checkout` restores the file.

- [ ] **Step 6: Commit**

```bash
git add scripts/methodology-check.mjs package.json test/topical-map/methodology-vendored.test.js
git commit -m "feat(topical-map): methodology drift-check script + vendored-tree regression test"
```

---

### Task 5: CI wiring note + README pointer

**Files:**
- Modify: `package.json` (a `pretest`-style chain is NOT added; see below)
- Create: `lib/topical-map/methodology/README.md`

**Interfaces:**
- Consumes: the scripts from Tasks 3-4.
- Produces: documentation so a future maintainer knows the sync/check ritual. No behavior change.

- [ ] **Step 1: Write the vendored-dir README**

Create `lib/topical-map/methodology/README.md`:

```markdown
# Vendored methodology (topical-map-creation)

These files are a **read-only copy** of `~/.claude/skills/topical-map-creation`,
pinned at the version in `VERSION`. They are DATA, not code: never `require()`
them. The pipeline reads them as text at runtime.

## Why vendored
The canonical skill lives on a workstation and is not deployable to Vercel.
This copy makes the methodology available at runtime and makes drift visible.

## Updating to a new skill version
1. `npm run methodology:sync`   # re-copies + rewrites VERSION and manifest.json
2. Review the diff (this is a deliberate methodology change).
3. Update `scripts/methodology-sync.mjs` VERSION const if the version changed.
4. `npm run methodology:check`  # must pass
5. Commit.

## Guardrail
`npm run methodology:check` fails if the vendored tree does not match its
manifest, or (on a dev machine) if it has drifted from the source skill.
```

- [ ] **Step 2: Add the check to the test script chain**

In `package.json`, change `"test"` so the manifest self-check runs with the suite (the check is safe in CI — it no-ops without source):

```json
"test": "node scripts/methodology-check.mjs && node --test test/"
```

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: methodology check line, then `# pass 7`, `# fail 0`.

- [ ] **Step 4: Commit**

```bash
git add package.json lib/topical-map/methodology/README.md
git commit -m "docs(topical-map): vendored methodology README + wire drift check into npm test"
```

---

## Self-Review

**Spec coverage (this plan is spec section 4 vendoring + section 9 harness only):**
- Spec section 4 "Vendoring" (copy files, VERSION, sync script, drift check, hash manifest) -> Tasks 2-5. COVERED.
- Spec section 9 "minimal test harness first" -> Task 1. COVERED.
- Spec section 9 lists provenance/RPP/cannibalization/stage-order tests as targets — those belong to later plans (they test code that does not exist yet). NOT in scope here; correct.
- Spec sections 5, 6, 7 (stages, provenance data, data model) -> later plans. Explicitly out of this plan.

**Placeholder scan:** No TBD/TODO/"handle errors"/"similar to". Every code step has complete code. PASS.

**Type consistency:** `computeManifest(dir)` and `diffManifests(expected, actual)` are used with identical signatures in Tasks 2, 3, 4. The `{ added, removed, changed }` shape is consistent across the test (Task 2), the check script (Task 4), and its assertions. `manifest.json` / `VERSION` exclusion is defined in Task 2 and relied on in Tasks 3-4. PASS.

**One risk to flag to the reviewer:** the sha256 literal for `'hello'` in Task 2 Step 1 is hardcoded (`2cf24dba...`). If a subagent cannot reproduce it, it is the real SHA-256 of the 5 bytes `hello`; verify with `printf hello | shasum -a 256`.
