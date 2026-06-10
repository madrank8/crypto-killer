/**
 * lib/source-verify.js — deterministic source-ledger verification
 * Date: 2026-06-10
 *
 * Closes the P0-1 gap from the content-pipeline skill audit: the Phase 2
 * source researcher (Gemini + search grounding) self-asserts `verified:true`
 * on every URL it emits, but nothing ever HTTP-checked those URLs before the
 * writer baked them into a YMYL review. The only existing check ran at
 * PUBLISH time (reviews/[id]/publish), i.e. after the content was already
 * written around a potentially dead/hallucinated source.
 *
 * This module is the single home for URL liveness checking — the publish
 * route now imports from here instead of keeping its own copy — plus
 * deterministic regulator lookups that replace LLM-guessed regulatory status:
 *
 *   - verifySourceLedger(ledger)  → HEAD/GET-checks every URL between
 *     Phase 2 (research) and Phase 3 (writing). Dead URLs are dropped so
 *     the writer never cites them. `verified` becomes a fact, not a vibe.
 *   - buildRegulatorSources(name) → exact-match lookups against:
 *       · SEC EDGAR full-text search (open API, User-Agent required)
 *       · FCA Financial Services Register (optional; requires the free
 *         FCA_API_EMAIL + FCA_API_KEY env vars from register.fca.org.uk)
 *     Best-effort, never throws, returns [] when nothing is found or the
 *     APIs are unreachable. Findings come back as ledger-shaped sources
 *     with verified:true and an extract describing the exact result.
 *
 * Design rules:
 *   - Never throw from a public function. Source verification is a quality
 *     gate, not a point of failure — a network blip must not kill a
 *     10-minute generation run.
 *   - Conservative drops only. A URL is dropped for hard negatives
 *     (malformed, DNS failure, 404/410/5xx). Soft negatives (403 on a
 *     known-blocking domain, 405 on HEAD with a passing GET) survive.
 */

// Domains we can't programmatically validate (block HEAD, hallucinate
// easily, or don't have a stable public URL scheme). These force a
// manual-review path rather than an unverifiable auto-publish.
const UNVERIFIABLE_DOMAINS = new Set([
  'reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com', 'np.reddit.com',
  'quora.com', 'www.quora.com',
  'medium.com', // anyone can publish; URLs hallucinate perfectly
  'twitter.com', 'x.com', // rate limits + requires auth
])

// Legit domains that commonly 403 a HEAD request — treat 403 as OK
// when the domain is on this allowlist. Otherwise 403 is a fail.
const HEAD_403_OK = new Set([
  'github.com', 'www.github.com',
  'linkedin.com', 'www.linkedin.com',
  'youtube.com', 'www.youtube.com',
  'amazon.com', 'www.amazon.com',
  // Trustpilot blocks automated HEAD requests while the public review page
  // remains browser-verifiable.
  'trustpilot.com', 'www.trustpilot.com',
  // ScamAdviser frequently times out/blocks automated HEAD checks; the public
  // page is still browser-verifiable and is acceptable as supporting evidence.
  'scamadviser.com', 'www.scamadviser.com',
])

const CHECK_TIMEOUT_MS = 5000
const USER_AGENT = 'CryptoKillerBot/1.0 (+https://cryptokiller.org; source-verification)'

/**
 * HEAD-check a single URL with a short timeout. Returns:
 *   { ok: true }
 *   { ok: false, reason: string }
 * We only fail on hard negatives: malformed URL, unverifiable domain,
 * DNS/network failure, non-2xx non-403 response (or 403 outside the
 * allowlist). Redirects are followed. A 405 (method not allowed) retries
 * once as a ranged GET — some gov hosts reject HEAD outright.
 */
async function headCheckUrl(url) {
  if (!url || typeof url !== 'string') {
    return { ok: false, reason: 'missing or non-string URL' }
  }
  let host
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return { ok: false, reason: `malformed URL (${url})` }
  }
  if (UNVERIFIABLE_DOMAINS.has(host)) {
    return {
      ok: false,
      reason:
        `unverifiable domain '${host}' — these URLs hallucinate perfectly ` +
        `and cannot be programmatically checked. Replace with a ` +
        `government/regulatory source, or remove.`,
    }
  }
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT },
    })
    if (res.ok) return { ok: true }
    if (res.status === 403 && HEAD_403_OK.has(host)) return { ok: true }
    if (res.status === 405 || res.status === 501) {
      // Host rejects HEAD — retry as a bounded GET before failing.
      const getRes = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT, Range: 'bytes=0-2047' },
      })
      if (getRes.ok || getRes.status === 206) return { ok: true }
      return { ok: false, reason: `HTTP ${getRes.status} (GET fallback)` }
    }
    return { ok: false, reason: `HTTP ${res.status}` }
  } catch (e) {
    if (HEAD_403_OK.has(host)) return { ok: true }
    return { ok: false, reason: `network: ${e.message || 'unknown error'}` }
  }
}

