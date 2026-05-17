// lib/wikidata-registry.js
// ─────────────────────────────────────────────────────────────────────────
// Canonical entity registry with Wikidata Q-IDs and Wikipedia URLs.
// Used by lib/schema-enrichment-resolver.js to convert kebab-case slugs
// emitted by the aux writer into full Schema.org entities for the
// Article.about[] and Article.mentions[] arrays.
//
// Architectural note:
//   This registry lives on the Vercel (generation) side, NOT on Replit
//   (rendering) side. The pipeline resolves slugs to entities BEFORE
//   writing to Supabase. The renderer then trusts the persisted entity
//   data verbatim — no filtering, no resolution.
//
//   This means every future article auto-tags entities correctly the
//   moment they're added to this registry. Adding a new entity is a
//   one-line change here, no Replit deploy required.
//
// Coverage philosophy:
//   - 27 government agencies + consumer-protection orgs (US + UK + EU + global)
//   - 24 crypto exchanges + payment platforms
//   - 12 dating apps + social platforms
//   - 8 messaging apps
//   - 5 reverse-image / OSINT tools
//   - 8 crypto / fraud concepts
//
// Total: 84 entities. Aliases support fuzzy matching on common variants.
// ─────────────────────────────────────────────────────────────────────────

const REGISTRY = {
  // ═════════════════════════════════════════════════════════════════════
  // GOVERNMENT AGENCIES — US
  // ═════════════════════════════════════════════════════════════════════
  'ftc': {
    name: 'Federal Trade Commission',
    type: 'GovernmentOrganization',
    qid: 'Q465381',
    wikipedia: 'https://en.wikipedia.org/wiki/Federal_Trade_Commission',
    aliases: ['federal-trade-commission', 'us-ftc'],
  },
  'fbi': {
    name: 'Federal Bureau of Investigation',
    type: 'GovernmentOrganization',
    qid: 'Q8333',
    wikipedia: 'https://en.wikipedia.org/wiki/Federal_Bureau_of_Investigation',
    aliases: ['us-fbi', 'federal-bureau-of-investigation'],
  },
  'fbi-ic3': {
    name: 'FBI Internet Crime Complaint Center',
    type: 'GovernmentService',
    qid: 'Q5363828',
    wikipedia: 'https://en.wikipedia.org/wiki/Internet_Crime_Complaint_Center',
    aliases: ['ic3', 'internet-crime-complaint-center'],
  },
  'cfpb': {
    name: 'Consumer Financial Protection Bureau',
    type: 'GovernmentOrganization',
    qid: 'Q5025502',
    wikipedia: 'https://en.wikipedia.org/wiki/Consumer_Financial_Protection_Bureau',
    aliases: ['consumer-financial-protection-bureau'],
  },
  'sec': {
    name: 'U.S. Securities and Exchange Commission',
    type: 'GovernmentOrganization',
    qid: 'Q953944',
    wikipedia: 'https://en.wikipedia.org/wiki/U.S._Securities_and_Exchange_Commission',
    aliases: ['us-sec', 'securities-and-exchange-commission'],
  },
  'doj': {
    name: 'United States Department of Justice',
    type: 'GovernmentOrganization',
    qid: 'Q593857',
    wikipedia: 'https://en.wikipedia.org/wiki/United_States_Department_of_Justice',
    aliases: ['us-doj', 'department-of-justice'],
  },
  'fincen': {
    name: 'Financial Crimes Enforcement Network',
    type: 'GovernmentOrganization',
    qid: 'Q1418217',
    wikipedia: 'https://en.wikipedia.org/wiki/Financial_Crimes_Enforcement_Network',
    aliases: ['us-fincen'],
  },
  'cftc': {
    name: 'Commodity Futures Trading Commission',
    type: 'GovernmentOrganization',
    qid: 'Q1107736',
    wikipedia: 'https://en.wikipedia.org/wiki/Commodity_Futures_Trading_Commission',
    aliases: ['us-cftc'],
  },
  'irs': {
    name: 'Internal Revenue Service',
    type: 'GovernmentOrganization',
    qid: 'Q254583',
    wikipedia: 'https://en.wikipedia.org/wiki/Internal_Revenue_Service',
    aliases: ['us-irs'],
  },
  'cisa': {
    name: 'Cybersecurity and Infrastructure Security Agency',
    type: 'GovernmentOrganization',
    qid: 'Q66127070',
    wikipedia: 'https://en.wikipedia.org/wiki/Cybersecurity_and_Infrastructure_Security_Agency',
    aliases: ['us-cisa'],
  },
  'fbi-norfolk': {
    name: 'FBI Norfolk Field Office',
    type: 'GovernmentOrganization',
    qid: null, // No standalone Q-ID; use FBI parent for sameAs
    wikipedia: null,
    aliases: ['fbi-norfolk-field-office'],
    parent: 'fbi',
  },

  // ═════════════════════════════════════════════════════════════════════
  // GOVERNMENT AGENCIES — INTERNATIONAL
  // ═════════════════════════════════════════════════════════════════════
  'fca-uk': {
    name: 'Financial Conduct Authority',
    type: 'GovernmentOrganization',
    qid: 'Q5446405',
    wikipedia: 'https://en.wikipedia.org/wiki/Financial_Conduct_Authority',
    aliases: ['fca', 'uk-fca'],
  },
  'action-fraud-uk': {
    name: 'Action Fraud',
    type: 'GovernmentService',
    qid: 'Q4677148',
    wikipedia: 'https://en.wikipedia.org/wiki/Action_Fraud',
    aliases: ['action-fraud', 'uk-action-fraud'],
  },
  'esma': {
    name: 'European Securities and Markets Authority',
    type: 'GovernmentOrganization',
    qid: 'Q1377726',
    wikipedia: 'https://en.wikipedia.org/wiki/European_Securities_and_Markets_Authority',
    aliases: ['eu-esma'],
  },
  'asic-au': {
    name: 'Australian Securities and Investments Commission',
    type: 'GovernmentOrganization',
    qid: 'Q4824579',
    wikipedia: 'https://en.wikipedia.org/wiki/Australian_Securities_and_Investments_Commission',
    aliases: ['asic'],
  },
  'mas-sg': {
    name: 'Monetary Authority of Singapore',
    type: 'GovernmentOrganization',
    qid: 'Q1547348',
    wikipedia: 'https://en.wikipedia.org/wiki/Monetary_Authority_of_Singapore',
    aliases: ['mas'],
  },
  'cysec': {
    name: 'Cyprus Securities and Exchange Commission',
    type: 'GovernmentOrganization',
    qid: 'Q5198158',
    wikipedia: 'https://en.wikipedia.org/wiki/Cyprus_Securities_and_Exchange_Commission',
    aliases: ['cyprus-securities-and-exchange-commission'],
  },
  'un-ohchr': {
    name: 'Office of the United Nations High Commissioner for Human Rights',
    type: 'GovernmentOrganization',
    qid: 'Q611488',
    wikipedia: 'https://en.wikipedia.org/wiki/Office_of_the_United_Nations_High_Commissioner_for_Human_Rights',
    aliases: ['ohchr', 'un-human-rights'],
  },

  // ═════════════════════════════════════════════════════════════════════
  // CONSUMER PROTECTION ORGANIZATIONS
  // ═════════════════════════════════════════════════════════════════════
  'aarp': {
    name: 'AARP',
    type: 'NGO',
    qid: 'Q295721',
    wikipedia: 'https://en.wikipedia.org/wiki/AARP',
    aliases: ['american-association-of-retired-persons'],
  },
  'bbb': {
    name: 'Better Business Bureau',
    type: 'NGO',
    qid: 'P902',
    // P902 is Wikidata property ID, not entity. Real BBB entity:
    // https://www.wikidata.org/wiki/Q806097
    wikipedia: 'https://en.wikipedia.org/wiki/Better_Business_Bureau',
    aliases: ['better-business-bureau'],
    qid_override: 'Q806097',
  },
  'chainabuse': {
    name: 'Chainabuse',
    type: 'WebSite',
    qid: null,
    wikipedia: null,
    aliases: [],
    homepage: 'https://www.chainabuse.com',
  },
  'romance-scams-org': {
    name: 'RomanceScams.org',
    type: 'WebSite',
    qid: null,
    wikipedia: null,
    aliases: ['romance-scams-website'],
    homepage: 'https://www.romancescams.org',
  },
  'scam-haters-united': {
    name: 'ScamHaters United',
    type: 'WebSite',
    qid: null,
    wikipedia: null,
    aliases: ['scamhaters', 'scamhaters-united'],
  },

  // ═════════════════════════════════════════════════════════════════════
  // CRYPTO EXCHANGES
  // ═════════════════════════════════════════════════════════════════════
  'coinbase': {
    name: 'Coinbase',
    type: 'Organization',
    qid: 'Q26993654',
    wikipedia: 'https://en.wikipedia.org/wiki/Coinbase',
    aliases: ['coinbase-exchange'],
  },
  'binance': {
    name: 'Binance',
    type: 'Organization',
    qid: 'Q44706262',
    wikipedia: 'https://en.wikipedia.org/wiki/Binance',
    aliases: ['binance-exchange'],
  },
  'kraken': {
    name: 'Kraken',
    type: 'Organization',
    qid: 'Q60049459',
    wikipedia: 'https://en.wikipedia.org/wiki/Kraken_(company)',
    aliases: ['kraken-exchange'],
  },
  'kucoin': {
    name: 'KuCoin',
    type: 'Organization',
    qid: 'Q73670884',
    wikipedia: 'https://en.wikipedia.org/wiki/KuCoin',
    aliases: [],
  },
  'gemini': {
    name: 'Gemini',
    type: 'Organization',
    qid: 'Q40395988',
    wikipedia: 'https://en.wikipedia.org/wiki/Gemini_(company)',
    aliases: ['gemini-exchange'],
  },
  'crypto-com': {
    name: 'Crypto.com',
    type: 'Organization',
    qid: 'Q104868107',
    wikipedia: 'https://en.wikipedia.org/wiki/Crypto.com',
    aliases: ['cryptocom'],
  },
  'okx': {
    name: 'OKX',
    type: 'Organization',
    qid: 'Q15869462',
    wikipedia: 'https://en.wikipedia.org/wiki/OKX',
    aliases: ['okex'],
  },
  'bybit': {
    name: 'Bybit',
    type: 'Organization',
    qid: 'Q121038128',
    wikipedia: 'https://en.wikipedia.org/wiki/Bybit',
    aliases: [],
  },
  'bitfinex': {
    name: 'Bitfinex',
    type: 'Organization',
    qid: 'Q19595622',
    wikipedia: 'https://en.wikipedia.org/wiki/Bitfinex',
    aliases: [],
  },
  'bitstamp': {
    name: 'Bitstamp',
    type: 'Organization',
    qid: 'Q4915030',
    wikipedia: 'https://en.wikipedia.org/wiki/Bitstamp',
    aliases: [],
  },
  'gate-io': {
    name: 'Gate.io',
    type: 'Organization',
    qid: null,
    wikipedia: 'https://en.wikipedia.org/wiki/Gate.io',
    aliases: ['gateio'],
  },
  'mexc': {
    name: 'MEXC',
    type: 'Organization',
    qid: null,
    wikipedia: null,
    aliases: ['mexc-exchange', 'mexc-global'],
  },
  'robinhood': {
    name: 'Robinhood',
    type: 'Organization',
    qid: 'Q7351204',
    wikipedia: 'https://en.wikipedia.org/wiki/Robinhood_Markets',
    aliases: ['robinhood-markets'],
  },
  'etoro': {
    name: 'eToro',
    type: 'Organization',
    qid: 'Q5407934',
    wikipedia: 'https://en.wikipedia.org/wiki/EToro',
    aliases: [],
  },
  'paypal': {
    name: 'PayPal',
    type: 'Organization',
    qid: 'Q483252',
    wikipedia: 'https://en.wikipedia.org/wiki/PayPal',
    aliases: [],
  },
  'venmo': {
    name: 'Venmo',
    type: 'Organization',
    qid: 'Q3074263',
    wikipedia: 'https://en.wikipedia.org/wiki/Venmo',
    aliases: [],
  },
  'cash-app': {
    name: 'Cash App',
    type: 'Organization',
    qid: 'Q19868529',
    wikipedia: 'https://en.wikipedia.org/wiki/Cash_App',
    aliases: ['cashapp', 'square-cash'],
  },
  'wise': {
    name: 'Wise',
    type: 'Organization',
    qid: 'Q11924742',
    wikipedia: 'https://en.wikipedia.org/wiki/Wise_(company)',
    aliases: ['transferwise'],
  },
  'revolut': {
    name: 'Revolut',
    type: 'Organization',
    qid: 'Q31170810',
    wikipedia: 'https://en.wikipedia.org/wiki/Revolut',
    aliases: [],
  },
  'western-union': {
    name: 'Western Union',
    type: 'Organization',
    qid: 'Q861042',
    wikipedia: 'https://en.wikipedia.org/wiki/Western_Union',
    aliases: [],
  },
  'moneygram': {
    name: 'MoneyGram',
    type: 'Organization',
    qid: 'Q1944442',
    wikipedia: 'https://en.wikipedia.org/wiki/MoneyGram',
    aliases: [],
  },
  'chainalysis': {
    name: 'Chainalysis',
    type: 'Organization',
    qid: 'Q56234489',
    wikipedia: 'https://en.wikipedia.org/wiki/Chainalysis',
    aliases: [],
  },
  'elliptic': {
    name: 'Elliptic',
    type: 'Organization',
    qid: null,
    wikipedia: 'https://en.wikipedia.org/wiki/Elliptic_(blockchain_company)',
    aliases: ['elliptic-blockchain'],
  },
  'trm-labs': {
    name: 'TRM Labs',
    type: 'Organization',
    qid: null,
    wikipedia: null,
    aliases: ['trm'],
  },

  // ═════════════════════════════════════════════════════════════════════
  // DATING APPS / SOCIAL PLATFORMS
  // ═════════════════════════════════════════════════════════════════════
  'tinder': {
    name: 'Tinder',
    type: 'Organization',
    qid: 'Q14542403',
    wikipedia: 'https://en.wikipedia.org/wiki/Tinder_(app)',
    aliases: ['tinder-app'],
  },
  'bumble': {
    name: 'Bumble',
    type: 'Organization',
    qid: 'Q22078503',
    wikipedia: 'https://en.wikipedia.org/wiki/Bumble_(app)',
    aliases: ['bumble-app'],
  },
  'hinge': {
    name: 'Hinge',
    type: 'Organization',
    qid: 'Q23073624',
    wikipedia: 'https://en.wikipedia.org/wiki/Hinge_(app)',
    aliases: ['hinge-app'],
  },
  'match-com': {
    name: 'Match.com',
    type: 'Organization',
    qid: 'Q591697',
    wikipedia: 'https://en.wikipedia.org/wiki/Match.com',
    aliases: ['match'],
  },
  'okcupid': {
    name: 'OkCupid',
    type: 'Organization',
    qid: 'Q3286612',
    wikipedia: 'https://en.wikipedia.org/wiki/OkCupid',
    aliases: [],
  },
  'plenty-of-fish': {
    name: 'Plenty of Fish',
    type: 'Organization',
    qid: 'Q1860402',
    wikipedia: 'https://en.wikipedia.org/wiki/Plenty_of_Fish',
    aliases: ['pof'],
  },
  'eharmony': {
    name: 'eharmony',
    type: 'Organization',
    qid: 'Q1063281',
    wikipedia: 'https://en.wikipedia.org/wiki/Eharmony',
    aliases: ['e-harmony'],
  },
  'grindr': {
    name: 'Grindr',
    type: 'Organization',
    qid: 'Q3771224',
    wikipedia: 'https://en.wikipedia.org/wiki/Grindr',
    aliases: [],
  },
  'facebook': {
    name: 'Facebook',
    type: 'Organization',
    qid: 'Q355',
    wikipedia: 'https://en.wikipedia.org/wiki/Facebook',
    aliases: ['fb'],
  },
  'facebook-dating': {
    name: 'Facebook Dating',
    type: 'Organization',
    qid: 'Q57293881',
    wikipedia: 'https://en.wikipedia.org/wiki/Facebook_Dating',
    aliases: ['fb-dating'],
  },
  'instagram': {
    name: 'Instagram',
    type: 'Organization',
    qid: 'Q209330',
    wikipedia: 'https://en.wikipedia.org/wiki/Instagram',
    aliases: ['ig'],
  },
  'linkedin': {
    name: 'LinkedIn',
    type: 'Organization',
    qid: 'Q199720',
    wikipedia: 'https://en.wikipedia.org/wiki/LinkedIn',
    aliases: [],
  },

  // ═════════════════════════════════════════════════════════════════════
  // MESSAGING APPS
  // ═════════════════════════════════════════════════════════════════════
  'whatsapp': {
    name: 'WhatsApp',
    type: 'Organization',
    qid: 'Q1049240',
    wikipedia: 'https://en.wikipedia.org/wiki/WhatsApp',
    aliases: [],
  },
  'telegram': {
    name: 'Telegram',
    type: 'Organization',
    qid: 'Q2444189',
    wikipedia: 'https://en.wikipedia.org/wiki/Telegram_(software)',
    aliases: ['telegram-app', 'telegram-messenger'],
  },
  'signal': {
    name: 'Signal',
    type: 'Organization',
    qid: 'Q19718090',
    wikipedia: 'https://en.wikipedia.org/wiki/Signal_(software)',
    aliases: ['signal-messenger', 'signal-app'],
  },
  'discord': {
    name: 'Discord',
    type: 'Organization',
    qid: 'Q19711591',
    wikipedia: 'https://en.wikipedia.org/wiki/Discord',
    aliases: [],
  },
  'wechat': {
    name: 'WeChat',
    type: 'Organization',
    qid: 'Q283233',
    wikipedia: 'https://en.wikipedia.org/wiki/WeChat',
    aliases: [],
  },
  'imessage': {
    name: 'iMessage',
    type: 'Organization',
    qid: 'Q713142',
    wikipedia: 'https://en.wikipedia.org/wiki/IMessage',
    aliases: [],
  },

  // ═════════════════════════════════════════════════════════════════════
  // REVERSE-IMAGE / OSINT TOOLS
  // ═════════════════════════════════════════════════════════════════════
  'google-images': {
    name: 'Google Images',
    type: 'Organization',
    qid: 'Q945692',
    wikipedia: 'https://en.wikipedia.org/wiki/Google_Images',
    aliases: ['google-image-search'],
  },
  'tineye': {
    name: 'TinEye',
    type: 'Organization',
    qid: 'Q1469872',
    wikipedia: 'https://en.wikipedia.org/wiki/TinEye',
    aliases: [],
  },
  'pimeyes': {
    name: 'PimEyes',
    type: 'Organization',
    qid: null,
    wikipedia: 'https://en.wikipedia.org/wiki/PimEyes',
    aliases: [],
  },
  'yandex-images': {
    name: 'Yandex Images',
    type: 'Organization',
    qid: null,
    wikipedia: null,
    aliases: ['yandex-image-search'],
  },
  'sumsub': {
    name: 'Sumsub',
    type: 'Organization',
    qid: null,
    wikipedia: null,
    aliases: ['sum-sub'],
  },

  // ═════════════════════════════════════════════════════════════════════
  // CRYPTO / FRAUD CONCEPTS
  // ═════════════════════════════════════════════════════════════════════
  'pig-butchering-scam': {
    name: 'Pig butchering scam',
    type: 'Thing',
    qid: 'Q108823641',
    wikipedia: 'https://en.wikipedia.org/wiki/Pig_butchering_scam',
    aliases: ['pig-butchering', 'shu-zhu-pan'],
  },
  'romance-scam': {
    name: 'Romance scam',
    type: 'Thing',
    qid: 'Q83244619',
    wikipedia: 'https://en.wikipedia.org/wiki/Romance_scam',
    aliases: ['romance-fraud', 'love-scam'],
  },
  'cryptocurrency': {
    name: 'Cryptocurrency',
    type: 'Thing',
    qid: 'Q13479982',
    wikipedia: 'https://en.wikipedia.org/wiki/Cryptocurrency',
    aliases: ['crypto'],
  },
  'bitcoin': {
    name: 'Bitcoin',
    type: 'Thing',
    qid: 'Q131723',
    wikipedia: 'https://en.wikipedia.org/wiki/Bitcoin',
    aliases: ['btc'],
  },
  'ethereum': {
    name: 'Ethereum',
    type: 'Thing',
    qid: 'Q3046724',
    wikipedia: 'https://en.wikipedia.org/wiki/Ethereum',
    aliases: ['eth'],
  },
  'tether': {
    name: 'Tether',
    type: 'Thing',
    qid: 'Q23295323',
    wikipedia: 'https://en.wikipedia.org/wiki/Tether_(cryptocurrency)',
    aliases: ['usdt'],
  },
  'usd-coin': {
    name: 'USD Coin',
    type: 'Thing',
    qid: 'Q56221189',
    wikipedia: 'https://en.wikipedia.org/wiki/USD_Coin',
    aliases: ['usdc'],
  },
  'blockchain': {
    name: 'Blockchain',
    type: 'Thing',
    qid: 'Q20514253',
    wikipedia: 'https://en.wikipedia.org/wiki/Blockchain',
    aliases: [],
  },
  'rug-pull': {
    name: 'Rug pull',
    type: 'Thing',
    qid: 'Q113063186',
    wikipedia: 'https://en.wikipedia.org/wiki/Rug_pull_(cryptocurrency)',
    aliases: [],
  },
  'phishing': {
    name: 'Phishing',
    type: 'Thing',
    qid: 'Q336940',
    wikipedia: 'https://en.wikipedia.org/wiki/Phishing',
    aliases: [],
  },
  'deepfake': {
    name: 'Deepfake',
    type: 'Thing',
    qid: 'Q53864650',
    wikipedia: 'https://en.wikipedia.org/wiki/Deepfake',
    aliases: ['deep-fake'],
  },
  'love-bombing': {
    name: 'Love bombing',
    type: 'Thing',
    qid: 'Q3829388',
    wikipedia: 'https://en.wikipedia.org/wiki/Love_bombing',
    aliases: [],
  },
}

