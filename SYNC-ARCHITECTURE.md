# Database Sync: Vercel Admin → Replit Live Site

## Architecture

```
VERCEL (Admin Dashboard)              REPLIT (Live Site - cryptokiller.org)
┌──────────────────────┐              ┌──────────────────────────┐
│ Supabase PostgreSQL  │              │ Replit PostgreSQL         │
│ ─────────────────    │              │ ─────────────────         │
│ creatives (76k)      │              │ reviews (1711 rows)       │
│ scam_brands (9k)     │              │ red_flags                 │
│ reviews (admin)      │   PUBLISH    │ faq_items                 │
│ sync_runs            │ ──────────►  │ funnel_stages             │
│ settings             │  webhook     │ geo_targets               │
│                      │              │ key_findings              │
│                      │              │ platforms                 │
│                      │              │ review_stats              │
│                      │              │ scam_reports              │
└──────────────────────┘              └──────────────────────────┘
```

## Replit PostgreSQL Schema (Production Database)

All tables use auto-incrementing integer primary keys.
Child tables use `review_id` as foreign key linking back to `reviews`.

### `reviews` (main review records)
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | auto-increment |
| slug | text | URL slug (e.g., "nezertronix-pro") |
| platform_name | text | Brand/platform name |
| status | text | "published" / "draft" |
| threat_score | integer | 0-100 scam score |
| verdict | text | e.g., "Confirmed Scam" |
| summary | text | Brief investigation summary |
| hero_description | text | Full hero paragraph |
| warning_callout | text | Warning text |
| investigation_date | timestamptz | When investigated |
| methodology_text | text | Methodology section |
| disclaimer_text | text | Legal disclaimer |
| word_count | integer | Article word count |
| reading_minutes | integer | Estimated read time |
| author | text | Author name |
| meta_description | text | SEO meta description |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `review_stats` (1:1 with reviews — brand intelligence data)
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| review_id | integer FK | Links to reviews.id |
| total_ads | integer | Total ad creatives |
| countries_targeted | integer | Number of countries |
| celebrities_abused | integer | Number of celebrities |
| days_active | integer | Campaign duration |
| velocity_7d | integer | Ads in last 7 days |
| velocity_trend | text | "stable"/"surging"/etc |
| first_seen | timestamptz | First seen date |
| last_seen | timestamptz | Last seen date |
| created_at | timestamptz | |

### `platforms` (1:1 with reviews — platform metadata)
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| review_id | integer FK | Links to reviews.id |
| (exact columns TBD) | | |

### `red_flags` (1:many with reviews)
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| review_id | integer FK | Links to reviews.id |
| flag | text | Red flag title |
| detail | text | Description/explanation |
| order_index | integer | Display order |
| created_at | timestamptz | |

### `faq_items` (1:many with reviews)
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| review_id | integer FK | Links to reviews.id |
| question | text | FAQ question |
| answer | text | FAQ answer |
| order_index | integer | Display order |
| created_at | timestamptz | |

### `funnel_stages` (1:many with reviews — "How This Scam Works")
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| review_id | integer FK | Links to reviews.id |
| stage_number | integer | Stage order (1,2,3,4) |
| title | text | Stage title |
| description | text | Stage description |
| stat_value | text | Stat number |
| stat_label | text | Stat label |
| bullets | text[] | Bullet points array |
| created_at | timestamptz | |

### `geo_targets` (1:many with reviews)
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| review_id | integer FK | Links to reviews.id |
| region | text | Region name |
| country_codes | text | Comma-separated codes |
| order_index | integer | Display order |
| created_at | timestamptz | |

### `key_findings` (1:many with reviews)
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| review_id | integer FK | Links to reviews.id |
| title | text | Finding title |
| description | text | Finding detail |
| stat_value | text | Key stat |
| stat_label | text | Stat label |
| order_index | integer | Display order |
| created_at | timestamptz | |

## Mapping: Supabase → Replit

When a review is published on Vercel, the sync maps data like this:

### Supabase `reviews` + `scam_brands` → Replit tables

```
Supabase reviews.slug          → Replit reviews.slug
Supabase scam_brands.name      → Replit reviews.platform_name
Supabase reviews.status        → Replit reviews.status
Supabase scam_brands.scam_score→ Replit reviews.threat_score
Supabase reviews.verdict       → Replit reviews.verdict
Supabase reviews.summary       → Replit reviews.summary
Supabase reviews.headline      → Replit reviews.hero_description
Supabase reviews.meta_description → Replit reviews.meta_description
Supabase reviews.methodology   → Replit reviews.methodology_text
Supabase reviews.word_count    → Replit reviews.word_count
Supabase reviews.published_at  → Replit reviews.investigation_date

Supabase reviews.red_flags (JSON array)  → Replit red_flags (individual rows)
Supabase reviews.faq (JSON array)        → Replit faq_items (individual rows)
Supabase reviews.how_it_works (text)     → Replit funnel_stages (parsed into stages)

Supabase scam_brands.total_creatives     → Replit review_stats.total_ads
Supabase scam_brands.total_geos          → Replit review_stats.countries_targeted
Supabase scam_brands.total_celebrities   → Replit review_stats.celebrities_abused
Supabase scam_brands.lifespan_days       → Replit review_stats.days_active
Supabase scam_brands.velocity_7d         → Replit review_stats.velocity_7d
Supabase scam_brands.velocity_trend      → Replit review_stats.velocity_trend
Supabase scam_brands.first_seen_at       → Replit review_stats.first_seen
Supabase scam_brands.last_seen_at        → Replit review_stats.last_seen

Supabase scam_brands.geo_list (JSON array) → Replit geo_targets (individual rows)
```

## Sync Endpoint (to build on Replit Express server)

```
POST /api/sync/review
Authorization: Bearer {SYNC_SECRET}
Content-Type: application/json

Body: {
  "review": { ...Supabase review fields },
  "brand": { ...Supabase scam_brands fields }
}

Response: { "success": true, "review_id": 123 }
```

## Environment Variables

### Vercel (crypto-killer):
REPLIT_SITE_URL=https://cryptokiller.org
SYNC_SECRET=<shared-secret>

### Replit (Scam-Detector):
SYNC_SECRET=<same-shared-secret>
```