/**
 * Verify every URL in a source ledger BEFORE the writer sees it.
 *
 * @param {Array<{title,url,type,extract?,generic?}>} ledger
 * @returns {Promise<{verified: Array, dropped: Array<{source, reason}>}>}
 *   - verified: sources whose URL passed, with verified:true stamped
 *   - dropped:  sources removed, with the machine reason (for SSE/diagnostics)
 *
 * Generic sources (the static regulatory fallback set) are checked too,
 * but a transient failure on a known-good generic source keeps it with
 * verified:false rather than dropping it — the writer prompt already
 * restricts how generic sources may be cited.
 */
async function verifySourceLedger(ledger) {
  const sources = Array.isArray(ledger) ? ledger.filter((s) => s && s.url) : []
  if (sources.length === 0) return { verified: [], dropped: [] }

  const results = await Promise.allSettled(sources.map((s) => headCheckUrl(s.url)))

  const verified = []
  const dropped = []
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i]
    const r = results[i]
    const check = r.status === 'fulfilled' ? r.value : { ok: false, reason: `check threw: ${r.reason?.message || r.reason}` }
    if (check.ok) {
      verified.push({ ...src, verified: true })
    } else if (src.generic) {
      // Known-good static resource on a transient failure — keep, unverified.
      verified.push({ ...src, verified: false })
    } else {
      dropped.push({ source: { title: src.title, url: src.url, type: src.type }, reason: check.reason })
    }
  }
  return { verified, dropped }
}

/**
 * SEC EDGAR full-text search — open API, no key, SEC requires a
 * descriptive User-Agent. Exact-phrase search on the brand name.
 * Returns a ledger-shaped source when EDGAR has any filing/document hit,
 * else null. Never throws.
 */
async function secEdgarLookup(brandName) {
  if (!brandName || typeof brandName !== 'string') return null
  try {
    const q = encodeURIComponent(`"${brandName.trim()}"`)
    const res = await fetch(`https://efts.sec.gov/LATEST/search-index?q=${q}`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = await res.json()
    const total = data?.hits?.total?.value ?? 0
    if (total > 0) {
      return {
        title: `SEC EDGAR full-text search: "${brandName}"`,
        // Human-viewable search UI — citable; the JSON API endpoint that
        // produced the count is recorded in lookup.api below.
        url: `https://www.sec.gov/edgar/search/#/q=${q}`,
        type: 'regulatory',
        verified: true,
        relevance: `EDGAR full-text search returns ${total} document hit${total === 1 ? '' : 's'} for the exact phrase "${brandName}".`,
        extract: `${total} EDGAR document${total === 1 ? '' : 's'} mention "${brandName}".`,
        lookup: { registry: 'sec_edgar_fts', hits: total, api: `https://efts.sec.gov/LATEST/search-index?q=${q}` },
      }
    }
    // Zero hits is itself a usable, deterministic fact for the writer.
    return {
      title: `SEC EDGAR: no filings mention "${brandName}"`,
      url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany',
      type: 'regulatory',
      verified: true,
      relevance: `EDGAR full-text search returns zero documents for the exact phrase "${brandName}" — the entity has no SEC filing footprint.`,
      extract: `0 EDGAR documents mention "${brandName}" (full-text search).`,
      lookup: { registry: 'sec_edgar_fts', hits: 0 },
    }
  } catch (e) {
    // Visible failure: the Crest Fundgrove run shipped without an EDGAR
    // finding and nothing in the logs said why. Soft-fail stays (regulator
    // lookups must never kill a generation) but now it leaves a trace.
    console.warn('[source-verify] SEC EDGAR lookup failed (non-fatal):', e?.message || e)
    return null
  }
}

/**
 * FCA Financial Services Register search — optional. Requires the free
 * developer credentials from register.fca.org.uk set as FCA_API_EMAIL and
 * FCA_API_KEY. Searches firms by name; distinguishes register presence
 * (authorized) from absence. Never throws; returns null when creds are
 * unset or the API is unreachable.
 */
async function fcaRegisterLookup(brandName) {
  const email = process.env.FCA_API_EMAIL || ''
  const key = process.env.FCA_API_KEY || ''
  if (!email || !key || !brandName) return null
  try {
    const q = encodeURIComponent(brandName.trim())
    const res = await fetch(
      `https://register.fca.org.uk/services/V0.1/Search?q=${q}&type=firm`,
      {
        signal: AbortSignal.timeout(8000),
        headers: {
          'X-Auth-Email': email,
          'X-Auth-Key': key,
          'Content-Type': 'application/json',
        },
      }
    )
    if (!res.ok) return null
    const data = await res.json()
    const matches = Array.isArray(data?.Data) ? data.Data : []
    const exact = matches.find(
      (m) => (m?.Name || '').trim().toLowerCase() === brandName.trim().toLowerCase()
    )
    if (exact) {
      return {
        title: `FCA Financial Services Register: ${exact.Name}`,
        url: exact?.URL || 'https://register.fca.org.uk/',
        type: 'regulatory',
        verified: true,
        relevance: `"${brandName}" appears on the FCA Financial Services Register (status: ${exact?.Status || 'unknown'}).`,
        extract: `FCA register match: ${exact.Name} — status ${exact?.Status || 'unknown'}.`,
        lookup: { registry: 'fca_register', status: exact?.Status || null },
      }
    }
    return {
      title: `FCA Financial Services Register: no entry for "${brandName}"`,
      url: 'https://register.fca.org.uk/',
      type: 'regulatory',
      verified: true,
      relevance: `"${brandName}" does not appear on the FCA's Financial Services Register of authorized firms (API search, ${matches.length} non-exact result${matches.length === 1 ? '' : 's'}).`,
      extract: `No exact FCA register entry for "${brandName}" — unregistered with the FCA.`,
      lookup: { registry: 'fca_register', status: 'not_found' },
    }
  } catch (e) {
    console.warn('[source-verify] FCA register lookup failed (non-fatal):', e?.message || e)
    return null
  }
}

/**
 * FCA Warning List probe — no API, no key. The FCA publishes each warning
 * at a predictable URL: fca.org.uk/news/warnings/<brand-slug>. For scam
 * brands this is the single strongest brand-specific regulatory citation
 * (far stronger than register absence), so probe the slug candidates with
 * a HEAD request. A 200 = official FCA warning naming this brand.
 *
 * False negatives are expected (the FCA appends domain suffixes to slugs
 * for repeat offenders, e.g. 'immediate-connect-wwwimmediateconnect-gbcom')
 * — a miss here just means no source is added; the Gemini researcher can
 * still surface suffix-variant warning pages, which then pass URL
 * verification like any other source. Never throws.
 */
async function fcaWarningListProbe(brandName) {
  if (!brandName || typeof brandName !== 'string') return null
  const baseSlug = brandName
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!baseSlug) return null

  const candidates = [baseSlug, `${baseSlug}-clone`]
  for (const slug of candidates) {
    const url = `https://www.fca.org.uk/news/warnings/${slug}`
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT },
      })
      if (res.ok) {
        return {
          title: `FCA Warning List: ${brandName}`,
          url,
          type: 'regulatory',
          verified: true,
          relevance: `The UK Financial Conduct Authority has published an official Warning List entry naming "${brandName}" as a firm operating without authorisation.`,
          extract: `The FCA has added ${brandName} to its Warning List of unauthorised firms.`,
          lookup: { registry: 'fca_warning_list', slug },
        }
      }
    } catch {
      // network failure on one candidate — try the next, then give up quietly
    }
  }
  return null
}