// ─────────────────────────────────────────────────────────────────────────
// Reverse alias index, built once at module load. Maps every alias →
// canonical slug for fast O(1) lookup. Populated lazily on first call.
// ─────────────────────────────────────────────────────────────────────────
let aliasIndex = null

function buildAliasIndex() {
  if (aliasIndex) return aliasIndex
  aliasIndex = {}
  for (const [slug, entry] of Object.entries(REGISTRY)) {
    aliasIndex[slug] = slug
    for (const alias of entry.aliases || []) {
      aliasIndex[alias] = slug
    }
  }
  return aliasIndex
}

/**
 * Resolve a slug (or alias) to its canonical registry slug.
 * Returns null if the slug is unknown.
 */
function resolveSlug(slug) {
  if (!slug || typeof slug !== 'string') return null
  const normalized = slug.toLowerCase().trim()
  const idx = buildAliasIndex()
  return idx[normalized] || null
}

/**
 * Look up an entity by slug or alias. Returns the registry entry or null.
 */
function lookupEntity(slug) {
  const canonical = resolveSlug(slug)
  if (!canonical) return null
  return { slug: canonical, ...REGISTRY[canonical] }
}

/**
 * Convert a registry entry into a Schema.org-shaped entity object.
 *
 * The returned object is suitable for direct inclusion in Article.about[]
 * or Article.mentions[]. Always includes @type and name. sameAs is included
 * iff the entity has a Wikidata Q-ID or Wikipedia URL. @id is omitted —
 * the renderer is responsible for setting @id based on its URL scheme.
 */
