# Quality Veto: Fix & Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the publish gate from vetoing blog drafts over review-only and stale audit checks, and give the editor one "Fix & Publish" button that deterministically repairs what it can, re-audits, publishes when clean, and otherwise reports exactly what a human must fix.

**Architecture:** Three layers, in dependency order. (1) Correct the audit inputs so re-audits stop manufacturing false failures. (2) Make the gate reason about audit *freshness* and *applicability* instead of trusting a model-authored `any_hard_fail` boolean. (3) Add a remediation endpoint that applies provable fixes, re-audits, and hands a clean row back to the existing publish path.

**Tech Stack:** Next.js API routes on Vercel, Supabase REST via `supaFetch`, `node --test` for tests, Tailwind for the admin UI.

**Repo:** `crypto-killer` (admin + pipeline). Do **not** touch `cryptokiller` (render/site layer) in this plan.

## Root causes found during investigation

| # | Symptom | Root cause | Layer |
|---|---|---|---|
| 1 | `item_reviewed_typed: false` hard-fails blog drafts | The check is review-only. Blog rows have no `item_reviewed` value and `schema_json` is empty **by design** (the SSR layer builds the `@graph` at render time). The auditor is told "FALSE when 'Thing' or missing", so it always fails. | auditor prompt + gate |
| 2 | `not_for_you_block_present: false` on re-audit | `app/api/admin/content/[id]/audit/route.js` builds `reviewContent` **without** the `not_for_you` column, while `fill/route.js` passes the full `article` (which has it). The auditor JSON-stringifies `reviewContent` wholesale, so a re-audit cannot see the block that exists in the DB. Every re-audit fabricates this hard fail. | audit route |
| 3 | Fixed problems keep blocking publish (e.g. `fabricated_source_or_stat` citing "73%" / "95%" strings no longer in the article) | `ai_audit` carries no content fingerprint, so the gate cannot tell an audit of the *current* text from an audit of text that was since rewritten. | freshness |
| 4 | Only escape hatch is "Publish anyway (override)" | No remediation path: the operator either regenerates the whole article or bypasses the YMYL gate. | remediate |

## Global constraints

- **Never fabricate to satisfy the gate.** Deterministic fixes only add text we already ship elsewhere, or delete/normalize provably-wrong values. If a fix would require inventing a fact, a source, a credential, or a number, it is **unfixable** and must be reported.
- **Unfixable means stop.** The draft stays unpublished and the response lists each remaining issue with the reason it could not be fixed. No auto-override, ever.
- **Fail closed on ambiguity.** Skipping a hard-fail check requires positive evidence that it does not apply (e.g. row has no `item_reviewed`), not merely the absence of data.
- **Legacy audits stay enforced.** Rows whose `ai_audit` predates freshness tracking have no hash; treat them as *unverifiable*, keep enforcing them, and surface "re-audit to confirm" in the UI. Never silently unblock historical rows.
- **One writer of publish logic.** The remediate endpoint does not publish. It returns readiness; the UI then calls the existing `publishAction('publish')` so sync, outbox, and audit-trail behaviour stay in one place.
- No em-dashes in user-facing copy (project convention: colons / hyphens / semicolons).
- Tests: `node --test 'test/**/*.test.js'`.

## File map

| File | Responsibility |
|---|---|
| `lib/audit-freshness.js` | `computeAuditHash(row)`, `stampAudit(audit, row)`, `auditFreshness(row)` |
| `lib/audit-gate.js` | `evaluateHardFails(audit, row)` - recompute `any_hard_fail`, skip inapplicable checks |
| `lib/remediate-content.js` | Deterministic fixes: YMYL disclosure append, classification of remaining fails |
| `lib/ymyl-disclosure.js` | Single source of the risk / not-financial-advice block + detector |
| `app/api/admin/content/[id]/audit/route.js` | Fix `reviewContent` payload; stamp freshness; add `maxDuration` |
| `app/api/admin/content/fill/route.js` | Stamp freshness on the audit it writes |
| `app/api/admin/content/[id]/publish/route.js` | Use `evaluateHardFails` + freshness instead of raw `any_hard_fail` |
| `app/api/admin/content/[id]/remediate/route.js` | New: fix → re-audit → report readiness |
| `app/admin/content/[id]/page.js` | "Fix & Publish" button + remediation report panel |
| `lib/review-prompts.js` | Auditor emits `"n/a"` for review-only checks on non-review content |
| `test/audit-freshness.test.js` | Hash stability, staleness detection, legacy handling |
| `test/audit-gate-hardfails.test.js` | Recomputation + skip rules |
| `test/remediate-content.test.js` | Disclosure append idempotence, unfixable classification |

