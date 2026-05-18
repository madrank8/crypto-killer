# Replit Agent prompt — multi-language review pages

> Paste this entire document into Replit Agent chat. It's self-contained — Replit Agent won't have access to the Vercel repo, so all required spec is embedded.

---

# TASK: Add multilingual review pages to cryptokiller.org

## Context

We just shipped a translation pipeline on the Vercel admin side (`crypto-killer.vercel.app`). The Vercel admin lets editors create translated review content (Italian, Spanish, German, French, Brazilian Portuguese) for any English master review. Translated content is pushed to this Replit deployment via the existing `/api/sync/review` webhook.

**The Replit side is the production public site at `cryptokiller.org`.** Right now it only renders the English version. Your job is to add the per-locale routes, hreflang annotations, schema localization, and sitemap entries so the translations Vercel sends actually surface on the public site.

## Success criteria (acceptance checklist)

When you're done, the following must all be true:

1. `cryptokiller.org/it/review/<slug>` (and `/es/`, `/de/`, `/fr/`, `/pt-br/`) returns 200 with translated content when a published translation exists for that brand + locale.
2. Both the English page and every translation page emit identical `<link rel="alternate" hreflang="...">` sets, including a `hreflang="x-default"` pointing to the English version. Self-referencing is required (each page lists itself).
3. Each translation page emits `<link rel="canonical" href="...">` pointing **to itself**, NOT to the English master.
4. The English master emits `<meta name="googlebot" content="notranslate" />` IF AND ONLY IF at least one translation is published for that review.
5. JSON-LD on the English master includes `workTranslation: [{ "@id": "<each-translation-url>#review" }, ...]`. Each translation page's JSON-LD includes `translationOfWork: { "@id": "<master-url>#review" }` and `inLanguage` matching its locale (BCP-47: `it-IT`, `es-ES`, `de-DE`, `fr-FR`, `pt-BR`).
6. Sitemap.xml entries for the master and each translation include `<xhtml:link rel="alternate" hreflang="...">` annotations per Google's i18n sitemap spec.
7. Each translation page has a visible disclosure block near the byline: *"This article was originally published in English on [date] and translated into [Language] by [translator_name] on [reviewed_at]."*
8. URL segment for `pt-BR` is lowercase `/pt-br/` (URL path) but the BCP-47 attribute value in `hreflang` and `inLanguage` is `pt-BR` (canonical case).

---

## Work in phases. After each phase, summarize what you did before continuing.

# PHASE 1 — DISCOVERY (do this first, report back before changing code)

Run these checks against the current codebase and tell me what you find. Don't write any new code yet.

1. **Framework detection.** Is this Next.js (App Router or Pages), Astro, Remix, SvelteKit, Express + a template engine, plain Node + custom router, or something else? Look at `package.json` dependencies and the directory structure under `app/`, `pages/`, `src/routes/`, `src/pages/`, or similar.

2. **Existing review render.** Find the route(s) that render `/review/<slug>`. Specifically locate:
   - The file that handles the URL match (e.g., `app/review/[slug]/page.js`, `src/pages/review/[slug].astro`, `routes/review.js`).
   - The data fetch — where does it pull the review row from? Is there a database layer (Drizzle/Prisma/Kysely/raw SQL/Supabase client)? What's the table name (`reviews`? `scam_reviews`?)?
   - The `<head>` / metadata generation — is it using `generateMetadata` (Next.js), `<head>` in the template, manual HTML strings, or `<Head>` from Astro/Remix?
   - The JSON-LD emission — search for `application/ld+json` or `inLanguage` or `@graph`.

3. **Sync handler.** Find the route that receives `/api/sync/review` from Vercel. Read the handler. Specifically tell me:
   - How does it parse the incoming payload `{ review, brand, expected_full_article_length, expected_full_article_hash }`?
   - Does it already see a `review.translations` array in that payload? (Vercel started sending it but the handler may be ignoring it because no field exists in the local DB yet.)
   - Where does it write the review to local storage? Show me the SQL/ORM call.

