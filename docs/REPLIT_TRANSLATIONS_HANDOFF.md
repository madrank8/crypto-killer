# Replit handoff: multi-language review translations (V1)

**Status:** Vercel side shipped 2026-05-18. Replit side **TODO**.
**Owner (Vercel):** This repo. **Owner (Replit):** cryptokiller.org engineering.
**V1 locales:** `en` (master), `it`, `es`, `de`, `fr`, `pt-BR`.

## TL;DR for whoever owns Replit

Vercel now produces translated review content. Until you do the work below, `cryptokiller.org/it/review/...` will 404, no hreflang tags ship on `cryptokiller.org/review/...`, and the EN page will keep getting Google's auto-translated machine-quality previews instead of our manual ones.

You need to:

1. **Read** new fields from the `/api/sync/review` payload (already arriving — see Section 2).
2. **Provision** routes at `/{locale}/review/{slug}` for the 5 V1 locales.
3. **Render** translated pages from the new payload.
4. **Emit hreflang + canonical + schema.org** updates bi-directionally on every page (master + every translation).
5. **Emit a `googlebot: notranslate`** meta on the EN master when any translation is published.
6. **Update the sitemap** to include `xhtml:link` alternates per Google's i18n sitemap spec.

Estimated work: **1–2 engineering days.** All required data is already in your `/api/sync/review` payload.

---

## 1. URL & locale conventions

| BCP-47 (canonical, used in `hreflang` attribute) | URL segment (lowercase) |
|---|---|
| `en` | (no segment — master) |
| `it` | `/it/` |
| `es` | `/es/` |
| `de` | `/de/` |
| `fr` | `/fr/` |
| `pt-BR` | `/pt-br/` |

**URL examples:**
- Master: `https://cryptokiller.org/review/polso-crescianza`
- Italian: `https://cryptokiller.org/it/review/recensione-polso-crescianza`

The per-locale slug can differ from the master slug (native-language slug for better CTR). Always use the `translations[i].slug` field from the payload, never assume it equals master `slug`.

---

## 2. New payload fields on `/api/sync/review`

The decomposed `review` object now includes a `translations` array. Already shipping — no opt-in needed. Example:

```json
{
  "review": {
    "slug": "polso-crescianza",
    "threat_score": 90,
    "title": "Polso Crescianza Review: …",
    "translations": [
      {
        "locale": "it",
        "slug": "recensione-polso-crescianza",
        "status": "published",
        "title": "Recensione Polso Crescianza: …",
        "meta_description": "Analisi approfondita di Polso Crescianza…",
        "headline": "…",
        "alternative_headline": "…",
        "summary": "…",
        "verdict": "…",
        "how_it_works": "…",
        "full_article": "# Recensione…\n\n…(markdown)…",
        "red_flags": [{ "title": "…", "description": "…" }],
        "faq": [{ "question": "…", "answer": "…" }],
        "key_takeaways": ["…", "…"],
        "not_for_you": "…",
        "protection_steps": "…",
        "methodology": "…",
        "disclaimer": "…",
        "expertise_depth": "…",
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
    ],
    "...": "..."
  },
  "brand": { "...": "..." }
}
```

**Important:**
- Only `status: 'published'` translations are sent. Drafts stay on Vercel.
- `translations` may be `[]` (no translations yet — handle gracefully).
- Each translation row mirrors the master's translatable fields. Untranslated columns (`scam_score`, `author_*`, `hero_image_*`, schema scaffolding, sources/citations, brand data, etc.) are not duplicated — Replit should pull these from the master payload and reuse.

### Storage model on Replit

If Replit uses Supabase directly (same DB as Vercel), you can skip the sync payload entirely and read translations live from the `review_translations` table:

```sql
SELECT * FROM review_translations
WHERE locale = $1 AND slug = $2 AND status = 'published';
```

The sync payload is provided for parity — pick whichever is cleaner for your codebase.

