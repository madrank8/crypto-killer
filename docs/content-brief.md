# Content Briefs — operator note

How to produce a content brief in the admin, what every bracketed marker means, and
which guardrails will refuse you (and why).

Port of the `content-brief-generator` **v1.6** skill (Plan 6 + MVP of Plan 7 + v1.6
template fields). The brief is the handoff artifact between the topical map and the
writing pipeline:

```
topical-map-creation  →  CONTENT BRIEF  →  outline / fill  →  seo-blog-generator
   (topics + SERP)        (this doc)         (gated)            (the article)
```

**Shipped in this MVP:** Sullivan-ok brief required for SEO **Generate Outline** and
**fill**; full brief injected into outline prompts; `locale` / `orthography_notes`,
per-heading `ple_unit`, `faq_sweep`; map vs Sullivan `content_type` labels.

**Still backlog:** on-demand topic SERP capture (Plan 7c/7d) — see
[Plan 7](./superpowers/plans/2026-07-29-plan7-content-brief-v15-port.md) and
[v1.6 MVP note](./superpowers/plans/2026-08-10-content-brief-v16-mvp.md).

**Name collision:** `topics.content_type` (`pillar_page`, `guide`, …) is the map /
page-format field. Sullivan `content_type` on `content_briefs` is the SC-098
non-commodity path (`case_study`, `original_data_study`, …). Do not treat
`pillar_page` as a Sullivan value.

**Discover carve-out:** Google Discover drafts (`topics.content_type = discover`)
skip the Sullivan brief gate — delayed-answer Discover rules fight the brief's
answer-first skeleton.

---

## The workflow

Open the topical map dashboard, expand a topic, and click the **clipboard icon**
("Content brief (12-section) + Sullivan Gate"). That opens the Content Brief panel.

> **Two different panels, don't confuse them.** The neighbouring document icon is
> **"Map directives"** — a small read-only summary of what the *outline generator*
> also receives for that topic (format, schema, PAA coverage, AIO directive). It is not
> the brief and has no gate. The clipboard icon is the real 12-section brief.

