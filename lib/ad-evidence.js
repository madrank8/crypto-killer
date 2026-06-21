/**
 * lib/ad-evidence.js — embed real scraped ad creatives as first-party evidence
 *
 * Celebrity-impersonation reviews should carry the actual SpyOwl-captured scam
 * ad screenshots — that's CryptoKiller's strongest first-party E-E-A-T signal.
 * This module fetches the real creatives, caches them in Supabase Storage, and
 * injects an "Evidence: Fraudulent Ad Creatives by Country" grid into the
 * review's full_article HTML.
 *
 * Shared by the generate route (write time), the manual images route, and the
 * polish step (so evidence is re-embedded on every publish and survives a
 * regenerate — once a creative is cached in storage it no longer needs SpyOwl).
 *
 * Storage budget: capped at MAX_EVIDENCE_IMAGES (5) creatives per review — a
 * representative sample is enough; we don't store dozens of near-duplicate ads.
 *
 * Never throws — evidence is additive; a SpyOwl/storage failure returns the
 * article unchanged with imagesEmbedded:0 so publishing is never blocked.
 */

import { supabaseRequest, SUPABASE_URL } from '@/lib/supabase'

const SPYOWL_API = 'https://api.spyowl.icu'
// Service-role key for storage WRITES — the creative-images bucket's RLS
// rejects the anon key ("new row violates row-level security policy"), which
// silently failed every evidence upload. Matches lib/images.js uploadToSupabase.
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const STORAGE_BASE = SUPABASE_URL ? `${SUPABASE_URL}/storage/v1/object/public/creative-images` : ''
const STORAGE_UPLOAD_BASE = SUPABASE_URL ? `${SUPABASE_URL}/storage/v1/object/creative-images` : ''

// Representative sample per review — 5 keeps storage lean without losing the
// "real evidence across countries" signal.
export const MAX_EVIDENCE_IMAGES = 5