4. **Sitemap.** Locate `sitemap.xml` (or `sitemap.ts` / dynamic route / static file). Show me how it's currently generated.

5. **Database / storage.** What's the local DB? (Replit databases, Postgres, SQLite, Turso, plain JSON files?) Show the schema for the reviews table. Tell me the migration tool (Drizzle migrations, Prisma migrate, plain SQL files, none).

**Output of Phase 1**: a markdown summary covering framework + review route file paths + sync handler file path + sitemap source + DB technology + reviews table schema. I'll confirm or adjust before you proceed.

---

# PHASE 2 — DATA MODEL

Once Phase 1 is done, propose a schema migration to store translations locally. The shape should match the incoming payload from Vercel:

```
review_translations table (or equivalent in whatever ORM/DB is used):
  id                       text PK
  review_id                text FK → reviews(id) ON DELETE CASCADE
  locale                   text NOT NULL  -- 'it'|'es'|'de'|'fr'|'pt-BR'
  slug                     text NOT NULL  -- per-locale slug; may differ from master
  status                   text NOT NULL  -- 'published' (we only sync published; treat any other as draft and skip render)
  title                    text
  meta_description         text
  headline                 text
  alternative_headline     text
  summary                  text
  verdict                  text
  how_it_works             text
  full_article             text  -- can be 10K+ chars
  red_flags                jsonb  -- array of {flag,detail} OR {title,description} — preserve as-is
  faq                      jsonb  -- array of {question,answer}
  key_takeaways            jsonb  -- array of strings
  not_for_you              text
  protection_steps         text
  methodology              text
  disclaimer               text
  expertise_depth          text
  translation_method       text  -- 'ai_full'|'ai_assisted'|'human_only'
  translator_name          text
  translator_credentials   text
  ai_model                 text
  ai_prompt_version        text
  reviewed_at              timestamptz
  word_count               integer
  published_at             timestamptz
  source_review_updated_at timestamptz  -- snapshot of master.updated_at at translation time; used for stale detection
  updated_at               timestamptz
  UNIQUE(review_id, locale)
  UNIQUE(locale, slug)
  INDEX (locale, slug)
```

Adapt to whatever ORM/migration tool you find in Phase 1.

---

# PHASE 3 — SYNC HANDLER UPDATE

The Vercel side already sends `review.translations: [...]` in the `/api/sync/review` payload. The handler needs to read that array and upsert into the new table.

```ts
// Pseudocode — adapt to actual stack
const incoming = body.review.translations || []
// Wipe existing translations for this review_id and insert fresh (idempotent)
await db.deleteFrom('review_translations').where('review_id', '=', body.review.id).execute()
for (const t of incoming) {
  await db.insertInto('review_translations').values({
    review_id: body.review.id,
    locale: t.locale,
    slug: t.slug,
    status: t.status,
    title: t.title,
    // ... all fields from the table above
  }).execute()
}
```

A delete-then-insert strategy is correct because Vercel only sends published translations and the array is the source of truth. Translations that disappear from the payload (got unpublished on Vercel) should disappear from cryptokiller.org too.

---

# PHASE 4 — ROUTES

Add per-locale review routes. URL allowlist (lowercase URL segment, BCP-47 canonical value):

| URL segment | BCP-47 | Display |
|---|---|---|
| `/it/` | `it-IT` | Italiano |
| `/es/` | `es-ES` | Español |
| `/de/` | `de-DE` | Deutsch |
| `/fr/` | `fr-FR` | Français |
| `/pt-br/` | `pt-BR` | Português (Brasil) |

For each request to `/<locale>/review/<slug>`:

1. Validate the URL locale segment is in the allowlist. 404 anything else.
2. Look up the translation by `(locale, slug)` where locale is the BCP-47 form (`pt-BR` not `pt-br`). Also require `status='published'`. 404 if missing.
3. Look up the master review by `translation.review_id` to inherit structural fields (brand info, scam_score, hero_image_url, author, publication dates, citations, etc.).
4. Render the page using the translated fields for content, master fields for everything else.