---

### Task 1: Fix the re-audit payload (highest-value, smallest change)

**Files:**
- Modify: `app/api/admin/content/[id]/audit/route.js`

**Steps:**
- [ ] Add `not_for_you: content.not_for_you || null` to the `reviewContent` object (around line 51, next to `author_bio`). This alone stops every re-audit from fabricating `not_for_you_block_present: false`.
- [ ] Diff `reviewContent` against what `fill/route.js` passes as `article` and add every other gate-relevant column the auditor reads: `claims`, `information_gain_summary`, `sources`, `verify_tags_count`. Any field a `hard_fail_checks` key inspects must be present.
- [ ] Add `export const maxDuration = 300` at the top of the file, matching `fill/route.js`. This route calls audit models with timeouts and currently inherits the platform default, which is a latent timeout bug.

**Verification:**
- [ ] Re-audit content `ea10ebac-2a09-4daf-9421-3b992ea52bb7` and confirm `not_for_you_block_present` is now `true`.
- [ ] Confirm the re-audit `hard_fail_checks` no longer differ from a fresh `fill` audit on the same text except for genuine issues.

---

### Task 2: Audit freshness fingerprint

**Files:**
- Create: `lib/audit-freshness.js`
- Create: `test/audit-freshness.test.js`
- Modify: `app/api/admin/content/[id]/audit/route.js`, `app/api/admin/content/fill/route.js`

**Interfaces:**
- `computeAuditHash(row) -> string` - sha256 hex over a canonical, key-sorted projection of only the fields the auditor reads (`full_article`, `sections`, `faq`, `summary`, `meta_description`, `headline`, `title`, `sources`, `not_for_you`, `internal_links`, `claims`, `item_reviewed`). Reuse the `sha256Hex` pattern already in `lib/sync-shape.js`; do not add a dependency.
- `stampAudit(audit, row) -> audit` - returns the audit object with `audited_at` (ISO) and `content_hash` added. Non-mutating.
- `auditFreshness(row) -> { state: 'fresh' | 'stale' | 'unverifiable', audited_at, expected_hash, actual_hash }` - `unverifiable` when `content_hash` is absent (legacy row).

**Steps:**
- [ ] Write the tests first: identical content yields identical hashes; reordering object keys does not change the hash; editing `full_article` changes it; editing an unaudited column (e.g. `hero_image_url`) does **not**; missing `content_hash` yields `unverifiable`.
- [ ] Implement `lib/audit-freshness.js`.
- [ ] Wrap both audit write sites in `stampAudit(...)` before the `PATCH`: the `ai_audit: audit` write in `fill/route.js` and the equivalent in the audit route. Keep the existing `reaudited_at` field as-is; `audited_at` is the machine-checked one.

**Verification:**
- [ ] `node --test test/audit-freshness.test.js` passes.
- [ ] Re-audit a row, then edit one word of `full_article` and confirm `auditFreshness` flips to `stale`.

---

### Task 3: Gate reasons over recomputed hard fails

**Files:**
- Create: `lib/audit-gate.js`
- Create: `test/audit-gate-hardfails.test.js`
- Modify: `app/api/admin/content/[id]/publish/route.js`

**Interfaces:**
- `evaluateHardFails(audit, row) -> { failed: Array<{ key, reason }>, skipped: Array<{ key, why }>, any_hard_fail: boolean }`

**Rules:**
- Recompute `any_hard_fail` from the individual keys. Do **not** trust the model's own `any_hard_fail` boolean; it is the flag that currently propagates false positives.
- Treat `"n/a"` (case-insensitive) on any check as skipped, not failed.
- Skip `item_reviewed_typed` when the row has no `item_reviewed` value. Record the skip with `why: 'row has no item_reviewed (non-review content)'`.
- A check whose value is a prompt-description string rather than a real value (the auditor sometimes echoes the schema text) is **not** a pass. Treat unparseable values as skipped-with-warning and surface them, so a malformed audit cannot silently green-light a YMYL page.