const countryNames = { US: '🇺🇸 United States', GB: '🇬🇧 United Kingdom', CA: '🇨🇦 Canada', FR: '🇫🇷 France', DE: '🇩🇪 Germany', AU: '🇦🇺 Australia', IN: '🇮🇳 India', BR: '🇧🇷 Brazil', ES: '🇪🇸 Spain', IT: '🇮🇹 Italy', MX: '🇲🇽 Mexico', ZA: '🇿🇦 South Africa', NL: '🇳🇱 Netherlands', PL: '🇵🇱 Poland', SE: '🇸🇪 Sweden', AT: '🇦🇹 Austria', CH: '🇨🇭 Switzerland', BE: '🇧🇪 Belgium', CZ: '🇨🇿 Czechia', DK: '🇩🇰 Denmark', FI: '🇫🇮 Finland', NO: '🇳🇴 Norway', IE: '🇮🇪 Ireland', PT: '🇵🇹 Portugal', RO: '🇷🇴 Romania', HU: '🇭🇺 Hungary', GR: '🇬🇷 Greece', JP: '🇯🇵 Japan', KR: '🇰🇷 South Korea', SG: '🇸🇬 Singapore', MY: '🇲🇾 Malaysia', TH: '🇹🇭 Thailand', PH: '🇵🇭 Philippines', ID: '🇮🇩 Indonesia', NZ: '🇳🇿 New Zealand', NG: '🇳🇬 Nigeria', KE: '🇰🇪 Kenya', AR: '🇦🇷 Argentina', CO: '🇨🇴 Colombia', CL: '🇨🇱 Chile', HK: '🇭🇰 Hong Kong', RS: '🇷🇸 Serbia', BG: '🇧🇬 Bulgaria', HR: '🇭🇷 Croatia', SK: '🇸🇰 Slovakia', LT: '🇱🇹 Lithuania', LV: '🇱🇻 Latvia', EE: '🇪🇪 Estonia', EG: '🇪🇬 Egypt', PE: '🇵🇪 Peru' }
const getCountryName = (code) => countryNames[code] || `🌐 ${code}`
const escHtml = (str) => (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function getSpyOwlCookie() {
  let token = ''
  try {
    const rows = await supabaseRequest('/settings?key=eq.spyowl_cookie&select=value')
    token = Array.isArray(rows) && rows[0]?.value ? rows[0].value.trim() : ''
  } catch { /* fall through */ }
  if (!token) token = process.env.SPYOWL_COOKIE || ''
  if (!token) return ''
  if (token.includes('=')) return token
  return `__Secure-spyowl.session_token=${token}`
}

/**
 * Build (and cache) the evidence image set for a brand, capped at `limit`.
 * Reuses storage-cached images first (no SpyOwl needed), then falls back to a
 * SpyOwl fetch + upload. Returns { images:[{geo,celebrity,url}], geoCounts }.
 */
async function resolveEvidenceImages(brand, limit) {
  const allCreatives = await supabaseRequest(
    `/creatives?normalized_offer=eq.${encodeURIComponent(brand.normalized_name)}` +
    `&is_video=eq.false&celebrity_name=neq.&select=id,geo,celebrity_name&order=last_seen_at.desc&limit=500`
  )
  const photoCreatives = (Array.isArray(allCreatives) ? allCreatives : [])
    .filter((c) => c.celebrity_name && c.celebrity_name !== 'Not mentioned')
  if (photoCreatives.length === 0) return { images: [], geoCounts: {} }

  const geoCounts = {}
  for (const c of photoCreatives) geoCounts[c.geo] = (geoCounts[c.geo] || 0) + 1
  const topGeos = Object.entries(geoCounts).sort((a, b) => b[1] - a[1]).map(([geo]) => geo)

  // Candidate grid: walk geos by volume, top celebs each, one creative per
  // celeb — then cap the whole set to `limit` (storage budget).
  const grid = []
  for (const geo of topGeos) {
    const geoCreatives = photoCreatives.filter((c) => c.geo === geo)
    const celebCounts = {}
    for (const c of geoCreatives) celebCounts[c.celebrity_name] = (celebCounts[c.celebrity_name] || 0) + 1
    const topCelebs = Object.entries(celebCounts).sort((a, b) => b[1] - a[1]).map(([celeb]) => celeb)
    for (const celeb of topCelebs) {
      const creative = geoCreatives.find((c) => c.celebrity_name === celeb)
      if (creative) grid.push({ geo, celebrity: celeb, id: creative.id })
      if (grid.length >= limit) break
    }
    if (grid.length >= limit) break
  }

  if (!STORAGE_BASE || grid.length === 0) return { images: [], geoCounts }

  const cookie = await getSpyOwlCookie()
  const resolved = await Promise.all(grid.map(async (entry) => {
    const publicUrl = `${STORAGE_BASE}/${entry.id}.webp`
    try {
      // Reuse already-cached image (no SpyOwl needed).
      const head = await fetch(publicUrl, { method: 'HEAD' })
      if (head.ok) return { ...entry, url: publicUrl }
      if (!cookie) return null
      const spy = await fetch(`${SPYOWL_API}/s3/creatives/${entry.id}/mediaFile.webp`, { headers: { Cookie: cookie } })
      if (!spy.ok) return null
      const buf = await spy.arrayBuffer()
      if (buf.byteLength < 1000) return null
      const up = await fetch(`${STORAGE_UPLOAD_BASE}/${entry.id}.webp`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'image/webp', 'x-upsert': 'true' },
        body: buf,
      })
      if (!up.ok) return null
      return { ...entry, url: publicUrl }
    } catch { return null }
  }))
  return { images: resolved.filter(Boolean), geoCounts }
}