**Important rendering details:**
- `<html lang="...">` should match the translation's BCP-47 code (`it-IT`, etc.).
- All visible text comes from the translation row; URLs, scam_score, dates, brand name come from the master.
- `red_flags` items may have keys `{flag, detail}` OR `{title, description}` — render both shapes (`r.title || r.flag` for the heading; `r.description || r.detail` for the body).

---

# PHASE 5 — SEO METADATA (the most error-prone part)

For BOTH the English master page and EVERY translation page, emit identical hreflang sets. This is **bidirectional reciprocity** — Google ignores hreflang if any return link is missing.

## 5.1 hreflang link tags

For a review with master + IT + ES translations, every one of those three pages emits these tags in the `<head>`:

```html
<link rel="alternate" hreflang="en"    href="https://cryptokiller.org/review/<master-slug>" />
<link rel="alternate" hreflang="it"    href="https://cryptokiller.org/it/review/<it-slug>" />
<link rel="alternate" hreflang="es"    href="https://cryptokiller.org/es/review/<es-slug>" />
<link rel="alternate" hreflang="x-default" href="https://cryptokiller.org/review/<master-slug>" />
```

The set is identical across all three pages. Order doesn't matter. Self-referencing is required — the IT page lists `hreflang="it"` pointing to itself.

## 5.2 Canonical

Each page is self-canonical:

```html
<!-- on /review/<master-slug> -->
<link rel="canonical" href="https://cryptokiller.org/review/<master-slug>" />

<!-- on /it/review/<it-slug> -->
<link rel="canonical" href="https://cryptokiller.org/it/review/<it-slug>" />
```

NEVER point a translation's canonical at the English master. Common mistake; Google will then ignore the translation.

## 5.3 notranslate on English master

Conditional. When the master has ≥1 published translation, emit:

```html
<meta name="googlebot" content="notranslate" />
```

This stops Google from auto-translating the EN page for foreign-language searchers — without it, Google's Translated Results feature serves a machine-translation of the EN page and competes with our manual Italian translation.

```ts
const hasTranslations = translations.length > 0
// In the EN page's head:
{hasTranslations && <meta name="googlebot" content="notranslate" />}
```

Brands with no translations stay open to Google's auto-translation (free foreign reach).

## 5.4 JSON-LD updates

### English master `Review` node

Add a `workTranslation` array listing every published translation's `@id`:

```json
{
  "@type": "Review",
  "@id": "https://cryptokiller.org/review/<master-slug>#review",
  "inLanguage": "en",
  "workTranslation": [
    { "@id": "https://cryptokiller.org/it/review/<it-slug>#review" },
    { "@id": "https://cryptokiller.org/es/review/<es-slug>#review" }
  ]
}
```

### Each translation `Review` node

Add `translationOfWork` pointing at the master and `translator`:

```json
{
  "@type": "Review",
  "@id": "https://cryptokiller.org/it/review/<it-slug>#review",
  "inLanguage": "it-IT",
  "translationOfWork": {
    "@id": "https://cryptokiller.org/review/<master-slug>#review"
  },
  "translator": {
    "@type": "Organization",
    "name": "<translation.translator_name>",
    "description": "AI-assisted human-reviewed translation team"
  }
}
```

### inLanguage on every applicable node

`WebPage`, `Review`, `Article`, `FAQPage`, `WebSite`, `BreadcrumbList` — all carry `inLanguage` matching the page's BCP-47. Currently `inLanguage` is probably hardcoded `en-US` somewhere; parameterize.

### Stable `@id` for shared entities

`Organization`, `Person` (author), and `WebSite` should keep the SAME `@id` across all locales (e.g., `https://cryptokiller.org/#organization`). Only `WebPage`/`Review`/`FAQPage`/`BreadcrumbList` get locale-suffixed `@id`s. This is what makes AI Overviews / Gemini / Perplexity unify entity recognition across the language graph.

---

# PHASE 6 — SITEMAP

Per Google's i18n sitemap spec, each `<url>` entry must list every translation as `<xhtml:link>` children INCLUDING the entry's own locale:

```xml
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://cryptokiller.org/review/<master-slug></loc>
    <xhtml:link rel="alternate" hreflang="en"    href="https://cryptokiller.org/review/<master-slug>" />
    <xhtml:link rel="alternate" hreflang="it"    href="https://cryptokiller.org/it/review/<it-slug>" />
    <xhtml:link rel="alternate" hreflang="es"    href="https://cryptokiller.org/es/review/<es-slug>" />
    <xhtml:link rel="alternate" hreflang="x-default" href="https://cryptokiller.org/review/<master-slug>" />
  </url>
  <url>
    <loc>https://cryptokiller.org/it/review/<it-slug></loc>
    <!-- SAME 4 xhtml:link children, repeated verbatim -->
  </url>
  <url>
    <loc>https://cryptokiller.org/es/review/<es-slug></loc>
    <!-- SAME 4 xhtml:link children -->
  </url>
</urlset>
```

Pick one of: single sitemap with `xhtml:link` annotations (recommended), or one sitemap per locale. Don't combine both.

---

# PHASE 7 — VISIBLE DISCLOSURE BLOCK

Each translation page renders a block near the byline (under the H1, above the body):

> *This article was originally published in English on **[source_review_updated_at, formatted as locale-appropriate date]** and translated into [Language] by **[translator_name]** on **[reviewed_at, formatted]**. Translation method: [translation_method, human-readable].*

Mapping for `translation_method` display strings:
- `ai_full` → "AI translation"
- `ai_assisted` → "AI-assisted translation, editorially reviewed"
- `human_only` → "Translated by [translator_name]" (no separate "translation" suffix)

This satisfies Google's recommendation (in their AI content guidance) to disclose how content was created, and meets E-E-A-T transparency norms for YMYL content.

---

# PHASE 8 — STALE STATE HANDLING