---

## 3. Routing on Replit

### 3.1 New routes

Add a per-locale route. In a Next.js codebase that would be `app/[locale]/review/[slug]/page.js` with an allowlist:

```js
const URL_LOCALES = new Set(['it', 'es', 'de', 'fr', 'pt-br'])
const URL_TO_BCP47 = {
  'it': 'it-IT', 'es': 'es-ES', 'de': 'de-DE',
  'fr': 'fr-FR', 'pt-br': 'pt-BR',
}
```

Validate the URL locale segment against `URL_LOCALES` (lowercase). 404 anything else. When querying `review_translations.locale` use the BCP-47 form (`pt-BR`, not `pt-br`).

### 3.2 EN master route (existing)

No URL change. `/review/{slug}` still serves the master. The only required changes are in metadata + schema (Sections 4–6).

---

## 4. hreflang tags (CRITICAL)

Google requires **bidirectional reciprocity** (return links). Every page — master AND each translation — must list every sibling INCLUDING ITSELF in its `<link rel="alternate">` set. If any link is missing, Google ignores the entire annotation.

### 4.1 Required link tags on every page

For a brand with `en` (master) + `it` + `es` published:

```html
<link rel="alternate" hreflang="en" href="https://cryptokiller.org/review/polso-crescianza" />
<link rel="alternate" hreflang="it" href="https://cryptokiller.org/it/review/recensione-polso-crescianza" />
<link rel="alternate" hreflang="es" href="https://cryptokiller.org/es/review/resena-polso-crescianza" />
<link rel="alternate" hreflang="x-default" href="https://cryptokiller.org/review/polso-crescianza" />
```

The SAME set of tags appears on `/review/polso-crescianza`, `/it/review/recensione-polso-crescianza`, AND `/es/review/resena-polso-crescianza`. Order doesn't matter; presence does.

### 4.2 Self-canonical (CRITICAL)

Each translation page must canonical to ITSELF, NOT to the EN master. Common mistake that nukes indexation:

```html
<!-- ON /it/review/recensione-polso-crescianza -->
<link rel="canonical" href="https://cryptokiller.org/it/review/recensione-polso-crescianza" />
```

Hreflang handles the relationship between the master and translations. Canonical pointing to EN tells Google "this page is a duplicate of EN" — exactly wrong.

### 4.3 Locale codes — Google's gotchas

- **Use `en`, not `en-US`.** We don't specifically target the US.
- **`pt-BR` only** in `hreflang`. Don't ship `pt-PT` (we don't translate to European Portuguese).
- **Never** use `es-419` (Latin American Spanish). Google does not support it. We use bare `es`.
- **`uk` is the Ukrainian language code**, not Great Britain. Irrelevant here but worth knowing.

