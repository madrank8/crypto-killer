'use strict'

/**
 * lib/internal-links.js — contextual internal links, and only real ones.
 * Phase 1, 2026-08-31.
 *
 * The brief asks for a link layer covering scam type, country, impersonated
 * public figure, related investigation, recovery guide and methodology — but
 * with a hard constraint: DO NOT create destination URLs that do not yet
 * exist, and do not stand up thin placeholder pages to satisfy a link.
 *
 * So this module is built around an allowlist of routes verified present in
 * the live sitemap (https://cryptokiller.org/api/sitemap.xml, checked
 * 2026-08-31). A link whose destination is not in the allowlist is not
 * rendered — it is returned in `opportunities`, which the implementation
 * report surfaces as a Phase 2 page-type backlog.
 *
 * Adding a route here is a claim that the page exists. Verify before adding.
 */

/** Static routes confirmed live. */
const STATIC_ROUTES = Object.freeze({
  investigations: '/investigations',
  blog: '/blog',
  methodology: '/methodology',
  report: '/report',
  about: '/about',
  recovery: '/recovery',
  ai_disclosure: '/ai-disclosure',
  privacy: '/privacy',
  terms: '/terms',
})

/** Dynamic route families confirmed live, with their id sets where bounded. */
const ANALYST_ROUTE_IDS = Object.freeze(['webb', 'nair', 'ortiz', 'pepi', 'majithia'])

/**
 * Route families the link layer WANTS but the site does not have. Nothing is
 * linked here; each entry becomes a Phase 2 opportunity line item.
 */
const MISSING_ROUTE_FAMILIES = Object.freeze({
  scam_type: { pattern: '/scam-type/<slug>', rationale: 'Hub for a fraud modality, e.g. celebrity-deepfake-investment-ads. Every investigation carries at least one scam type and currently has nowhere to link it.' },
  country: { pattern: '/country/<iso2>', rationale: 'Per-market hub. The geo_list on every brand is unlinked surface area, and country-qualified queries are the highest-intent traffic the archive gets.' },
  public_figure: { pattern: '/impersonated/<slug>', rationale: 'Per-person hub for impersonated public figures. Names are already deduped and structured in celebrity_list, and these are the queries victims actually type.' },
})

function isKnownAnalyst(id) {
  return typeof id === 'string' && ANALYST_ROUTE_IDS.includes(id.trim().toLowerCase())
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Build the contextual links for one investigation page.
 *
 * @param {object} investigation canonical record
 * @param {object} [opts]
 * @param {Array}  [opts.related] canonical records of related investigations
 * @returns {{ links: Array<{key,label,href,rel?}>, opportunities: Array }}
 */
function buildInvestigationLinks(investigation, opts = {}) {
  const i = investigation || {}
  const links = []
  const opportunities = []

  // ── Always-available context ────────────────────────────────────────────
  links.push({
    key: 'methodology',
    label: 'How Crypto Killer scores threats',
    href: STATIC_ROUTES.methodology,
    // The score and classification on this page are only meaningful next to
    // the rules that produced them.
    context: 'scoring',
  })
  links.push({
    key: 'recovery',
    label: 'What to do if you have already deposited',
    href: STATIC_ROUTES.recovery,
    context: 'harm-reduction',
  })
  links.push({
    key: 'report',
    label: `Report ${i.brand_name || 'a platform'} to Crypto Killer`,
    href: STATIC_ROUTES.report,
    context: 'reporting',
  })
  links.push({
    key: 'investigations',
    label: 'All Crypto Killer investigations',
    href: STATIC_ROUTES.investigations,
    context: 'archive',
  })

  // ── Analyst ─────────────────────────────────────────────────────────────
  if (isKnownAnalyst(i.analyst?.id)) {
    links.push({
      key: 'analyst',
      label: `More investigations by ${i.analyst.name || i.analyst.id}`,
      href: `/author/${i.analyst.id.trim().toLowerCase()}`,
      context: 'author',
    })
  }

  // ── Related investigations (real slugs only) ────────────────────────────
  for (const rel of Array.isArray(opts.related) ? opts.related : []) {
    if (!rel?.slug || rel.slug === i.slug) continue
    links.push({
      key: `related:${rel.slug}`,
      label: `${rel.brand_name} — ${rel.threat_classification_label}`,
      href: `/review/${rel.slug}`,
      context: 'related-investigation',
    })
  }

  // ── Wanted but unbuilt ──────────────────────────────────────────────────
  for (const type of Array.isArray(i.scam_types) ? i.scam_types : []) {
    opportunities.push({
      family: 'scam_type',
      wanted_href: `/scam-type/${slugify(type)}`,
      anchor: type.replace(/_/g, ' '),
      from: i.slug,
      ...MISSING_ROUTE_FAMILIES.scam_type,
    })
  }
  for (const cc of (Array.isArray(i.country_codes) ? i.country_codes : []).slice(0, 5)) {
    opportunities.push({
      family: 'country',
      wanted_href: `/country/${String(cc).toLowerCase()}`,
      anchor: String(cc).toUpperCase(),
      from: i.slug,
      ...MISSING_ROUTE_FAMILIES.country,
    })
  }
  for (const person of (Array.isArray(i.public_figures_named) ? i.public_figures_named : []).slice(0, 5)) {
    opportunities.push({
      family: 'public_figure',
      wanted_href: `/impersonated/${slugify(person)}`,
      anchor: person,
      from: i.slug,
      ...MISSING_ROUTE_FAMILIES.public_figure,
    })
  }

  return { links, opportunities }
}

module.exports = {
  STATIC_ROUTES,
  ANALYST_ROUTE_IDS,
  MISSING_ROUTE_FAMILIES,
  buildInvestigationLinks,
  isKnownAnalyst,
  slugify,
}
