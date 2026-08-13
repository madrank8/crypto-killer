# Design: Quality Fix Agent (content + reviews)

**Date:** 2026-08-13
**Status:** approved (brainstorming complete; ready for writing-plans)
**Repo:** `crypto-killer` (Vercel admin + pipeline)
**Motivating row:** content `e346d80e-b41a-4eca-bf7e-57afaf2e824f`
(`crypto-scam-checker`) — blocked by unverified claims, missing YMYL
disclosure, and a ledger claim without a body link
**Related:** `docs/superpowers/plans/2026-08-02-quality-veto-fix-and-publish.md`,
`lib/remediate-content.js`, `lib/review-remediate.js`, `lib/audit-gate.js`,
`lib/run-quality-audit.js`, `app/api/admin/reviews/[id]/auto-fix/route.js`

---

## 1. Problem

Publish is blocked by the quality gate, but the operator's recovery paths are
blunt:

1. **Regenerate the whole article** — expensive, loses editorial edits.
2. **Re-run Audit** — only helps when the verdict is stale or incomplete.
3. **Publish anyway (override)** — disables every check at once; wrong for YMYL.
4. **Deterministic remediation** — exists for content disclosure only
   (`lib/remediate-content.js`); never wired as a content UI button; does not
   call a model; cannot add missing sources or rewrite unverified claims.
5. **Review auto-fix** — citation URL / visual-placeholder scrub only; not
   a general quality-gate agent.

The motivating draft fails on real issues (`unverified_claims_in_article: 2`,
`missing_risk_or_ftc_disclosure: true`, `source_ledger_claims_without_links: 1`),
not false positives. We need an agent that surgically adds missing data and
clears fixable hard fails for **both** topical `content` and brand `reviews`,
then auto-publishes when the gate is clean.

---

## 2. Decisions (brainstorming)

| Question | Decision |
|---|---|
| Autonomy when a claim is unverified | **Hybrid (C):** surgical rewrite/remove by default; escalate to research + cite only for load-bearing claims with HEAD-verified URLs |
| After a clean re-audit | **Auto-publish (B)** via existing publish routes (never override) |
| Scope | **Content + reviews** (shared agent, thin adapters) |
| When it runs | **Both (C):** post-generation hook (content fill / review polish) **and** manual **Fix & Publish** |
| Score floor for auto-publish | **Hard fails only (C)** — score remains a warning; does not block auto-publish |
| Model | **OpenAI flagship pin (A):** add `gpt-5.4` to `callModel`; Gemini used only for research grounding when Hybrid escalates |
| Architecture | **Approach 1:** one shared Quality Fix Agent + content/review adapters |

### Rejected alternatives

- **Surgical-only** — cannot recover load-bearing claims that need real sources.
- **Research-everything** — too costly; risk of bad citations on soft claims.
- **Stop-at-ready (no auto-publish)** — rejected; operator wants clean runs to ship.
- **Parallel content vs review agents** — immediate drift; rejected.
- **Full regenerate-on-fail** — loses edits; not surgical; rejected.
- **Agent calling publish override** — never; YMYL fail-closed.

---

## 3. Goals / non-goals

### Goals

1. One shared orchestrator that classifies gate failures, applies fixes, re-audits,
   and auto-publishes when hard fails are clear.
2. Cover **content** and **reviews** with the same tactic map and safety rules.
3. Run automatically once after generation when hard fails remain, and on demand
   via **Fix & Publish**.
4. Prefer deterministic fixes, then surgical OpenAI patches, then researched
   citations — never invent numbers, URLs, testimonials, or credentials.
5. Surface precise `unfixable` operator actions when the agent cannot clear
   a fail (e.g. commodity / no information gain).

### Non-goals

- Removing the human override button (keep it; visually subordinate).
- Bulk cron / regen-queue integration in v1.
- Agent-chat tool exposure in v1.
- Lowering or disabling hard-fail checks.
- Multi-cycle loops or regenerate storms (hard cap: **one** agent cycle per
  invocation / per generation).