**Steps:**
- [ ] Write tests covering: real hard fail still blocks; `item_reviewed_typed: false` on a row with no `item_reviewed` is skipped; `item_reviewed_typed: false` on a row **with** a `Thing`-typed `item_reviewed` still blocks; `"n/a"` is skipped; a model-set `any_hard_fail: true` with zero failing keys does not block.
- [ ] Implement `lib/audit-gate.js`.
- [ ] In `publish/route.js`, replace the `verdict.hard_fail_checks?.any_hard_fail === true` branch (around lines 154-185) with `evaluateHardFails`. Push one reason per failed key so the operator sees a checklist, not one run-on sentence.
- [ ] Add a freshness branch: when `auditFreshness(row).state === 'stale'`, do not emit the audit's hard-fail reasons as-is. Emit a single reason: "quality audit is stale (content changed after it ran); re-audit before publishing", and mark the payload `stale: true` so the UI can offer re-audit rather than override.
- [ ] When state is `unverifiable`, keep enforcing the audit but add `audit_unverifiable: true` to the 422 payload.

**Verification:**
- [ ] `node --test test/audit-gate-hardfails.test.js` passes.
- [ ] Attempt publish on `ea10ebac-...`; confirm `item_reviewed_typed` no longer appears in the blocked reasons and the remaining reasons are the genuine ones.

---

### Task 4: Auditor stops asserting review-only checks on non-review content

**Files:**
- Modify: `lib/review-prompts.js`

**Steps:**
- [ ] In the `SCHEMA / ITEM_REVIEWED` instruction block (around lines 672-687), add: when the REVIEW CONTENT JSON has no `item_reviewed` object, emit `item_reviewed_typed: "n/a"` and do not count it toward `any_hard_fail`. Blog and informational pages legitimately have no reviewed item, and the JSON-LD `@graph` is assembled at render time, so an empty `schema_json` is expected and is not evidence of a missing entity.
- [ ] Update the `item_reviewed_typed` value description (line 41) and the `any_hard_fail` description (line 48) so the two agree with each other and with `lib/audit-gate.js`.

**Verification:**
- [ ] Re-audit a blog row and confirm `item_reviewed_typed` comes back `"n/a"`.
- [ ] Re-audit a `brand_review` row and confirm it still returns a real boolean.

> Task 3 is the enforcement boundary and Task 4 is defence in depth. The gate must stay correct even if the model ignores the instruction, which is why both exist.

---

### Task 5: Deterministic remediation library

**Files:**
- Create: `lib/ymyl-disclosure.js`
- Create: `lib/remediate-content.js`
- Create: `test/remediate-content.test.js`

**Interfaces:**
- `hasRiskDisclosure(html) -> boolean`
- `DISCLOSURE_HTML` - the standard block, lifted from the existing rendered disclosure in the site layer (`app/review/[slug]/page.js` around lines 685-689: "This analysis is for informational purposes only and should not be considered financial advice."). Same wording, so the page does not gain a second, differently-worded disclaimer.
- `remediateContent(row, hardFails) -> { patch, applied: Array<{ key, what }>, unfixable: Array<{ key, reason, operator_action }> }`

**Fix table:**

| Hard fail | Treatment |
|---|---|
| `missing_risk_or_ftc_disclosure` | **Deterministic.** Append `DISCLOSURE_HTML` to `full_article` if `hasRiskDisclosure` is false. Idempotent. |
| `not_for_you_block_present: false` **and** row has `not_for_you` | **No-op.** Task 1 fixed the input; re-audit clears it. |
| `not_for_you_block_present: false` **and** row has no `not_for_you` | **Unfixable.** Writing a "Not For You" block is editorial judgement. Report with `operator_action: 'run Generate Article or write the not_for_you block'`. |
| `fabricated_source_or_stat`, `fake_or_unmarked_freshness`, `fabricated_reviews_or_testimonials`, `commodity_no_information_gain`, `unverified_claims_in_article > 0` | **Unfixable by machine.** Each names text that must be removed or sourced by a human. Report the auditor's own reason verbatim. |
| Numeric contradictions (e.g. chargeback window 120 vs 180 days) | **Unfixable.** Both values appear in the article and the source ledger does not settle which is correct; picking one would be a guess on a YMYL page. Report both values and where they appear. |
| `overall_score < 60` | **Unfixable.** Report the auditor's `critical_fixes`. |