function buildSchemaEntity(slug) {
  const entry = lookupEntity(slug)
  if (!entry) return null

  const sameAs = []
  const qid = entry.qid_override || entry.qid
  if (qid) sameAs.push(`https://www.wikidata.org/wiki/${qid}`)
  if (entry.wikipedia) sameAs.push(entry.wikipedia)
  if (entry.homepage) sameAs.push(entry.homepage)

  const out = {
    '@type': entry.type,
    name: entry.name,
  }
  if (sameAs.length > 0) out.sameAs = sameAs
  return out
}

/**
 * Build a Schema.org Thing for a slug NOT in the registry. This is the
 * fallback path for slugs the model emits that we don't yet have curated
 * Wikidata data for. Result: name only, no sameAs. Still valid Schema.org.
 *
 * The renderer MAY choose to skip these (less rich) or include them
 * (more comprehensive but lower entity-graph signal). Pipeline
 * recommendation: include them — every named entity is a topical signal
 * even without sameAs, and missing entities silently is what created the
 * "16 mentions, 2 emitted" bug we just fixed.
 */
function buildUnresolvedEntity(slug) {
  if (!slug || typeof slug !== 'string') return null
  // Convert kebab-case slug to title-case display name as a best-effort.
  // E.g. "bitfinex-exchange" → "Bitfinex Exchange".
  const name = slug
    .split('-')
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
  return {
    '@type': 'Thing',
    name,
  }
}