The payload includes `source_review_updated_at` on each translation (snapshot of the master's `updated_at` at translation time). If a translation row arrives with `source_review_updated_at < master.updated_at - 1h`, treat it as STALE:

- Still render the page (do NOT 404 — stale ≠ wrong, it just means master got edited after this translation was made).
- Add a yellow notice above the article: *"This article may be slightly out of date — the original English version was updated [date]. A refreshed translation is in progress."*
- Optionally exclude stale translations from the `workTranslation` schema array on the master to avoid pointing AI consumers at potentially-outdated content. Your call — fine either way for V1.

---

# PHASE 9 — VERIFICATION

After implementing all phases, do this smoke test and report results:

1. Pick any published review with a published translation (the Vercel side has one for testing — ask the user if you can't find one in the payload history).
2. `curl -s https://cryptokiller.org/review/<master-slug> | grep -E '(hreflang|canonical|notranslate)'` — should show 5+ hreflang lines and a canonical pointing to itself, and notranslate IF translations exist.
3. `curl -s https://cryptokiller.org/it/review/<it-slug> | grep -E '(hreflang|canonical)'` — should show the same 5 hreflang set, canonical pointing to the IT URL itself.
4. Both pages → Google [Rich Results Test](https://search.google.com/test/rich-results) → no schema errors.
5. `curl -s https://cryptokiller.org/sitemap.xml | head -50` — verify `<xhtml:link>` alternates appear per URL.
6. Visual check: open the IT page in a browser → content is in Italian, disclosure block shows under byline, `<html lang="it-IT">` in DevTools.

---

# REFERENCE — Locale conventions cheat sheet

| URL segment | BCP-47 | Language label | hreflang attr | sitemap hreflang attr |
|---|---|---|---|---|
| `/` (no segment) | `en` | English | `en` + `x-default` | `en` + `x-default` |
| `/it/` | `it-IT` | Italiano | `it` | `it` |
| `/es/` | `es-ES` | Español | `es` | `es` |
| `/de/` | `de-DE` | Deutsch | `de` | `de` |
| `/fr/` | `fr-FR` | Français | `fr` | `fr` |
| `/pt-br/` | `pt-BR` | Português (Brasil) | `pt-BR` | `pt-BR` |

**Gotchas:**
- `hreflang="en-US"` is WRONG for our EN master — we don't specifically target the US. Use `hreflang="en"` (covers all English speakers).
- `hreflang="es-419"` is rejected by Google. Use bare `hreflang="es"`.
- `hreflang="uk"` is the Ukrainian language code, NOT Great Britain. Irrelevant here but worth knowing.
- URL paths are lowercase (`/pt-br/`). The `hreflang` and `inLanguage` attribute values are BCP-47 canonical case (`pt-BR`). Do this normalization carefully — search engines accept lowercase hreflang values but normalize to canonical case is best practice.

---

# REFERENCE — Incoming payload shape (exact JSON example)

This is what Vercel POSTs to `/api/sync/review` today. The `translations` array is the new part — older payloads might not have it.

```json
{
  "review": {
    "slug": "polso-crescianza",
    "title": "Polso Crescianza Review: AI-Powered Trading Platform Investigation",
    "threat_score": 90,
    "...all other existing fields...": "...",
    "translations": [
      {
        "locale": "it",
        "slug": "recensione-polso-crescianza",
        "status": "published",
        "title": "Recensione Polso Crescianza: Indagine sulla piattaforma di trading IA",
        "meta_description": "Analisi approfondita di Polso Crescianza — la piattaforma di trading IA promossa con annunci ingannevoli.",
        "headline": "Polso Crescianza: indagine completa su una piattaforma sospetta",
        "alternative_headline": "Truffa di investimento o legittima opportunità?",
        "summary": "Polso Crescianza è una piattaforma...",
        "verdict": "Truffa confermata. Evitare ogni contatto.",
        "how_it_works": "...",
        "full_article": "# Recensione Polso Crescianza\n\n## Panoramica\n\n...(markdown)...",
        "red_flags": [
          { "flag": "Promesse di guadagno irrealistiche", "detail": "Il sito promette rendimenti del 300%..." }
        ],
        "faq": [
          { "question": "Polso Crescianza è una truffa?", "answer": "Sulla base della nostra indagine..." }
        ],
        "key_takeaways": [
          "Le credenziali della piattaforma non possono essere verificate",
          "Le testimonianze dei celebri sono false"
        ],
        "not_for_you": "Se cerchi rendimenti garantiti...",
        "protection_steps": "Se hai già depositato fondi...",
        "methodology": "La nostra indagine si è basata su...",
        "disclaimer": "Questa recensione è basata su informazioni pubblicamente disponibili...",
        "expertise_depth": "Crypto Killer indaga le truffe di investimento dal 2022...",
        "translation_method": "ai_assisted",
        "translator_name": "Crypto Killer Editorial Team",
        "translator_credentials": null,
        "ai_model": "gpt-5.4-mini",
        "ai_prompt_version": "translate-v1",
        "reviewed_at": "2026-05-18T08:31:00Z",
        "word_count": 4382,
        "published_at": "2026-05-18T08:35:12Z",
        "source_review_updated_at": "2026-05-17T20:14:02Z",
        "updated_at": "2026-05-18T08:35:12Z"
      },
      { "locale": "es", "...": "..." }
    ]
  },
  "brand": { "...": "..." },
  "expected_full_article_length": 12345,
  "expected_full_article_hash": "abc123..."
}
```

`translations` may be `[]` (no translations published yet) — handle gracefully. Fields inside each translation may be `null` if the master had no value for that field; render conditionally.

---

# OUT OF SCOPE (don't do these now)

- Locale auto-detection middleware that 302-redirects users by Accept-Language. Defer to a follow-up. For V1, users land on the URL they typed.
- "Suggest this in Italian" banner on the English page when an IT translation exists. Same — defer to follow-up.
- Translation editing UI on Replit. Editing happens on Vercel admin only.
- AI translation execution on Replit. Translation runs on Vercel only.

---

# READY?

Start with Phase 1 (Discovery). Report back the framework, route paths, sync handler location, sitemap source, and DB schema. Then we'll proceed to Phase 2 together.

If at any point you find the existing code does something differently than this brief assumes (e.g., the framework is something unusual, or the sync handler uses a totally different storage model), call that out — I'll adjust before you write code.
