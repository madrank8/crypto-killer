# Content & Review Generation Pipeline

This document covers the AI-driven generation pipeline that produces scam reviews and topical articles, the model fallback chain, the schema enrichment layer, and the publish quality gate. For the data-flow architecture (Vercel ↔ Supabase ↔ Replit), see [`SYNC-ARCHITECTURE.md`](../SYNC-ARCHITECTURE.md). For the public render layer, see [`ARCHITECTURE.md`](https://github.com/madrank8/cryptokiller/blob/main/ARCHITECTURE.md) in the companion repo.

## Two content types, two routes

| Content type | Example | Admin UI | API route | Writer prompt |
|---|---|---|---|---|
| **Reviews** | `quantum-ai`, `nezertronix-pro` | `/admin/review/[id]` | `/api/admin/reviews/...` | `lib/review-prompts.js → contentWriterPrompt` |
| **Articles** | `romance-scammer-red-flags` | `/admin/content/[id]` | `/api/admin/content/...` | `lib/content-prompts.js → topicalArticleWriterPrompt` |

Reviews are per-platform investigations (one platform → one review). Articles are topical guides covering a fraud type or pattern (one query intent → one article). Different stat domains, different writer prompts, different schema graphs.

**Don't confuse the two route trees.** A bug in `/api/admin/reviews/...` rarely indicates a problem in `/api/admin/content/...` or vice versa.

## Multi-agent fill pipeline (articles)

Replaces the prior monolithic `/api/admin/content/fill` writer that timed out at the 300 s lambda ceiling. Splits article generation across four narrow-scope calls so no single call has to think across a 7 – 10 k input + 6 – 8 k output prompt.

```
┌──────────────┐   ┌──────────────────────┐   ┌───────────┐   ┌──────────────────────┐
│  A. Skeleton │ ──►  B. Sections (xN) ─┐ ─► C. FAQ      │ ─►│  D. Aux              │
│  Haiku       │   │  Opus parallel     │   │  Haiku     │   │  Haiku               │
│              │   │  + Sonnet retry    │   │            │   │                      │
│  title       │   │  + deterministic   │   │  question  │   │  not_for_you         │
│  headline    │   │    fallback per    │   │  +answer   │   │  social_proof        │
│  meta_desc   │   │    section         │   │            │   │  visual_placeholders │
│  summary     │   │                    │   │            │   │  internal_links      │
│  key_takeaws │   │  body[]            │   │            │   │  schema_enrichment   │
│              │   │                    │   │            │   │  author_bio          │
└──────────────┘   └────────────────────┘   └───────────┘   └──────────────────────┘
   ~1.5k in           ~1.5k in /section          ~1.5k in       ~1.5k in
   ~300 out           ~700 out / section         ~700 out       ~700 out
```

Implementation: `lib/article-pipeline.js` orchestrates; `lib/skeleton-writer.js`, `lib/section-writer.js`, `lib/faq-writer.js`, `lib/aux-writer.js` implement each phase.

Per-attempt diagnostics (`ai_audit.writer_attempts` jsonb on each row): `{label, model, timeoutMs, durationMs, ok, stopReason, inputTokens, outputTokens, error?}`. Inspect via `SELECT ai_audit->'writer_attempts' FROM content WHERE slug = '<slug>'`.

## AI model registry (`lib/ai-models.js`)

```js
MODELS = {
  'claude-opus':   { provider: 'anthropic', model: 'claude-opus-4-6',          maxTokens: 8192 },
  'claude-sonnet': { provider: 'anthropic', model: 'claude-sonnet-4-6',        maxTokens: 8192 },
  'claude-haiku':  { provider: 'anthropic', model: 'claude-haiku-4-5-20251001',maxTokens: 8192 },
  'gpt-5.4-mini':  { provider: 'openai',    model: 'gpt-5.4-mini',             maxTokens: 8192 },
  'gpt-5.4-nano':  { provider: 'openai',    model: 'gpt-5.4-nano',             maxTokens: 8192 },
  'gemini-flash':  { provider: 'google',    model: 'gemini-2.5-flash',         maxTokens: 8192 },
  'gemini-pro':    { provider: 'google',    model: 'gemini-2.5-pro',           maxTokens: 8192 },
}
```

`resolveModel(preferred)` picks the requested model when its provider key is set; otherwise falls back through `claude-sonnet` → `claude-haiku`. Other providers are wired but only reached when explicitly requested. Anthropic is the default everywhere production-relevant.

### Effort placement — production-tested gotcha

Claude 4.6 / 4.7 default to `effort: 'high'` adaptive thinking. On 6–8 k token writers that can mean 3 + minutes per call, which on a 300 s lambda cascades into the deterministic fallback path with no useful diagnostic.

**The `effort` parameter MUST be nested under `output_config`. Top-level `effort` is silently ignored.** This was a real production regression (commit `0a7f92b3`); both the symptom (writers timing out) and the cause (silent ignore) were unobvious until per-attempt logging landed.

```js
// CORRECT
body.output_config = { effort: 'low' }

// SILENTLY IGNORED — do not write this
body.effort = 'low'
```

`HIGH_EFFORT_DEFAULT_MODELS` (`Set` in `lib/ai-models.js`) maintains the override-required list. New 4.6+ Anthropic models go in here so the writer pipeline doesn't time out the day they ship.

The legacy `anthropic-beta: output-128k-2025-02-19` header is removed — no effect on Claude 4 + (64 k native, 128 k on 4.7).

## Schema enrichment v2

Auto-emits the following nodes onto Article / Review JSON-LD when conditions match. All resolved server-side from structured columns (`about_slugs`, `mention_slugs`, `citations`, `speakable_selectors`, `dataset`, `claims`, `item_reviewed`):

| Node | Triggered by | Notes |
|---|---|---|
| `Article.about[]` | Always for articles | One per primary topic; resolves Wikidata `sameAs` from `lib/wikidata-registry.js` + internal `@id` |
| `Article.mentions[]` | Always | One per named org / product. **NEVER silently dropped** (the romance-scam regression: 14 / 16 entities silently lost; PR `e917b97` fixed) |
| `ClaimReview[]` | `{{VERIFY:claim\|source}}` tags inline in body | Auto-extracted; matched back to source ledger for `itemReviewed.author`. Falls through to citations / source-ledger synthesis when inline tags absent |
| `HowTo` | Sections with 3 + sequential numbered H3s (`Step` / `Stage` / `Phase` pattern) | Detection broadened to ordered-list bodies in PR `8U1BguiD` |
| `ItemList` | Listicle-shaped articles (numeric token in title or section count match) | Triggers also for "red flags / warning signs / signs of" intents |
| `Speakable` | Always | Canonical selectors: `['.key-takeaways', '.section-summary']` |
| `Dataset` | Reviews always; articles when `dataset` field populated | License: CC-BY 4.0. `temporalCoverage` re-derived live from `review_stats` on the renderer side — see stat-token note below |

## Stat-token producer protocol (reviews)

Live scraper-derived numbers (`review_stats.{ad_creatives, countries_targeted, days_active, celebrities_abused, weekly_velocity, first_detected, last_active}`) drift continuously after a review is written. To keep body prose in sync with the JSON-LD `@graph`, the writer emits `{{stat:KEY[|FMT]}}` tokens in prose. The Replit renderer substitutes live values on every render.

```
{{stat:ad_creatives}}        → 2,909      (locale-formatted, default)
{{stat:ad_creatives|raw}}    → 2909
{{stat:ad_creatives|short}}  → 2.9k
{{stat:countries_targeted}}  → 45
{{stat:days_active}}         → 227
{{stat:celebrities_abused}}  → 56
{{stat:weekly_velocity}}     → 104
{{stat:first_detected}}      → January 8, 2025
{{stat:first_detected|iso}}  → 2025-01-08
{{stat:last_active}}         → April 24, 2026
{{stat:last_active|iso}}     → 2026-04-24
```

**Live stats → tokens. Static facts → literals.** Threat score, regulator counts, dollar amounts cited from sources, and velocity-trend categorical labels stay literal.

The producer side lives in `lib/review-prompts.js → contentWriterPrompt` (system prompt has a `STAT-TOKEN PROTOCOL` section + the user prompt's `INTELLIGENCE DATA` block annotates each line with `LITERAL` or `TOKEN`). The consumer side lives in [`cryptokiller/artifacts/crypto-review/src/lib/statTokens.ts`](https://github.com/madrank8/cryptokiller/blob/main/artifacts/crypto-review/src/lib/statTokens.ts).

Articles use a different stat domain (`platformIntelligence` cross-cutting numbers, not per-brand `review_stats`) and don't currently have a token system. If article drift becomes an issue, mirror this design with a `{{platform_stat:KEY}}` namespace.

## Publish quality gate

`validateForPublish` in `app/api/admin/content/[id]/publish/route.js` (and the parallel review path) returns 422 with structured reasons if any of these slip through:

1. **Deterministic-fallback content** — the per-section stub fired (writer chain exhausted)
2. **Skeleton openers** — `"This section explains..."` and similar meta-descriptive opening sentences
3. **Taxonomy trailers** — `"This topic relates to the broader area of..."` and similar boilerplate closers
4. **Placeholder links** — `href="#"`, `target_slug="TBD"`, `"todo"` etc.
5. **Author-name stutter** — `"M. Webb — M. Webb investigates..."` (renderer prepends author name; bio that starts with the same name double-stutters)

Admin UI surfaces reasons as bullets with one-click auto-fix CTAs (placeholder removal, vetted citation replacement, regenerate). Unpublish path is unchanged — the gate only blocks publish.

## Sync coherence guards (`lib/sync-shape.js`)

Pre-flight transforms applied to every Supabase row before it's POSTed to Replit's `/api/sync/review`:

- **Field renames** to match Replit column names
- **Schema enrichment normalization** — unwraps `article.schema_enrichment` into the dedicated columns Replit expects (`about_slugs`, `mention_slugs`, `citations`, `speakable_selectors`, `dataset`)
- **Coherence guards** — `detectInternalContradictions` flags prose that disagrees with structured stats. Failed reviews go back to the editor instead of producing live drift
- **Score / verdict consistency** — verdict opener must match the threat tier (`confirmed` tier can use declarative scam language; `watchlist` and below must use hedged investigative framing)
- **Persona allowlist** — `VALID_PERSONAS = {webb, nair, ortiz, pepi, majithia}`. Unknown personas are dropped (silently — Replit also has its own allowlist)

## Required env vars

| Name | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Editorial workspace DB |
| `ANTHROPIC_API_KEY` | Primary writer (Claude Opus / Sonnet / Haiku) |
| `OPENAI_API_KEY` (optional) | GPT-5.4 — wired but not in default chain |
| `GOOGLE_AI_API_KEY` (optional) | Gemini 2.5 — used by source-researcher prompts |
| `REPLIT_SITE_URL` | Sync target host (usually `https://cryptokiller.org`) |
| `SYNC_SECRET` | Bearer token; matches the Replit side |
| `ADMIN_SECRET` | Auth gate on `/api/admin/*` |
| `NEXT_PUBLIC_SITE_URL` | Self-reference for callbacks |

The publish endpoint structurally logs env presence (`set` / `unset` + URL host + secret length, never values) — first stop when "live page is stale" or sync fails.

## Common gotchas

- **`effort` placement** — under `output_config`, not top-level. Top-level is silently ignored on Claude 4.6+.
- **`generateStaticParams` timeout-guard** — added in commit `3ef6bad9` so builds survive Supabase degradation. If you see static generation hanging on deploy, that's where to look.
- **`buildArticleHtml` deliberately omits `article.summary`, FAQ, sources, and Article / FAQPage JSON-LD.** The Replit SSR layer renders these from structured columns. Re-introducing them here causes the romance-scam-style duplicate-output bug.
- **Don't trust `brand.total_celebrities` in writer prompts** — that's the raw pre-dedupe count. Use `derivedCelebCount` (the locally-deduped value passed in via `cleanCelebrityList`). The Floventra `28-vs-26` regression is the lesson.
- **Two-repo product.** When a fix needs both a writer-prompt change here AND a renderer change in `madrank8/cryptokiller`, ship them together. The byline + stat-token systems are the canonical examples.

## See also

- [`SYNC-ARCHITECTURE.md`](../SYNC-ARCHITECTURE.md) — field-level Supabase → Replit column mapping
- [`spec-draft.md`](../spec-draft.md) — original product spec
- Companion repo [`madrank8/cryptokiller/ARCHITECTURE.md`](https://github.com/madrank8/cryptokiller/blob/main/ARCHITECTURE.md) — the Replit render side
- [`lib/review-prompts.js`](../lib/review-prompts.js), [`lib/content-prompts.js`](../lib/content-prompts.js) — the actual prompt source