**Steps:**
- [ ] Write tests first: appending the disclosure twice yields one block; a row that already has the disclosure gets an empty patch; every unfixable key produces an entry with a non-empty `operator_action`; `remediateContent` never returns a patch that adds a number, a source, or a credential.
- [ ] Implement both modules. Mirror the structure of `lib/review-remediate.js` (pure functions, explicit `changes` list, no I/O).

**Verification:**
- [ ] `node --test test/remediate-content.test.js` passes.
- [ ] Manually assert the disclosure wording matches the site layer character-for-character.

---

### Task 6: Remediate endpoint

**Files:**
- Create: `app/api/admin/content/[id]/remediate/route.js`

**Contract:** `POST /api/admin/content/[id]/remediate`, Bearer `ADMIN_SECRET` via `verifyAdmin`, `export const maxDuration = 300`.

**Flow:**
1. Load the row.
2. `evaluateHardFails` on the current audit to get the failing keys.
3. `remediateContent(row, failed)` - if `patch` is non-empty, `PATCH` the row.
4. **Always re-audit** by calling the same audit logic as `app/api/admin/content/[id]/audit/route.js`. This is what clears stale and input-bug failures, so it runs even when no patch was applied. Extract the audit body into a shared function rather than HTTP-calling our own route.
5. Re-evaluate. If `any_hard_fail` is false and `overall_score >= 60`, respond `{ ok: true, ready: true, applied, audit_summary }`.
6. Otherwise respond `422 { ok: false, ready: false, applied, unfixable, reasons }`. The row stays a draft.

**Steps:**
- [ ] Extract the audit execution from the audit route into a reusable helper (e.g. `lib/run-content-audit.js`) so both routes share one code path and one `reviewContent` shape. This prevents Task 1's fix from drifting out of sync again.
- [ ] Implement the route.
- [ ] Record remediation metadata on the row: `ai_audit.remediation = { at, applied, unfixable, cycles: 1 }`. One cycle only; do not loop.

**Verification:**
- [ ] `curl` the endpoint against `ea10ebac-...` and confirm the response either reports `ready: true` or lists genuine unfixable issues with operator actions.
- [ ] Confirm the row is still `draft` after a 422.

---

### Task 7: "Fix & Publish" button

**Files:**
- Modify: `app/admin/content/[id]/page.js`

**Steps:**
- [ ] Add `remediateAndPublish()`: `save()` → `POST .../remediate` → on `ready: true`, call the existing `publishAction('publish')` (no override) → on 422, render the remediation report. Reuse the `publishing`/`saving` disabled pattern and the `rerunAuditAndRetry` shape already in this file.
- [ ] Add the button to the existing `publishGate` panel (around lines 1070-1084), before "Publish anyway (override)", styled `bg-emerald-600 hover:bg-emerald-500`. Label: "Fix & Publish". Title: "Applies safe automatic fixes, re-runs the audit, and publishes only if the gate clears."
- [ ] Render the report: a green list of what was fixed and an amber list of what a human must do, each with its `operator_action`. Keep "Publish anyway (override)" available but visually subordinate.
- [ ] When the 422 payload carries `stale: true`, surface "the audit was stale; it has been re-run" so the operator understands why the reasons changed.

**Verification:**
- [ ] Load `/admin/content/ea10ebac-2a09-4daf-9421-3b992ea52bb7`, click Publish to trigger the gate, then click Fix & Publish.
- [ ] Confirm one click ends in either a published article or a specific, actionable report - never a silent override.

---

### Task 8: Regression sweep

**Steps:**
- [ ] `node --test 'test/**/*.test.js'` - full suite green, including the pre-existing `test/review-schema-itemreviewed.test.js`.
- [ ] `node scripts/methodology-check.mjs`.
- [ ] Publish a `brand_review` row end to end and confirm the review-only checks are still enforced for it. The whole point of Task 3's skip rule is that it must not weaken review pages.
- [ ] Confirm a deliberately fabricated stat still blocks publish after Fix & Publish.
