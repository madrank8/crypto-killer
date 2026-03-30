import { supabaseRequest, SUPABASE_URL } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

const SPYOWL_API = 'https://api.spyowl.icu'
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const STORAGE_BASE = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/creative-images`
  : ''
const STORAGE_UPLOAD_BASE = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/creative-images`
  : ''

// Build SpyOwl Cookie header from stored token
async function getSpyOwlCookie() {
  let token = ''
  try {
    const rows = await supabaseRequest("/settings?key=eq.spyowl_cookie&select=value")
    token = Array.isArray(rows) && rows[0]?.value ? rows[0].value.trim() : ''
  } catch { /* fall through */ }
  if (!token) token = process.env.SPYOWL_COOKIE || ''
  if (!token) return ''
  if (token.includes('=')) return token
  return `__Secure-spyowl.session_token=${token}`
}

const countryNames = { US: '🇺🇸 United States', GB: '🇬🇧 United Kingdom', CA: '🇨🇦 Canada', FR: '🇫🇷 France', DE: '🇩🇪 Germany', AU: '🇦🇺 Australia', IN: '🇮🇳 India', BR: '🇧🇷 Brazil', ES: '🇪🇸 Spain', IT: '🇮🇹 Italy', MX: '🇲🇽 Mexico', ZA: '🇿🇦 South Africa', NL: '🇳🇱 Netherlands', PL: '🇵🇱 Poland', SE: '🇸🇪 Sweden', AT: '🇦🇹 Austria', CH: '🇨🇭 Switzerland', BE: '🇧🇪 Belgium', CZ: '🇨🇿 Czechia', DK: '🇩🇰 Denmark', FI: '🇫🇮 Finland', NO: '🇳🇴 Norway', IE: '🇮🇪 Ireland', PT: '🇵🇹 Portugal', RO: '🇷🇴 Romania', HU: '🇭🇺 Hungary', GR: '🇬🇷 Greece', JP: '🇯🇵 Japan', KR: '🇰🇷 South Korea', SG: '🇸🇬 Singapore', MY: '🇲🇾 Malaysia', TH: '🇹🇭 Thailand', PH: '🇵🇭 Philippines', ID: '🇮🇩 Indonesia', NZ: '🇳🇿 New Zealand', NG: '🇳🇬 Nigeria', KE: '🇰🇪 Kenya', AR: '🇦🇷 Argentina', CO: '🇨🇴 Colombia', CL: '🇨🇱 Chile', HK: '🇭🇰 Hong Kong', RS: '🇷🇸 Serbia', BG: '🇧🇬 Bulgaria', HR: '🇭🇷 Croatia', SK: '🇸🇰 Slovakia', LT: '🇱🇹 Lithuania', LV: '🇱🇻 Latvia', EE: '🇪🇪 Estonia', EG: '🇪🇬 Egypt', PE: '🇵🇪 Peru' }
const getCountryName = (code) => countryNames[code] || `🌐 ${code}`
const escHtml = (str) => (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const maxDuration = 60

/**
 * POST /api/admin/reviews/[id]/images
 * Regenerate evidence grid images only — does NOT regenerate the full article.
 * Fetches new images from SpyOwl, uploads to Supabase Storage, then
 * rebuilds the evidence grid HTML and patches it into full_article.
 *
 * Body: {} (no params needed — uses brand_id from the review)
 */
export async function POST(request, { params }) {
  try {
    verifyAdmin(request)

    const { id } = params
    const SPYOWL_COOKIE = await getSpyOwlCookie()

    // 1. Fetch the review to get brand_id and current full_article
    const reviewData = await supabaseRequest(`/reviews?id=eq.${id}&select=id,brand_id,full_article`)
    if (!Array.isArray(reviewData) || reviewData.length === 0) {
      return Response.json({ error: 'Review not found' }, { status: 404 })
    }
    const review = reviewData[0]

    // 2. Fetch brand data
    const brandData = await supabaseRequest(`/scam_brands?id=eq.${review.brand_id}&select=*`)
    if (!Array.isArray(brandData) || brandData.length === 0) {
      return Response.json({ error: 'Brand not found' }, { status: 404 })
    }
    const brand = brandData[0]

    // 3. Query ALL photo creatives with celebrities for this brand
    const allCreatives = await supabaseRequest(
      `/creatives?normalized_offer=eq.${encodeURIComponent(
        brand.normalized_name
      )}&is_video=eq.false&celebrity_name=neq.&select=id,geo,celebrity_name&order=last_seen_at.desc&limit=500`
    )
    const photoCreatives = (Array.isArray(allCreatives) ? allCreatives : [])
      .filter(c => c.celebrity_name && c.celebrity_name !== 'Not mentioned')

    // 4. Count per geo, pick top 3
    const geoCounts = {}
    for (const c of photoCreatives) {
      geoCounts[c.geo] = (geoCounts[c.geo] || 0) + 1
    }
    const topGeos = Object.entries(geoCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([geo]) => geo)

    // 5. For each top geo, top 3 celebs, one creative each
    const evidenceGrid = []
    for (const geo of topGeos) {
      const geoCreatives = photoCreatives.filter(c => c.geo === geo)
      const celebCounts = {}
      for (const c of geoCreatives) {
        celebCounts[c.celebrity_name] = (celebCounts[c.celebrity_name] || 0) + 1
      }
      const topCelebs = Object.entries(celebCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
      for (const [celeb] of topCelebs) {
        const creative = geoCreatives.find(c => c.celebrity_name === celeb)
        if (creative) evidenceGrid.push({ geo, celebrity: celeb, id: creative.id })
      }
    }

    if (evidenceGrid.length === 0) {
      return Response.json({
        success: false,
        error: 'No photo creatives with celebrities found for this brand',
        images_found: 0,
      })
    }

    // 6. Fetch from SpyOwl → upload to Supabase Storage
    let availableImages = []
    if (STORAGE_BASE) {
      const fetchPromises = evidenceGrid.map(async (entry) => {
        const publicUrl = `${STORAGE_BASE}/${entry.id}.webp`
        try {
          // Check if already in storage
          const headRes = await fetch(publicUrl, { method: 'HEAD' })
          if (headRes.ok) {
            return { ...entry, url: publicUrl }
          }
          // Fetch from SpyOwl
          if (!SPYOWL_COOKIE) return null
          const spyRes = await fetch(`${SPYOWL_API}/s3/creatives/${entry.id}/mediaFile.webp`, {
            headers: { 'Cookie': SPYOWL_COOKIE },
          })
          if (!spyRes.ok) return null
          const imgBuffer = await spyRes.arrayBuffer()
          if (imgBuffer.byteLength < 1000) return null
          // Upload to Supabase Storage
          const uploadUrl = `${STORAGE_UPLOAD_BASE}/${entry.id}.webp`
          const uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'image/webp',
              'x-upsert': 'true',
            },
            body: imgBuffer,
          })
          if (!uploadRes.ok) return null
          return { ...entry, url: publicUrl }
        } catch { return null }
      })
      availableImages = (await Promise.all(fetchPromises)).filter(Boolean)
    }

    if (availableImages.length === 0) {
      return Response.json({
        success: false,
        error: SPYOWL_COOKIE
          ? 'Failed to fetch images — SpyOwl may be down or images unavailable'
          : 'No SpyOwl cookie configured — set it in Settings',
        images_found: 0,
      })
    }

    // 7. Build evidence grid HTML (same format as generate route)
    const byGeo = {}
    for (const img of availableImages) {
      if (!byGeo[img.geo]) byGeo[img.geo] = []
      byGeo[img.geo].push(img)
    }

    const imgStyle = 'width:100%;height:180px;object-fit:cover;border-radius:6px;border:1px solid rgba(255,255,255,0.1)'
    const cardStyle = 'flex:1;min-width:140px;max-width:220px;text-align:center'
    const captionStyle = 'font-size:12px;color:rgba(255,255,255,0.6);margin-top:6px;line-height:1.4'
    const geoHeaderStyle = 'color:#f59e0b;font-size:15px;font-weight:600;margin:20px 0 10px;padding:6px 12px;background:rgba(245,158,11,0.08);border-radius:6px;display:inline-block'
    const rowStyle = 'display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px'

    let geoSections = ''
    for (const geo of Object.keys(byGeo)) {
      const imgs = byGeo[geo]
      const geoCount = geoCounts[geo] || 0
      geoSections += `<div style="${geoHeaderStyle}">${getCountryName(geo)} — ${geoCount} ads detected</div>\n<div style="${rowStyle}">\n`
      for (const img of imgs) {
        const altText = `${escHtml(brand.name)} scam ad impersonating ${escHtml(img.celebrity)} in ${img.geo}`
        geoSections += `<div style="${cardStyle}"><img src="${img.url}" alt="${altText}" style="${imgStyle}" loading="lazy" /><p style="${captionStyle}">${escHtml(img.celebrity)}</p></div>\n`
      }
      geoSections += `</div>\n`
    }

    const newGridHtml = `<h2 style="color:#f59e0b;font-size:20px;margin:32px 0 12px;border-bottom:1px solid rgba(245,158,11,0.3);padding-bottom:8px">Evidence: Fraudulent Ad Creatives by Country</h2>
<p style="line-height:1.7;margin:0 0 16px;color:rgba(255,255,255,0.7);font-size:14px">The following screenshots were captured by SpyOwl ad surveillance. Each image shows a real scam advertisement impersonating a public figure without their consent.</p>
${geoSections}`

    // 8. Replace evidence grid in full_article
    let fullArticle = review.full_article || ''
    // Match existing evidence grid: starts with the <h2> for Evidence, ends before next <h2> or major section
    const gridStartPattern = /<h2[^>]*>Evidence: Fraudulent Ad Creatives/
    const gridStart = fullArticle.search(gridStartPattern)

    if (gridStart !== -1) {
      // Find where the evidence section ends (next <h2> or </details> or <h3 for Key Takeaways)
      const afterGrid = fullArticle.substring(gridStart)
      // Evidence grid ends at the next <h2 or <h3 section after it
      const nextSectionMatch = afterGrid.match(/(?:^[\s\S]*?<\/div>\s*\n?)(<(?:h2|h3)\s)/)
      if (nextSectionMatch) {
        const endIdx = gridStart + afterGrid.indexOf(nextSectionMatch[1])
        fullArticle = fullArticle.substring(0, gridStart) + newGridHtml + '\n' + fullArticle.substring(endIdx)
      } else {
        // Fallback: replace from gridStart to end (shouldn't normally happen)
        fullArticle = fullArticle.substring(0, gridStart) + newGridHtml
      }
    } else {
      // No existing grid — insert after the author byline (first </div>)
      const bylineEnd = fullArticle.indexOf('</div>')
      if (bylineEnd !== -1) {
        const insertAt = bylineEnd + 6
        fullArticle = fullArticle.substring(0, insertAt) + '\n\n' + newGridHtml + '\n' + fullArticle.substring(insertAt)
      } else {
        fullArticle = newGridHtml + '\n' + fullArticle
      }
    }

    // 9. Save updated full_article back to DB
    await supabaseRequest(`/reviews?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        full_article: fullArticle,
        updated_at: new Date().toISOString(),
      }),
      headers: { 'Prefer': 'return=minimal' },
    })

    return Response.json({
      success: true,
      images_found: availableImages.length,
      images: availableImages.map(img => ({
        id: img.id,
        geo: img.geo,
        celebrity: img.celebrity,
        url: img.url,
      })),
    })
  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      return unauthorizedResponse()
    }
    return Response.json({ error: error.message }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/reviews/[id]/images
 * Remove a single image from the evidence grid in full_article.
 * Body: { image_url: "https://..." }
 */
export async function DELETE(request, { params }) {
  try {
    verifyAdmin(request)

    const { id } = params
    const { image_url } = await request.json()

    if (!image_url) {
      return Response.json({ error: 'image_url is required' }, { status: 400 })
    }

    // Fetch current article
    const reviewData = await supabaseRequest(`/reviews?id=eq.${id}&select=id,full_article`)
    if (!Array.isArray(reviewData) || reviewData.length === 0) {
      return Response.json({ error: 'Review not found' }, { status: 404 })
    }

    let fullArticle = reviewData[0].full_article || ''

    // Remove the <div> card containing this image URL
    // Each image card looks like: <div style="..."><img src="URL" ... /><p ...>caption</p></div>
    const escapedUrl = image_url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const imgCardPattern = new RegExp(
      `<div\\s+style="[^"]*(?:flex:1|min-width)[^"]*"[^>]*>\\s*<img\\s+src="${escapedUrl}"[^>]*/?>\\s*<p[^>]*>[^<]*</p>\\s*</div>\\s*\\n?`,
      'g'
    )

    const newArticle = fullArticle.replace(imgCardPattern, '')

    if (newArticle === fullArticle) {
      return Response.json({ success: false, error: 'Image not found in article' })
    }

    // Check if any images remain in the evidence section
    const hasImages = /<img\s+src="[^"]*\/creative-images\//.test(newArticle)

    let finalArticle = newArticle
    // If no images left, remove the entire evidence section header too
    if (!hasImages) {
      finalArticle = finalArticle.replace(
        /<h2[^>]*>Evidence: Fraudulent Ad Creatives[^<]*<\/h2>\s*<p[^>]*>The following screenshots[^<]*<\/p>\s*/g,
        ''
      )
      // Clean up empty geo headers and rows
      finalArticle = finalArticle.replace(
        /<div style="[^"]*background:rgba\(245,158,11[^"]*">[^<]*<\/div>\s*<div style="[^"]*display:flex[^"]*">\s*<\/div>\s*/g,
        ''
      )
    }

    // Save
    await supabaseRequest(`/reviews?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        full_article: finalArticle,
        updated_at: new Date().toISOString(),
      }),
      headers: { 'Prefer': 'return=minimal' },
    })

    return Response.json({ success: true, images_remaining: hasImages })
  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      return unauthorizedResponse()
    }
    return Response.json({ error: error.message }, { status: 500 })
  }
}