function buildEvidenceGridHtml(images, geoCounts, brandName) {
  const byGeo = {}
  for (const img of images) (byGeo[img.geo] ||= []).push(img)

  const imgStyle = 'width:100%;height:180px;object-fit:cover;border-radius:6px;border:1px solid rgba(255,255,255,0.1)'
  const cardStyle = 'flex:1;min-width:140px;max-width:220px;text-align:center'
  const captionStyle = 'font-size:12px;color:rgba(255,255,255,0.6);margin-top:6px;line-height:1.4'
  const geoHeaderStyle = 'color:#f59e0b;font-size:15px;font-weight:600;margin:20px 0 10px;padding:6px 12px;background:rgba(245,158,11,0.08);border-radius:6px;display:inline-block'
  const rowStyle = 'display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px'

  let geoSections = ''
  for (const geo of Object.keys(byGeo)) {
    geoSections += `<div style="${geoHeaderStyle}">${getCountryName(geo)} — ${geoCounts[geo] || 0} ads detected</div>\n<div style="${rowStyle}">\n`
    for (const img of byGeo[geo]) {
      const alt = `${escHtml(brandName)} scam ad impersonating ${escHtml(img.celebrity)} in ${img.geo}`
      geoSections += `<div style="${cardStyle}"><img src="${img.url}" alt="${alt}" style="${imgStyle}" loading="lazy" /><p style="${captionStyle}">${escHtml(img.celebrity)}</p></div>\n`
    }
    geoSections += `</div>\n`
  }

  return `<h2 style="color:#f59e0b;font-size:20px;margin:32px 0 12px;border-bottom:1px solid rgba(245,158,11,0.3);padding-bottom:8px">Evidence: Fraudulent Ad Creatives by Country</h2>
<p style="line-height:1.7;margin:0 0 16px;color:rgba(255,255,255,0.7);font-size:14px">The following screenshots were captured by CryptoKiller ad surveillance. Each image shows a real scam advertisement impersonating a public figure without their consent.</p>
${geoSections}`
}

function injectGrid(fullArticle, gridHtml) {
  const article = String(fullArticle || '')
  const gridStart = article.search(/<h2[^>]*>Evidence: Fraudulent Ad Creatives/)
  if (gridStart !== -1) {
    // Replace the existing grid (ends at the next h2/h3 after it).
    const afterGrid = article.substring(gridStart)
    // Match the next section heading after the grid. Allow `<h2>` (no attrs)
    // AND `<h2 ...>` — requiring a space would miss plain headings and
    // truncate the article tail (content loss).
    const nextSection = afterGrid.match(/(?:^[\s\S]*?<\/div>\s*\n?)(<(?:h2|h3)[\s>])/)
    if (nextSection) {
      const endIdx = gridStart + afterGrid.indexOf(nextSection[1])
      return article.substring(0, gridStart) + gridHtml + '\n' + article.substring(endIdx)
    }
    // SAFETY: couldn't locate the end of the existing grid. Do NOT truncate
    // everything after gridStart (that wiped a review's prose down to just the
    // grid). Leave the article untouched — re-embed is skipped, never destructive.
    return article
  }
  // No existing grid — insert after the author byline (first </div>).
  const bylineEnd = article.indexOf('</div>')
  if (bylineEnd !== -1) {
    const at = bylineEnd + 6
    return article.substring(0, at) + '\n\n' + gridHtml + '\n' + article.substring(at)
  }
  return gridHtml + '\n' + article
}

/**
 * Embed (or refresh) the ad-creative evidence grid in a review's full_article.
 * @param {object} args
 * @param {object} args.brand        - scam_brands row (needs normalized_name, name)
 * @param {string} args.fullArticle  - current full_article HTML
 * @param {number} [args.limit]      - max evidence images (default 5)
 * @returns {Promise<{ fullArticle: string, imagesEmbedded: number }>}
 */
export async function embedAdEvidence({ brand, fullArticle, limit = MAX_EVIDENCE_IMAGES }) {
  try {
    if (!brand?.normalized_name) return { fullArticle, imagesEmbedded: 0 }
    const { images, geoCounts } = await resolveEvidenceImages(brand, limit)
    if (images.length === 0) return { fullArticle, imagesEmbedded: 0 }
    const gridHtml = buildEvidenceGridHtml(images, geoCounts, brand.name || brand.normalized_name)
    const before = String(fullArticle || '')
    const out = injectGrid(before, gridHtml)
    // Guard: embedding only ADDS a grid, so the result must not be dramatically
    // shorter than the input. If it is, an inject bug dropped article content —
    // refuse the result and keep the original prose intact.
    if (before.length > 2000 && out.length < before.length * 0.5) {
      return { fullArticle, imagesEmbedded: 0 }
    }
    return { fullArticle: out, imagesEmbedded: images.length }
  } catch {
    return { fullArticle, imagesEmbedded: 0 }
  }
}
