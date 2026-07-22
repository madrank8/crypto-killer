# Systematic review-quality fixes (quantum-ai veto → pipeline)

The quantum-ai regeneration vetoed on real content problems. The stat-token class
is fixed (zero drift flags). What remains splits into **systemic generation bugs**
(recur on every review) and one **prompt discipline** issue. Fix them in the
pipeline so every future review is clean, not per-review band-aids.

Branch: `fix/review-quality-systematic` (off main). One reviewed commit per fix.

---

## 1. Truncated FAQPage JSON-LD  *(bug — malformed rich result)*

**Cause:** generation can hit `maxTokens: 16384` (`generate/route.js:593`) and
truncate; the JSON-repair closes the structure but the last FAQ `answer` is cut
mid-sentence, so the FAQPage node ships an incomplete `acceptedAnswer`.

**Fix:** deterministically drop any FAQ whose `answer` is empty or incomplete
(no terminal punctuation / too short) before it reaches `buildReviewSchema` and the
HTML. A malformed trailing FAQ is never worth shipping — better one fewer Q&A than a
broken rich result. Lives in the remediation pass (already runs pre-audit).

## 2. `itemReviewed.@type` mismatch  *(bug — schema vs editorial disagree)*

**Cause:** the schema's `itemReviewed.@type` comes from
`ENTITY_TYPE_TO_GOOGLE[brandData.entity_type]` while the editorial
`item_reviewed.type` is the LLM's value. When `brandData.entity_type` is stale/wrong
(here `SoftwareApplication` for a fake trading platform), the two diverge.

**Fix:** derive both from ONE source. Use the editorial `item_reviewed.type` (the
LLM's judgement of what the scam actually is) as the authority, map it through
`ENTITY_TYPE_TO_GOOGLE` for the schema `@type`, and keep the editorial field's raw
value — so they are semantically consistent by construction. Fall back to
`brandData.entity_type` only when the LLM didn't emit a type.

## 3. Fabricated celebrity names in prose  *(YMYL — deterministic backstop)*

**Cause:** the writer occasionally names a real person as an impersonation victim
who is not in the ground-truth roster (Pauline Hanson, Sudha/Narayana Murthy). #72
lowered the rate; #73 filters the *structured* roster but not prose. Only the
probabilistic LLM auditor catches the prose cases.

**Fix:** add a DETERMINISTIC guard in the remediation pass. `experience_signals`
and `faq` are item-granular (standalone bullets / Q&A), so an item that names an
off-roster celebrity can be dropped WHOLE — safe, unlike stripping a name mid-
sentence. Report every dropped item. This makes the catch reliable instead of
relying on the LLM auditor. (Body-paragraph prose still relies on the audit veto —
you cannot safely edit a sentence — but the two highest-risk fields become
deterministic.)

## 4. Zero internal links  *(SEO/E-E-A-T completeness)*

**Cause:** the generator merges real published siblings into the `internal_links`
array (`generate/route.js:1542`), but this review rendered zero *inline body* links
— the audit counts `<a>` in the copy, and the comparables/links weren't surfaced
there.

**Fix:** guarantee ≥2 internal links appear in the rendered body. Investigate
whether `internal_links` is rendered inline; if not, render them (or a deterministic
fallback: the methodology page + one related published review) as real `<a>` links
in the article. Never invent a target — only link to pages that exist.

## 6. Uncited / non-evidentiary source trips the publish gate  *(added after a re-veto)*

**Cause:** a source in `sources[]` that is not tied to a body claim trips
`source_ledger_claims_without_links`. The recurring offender is ScamAdviser — a
seeded generic consumer-trust aggregator, not an authoritative citation for a
specific fraud claim on a YMYL page.

**Fix:** deterministic filter in the remediation pass — drop any source whose
domain is not inline-linked anywhere in the prose (uncited = not evidence we
used), and drop known non-evidentiary aggregators (ScamAdviser) regardless.
Never invents a source. Verified against the real quantum-ai source set: only
ScamAdviser goes; every inline-cited regulator stays.

## 5. EDGAR document count as a bare literal  *(prompt discipline)*

**Cause:** the SEC EDGAR full-text lookup returns a real `hits` count (239); the
writer copies it into a red_flag as a bare literal. It's real but point-in-time
(drifts on re-lookup) and has no token, so the auditor flags it as unsourced.

**Fix:** prompt constraint — cite EDGAR **qualitatively** ("full-text search returns
documents mentioning X, none registering it as an investment entity"), never the raw
document count. The deterministic regulatory card keeps its own display. Fix in
`review-prompts.js` + `review-pipeline.js`.

---

## Sequencing & verification
1 → 2 → 5 (clear/contained) → 3 (guard + tests) → 4 (investigate render).
Each: `npm test` green, `next build` clean, unit tests for the deterministic pieces.
After all merge + deploy: regenerate quantum-ai → expect a clean (or purely
editorial) audit.