---

## 4. Architecture

### Shared core

| Module | Responsibility |
|---|---|
| `lib/quality-fix-agent.js` | Orchestrator: classify → fix → re-audit → publish decision |
| `lib/quality-fix-classify.js` | Map hard-fail keys / gate reasons → tactic |
| `lib/ai-models.js` | Add `gpt-5.4` OpenAI flagship pin |
| Existing remediator / audit / verify libs | Reused, not rewritten |

### Thin adapters

| Module | Responsibility |
|---|---|
| `lib/quality-fix-content.js` | Load/patch `content` row; content audit; content publish |
| `lib/quality-fix-review.js` | Load/patch `reviews` row; review audit path; review publish |

### API

| Route | Contract |
|---|---|
| `POST /api/admin/content/[id]/quality-fix` | SSE, Bearer admin, `maxDuration=300` |
| `POST /api/admin/reviews/[id]/quality-fix` | Same contract |

Optional body: `{ "auto_publish": true }` (default **true**).

### UI

- Content editor (`app/admin/content/[id]/page.js`) and review editor
  (`app/admin/review/[id]/page.js`): emerald **Fix & Publish** on the publish-gate
  panel, before override.
- Live SSE step progress + applied / unfixable report.

### Pipeline hooks

- Content `fill`: after audit, if hard fails remain → one agent cycle as SSE
  stage `quality_fix` with `auto_publish: true`.
- Review `polish`: after audit/VETO persist, if hard fails remain → same.
- Cap: one cycle; if still failing → hand to operator (`needs_review` / report).

### Out of scope for v1

Cron bulk queue, agent chat tools, automatic override, second agent loops.

---

## 5. Data flow & tactics

```
gate reasons / hard_fail_checks
        │
        ▼
   classify each fail
        │
   ┌────┼──────────────┬──────────────┬────────────┐
   ▼    ▼              ▼              ▼            ▼
 det  surgical      research      unfixable    skip
   │    │              │              │
   └────┴──────┬───────┘              │
               ▼                      ▼
         apply patches          report + stop
               │                 (no publish)
               ▼
          re-audit (fresh hash)
               │
        hard fails == 0?
          │         │
         yes        no
          ▼         ▼
    auto-publish   return report
    via existing   (ready:false)
    publish route
```

### Tactic map (Hybrid)

| Fail key / reason class | Tactic |
|---|---|
| `missing_risk_or_ftc_disclosure` | Deterministic disclosure append |
| skeleton / taxonomy / short section / placeholder links / author stutter / anti-slop lint | Surgical GPT-5.4 rewrite of only offending spans |
| visual `[TYPE NEEDED]` / placeholder-box | Deterministic scrub (reuse review auto-fix scrub) |
| dead sources / blocked citation URLs | Drop dead + optional research replacements (HEAD-verify) |
| `unverified_claims_in_article`, unresolved `{{VERIFY}}` | Surgical remove/soften unless load-bearing → research + cite |
| `source_ledger_claims_without_links` | Surgical: insert links from existing ledger URLs only |
| `fabricated_source_or_stat` / `fabricated_reviews_or_testimonials` | Surgical remove/rewrite; never invent replacements |
| `commodity_no_information_gain` | Unfixable (needs first-party evidence) |
| score below 60/80 | Warning only — does not block auto-publish |

### Load-bearing rule

A claim is load-bearing if removing it would gut a section's thesis. The agent
judges; when unsure, default to surgical remove (fail closed on fabrication).

### Safety rules

1. Never invent URLs, numbers, testimonials, or credentials.
2. Researched URLs must pass `verifySourceLedger` / HEAD checks before ledger insert.
3. Failed research → fall back to surgical remove of the claim.
4. Agent never calls publish with `override: true`.
5. One cycle only (`cycle: 1`); no retry loops inside a single invocation.
6. Model/timeout errors → `needs_review` with error message; never half-publish.