1. **Pass the Sullivan Gate.** Declare a Sullivan content type and supply its evidence. Until
   this passes, no brief is generated — and **Generate Outline** / **fill** on the
   content editor will refuse SEO topics. See [The Sullivan Gate](#the-sullivan-gate).
2. **Save.** The deterministic brief is assembled from map data — placement,
   keywords, schema, URL, publication week, internal links, entity IDs, measured
   SERP data, default `locale` (`en-US`), empty `faq_sweep`, and `ple_unit` scaffolds.
   Everything that is *knowable* is filled; everything else gets an
   explicit marker.
3. **Enrich (optional).** "Enrich creative sections (Sonnet)" writes the title tag,
   meta description, heading skeleton (incl. `ple_unit`), `faq_sweep` items,
   EAV triplets, claim categories and visual
   requirements. Measured and human-supplied fields stay locked. Invented FAQ
   volumes are discarded → `[NO DATA]`.
4. **Outline / fill.** On `/admin/content/[id]`, Generate Outline injects the approved
   brief (headings, starting statements, faq_sweep, Sullivan type). Fill also requires
   a Sullivan-ok brief for non-Discover topics.
5. **Export.** Download or copy the YAML and hand it to `seo-blog-generator`.
6. **Advance the status** — `draft → approved → in-production → published`.

---

## Bracketed markers are meaning, not filler

A brief will contain bracketed values. **These are not "TODO" text to be casually
overwritten** — each one states precisely what is unknown and who can resolve it.
Replacing one with a plausible guess is the failure this whole pipeline is built to
prevent.

| Marker | What it means | What to do |
|---|---|---|
| `[NO DATA — requires Tool-Assisted mode]` | A tool metric was not available (competitor word counts, DR, unverified FAQ volumes). | Run the tool, or leave it. **Never estimate it.** |
| `[UNVERIFIED — editor must locate]` | A claim direction is named but no source is verified. Claim categories are *search targets*, not citations. | An editor finds and verifies a real source. |
| `[UNRESOLVED — verify at wikidata.org]` | The entity is not in our curated registry, so no Q-ID/sameAs can be asserted. | Look it up manually, or leave unresolved. |
| `[PENDING — LLM enrichment not run]` | A creative field (incl. `ple_unit` layers) the enrichment step has not written yet. | Click Enrich, or write it yourself. |
| `[NOT CLASSIFIED — regenerate the map to populate this field]` | A map field (`content_format`, `schema_type`, `search_intent`) is empty because the topic predates migrations 018–021. | Regenerate the map. |
| `[DERIVED — not SERP-validated]` | Present but not confirmed against live SERP data. | Treat as a hypothesis. |

**Rule of thumb:** if you cannot replace a marker with something *verified*, leave
the marker. A brief that admits a gap is worth more than one that hides it — the
downstream writer treats bracketed values as "do not assert."

---

## v1.6 fields (MVP)

| Field | Section | Behaviour |
|---|---|---|
| `locale` | 3 | Default `en-US` for Crypto Killer; override via `topics.locale` if set. Protected from enrich. |
| `orthography_notes` | 3 | Empty by default; set on the topic when a non-default market needs rules. Protected from enrich. |
| `ple_unit` | 6 (per heading) | `{ pixel, letter, byte }` scaffolded pending; enrich fills. |
| `faq_sweep` | 6 | `{ carrier_h2, items[] }` — empty until enrich proposes long-tail remainder. Volumes never invented. |
| Escalation-ladder CTA | 6 final H2 | YMYL closing heading instruction references self-serve → fit → honest limit → emergency path. |

---

## The Sullivan Gate

Before any brief is generated, the topic must clear SC-098: it has to be
**non-commodity**. You declare one of five content types and supply that type's
forcing inputs.

| Content type | Required evidence |
|---|---|
| `case_study` | `concrete_metric`, `what_we_did_differently`, `timeframe`, `proprietary_source` |
| `original_data_study` | `dataset_source`, `n_size` (**≥100**), `methodology`, `novel_finding`, `collection_date` |
| `firsthand_review` | `direct_anecdotes` (**≥3**), `field_observation_count`, `recurring_pattern`, `credentials` |
| `contrarian_opinion` | `consensus_position`, `counter_position`, `evidence_from_portfolio` (**≥2**), `where_consensus_fails` |
| `infrastructure` | `entity_id` (real Wikidata Q-ID), `sub_entities` (**≥3**), `internal_link_targets` (**≥3**), `semantic_role` |

**These come from you, the team, the dataset, or the portfolio — never from
inference.** Nothing in the system will pre-fill them, and a placeholder like
`[UNRESOLVED]` will not satisfy the `entity_id` check. Fabricating a
`concrete_metric` or inventing `direct_anecdotes` to get past the gate is, per the
skill, as serious as inventing a PMID: it ships unverifiable claims into prose.

**If no type genuinely fits, that is a real signal** — the piece is commodity
content. Change the angle rather than forcing it through.

The gate is a *block*, not a dead end. It always shows exactly which inputs are
missing and why, and **your progress is saved even when it fails**, so you can come
back with the evidence. Entries are kept per content type, so switching types does
not destroy what you wrote for another (a save that would replace evidence stored
under a different type warns first).

---

## What the enrichment guard blocks

The LLM writes only the creative sections. The guard is **structural**, not a
prompt instruction — whatever the model returns is filtered before it is stored.
After enriching, expand **"N model output(s) blocked by the honesty guard"** to see
what it tried.

Blocked, always:

- **Any protected field** — measured metrics, deterministic map data, your Sullivan
  evidence, `locale` / `orthography_notes`, identity/lifecycle. The model cannot overwrite `competitor_benchmarks`,
  `entity_wikidata`, `search_intent`, `forcing_inputs`, and so on.
- **Unverifiable identifiers**, stripped from *every* field: PMIDs, PMCIDs, DOIs,
  URLs with a path, Wikidata Q-IDs, and Ahrefs `DR nn` figures. The descriptive text
  is kept and marked `[UNVERIFIED — editor must locate]`.
  This is deliberately **stricter than the skill**, which allows a PMID "if known
  from session context" — nothing in this pipeline establishes that context, and a
  recalled identifier is how fabricated citations get in.
- **Invented `faq_sweep` volumes** — replaced with `[NO DATA]`.
- **Renaming or dropping a measured heading.** H2s seeded from real SERP
  People-Also-Ask data are preserved verbatim. The model may add headings, but they
  are tagged internally as model-invented so provenance stays visible.
- **`experience_angle`** once your Sullivan `recurring_pattern` has filled it.

Kept on purpose: **bare hostnames** (`sec.gov`). Section 9 asks for authoritative
*domains* — a domain is a category of source, not a checkable claim. A domain with a
path (`sec.gov/litigation/12345`) *is* a specific claim and gets stripped.

Seeing blocked items is normal and healthy. A long list of stripped identifiers
means the guard is doing its job.

---

## Status lifecycle

`draft → approved → in-production → published`

- A brief cannot leave `draft` until the gate passes **and** a brief exists —
  otherwise "approved" would mean nothing.
- **Regenerating a brief demotes it back to `draft`**, because the approval was
  granted against the previous content. The UI tells you when this happens.
- Moving back to `draft` is always allowed.

---

## Known limits

- **Pre-migration topics produce thinner briefs.** Topics created before migrations
  018–021 have no `content_format`, `schema_type`, `url_path` or `competitor_urls`,
  so those render as `[NOT CLASSIFIED …]` / `[NO DATA …]`. Regenerate the map to
  populate them. This is correct behaviour, not a bug.
- **Competitor benchmarks are partial.** `competitor_pages_to_beat` uses measured
  SERP URLs (post-migration maps). Word counts and average DR remain `[NO DATA]` —
  nothing in the pipeline measures them yet.
- **No on-demand SERP capture yet.** Imported topics with empty PAA keep
  `[DERIVED — not SERP-validated]` heading provenance until Plan 7c lands.
- **One brief per topic.** Regenerating replaces it; there is no version history.

---

## Where things live

| Piece | Path |
|---|---|
| Sullivan Gate validator | `lib/content-brief/sullivan.js` |
| Deterministic assembler (12 sections) | `lib/content-brief/assemble.js` |
| LLM enrichment + honesty guard | `lib/content-brief/enrich.js` |
| YAML serializer | `lib/content-brief/yaml.js` |
| Outline/fill brief gate | `lib/content-brief/gate.js` |
| Full brief → prompt text | `lib/content-brief/prompt.js` |
| Gate + brief UI | `app/admin/topical-map/page.js` (`ContentBriefPanel`) |
| Get / save gate + assemble | `/api/admin/topical-map/topics/[id]/content-brief` |
| Enrich | `…/content-brief/enrich` |
| YAML export | `…/content-brief/yaml` |
| Outline / fill | `/api/admin/content/outline`, `/api/admin/content/fill` |
| Storage | `content_briefs` table (migration `020`) |

Tests: `test/content-brief/`. The YAML tests round-trip-parse the real output with
the `yaml` devDependency rather than asserting on strings — every honesty marker
starts with `[`, which YAML reads as a flow sequence, so unquoted they would be
silently destroyed.

Canonical spec: `~/.claude/skills/content-brief-generator/` —
`references/brief-template.md` (the 12 sections and exact field names, which
`seo-blog-generator` parses) and `SKILL.md` **v1.6**.
