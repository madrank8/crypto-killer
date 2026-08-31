'use strict'

/**
 * lib/entity-registry.js — canonical Organization + analyst Person records.
 * Phase 1, 2026-08-31.
 *
 * Before this file the Organization node was written inline in
 * lib/review-schema.js and nowhere else, so the visible byline, the schema
 * author and the /author/<id> pages had no shared definition. Anything that
 * needs to say who Crypto Killer is, or who wrote an investigation, reads it
 * from here.
 *
 * Two rules this file exists to hold:
 *   1. NO INVENTED PROFILES. `sameAs` only ever contains URLs supplied through
 *      environment variables, because Google penalises sameAs pointing at 404s
 *      and because inventing a LinkedIn for an analyst is fabricating an
 *      identity. An unset env var yields an absent link, never a guessed one.
 *   2. Analyst URLs are only emitted for the five persona pages that actually
 *      exist on cryptokiller.org (verified in the live sitemap, 2026-08-31).
 *      A persona id we do not recognise gets the team record, not a 404.
 */

const CANONICAL_SITE_URL = 'https://cryptokiller.org'

function siteUrl() {
  const override = process.env.NEXT_PUBLIC_SITE_URL
  if (!override) return CANONICAL_SITE_URL
  // The Vercel host is an admin preview; canonical entities always live on
  // the production domain regardless of who renders them.
  if (/vercel\.app|base44\.app|localhost|127\.0\.0\.1/i.test(override)) return CANONICAL_SITE_URL
  return override.replace(/\/$/, '')
}

/** sameAs targets, env-configured only. */
function organizationSameAs() {
  return [
    process.env.CRYPTOKILLER_LINKEDIN_URL,
    process.env.CRYPTOKILLER_TWITTER_URL,
    process.env.CRYPTOKILLER_CRUNCHBASE_URL,
    process.env.CRYPTOKILLER_WIKIDATA_URL,
    process.env.CRYPTOKILLER_GITHUB_URL,
  ].filter((u) => typeof u === 'string' && u.startsWith('http'))
}

const ORGANIZATION_DESCRIPTION =
  'Scam intelligence platform powered by proprietary advertising-surveillance technology. ' +
  'Crypto Killer catalogues fraudulent advertising campaigns and cross-checks every investigated ' +
  'brand against official regulatory databases, including the UK FCA Financial Services Register ' +
  'and Warning List and US SEC EDGAR filings.'

const KNOWS_ABOUT = Object.freeze([
  'Cryptocurrency Scam Detection',
  'Crypto Fraud Investigation',
  'Ad Surveillance Technology',
  'Investment Scam Analysis',
  'Celebrity Impersonation Fraud',
  'Financial Consumer Protection',
  'Digital Advertising Fraud Detection',
  'Blockchain Scam Intelligence',
  'FCA Financial Services Register Verification',
  'SEC EDGAR Regulatory Cross-Referencing',
])

/** Contact point — only emitted when an address is configured. */
function contactPoint() {
  const email = process.env.CRYPTOKILLER_CONTACT_EMAIL
  if (!email) return null
  return {
    '@type': 'ContactPoint',
    contactType: 'editorial',
    email,
    availableLanguage: ['en'],
  }
}

/** The canonical Organization node. */
function organizationEntity() {
  const url = siteUrl()
  const contact = contactPoint()
  const sameAs = organizationSameAs()
  return {
    '@type': 'Organization',
    '@id': `${url}/#organization`,
    name: 'Crypto Killer',
    alternateName: ['CryptoKiller', 'Crypto Killer Intelligence'],
    url,
    description: ORGANIZATION_DESCRIPTION,
    knowsAbout: [...KNOWS_ABOUT],
    areaServed: { '@type': 'Place', name: 'Worldwide' },
    logo: { '@type': 'ImageObject', url: `${url}/logo.png`, width: 512, height: 512 },
    ...(sameAs.length ? { sameAs } : {}),
    ...(contact ? { contactPoint: contact } : {}),
  }
}

/**
 * Analyst records. Names and titles match lib/writer-personas.js where a
 * persona exists there; the two ids that only exist on the public site
 * (pepi, majithia) carry the descriptions used in the writer prompt.
 *
 * `path` is verified to exist on the live site — do not add an id here
 * without its /author page, or the schema will link to a 404.
 */