Reference: [Google Search Central — Tell Google about localized versions](https://developers.google.com/search/docs/specialty/international/localized-versions).

---

## 5. The `notranslate` meta tag (CRITICAL for SEO)

Google's [Translated Results feature](https://developers.google.com/search/docs/appearance/translated-results) auto-translates the title link + snippet of foreign-language results for users searching in their native language. For our V1 locales (es/fr/de/it/pt-BR), Google supports this feature on the EN page — meaning if we don't opt out, Google serves a machine-translated EN snippet of `/review/polso-crescianza` to Italian searchers, and clicking that opens Google Translate's proxy of the EN page.

Our manually-translated Italian page (`/it/review/recensione-polso-crescianza`) is way better than Google's auto-translation. So:

**On the EN master, IF the brand has ≥1 published translation, emit:**

```html
<meta name="googlebot" content="notranslate" />
```

This tells Google "don't auto-translate this page for foreign-language searchers." Combined with the hreflang tags above, Google should now serve our `/it/` page to Italian searchers instead of an auto-translation of the EN page.

**Conditional:** only emit this when `translations.length > 0`. Brands with no translations stay open to Google's auto-translation (free foreign reach).

---

## 6. Schema.org JSON-LD updates

Each page (master and each translation) needs its own JSON-LD `@graph` with these locale-specific tweaks:

### 6.1 inLanguage

Every node that supports it (`WebPage`, `Review`, `Article`, `FAQPage`, `WebSite`) must carry `inLanguage` matching the page's BCP-47 code:

```json
{
  "@type": "Review",
  "@id": "https://cryptokiller.org/it/review/recensione-polso-crescianza#review",
  "inLanguage": "it-IT",
  "...": "..."
}
```

Vercel's `lib/review-schema.js` currently hardcodes `"en-US"` in 4 places. Pull the locale from the translation row and parameterize.

### 6.2 Stable `@id` for shared entities (GEO best practice)

`Organization`, `Person` (author), and `WebSite` `@id`s stay **constant across all locales** — don't localize them. Only `WebPage`, `Review`, `FAQPage`, `BreadcrumbList` get locale-suffixed `@id`s.

```json
// SAME @id on every locale page:
{ "@type": "Organization", "@id": "https://cryptokiller.org/#organization" }

// DIFFERENT @id per locale:
{ "@type": "Review", "@id": "https://cryptokiller.org/it/review/recensione-polso-crescianza#review" }
```

Why: AI Overviews / Gemini / Perplexity use stable `@id`s to unify entity recognition across the language graph. Localized `@id`s fragment your authority signal.

### 6.3 `workTranslation` / `translationOfWork` cross-references

Add these to the Review (and Article, if present) nodes:

```json
// On the master Review node (/review/polso-crescianza):
{
  "@type": "Review",
  "@id": "https://cryptokiller.org/review/polso-crescianza#review",
  "inLanguage": "en",
  "workTranslation": [
    { "@id": "https://cryptokiller.org/it/review/recensione-polso-crescianza#review" },
    { "@id": "https://cryptokiller.org/es/review/resena-polso-crescianza#review" }
  ]
}

// On each translation Review node:
{
  "@type": "Review",
  "@id": "https://cryptokiller.org/it/review/recensione-polso-crescianza#review",
  "inLanguage": "it-IT",
  "translationOfWork": {
    "@id": "https://cryptokiller.org/review/polso-crescianza#review"
  },
  "translator": {
    "@type": "Organization",
    "name": "Crypto Killer Editorial Team",
    "description": "AI-assisted human-reviewed translation team"
  }
}
```

Reference: [Schema.org workTranslation](https://schema.org/workTranslation).

---

## 7. Sitemap updates

Per Google's [i18n sitemap spec](https://developers.google.com/search/docs/specialty/international/localized-versions#sitemap), each `<url>` entry must list ALL translations as `<xhtml:link>` children INCLUDING ITSELF:

```xml
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://cryptokiller.org/review/polso-crescianza</loc>
    <xhtml:link rel="alternate" hreflang="en"    href="https://cryptokiller.org/review/polso-crescianza" />
    <xhtml:link rel="alternate" hreflang="it"    href="https://cryptokiller.org/it/review/recensione-polso-crescianza" />
    <xhtml:link rel="alternate" hreflang="es"    href="https://cryptokiller.org/es/review/resena-polso-crescianza" />
    <xhtml:link rel="alternate" hreflang="x-default" href="https://cryptokiller.org/review/polso-crescianza" />
  </url>
  <url>
    <loc>https://cryptokiller.org/it/review/recensione-polso-crescianza</loc>
    <!-- SAME 4 xhtml:link children, repeated verbatim -->
  </url>
  <!-- … one <url> per published variant -->
</urlset>
```

Pick one of: (a) one sitemap with `xhtml:link` annotations (recommended, simpler), or (b) one sitemap per locale. Don't combine.

Next.js `MetadataRoute.Sitemap` has built-in `alternates.languages` support since v14.2 — see [docs](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap#generate-a-localized-sitemap).

---

## 8. Visible "Translated by" disclosure block

Render a small block on every translation page near the byline:

> *This article was originally published in English on **2026-05-17** and translated into Italian by **Crypto Killer Editorial Team** on **2026-05-18**. AI-assisted translation, editorially reviewed.*

Source fields from the translation row:
- `source_review_updated_at` — when the master was last edited
- `translator_name`, `translator_credentials`, `reviewed_at`
- `translation_method` — show value, but in human form: `ai_assisted` → "AI-assisted, editorially reviewed", `human_only` → "Translated by [translator_name]", `ai_full` → "AI-translated"

Why: Google's [generative AI content guidance](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content) recommends disclosing how content was created. For YMYL (scam reviews qualify), this also satisfies E-E-A-T transparency norms.

---

## 9. Status policy

| Translation `status` | Renders on cryptokiller.org? |
|---|---|
| `draft` | No (Vercel only; not in sync payload) |
| `review_pending` | No |
| `published` | Yes |
| `stale` | Yes, but show a "Last verified [date]" badge — master has advanced since translation |

Vercel's daily cron will flip translations to `stale` when `master.updated_at > translation.source_review_updated_at + 1 hour`. Stale translations stay published (they're not wrong, just possibly out-of-sync with the master's latest edit) — render them with a freshness disclaimer rather than 404-ing them.

---

## 10. Smoke-test checklist

After deploying Replit changes, verify on cryptokiller.org with a brand that has at least one published translation (test with `polso-crescianza` once you've translated it on Vercel):

- [ ] `/it/review/<masterSlug>` renders Italian content (or 404s if no translation)
- [ ] Both EN and IT pages have identical `<link rel="alternate">` sets (verify with curl + grep)
- [ ] EN page has `<meta name="googlebot" content="notranslate">` when translations exist
- [ ] Each translation page's `<link rel="canonical">` points to itself
- [ ] JSON-LD on master shows `workTranslation` with the IT page's `@id`
- [ ] JSON-LD on IT page shows `translationOfWork` with the master `@id` + `inLanguage: it-IT`
- [ ] sitemap.xml contains `xhtml:link` alternates for the translated set
- [ ] Run the URL through Google's [Rich Results Test](https://search.google.com/test/rich-results) — should not error on the new schema fields
- [ ] Google Search Console > Coverage report should pick up the new locale URLs within ~1 week

---

## 11. Edge cases worth handling

1. **Master gets unpublished while translations are published.** Per V1 policy, hide the translations too (treat the master as the source of truth for visibility). Either flip them to draft, or just skip rendering until master is republished.
2. **Translation has empty `full_article`.** Render an "[Article translation in progress]" placeholder rather than serving an empty page. This should be rare — Vercel's API blocks publish if word_count is too low.
3. **Slug collision across locales.** Database `UNIQUE (locale, slug)` constraint prevents this within a locale. Cross-locale slug collisions (master EN `polso-crescianza` and IT `polso-crescianza` — same slug, different locales) are valid and routable because the locale prefix differs.
4. **Per-locale slug change.** Vercel allows editing the per-locale slug after publish. The old URL should 301-redirect to the new one (track previous slugs in a `redirects` table, or accept the index churn for V1).

---

## 12. Reference

- Vercel migration that created the table: `migrations/004_review_translations.sql`
- Vercel translation engine: `lib/translate.js`
- Vercel admin API: `app/api/admin/reviews/[id]/translations/**`
- Vercel admin preview page: `app/[locale]/review/[slug]/page.js` (noindexed; Vercel only)
- Vercel sync payload shape: `lib/sync-shape.js` — search for `translations:`
- Vercel publish/sync routes that include translations: `app/api/admin/reviews/[id]/{publish,sync}/route.js`

Questions: open an issue on the Vercel repo or @niro on Slack.