/**
 * Drop sources that point at the INVESTIGATED BRAND'S OWN web properties.
 * Caught on Crest Fundgrove (2026-06-10): Gemini's source research returned
 * the scam's own landing site ("Crest Fundgrove | Official Website Platform",
 * crestfundgrove.com), it passed HEAD verification (live scam sites return
 * 200), and the published review rendered a clickable link TO THE SCAM under
 * "Sources & References". The brand's own domain is evidence (item_reviewed
 * .url, claims[].appearance via the archived landing URLs) — never a source.
 *
 * Matching: hostname (minus www.) contains the slugified brand name, or
 * matches the hostname of any known landing URL for the brand.
 */
function filterBrandOwnedSources(ledger, brandName, landingUrls = []) {
  const sources = Array.isArray(ledger) ? ledger : []
  const brandSlug = String(brandName || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]/g, '')
  const landingHosts = new Set(
    (landingUrls || [])
      .map((u) => {
        try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase() } catch { return null }
      })
      .filter(Boolean)
  )
  const kept = []
  const droppedBrandOwned = []
  for (const s of sources) {
    let host = ''
    try { host = new URL(s.url).hostname.replace(/^www\./, '').toLowerCase() } catch { kept.push(s); continue }
    const hostFlat = host.replace(/[^a-z0-9]/g, '')
    const isBrandOwned =
      landingHosts.has(host) ||
      (brandSlug.length >= 6 && hostFlat.includes(brandSlug))
    if (isBrandOwned) droppedBrandOwned.push({ source: { title: s.title, url: s.url }, reason: `brand-owned domain '${host}' — the investigated brand's own site is never a citable source` })
    else kept.push(s)
  }
  return { kept, droppedBrandOwned }
}

/**
 * Run every available deterministic regulator lookup for a brand.
 * Best-effort: each lookup independently soft-fails to null.
 * @returns {Promise<Array>} ledger-shaped sources (possibly empty)
 */
async function buildRegulatorSources(brandName) {
  const results = await Promise.allSettled([
    secEdgarLookup(brandName),
    fcaRegisterLookup(brandName),
    fcaWarningListProbe(brandName),
  ])
  return results
    .filter((r) => r.status === 'fulfilled' && r.value)
    .map((r) => r.value)
}

module.exports = {
  headCheckUrl,
  verifySourceLedger,
  filterBrandOwnedSources,
  secEdgarLookup,
  fcaRegisterLookup,
  fcaWarningListProbe,
  buildRegulatorSources,
  UNVERIFIABLE_DOMAINS,
  HEAD_403_OK,
}