---

## 6. API / SSE contract

**Steps:** `init` → `classify` → `deterministic` → `surgical` (if needed) →
`research` (if escalated) → `apply` → `reaudit` → `publish` (if clean +
auto_publish) → `done` | `needs_review`

**Final event:**

```json
{
  "ok": true,
  "ready": true,
  "published": true,
  "applied": [{ "key": "...", "tactic": "...", "what": "..." }],
  "unfixable": [{ "key": "...", "reason": "...", "operator_action": "..." }],
  "audit_summary": { "overall_score": 72, "hard_fails": [] },
  "reasons": []
}
```

- `published: true` only when the existing publish route returns 200.
- Remaining hard fails → `ready: false`, `published: false`, status stays draft
  (content) or parks for human review (reviews).

**Row metadata:** stamp

```json
{
  "ai_audit": {
    "quality_fix": {
      "at": "ISO-8601",
      "model": "gpt-5.4",
      "applied": [],
      "unfixable": [],
      "published": false,
      "cycle": 1
    }
  }
}
```

---

## 7. Testing & rollout

### Unit (`node --test`)

- Classifier: each hard-fail key → expected tactic; unknown key → unfixable.
- Surgical applicator: only touches allowed fields; fixtures assert no invented
  URLs/numbers.
- Research gate: dead URL rejected; verified URL accepted into ledger.
- Orchestrator dry-run: mock model → applied / unfixable / ready / published.

### Integration

1. Content `e346d80e-…`: Fix & Publish clears disclosure + VERIFY/$2M/72h path,
   re-audits, publishes or returns precise unfixable actions.
2. Review with dead citation + disclosure miss → same via review route.
3. Commodity / first-party-only fail → unfixable, not published.
4. Post-gen hook: one agent cycle only; no second loop.

### Rollout

1. Model pin + shared agent + content route/UI.
2. Review route/UI + polish hook.
3. Enable fill/polish auto hooks behind `QUALITY_FIX_AUTO` (default on after smoke).
4. Keep override button; do not remove.

### Success criteria

- Motivating content URL publishes without override, or shows actionable
  unfixable items.
- Reviews share the same Fix & Publish path.
- Zero publishes via override from the agent.
- One cycle max; no regenerate storm.

---

## 8. File map (implementation preview)

| File | Action |
|---|---|
| `lib/ai-models.js` | Add `gpt-5.4` pin |
| `lib/quality-fix-classify.js` | Create |
| `lib/quality-fix-agent.js` | Create |
| `lib/quality-fix-content.js` | Create |
| `lib/quality-fix-review.js` | Create |
| `app/api/admin/content/[id]/quality-fix/route.js` | Create |
| `app/api/admin/reviews/[id]/quality-fix/route.js` | Create |
| `app/admin/content/[id]/page.js` | Fix & Publish + SSE report |
| `app/admin/review/[id]/page.js` | Fix & Publish + SSE report |
| `app/api/admin/content/fill/route.js` | Optional post-audit hook |
| `app/api/admin/reviews/[id]/polish/route.js` | Optional post-audit hook |
| `test/quality-fix-*.test.js` | Create |

---

## 9. Open implementation notes (not open product questions)

- Exact OpenAI model string for the `gpt-5.4` pin should match current OpenAI
  GA flagship at implement time (verify against OpenAI docs / `MODELS` comment
  in `lib/ai-models.js` before shipping).
- Content publish already uses `evaluateHardFails` + freshness; review publish
  path must be checked so auto-publish goes through the same hard gate, not a
  side door.
- The Aug 2026 deterministic remediate endpoint was planned but not shipped as
  `/remediate`; this design supersedes that button with `/quality-fix` while
  still calling `remediateContent` / `review-remediate` for deterministic steps.