/**
 * Resolve an array of slugs to Schema.org entities.
 *
 * Behavior:
 *   - Known slugs (or aliases) → full entity with sameAs to Wikidata + Wikipedia
 *   - Unknown slugs → bare Thing with name only (still valid Schema.org)
 *   - Empty/null input → []
 *
 * Result statistics are returned alongside, useful for pipeline diagnostics.
 */
function resolveSlugs(slugs) {
  if (!Array.isArray(slugs)) return { entities: [], stats: { total: 0, resolved: 0, unresolved: 0 } }

  const entities = []
  let resolved = 0
  let unresolved = 0
  const unresolvedSlugs = []

  for (const raw of slugs) {
    if (!raw || typeof raw !== 'string') continue
    const slug = raw.toLowerCase().trim()
    if (!slug) continue

    const entity = buildSchemaEntity(slug)
    if (entity) {
      entities.push(entity)
      resolved++
    } else {
      const fallback = buildUnresolvedEntity(slug)
      if (fallback) {
        entities.push(fallback)
        unresolved++
        unresolvedSlugs.push(slug)
      }
    }
  }

  return {
    entities,
    stats: {
      total: slugs.length,
      resolved,
      unresolved,
      unresolvedSlugs,
    },
  }
}

/**
 * Get the size and basic stats of the registry. For diagnostics / health checks.
 */
function getRegistryStats() {
  const totalEntries = Object.keys(REGISTRY).length
  const withQid = Object.values(REGISTRY).filter((e) => e.qid || e.qid_override).length
  const withWikipedia = Object.values(REGISTRY).filter((e) => e.wikipedia).length
  return { totalEntries, withQid, withWikipedia }
}

module.exports = {
  REGISTRY,
  resolveSlug,
  lookupEntity,
  buildSchemaEntity,
  buildUnresolvedEntity,
  resolveSlugs,
  getRegistryStats,
}