const ANALYSTS = Object.freeze({
  webb: {
    id: 'webb',
    name: 'M. Webb',
    jobTitle: 'Lead Threat Analyst',
    path: '/author/webb',
    knowsAbout: ['Blockchain Forensics', 'OSINT', 'Deepfake Detection', 'AI-Enabled Fraud'],
  },
  nair: {
    id: 'nair',
    name: 'P. Nair',
    jobTitle: 'Ad Intelligence Specialist',
    path: '/author/nair',
    knowsAbout: ['Advertising Fraud', 'Ponzi Scheme Analysis', 'Trading Platform Fraud', 'Ad Platform Trust & Safety'],
  },
  ortiz: {
    id: 'ortiz',
    name: 'D. Ortiz',
    jobTitle: 'Digital Forensics Specialist',
    path: '/author/ortiz',
    knowsAbout: ['Rug Pulls', 'Token Exploits', 'Wallet Drainers', 'DeFi Security'],
  },
  pepi: {
    id: 'pepi',
    name: 'M. Pepi',
    jobTitle: 'Financial Crime Researcher',
    path: '/author/pepi',
    knowsAbout: ['Anti-Money Laundering', 'Digital Asset Seizure', 'Financial Crime Research'],
  },
  majithia: {
    id: 'majithia',
    name: 'R. Majithia',
    jobTitle: 'Senior Crypto Journalist',
    path: '/author/majithia',
    knowsAbout: ['Crypto Journalism', 'FinTech Reporting', 'Search and Answer-Engine Optimisation'],
  },
})

/** The collective record used when no individual persona is recorded. */
const RESEARCH_TEAM = Object.freeze({
  id: null,
  name: 'Crypto Killer Research Team',
  jobTitle: 'Crypto Fraud Intelligence Analysts',
  path: null,
  knowsAbout: [
    'Cryptocurrency Fraud Investigation',
    'Ad Surveillance Analysis',
    'Scam Pattern Recognition',
    'Financial Regulatory Compliance',
  ],
})

/** Resolve a persona id (or a display name) to an analyst record. */
function resolveAnalyst(personaIdOrName) {
  const key = typeof personaIdOrName === 'string' ? personaIdOrName.trim().toLowerCase() : ''
  if (ANALYSTS[key]) return ANALYSTS[key]
  const byName = Object.values(ANALYSTS).find((a) => a.name.toLowerCase() === key)
  return byName || RESEARCH_TEAM
}

/**
 * Person node for an analyst.
 * @param {string} personaId
 * @param {object} [opts] { description, knowsAbout }
 */
function analystEntity(personaId, opts = {}) {
  const url = siteUrl()
  const a = resolveAnalyst(personaId)
  // A named analyst gets their own @id anchored on their author page; the
  // team record keeps the site-level /#author anchor so existing references
  // to it stay resolvable.
  const id = a.path ? `${url}${a.path}#person` : `${url}/#author`
  const knowsAbout = Array.isArray(opts.knowsAbout) && opts.knowsAbout.length ? opts.knowsAbout : a.knowsAbout
  return {
    '@type': 'Person',
    '@id': id,
    name: a.name,
    jobTitle: a.jobTitle,
    ...(a.path ? { url: `${url}${a.path}` } : {}),
    worksFor: { '@id': `${url}/#organization` },
    knowsAbout: [...knowsAbout],
    ...(opts.description ? { description: opts.description } : {}),
  }
}

/** WebSite node, so publisher/isPartOf references resolve inside one graph. */
function websiteEntity() {
  const url = siteUrl()
  return {
    '@type': 'WebSite',
    '@id': `${url}/#website`,
    url,
    name: 'Crypto Killer',
    publisher: { '@id': `${url}/#organization` },
    inLanguage: 'en-US',
  }
}

module.exports = {
  CANONICAL_SITE_URL,
  ANALYSTS,
  RESEARCH_TEAM,
  KNOWS_ABOUT,
  ORGANIZATION_DESCRIPTION,
  siteUrl,
  organizationSameAs,
  organizationEntity,
  analystEntity,
  websiteEntity,
  resolveAnalyst,
}
