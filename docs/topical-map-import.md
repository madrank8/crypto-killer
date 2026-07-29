# Topical Map Import - Operator Runbook

This document covers how to import a Koray-style page-map spreadsheet into Crypto Killer's
topical map system. All import/admin actions happen on the **Vercel-hosted admin panel**
(crypto-killer.vercel.app/admin/topical-map). Replit publish is an unrelated system; do not
confuse the two.

---

## Required Sheet Columns

Your spreadsheet (.xlsx or .csv) must include these column headers (case-insensitive aliases
are accepted; see `lib/topical-map/import/field-map.js` for the full alias map):

| Column                          | Required | Notes                                           |
|---------------------------------|----------|-------------------------------------------------|
| Section                         | Yes      | CORE or OUTER                                   |
| Cluster                         | Yes      | e.g. "1. Wiki", "4. Verification"               |
| Page Title (Title Tag Style)    | Yes      | The page title for the topic                    |
| Suggested URL                   | Yes      | e.g. /wiki/pig-butchering/                      |
| Primary Query Cluster           | Yes      | Target keyword for the page                     |
| Search Intent                   | Yes      | informational / commercial / transactional / navigational |
| Phase                           | Yes      | Publication wave number (1, 2, 3...)            |
| Internal Links To               | Yes*     | Required for supporting pages only; pillar/cluster hubs are exempt |
| Lead KW Volume                  | No       | Search volume (numeric); imported if present    |
| KD                              | No       | Keyword difficulty (numeric); imported if present |
| Notes / Angle                   | No       | Warn-only if blank; never blocks import         |

\* Internal Links To is required for page rows that resolve to **supporting** topics. Pillar
hub pages and cluster hub pages are exempt from this requirement.

---

## Hard-fail vs Warn Rules

### Hard-fail (422 - entire import is rejected)

These checks run **before any database write**. If any fail, nothing is persisted.

**Validation gate** (`lib/topical-map/import/validate-sheet.js`):
- Any non-rolling-placeholder row missing Page Title, Suggested URL, Section, Cluster,
  Primary Query Cluster, Search Intent, or Phase
- Any supporting-topic row missing Internal Links To

**Coverage gate** (`lib/topical-map/import/coverage.js`):
- Any non-rolling sheet page title absent from the consolidated topic tree
- Consolidator-reported supporting count mismatches the actual tree count

**Persist verification** (`lib/topical-map/import/persist.js`):
- Post-insert topic count does not match expected count: the map and all topics are
  deleted, and the import returns **HTTP 500** (not a structured 422 row table)

### Warn-only (import succeeds with warnings)

- Notes / Angle column is blank on a row (logged as a warning, never blocks import)
- Consolidator structural warnings (e.g. cluster with zero supporting pages)
- Parse-level warnings from the sheet parser

When an import fails with **422**, the admin UI shows:
- **Validation errors**: a scrollable table (row number, title, missing columns)
- **Coverage errors**: a bulleted list of messages, plus truncated missing titles when present

Persist/cleanup failures surface as a generic error toast (500), not the 422 table.

---

## Environment Variables

### FIRECRAWL_API_KEY (optional)

Set `FIRECRAWL_API_KEY` on Vercel (Settings > Environment Variables) to enable the Firecrawl
evidence gatherer during readiness runs. Without this key, the readiness pipeline silently
skips the Firecrawl step and relies only on stack evidence (Supabase data and live site).

Required variables for the import pipeline itself (these should already be set):

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
ADMIN_SECRET
```

---

## Post-import: Sullivan Readiness

After a successful import, the system automatically starts a **readiness check** in the
background. This pipeline:

1. Proposes a Sullivan content type for each supporting topic (deterministic rules, no LLM)
2. Gathers evidence from the Supabase stack (existing reviews, brand data, live pages)
3. If evidence gaps remain and FIRECRAWL_API_KEY is set, scrapes cited URLs via Firecrawl
4. Validates each topic against the Sullivan Gate
5. Upserts results into content_briefs and saves a summary to topical_maps.stats.readiness

Per-topic outcomes appear as badges in the topic tree:
- **evidence ok** (green): Sullivan gate passes with gathered evidence
- **needs evidence** (amber): one or more forcing inputs are missing

You can re-run readiness at any time via the "Re-run readiness" button in the map header.
This is safe to repeat: it only fills evidence gaps and never overwrites human-supplied
forcing inputs or human-declared content types.

---

## Honesty Rules

- Sullivan forcing inputs are **never invented**. If no real, cited source exists for a
  field (e.g. direct_anecdotes, entity_id, field_observation_count), it is left in the
  `missing` list. A human must supply it via the content-brief editor.
- Wikidata Q-IDs are only used when already stored on related content/schema data. The
  system never fabricates a Q-ID.
- Metric provenance (measured / estimated / unresolved) is always shown so an operator
  never mistakes an AI estimate for a tool-measured value.

---

## Workflow Summary

1. Prepare your spreadsheet with all required columns
2. Go to /admin/topical-map and click "Import Map"
3. Upload the file or paste a Google Sheet URL
4. If the import fails (422), review the error table and fix your sheet
5. On success, the map loads automatically and readiness starts in the background
6. Check per-topic evidence badges after readiness completes
7. Use "Re-run readiness" if you add FIRECRAWL_API_KEY later or want to refresh evidence
8. Fill remaining evidence gaps manually in the content-brief editor before generating outlines
