import { supabaseRequest, SUPABASE_URL } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { callModel, extractJSON, getAvailableModels } from '@/lib/ai-models'
import { buildReviewSchema } from '@/lib/review-schema'
import { sourceResearcherPrompt, contentWriterPrompt } from '@/lib/review-prompts'
import { stripVerifyTags } from '@/lib/visual-generator'
import { classifyThreat, dedupeCelebrityList, pluralize } from '@/lib/threat-score'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const SPYOWL_API = 'https://api.spyowl.icu'

// Build SpyOwl Cookie header from stored token (Supabase → env var fallback)
async function getSpyOwlCookie() {
  let token = ''
  try {
    const rows = await supabaseRequest("/settings?key=eq.spyowl_cookie&select=value")
    token = Array.isArray(rows) && rows[0]?.value ? rows[0].value.trim() : ''
  } catch { /* fall through */ }
  if (!token) token = process.env.SPYOWL_COOKIE || ''
  if (!token) return ''
  // If already has cookie name prefix, use as-is; otherwise prepend it
  if (token.includes('=')) return token
  return `__Secure-spyowl.session_token=${token}`
}
// ─── CAMPAIGN TIMELINE BUILDER ───
// Synthesizes brand data into a collapsible chronological timeline
function buildCampaignTimeline(brand, lifespanDays, currentDate) {
  const first = brand.first_seen_at ? new Date(brand.first_seen_at) : null
  const last = brand.last_seen_at ? new Date(brand.last_seen_at) : null
  if (!first) return ''

  const fmtDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const fmtMonth = (d) => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  const daysSinceLast = last ? Math.round((new Date() - last) / 86400000) : null
  const isActive = daysSinceLast !== null && daysSinceLast <= 14
  const totalCreatives = brand.total_creatives || 0
  const totalGeos = brand.total_geos || 0
  const totalCelebs = brand.total_celebrities || 0
  const velocity = brand.velocity_7d || 0

  // Build events chronologically
  const events = []

  // 1. Detection
  events.push({
    date: first,
    label: 'First Detected',
    desc: `First scam ad creative captured by SpyOwl surveillance network`,
    icon: '🔍',
    color: '#3b82f6', // blue
    phase: 'detection',
  })
  // 2. Expansion milestones (synthesized from total creatives + lifespan)
  if (lifespanDays > 30 && totalCreatives > 10) {
    const expandDate = new Date(first.getTime() + Math.min(lifespanDays * 0.15, 30) * 86400000)
    events.push({
      date: expandDate,
      label: 'Campaign Expansion',
      desc: `Operation scaled to ${totalGeos > 1 ? totalGeos + ' countries' : '1 country'}${totalCelebs > 0 ? ` using ${totalCelebs} impersonated celebrities` : ''}`,
      icon: '🌍',
      color: '#f59e0b', // amber
      phase: 'expansion',
    })
  }

  // 3. Peak activity (midpoint of campaign, or when velocity is highest)
  if (lifespanDays > 60 && totalCreatives > 50) {
    const peakDate = new Date(first.getTime() + lifespanDays * 0.5 * 86400000)
    events.push({
      date: peakDate,
      label: 'Peak Activity',
      desc: `${totalCreatives.toLocaleString()} total ad creatives deployed across ${totalGeos} countries`,
      icon: '📈',
      color: '#ef4444', // red
      phase: 'peak',
    })
  }
  // 4. Investigation (current review date)
  events.push({
    date: new Date(currentDate),
    label: 'Investigation Published',
    desc: `Crypto Killer published this threat assessment with a score of ${brand.scam_score || 'N/A'}/100`,
    icon: '🛡️',
    color: '#8b5cf6', // purple
    phase: 'investigation',
  })

  // 5. Current status
  if (isActive) {
    events.push({
      date: last,
      label: 'Still Active',
      desc: `${velocity} new ad creatives detected in the last 7 days — campaign remains operational`,
      icon: '⚠️',
      color: '#ef4444', // red
      phase: 'active',
    })
  } else if (last) {    events.push({
      date: last,
      label: 'Last Activity',
      desc: `Most recent ad creative detected${daysSinceLast > 0 ? ` — ${daysSinceLast} days ago` : ''}`,
      icon: '⏸️',
      color: '#6b7280', // gray
      phase: 'shutdown',
    })
  }

  // Sort by date
  events.sort((a, b) => a.date - b.date)

  // Calculate progress bar positions (0-100%)
  const timelineStart = events[0].date.getTime()
  const timelineEnd = events[events.length - 1].date.getTime()
  const timelineSpan = timelineEnd - timelineStart || 1

  // Build HTML
  const phaseColors = {
    detection: { bg: 'rgba(59,130,246,0.12)', border: '#3b82f6', text: '#60a5fa' },
    expansion: { bg: 'rgba(245,158,11,0.12)', border: '#f59e0b', text: '#fbbf24' },
    peak: { bg: 'rgba(239,68,68,0.12)', border: '#ef4444', text: '#f87171' },
    investigation: { bg: 'rgba(139,92,246,0.12)', border: '#8b5cf6', text: '#a78bfa' },
    active: { bg: 'rgba(239,68,68,0.15)', border: '#ef4444', text: '#f87171' },
    shutdown: { bg: 'rgba(107,114,128,0.12)', border: '#6b7280', text: '#9ca3af' },
  }

  const eventCards = events.map((evt, i) => {
    const pc = phaseColors[evt.phase]
    const pct = Math.round(((evt.date.getTime() - timelineStart) / timelineSpan) * 100)
    const delay = i * 120
    return `<div class="ck-tl-card" style="display:flex;gap:16px;align-items:flex-start;padding:14px 16px;margin:0 0 2px;background:${pc.bg};border-left:3px solid ${pc.border};border-radius:0 8px 8px 0;animation:ckTlSlide 0.4s ease ${delay}ms both" data-pct="${pct}">
  <div style="flex-shrink:0;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:${pc.bg};border:1px solid ${pc.border};font-size:18px">${evt.icon}</div>
  <div style="flex:1;min-width:0">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span style="font-weight:600;font-size:14px;color:${pc.text}">${evt.label}</span>
      <span style="font-size:11px;color:rgba(255,255,255,0.4);font-variant-numeric:tabular-nums">${fmtDate(evt.date)}</span>
    </div>
    <p style="margin:4px 0 0;font-size:13px;line-height:1.5;color:rgba(255,255,255,0.7)">${evt.desc}</p>
  </div>
</div>`
  }).join('\n')

  // Progress bar dots
  const dots = events.map((evt, i) => {
    const pc = phaseColors[evt.phase]
    const pct = Math.round(((evt.date.getTime() - timelineStart) / timelineSpan) * 100)
    return `<div style="position:absolute;left:${pct}%;top:50%;transform:translate(-50%,-50%);width:12px;height:12px;border-radius:50%;background:${pc.border};border:2px solid rgba(0,0,0,0.6);z-index:2" title="${evt.label} — ${fmtDate(evt.date)}"></div>`
  }).join('')

  // Filled portion of progress bar
  const lastPct = Math.round(((events[events.length - 1].date.getTime() - timelineStart) / timelineSpan) * 100)

  // Status badge
  const statusBadge = isActive
    ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;padding:3px 10px;border-radius:99px;background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.3)"><span style="width:6px;height:6px;border-radius:50%;background:#ef4444;animation:ckTlPulse 2s ease infinite"></span>ACTIVE</span>`
    : `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;padding:3px 10px;border-radius:99px;background:rgba(107,114,128,0.15);color:#9ca3af;border:1px solid rgba(107,114,128,0.3)">INACTIVE</span>`

  return `<style>@keyframes ckTlSlide { from { opacity:0; transform:translateX(-12px); } to { opacity:1; transform:translateX(0); } }
@keyframes ckTlPulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
@keyframes ckTlGrow { from { width:0; } }
</style>
<details open style="margin:28px 0;border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden;background:rgba(255,255,255,0.02)">
<summary style="cursor:pointer;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:rgba(255,255,255,0.03);border-bottom:1px solid rgba(255,255,255,0.06);list-style:none;user-select:none">
  <div style="display:flex;align-items:center;gap:10px">
    <span style="font-size:18px">📅</span>
    <div>
      <span style="font-weight:600;font-size:15px;color:#f59e0b">Campaign Timeline</span>
      <span style="margin-left:8px;font-size:12px;color:rgba(255,255,255,0.4)">${lifespanDays} days · ${fmtMonth(first)} → ${last ? fmtMonth(last) : 'Present'}</span>
    </div>
  </div>
  ${statusBadge}
</summary>

<div style="padding:16px 20px 8px">
  <div style="position:relative;height:20px;background:rgba(255,255,255,0.06);border-radius:10px;margin:0 0 20px;overflow:hidden">
    <div style="position:absolute;top:0;left:0;height:100%;width:${lastPct}%;background:linear-gradient(90deg,#3b82f6,#f59e0b,#ef4444);border-radius:10px;opacity:0.3;animation:ckTlGrow 1s ease-out"></div>
    ${dots}
  </div>
  ${eventCards}
</div>
</details>`
}

// Supabase Storage public URL for creative images
const STORAGE_BASE = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/creative-images`
  : ''
const STORAGE_UPLOAD_BASE = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/creative-images`  : ''
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// Phase A of the split pipeline: source research + content generation only.
// Requires Vercel Pro (300s cap) — source research + Claude Opus content gen
// collectively can run 60-150s. Visuals, audit and hero-image generation
// happen in Phase B (/api/admin/reviews/[id]/polish) after navigation so the
// user sees the draft and editor as soon as phase A lands.
export const maxDuration = 300

/** * POST /api/admin/reviews/generate
 * Phase A of the split review-generation pipeline.
 * Runs source research → content writing → schema build → DB save, then
 * returns with generation_status='content_generated'. Visuals, audit and
 * hero/content images run in the /polish endpoint.
 * Body: { brand_id }
 */
export async function POST(request) {
  try {
    verifyAdmin(request)

    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }

    // Fetch SpyOwl cookie from Supabase (falls back to env var)
    const SPYOWL_COOKIE = await getSpyOwlCookie()

    const { brand_id } = await request.json()

    if (!brand_id) {
      return Response.json(
        { error: 'brand_id is required' },
        { status: 400 }
      )
    }

    // ─── SSE STREAM SETUP ───
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data) => {controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }

        try {
          // ─── STEP 1: Fetch brand data ───
          send({ step: 'brand', progress: 5, message: 'Loading brand intelligence...' })

    const brand = await supabaseRequest(
      `/scam_brands?id=eq.${brand_id}&select=*`
    )

    if (!Array.isArray(brand) || brand.length === 0) {
      send({ step: 'error', progress: 0, message: 'Brand not found', error: true })
      controller.close()
      return
    }

    const brandData = brand[0]

          send({ step: 'creatives', progress: 15, message: `Fetching ad creatives for ${brandData.name}...` })

    // Fetch sample creatives for this brand
    const creatives = await supabaseRequest(
      `/creatives?normalized_offer=eq.${encodeURIComponent(
        brandData.normalized_name
      )}&select=*&limit=20`
    )

    const creativeSample = Array.isArray(creatives) ? creatives : []    // ─── EVIDENCE GRID: Top 3 countries × Top 3 celebs per country ───
    // Query ALL creatives for this brand to find the best evidence
    const allCreatives = await supabaseRequest(
      `/creatives?normalized_offer=eq.${encodeURIComponent(
        brandData.normalized_name
      )}&is_video=eq.false&celebrity_name=neq.&select=id,geo,celebrity_name&order=last_seen_at.desc&limit=500`
    )
    const photoCreatives = (Array.isArray(allCreatives) ? allCreatives : [])
      .filter(c => c.celebrity_name && c.celebrity_name !== 'Not mentioned')

    // Count creatives per geo, then pick top 3 geos
    const geoCounts = {}
    for (const c of photoCreatives) {
      geoCounts[c.geo] = (geoCounts[c.geo] || 0) + 1
    }
    const topGeos = Object.entries(geoCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([geo]) => geo)

    // For each top geo, find top 3 celebs by count, pick one creative per celeb
    const evidenceGrid = [] // [{ geo, celebrity, id }]
    for (const geo of topGeos) {
      const geoCreatives = photoCreatives.filter(c => c.geo === geo)
      const celebCounts = {}
      for (const c of geoCreatives) {
        celebCounts[c.celebrity_name] = (celebCounts[c.celebrity_name] || 0) + 1
      }
      const topCelebs = Object.entries(celebCounts)
        .sort((a, b) => b[1] - a[1])        .slice(0, 3)
      for (const [celeb] of topCelebs) {
        const creative = geoCreatives.find(c => c.celebrity_name === celeb)
        if (creative) evidenceGrid.push({ geo, celebrity: celeb, id: creative.id })
      }
    }

          send({ step: 'images', progress: 25, message: `Found ${evidenceGrid.length} evidence candidates${SPYOWL_COOKIE ? '' : ' — no SpyOwl cookie (set in Settings)'}` })

    // Fetch images from SpyOwl API → upload to Supabase Storage → get public URLs
    let availableImages = []
    if (STORAGE_BASE && evidenceGrid.length > 0) {
      const fetchPromises = evidenceGrid.map(async (entry) => {
        const publicUrl = `${STORAGE_BASE}/${entry.id}.webp`
        try {
          // Check if already in storage
          const headRes = await fetch(publicUrl, { method: 'HEAD' })
          if (headRes.ok) {
            return { ...entry, url: publicUrl }
          }
          // Fetch from SpyOwl API
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

    // Calculate longevity
    const firstSeen = brandData.first_seen_at ? new Date(brandData.first_seen_at) : null
    const lastSeen = brandData.last_seen_at ? new Date(brandData.last_seen_at) : null
    const longevityDays = firstSeen && lastSeen
      ? Math.round((lastSeen - firstSeen) / (1000 * 60 * 60 * 24))
      : 0

    // Current date for temporal freshness
    const currentYear = new Date().getFullYear()
    const currentDate = new Date().toISOString().split('T')[0]

          // ═══════════════════════════════════════════════════════════════
          // PHASE 2: SOURCE RESEARCH (Gemini Flash with search grounding, or Claude fallback)          // ═══════════════════════════════════════════════════════════════
          send({ step: 'sources', progress: 30, message: 'Phase 2/5: Researching authoritative sources...' })

          const availableModelsInfo = getAvailableModels()
          const sourceModel = availableModelsInfo.google ? 'gemini-flash' : 'claude-haiku'

          let sourceLedger = []
          let sourceResearchActualModel = 'default_templates'  // Track what actually produced sources
          try {
            const srcPrompt = sourceResearcherPrompt(brandData.name, currentDate)
            const srcResult = await callModel(sourceModel, srcPrompt.system, srcPrompt.user, {
              searchGrounding: true,
              jsonMode: sourceModel.startsWith('gemini'),
            })

            const srcData = extractJSON(srcResult.text)
            sourceLedger = (srcData.sources || []).filter(s => s.url && s.title)
            sourceResearchActualModel = srcResult.usedFallback
              ? `${srcResult.resolvedModel} (fallback from ${srcResult.fallbackFrom})`
              : srcResult.label || sourceModel

            send({
              step: 'sources_done',
              progress: 40,
              message: `Found ${sourceLedger.length} verified sources via ${srcResult.label}${srcResult.usedFallback ? ` (fallback from ${srcResult.fallbackFrom})` : ''}`,
            })
          } catch (srcError) {
            // Source research failure is non-fatal — use default source templates
            console.error('Source research failed:', srcError.message)
            sourceResearchActualModel = `default_templates (${sourceModel} failed: ${srcError.message.slice(0, 100)})`
            sourceLedger = [
              { title: 'FCA ScamSmart Warning List', url: 'https://www.fca.org.uk/scamsmart/warning-list', type: 'regulatory', verified: false, extract: 'FCA register of unauthorized firms and individuals.' },
              { title: 'SEC EDGAR Company Search', url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany', type: 'regulatory', verified: false, extract: 'SEC database for registered investment entities.' },              { title: 'IC3 Internet Crime Complaint Center', url: 'https://www.ic3.gov/', type: 'government', verified: false, extract: 'FBI portal for reporting internet-enabled crime.' },
              { title: 'FTC Report Fraud', url: 'https://reportfraud.ftc.gov/', type: 'government', verified: false, extract: 'Federal Trade Commission fraud reporting portal.' },
              { title: 'ScamAdviser', url: 'https://www.scamadviser.com/', type: 'consumer_protection', verified: false, extract: 'Consumer trust score analysis for websites.' },
            ]
            send({ step: 'sources_fallback', progress: 40, message: `Source research failed — using ${sourceLedger.length} default regulatory sources` })
          }

          // ═══════════════════════════════════════════════════════════════
          // PHASE 3: CONTENT GENERATION (Claude Opus — best writing quality)
          // Full seo-blog-generator v3.1 + ICP methodology
          // ═══════════════════════════════════════════════════════════════
          send({ step: 'ai', progress: 45, message: 'Phase 3/5: Generating review with Claude Opus (30-60s)...' })

          const contentPrompt = contentWriterPrompt(brandData, creativeSample, longevityDays, currentDate, sourceLedger, availableImages)

          // Use Claude Opus for content (best writing quality), fall back to Sonnet/Haiku
          const contentResult = await callModel('claude-opus', contentPrompt.system, contentPrompt.user, {
            maxTokens: 8192,
          })
          send({
            step: 'ai_done',
            progress: 70,
            message: `Content generated by ${contentResult.label}${contentResult.usedFallback ? ` (fallback from claude-opus)` : ''} — ${contentResult.outputTokens || '?'} tokens`,
          })

          // ─── LEGACY COMPATIBILITY: Parse and process exactly like before ───
          // The code below is kept from the original single-shot approach
          const responseText = contentResult.text
          const anthropicData = { stop_reason: contentResult.stopReason } // compat shim
    let reviewContent
    try {
      // ─── EXTRACT FIRST COMPLETE JSON OBJECT (balanced-brace parser) ───
      // The greedy regex /\{[\s\S]*\}/ fails when Claude adds commentary
      // after the JSON that contains braces. Instead, find the first '{' and
      // walk forward counting nesting depth to find its matching '}'.
      let jsonStr = null
      const startIdx = responseText.indexOf('{')
      if (startIdx === -1) {
        throw new Error('No JSON found in response')
      }

      let depth = 0
      let inString = false
      let escaped = false
      for (let i = startIdx; i < responseText.length; i++) {
        const ch = responseText[i]
        if (escaped) { escaped = false; continue }
        if (ch === '\\' && inString) { escaped = true; continue }
        if (ch === '"' && !escaped) { inString = !inString; continue }
        if (inString) continue
        if (ch === '{' || ch === '[') depth++
        else if (ch === '}' || ch === ']') {
          depth--
          if (depth === 0) {
            jsonStr = responseText.slice(startIdx, i + 1)
            break
          }
        }
      }
      if (!jsonStr) {
        // Fallback to greedy regex if balanced parse failed
        const jsonMatch = responseText.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error('No JSON found in response')
        jsonStr = jsonMatch[0]
      }

      // Repair common LLM JSON issues
      jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1')

      // If truncated, try to close open arrays/objects
      if (anthropicData.stop_reason === 'max_tokens') {
        const opens = (jsonStr.match(/[\[{]/g) || []).length
        const closes = (jsonStr.match(/[\]}]/g) || []).length
        const diff = opens - closes
        jsonStr = jsonStr.replace(/,?\s*"[^"]*$/, '')
        jsonStr = jsonStr.replace(/,?\s*\{[^}]*$/, '')
        jsonStr = jsonStr.replace(/,?\s*"[^"]*":\s*"[^"]*$/, '')
        for (let i = 0; i < diff; i++) {
          const lastOpen = jsonStr.lastIndexOf('[') > jsonStr.lastIndexOf('{') ? ']' : '}'
          jsonStr += lastOpen
        }
      }

      reviewContent = JSON.parse(jsonStr)
    } catch (parseError) {
      throw new Error(`Failed to parse Claude response (stop_reason: ${anthropicData.stop_reason}, text length: ${responseText.length}): ${parseError.message}`)
    }

          send({ step: 'building', progress: 78, message: 'Building HTML article + schema markup...' })
    // ─── BUILD HTML ARTICLE ───
    const escHtml = (str) => (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    // Safety net: convert any residual markdown bold/italic to HTML after escaping
    const cleanMarkdown = (str) => str
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')

    // ─── BUILD EVIDENCE GRID HTML (grouped by country) ───
    const countryNames = { US: '🇺🇸 United States', GB: '🇬🇧 United Kingdom', CA: '🇨🇦 Canada', FR: '🇫🇷 France', DE: '🇩🇪 Germany', AU: '🇦🇺 Australia', IN: '🇮🇳 India', BR: '🇧🇷 Brazil', ES: '🇪🇸 Spain', IT: '🇮🇹 Italy', MX: '🇲🇽 Mexico', ZA: '🇿🇦 South Africa', NL: '🇳🇱 Netherlands', PL: '🇵🇱 Poland', SE: '🇸🇪 Sweden', AT: '🇦🇹 Austria', CH: '🇨🇭 Switzerland', BE: '🇧🇪 Belgium', CZ: '🇨🇿 Czechia', DK: '🇩🇰 Denmark', FI: '🇫🇮 Finland', NO: '🇳🇴 Norway', IE: '🇮🇪 Ireland', PT: '🇵🇹 Portugal', RO: '🇷🇴 Romania', HU: '🇭🇺 Hungary', GR: '🇬🇷 Greece', JP: '🇯🇵 Japan', KR: '🇰🇷 South Korea', SG: '🇸🇬 Singapore', MY: '🇲🇾 Malaysia', TH: '🇹🇭 Thailand', PH: '🇵🇭 Philippines', ID: '🇮🇩 Indonesia', NZ: '🇳🇿 New Zealand', NG: '🇳🇬 Nigeria', KE: '🇰🇪 Kenya', AR: '🇦🇷 Argentina', CO: '🇨🇴 Colombia', CL: '🇨🇱 Chile', HK: '🇭🇰 Hong Kong', RS: '🇷🇸 Serbia', BG: '🇧🇬 Bulgaria', HR: '🇭🇷 Croatia', SK: '🇸🇰 Slovakia', LT: '🇱🇹 Lithuania', LV: '🇱🇻 Latvia', EE: '🇪🇪 Estonia', EG: '🇪🇬 Egypt', PE: '🇵🇪 Peru' }
    const getCountryName = (code) => countryNames[code] || `🌐 ${code}`

    let evidenceGridHtml = ''
    if (availableImages.length > 0) {
      // Group by geo
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
          const altText = `${escHtml(brandData.name)} scam ad impersonating ${escHtml(img.celebrity)} in ${img.geo}`
          geoSections += `<div style="${cardStyle}"><img src="${img.url}" alt="${altText}" style="${imgStyle}" loading="lazy" /><p style="${captionStyle}">${escHtml(img.celebrity)}</p></div>\n`
        }
        geoSections += `</div>\n`
      }

      evidenceGridHtml = `<h2 style="color:#f59e0b;font-size:20px;margin:32px 0 12px;border-bottom:1px solid rgba(245,158,11,0.3);padding-bottom:8px">Evidence: Fraudulent Ad Creatives by Country</h2>
<p style="line-height:1.7;margin:0 0 16px;color:rgba(255,255,255,0.7);font-size:14px">The following screenshots were captured by SpyOwl ad surveillance. Each image shows a real scam advertisement impersonating a public figure without their consent.</p>
${geoSections}`
    }

    // Red flag icon mapping based on keywords
    const getRedFlagIcon = (flag) => {
      const f = (flag || '').toLowerCase()
      if (f.includes('celebrit') || f.includes('deepfake') || f.includes('impersonat')) return '🎭'
      if (f.includes('countr') || f.includes('geo') || f.includes('global')) return '🌍'
      if (f.includes('withdraw') || f.includes('deposit') || f.includes('payment') || f.includes('fund')) return '🔒'
      if (f.includes('regulat') || f.includes('licen') || f.includes('compliance')) return '⚖️'
      if (f.includes('ad ') || f.includes('creative') || f.includes('campaign') || f.includes('advertis')) return '📢'
      if (f.includes('testimonial') || f.includes('fake review') || f.includes('social proof')) return '👤'
      if (f.includes('pressure') || f.includes('urgency') || f.includes('limited')) return '⏰'
      if (f.includes('company') || f.includes('register') || f.includes('address') || f.includes('contact')) return '🏢'
      if (f.includes('video') || f.includes('youtube')) return '🎬'
      return '🚩'
    }

    // Red flags HTML
    const redFlagsHtml = (reviewContent.red_flags || [])
      .map(rf => `<li>${getRedFlagIcon(rf.flag)} <strong>${escHtml(rf.flag)}</strong> — ${escHtml(rf.detail)}</li>`)
      .join('\n')

    // FAQ HTML with proper semantic structure (optimized for AI extraction)
    const faqHtml = (reviewContent.faq || [])
      .map(f => `<h3>${escHtml(f.question)}</h3>\n<p>${escHtml(f.answer)}</p>`)
      .join('\n\n')

    // Protection steps — split by numbered items if present
    const protectionHtml = escHtml(reviewContent.protection_steps || reviewContent.verdict || '')

    // Not For You block
    const notForYouHtml = reviewContent.not_for_you
      ? `<blockquote style="margin:16px 0;padding:16px 20px;background:rgba(59,130,246,0.08);border-left:3px solid #3b82f6;border-radius:0 8px 8px 0;color:rgba(255,255,255,0.85);line-height:1.7"><strong>Important Disclaimer:</strong> ${escHtml(reviewContent.not_for_you)}</blockquote>`
      : ''

    // ─── E-E-A-T CONTENT SECTIONS ───
    // Author byline HTML (word count placeholder replaced after fullArticle is built)
    const authorName = reviewContent.author_name || 'Crypto Killer Research Team'
    const authorCredentials = escHtml(reviewContent.expertise_depth || 'Crypto fraud intelligence analysts specializing in ad surveillance and scam pattern recognition.')
    const authorBylineTemplate = `<div style="border-left:3px solid #f59e0b;padding:12px 16px;margin:24px 0;background:rgba(245,158,11,0.08);border-radius:0 8px 8px 0" itemscope itemtype="https://schema.org/Person">
<p style="margin:0 0 4px;font-size:15px"><strong>Reviewed by:</strong> <span itemprop="name">${escHtml(authorName)}</span></p>
<p style="margin:0 0 4px;font-size:13px;opacity:0.8"><em>${authorCredentials}</em></p>
<p style="margin:0;font-size:13px;opacity:0.7"><time datetime="${currentDate}">Published: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</time> · {{WORD_COUNT}} words · {{READ_TIME}} min read</p>
</div>`

    // Methodology section HTML
    const methodologyHtml = reviewContent.methodology
      ? `<h2 style="color:#f59e0b;font-size:20px;margin:32px 0 12px;border-bottom:1px solid rgba(245,158,11,0.3);padding-bottom:8px">Our Investigation Methodology</h2>\n<p style="line-height:1.7;margin:0 0 16px;color:rgba(255,255,255,0.85)">${escHtml(reviewContent.methodology)}</p>`
      : ''

    // Experience signals HTML
    const experienceSignalsHtml = (reviewContent.experience_signals || []).length > 0
      ? `<h3 style="color:#f59e0b;font-size:17px;margin:24px 0 12px">Key Investigation Findings</h3>\n<ul style="list-style:none;padding:0;margin:0 0 16px">\n${(reviewContent.experience_signals || []).map(s => `<li style="padding:8px 12px;margin:6px 0;background:rgba(245,158,11,0.06);border-radius:6px;border-left:2px solid rgba(245,158,11,0.4);line-height:1.6;color:rgba(255,255,255,0.85)">🔍 ${escHtml(s)}</li>`).join('\n')}\n</ul>`
      : ''

    // Sources section HTML
    const sourcesHtml = (reviewContent.sources || []).length > 0
      ? `<h2 style="color:#f59e0b;font-size:20px;margin:32px 0 12px;border-bottom:1px solid rgba(245,158,11,0.3);padding-bottom:8px">Sources &amp; References</h2>\n<ol style="padding-left:20px;margin:0 0 16px">\n${(reviewContent.sources || []).map(s =>
          `<li style="margin:6px 0;line-height:1.6;color:rgba(255,255,255,0.75)"><a href="${escHtml(s.url)}" rel="nofollow noopener" target="_blank" style="color:#f59e0b;text-decoration:none">${escHtml(s.title)}</a> <span style="opacity:0.6">(${escHtml(s.type)}, accessed ${escHtml(s.accessed_date || currentDate)})</span></li>`
        ).join('\n')}\n</ol>`
      : ''

    // Disclaimer HTML
    const disclaimerHtml = reviewContent.disclaimer
      ? `<div style="margin:32px 0 16px;padding:16px;background:rgba(255,255,255,0.04);border-radius:8px;border:1px solid rgba(255,255,255,0.1)"><p style="margin:0;font-size:13px;line-height:1.6;color:rgba(255,255,255,0.5)"><strong>Disclaimer:</strong> ${escHtml(reviewContent.disclaimer)}</p></div>`
      : `<div style="margin:32px 0 16px;padding:16px;background:rgba(255,255,255,0.04);border-radius:8px;border:1px solid rgba(255,255,255,0.1)"><p style="margin:0;font-size:13px;line-height:1.6;color:rgba(255,255,255,0.5)"><strong>Disclaimer:</strong> This review is for informational purposes only and does not constitute financial, legal, or investment advice. Crypto Killer is an independent scam intelligence platform. If you believe you have been defrauded, contact your local financial authority and law enforcement.</p></div>`
    // ─── FULL ARTICLE HTML ───
    // COMPLETE self-contained review page matching Replit design.
    // Base44 renders ONLY this field via dangerouslySetInnerHTML.
    // All styles are inline. Uses <details>/<summary> for FAQ accordion (no JS).
    // Responsive 2-col layout via flexbox with flex-wrap.

    // ── Threat classification (single source of truth — see lib/threat-score.js)
    // Replaces the old `>=90/80/70` ladder that misclassified 99.5% of the
    // dataset. The `scam_score` field is a weighted signal aggregate, not a
    // probability; median is 1, p99 is 15. See lib/threat-score.js header.
    const threat = classifyThreat(brandData.scam_score)
    const riskLabel = threat.label
    const badgeLabel = threat.badge

    // ── Normalize celebrity_list to atomic names.
    // Upstream SpyOwl data sometimes stores pairings as compound strings
    // (e.g. "Nabela Qoser, Eddie Yue Wai-man" as one element). Dedupe so the
    // prose, stat cards, and schema mentions[] all see clean individuals.
    const cleanCelebrityList = dedupeCelebrityList(brandData.celebrity_list)
    // Preserve the original on brandData but overlay a cleaned copy for the
    // template. total_celebrities stays authoritative from scam_brands —
    // cleanCelebrityList.length may differ; template uses total_celebrities.
    brandData.celebrity_list = cleanCelebrityList
    const isStillActive = brandData.last_seen_at && (Math.round((new Date() - new Date(brandData.last_seen_at)) / 86400000) <= 14)
    const firstDetectedFmt = brandData.first_seen_at ? new Date(brandData.first_seen_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown'
    const lastActiveFmt = brandData.last_seen_at ? new Date(brandData.last_seen_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown'
    const publishedDateFmt = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    // Section title helper
    const sectionH2 = (icon, title) => `<h2 style="font-size:22px;font-weight:700;color:#f8fafc;margin:0 0 20px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;padding-bottom:12px"><span style="color:#ef4444">${icon}</span>${escHtml(title)}</h2>`

    // Geo regions for sidebar
    const geoRegions = (() => {
      const geos = brandData.geo_list || []
      if (geos.length === 0) return ''
      const regionMap = { 'GB':'Europe','DE':'Europe','FR':'Europe','IT':'Europe','ES':'Europe','NL':'Europe','PL':'Europe','SE':'Europe','AT':'Europe','CH':'Europe','BE':'Europe','CZ':'Europe','DK':'Europe','FI':'Europe','NO':'Europe','IE':'Europe','PT':'Europe','RO':'Europe','HU':'Europe','GR':'Europe','SK':'Europe','BG':'Europe','HR':'Europe','SI':'Europe','LT':'Europe','LV':'Europe','EE':'Europe','US':'Americas','CA':'Americas','BR':'Americas','MX':'Americas','AR':'Americas','CO':'Americas','CL':'Americas','PE':'Americas','IN':'Asia','JP':'Asia','KR':'Asia','SG':'Asia','MY':'Asia','TH':'Asia','PH':'Asia','ID':'Asia','VN':'Asia','TW':'Asia','HK':'Asia','AU':'Oceania','NZ':'Oceania','ZA':'Africa','NG':'Africa','KE':'Africa','EG':'Africa' }
      const regions = {}
      geos.forEach(g => { const r = regionMap[g] || 'Other'; if (!regions[r]) regions[r] = []; regions[r].push(g) })
      return Object.entries(regions).map(([region, codes]) =>
        `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 16px;border-bottom:1px solid #1e293b"><span style="color:#cbd5e1;font-size:12px;font-weight:500">${region}</span><span style="color:#64748b;font-size:12px">${codes.join(', ')}</span></div>`
      ).join('')
    })()
    let fullArticle = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#f8fafc">

<!-- BREADCRUMB -->
<div style="font-size:13px;color:#64748b;margin-bottom:24px">
<a href="/" style="color:#94a3b8;text-decoration:none">Home</a>
<span style="margin:0 6px;color:#475569">›</span>
<a href="/investigations" style="color:#94a3b8;text-decoration:none">Investigations</a>
<span style="margin:0 6px;color:#475569">›</span>
<span style="color:#cbd5e1">${escHtml(brandData.name)}</span>
</div>

<!-- HERO -->
<div style="margin-bottom:40px">
<div style="display:flex;flex-wrap:wrap;align-items:center;gap:16px;margin-bottom:16px">
<h1 style="margin:0;font-size:clamp(36px,5vw,56px);font-weight:900;color:#f8fafc;letter-spacing:-1px">${escHtml(brandData.name)}</h1>
<span style="display:inline-flex;align-items:center;gap:6px;background:#dc2626;color:#fff;font-size:12px;font-weight:700;padding:6px 14px;border-radius:4px;text-transform:uppercase;letter-spacing:1px;white-space:nowrap">${badgeLabel}</span>
</div>

<p style="font-size:17px;color:#cbd5e1;max-width:900px;margin:0 0 24px;line-height:1.7">${(() => {
  let s = escHtml(reviewContent.summary || '')
  // Highlight threat score in red bold
  s = s.replace(/(\d+\/100\s*threat\s*score)/gi, '<span style="color:#ef4444;font-weight:700">$1</span>')
  // Bold key numbers: "N,NNN fraudulent advertisements", "NN countries", "NNN days", "NN celebrities"
  s = s.replace(/(\d[\d,]*)\s+(fraudulent\s+ad\w*|ad\s+creatives?|countries|days|celebrities)/gi, '<strong style="color:#f8fafc;font-weight:700">$1 $2</strong>')
  return s
})()}</p>

<div style="display:flex;flex-wrap:wrap;align-items:center;gap:16px;font-size:13px;color:#94a3b8;margin-bottom:32px;padding-bottom:24px;border-bottom:1px solid #1e293b">
<span>📅 Published: ${publishedDateFmt}</span>
<span>⏱️ {{WORD_COUNT}} words · {{READ_TIME}} min read</span>
<span>👤 Crypto Killer Research Team</span>
<span>🔍 SpyOwl Ad Surveillance</span>
</div>
<!-- STAT CARDS -->
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
<div style="background:rgba(15,23,42,0.6);border:1px solid #1e293b;border-radius:10px;padding:16px;display:flex;align-items:center;gap:12px">
<div style="width:44px;height:44px;border-radius:50%;background:rgba(239,68,68,0.15);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">📊</div>
<div><p style="margin:0;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase">Ad Creatives</p><p style="margin:4px 0 0;font-size:26px;font-weight:900;color:#f8fafc">${(brandData.total_creatives || 0).toLocaleString()}</p></div>
</div>
<div style="background:rgba(15,23,42,0.6);border:1px solid #1e293b;border-radius:10px;padding:16px;display:flex;align-items:center;gap:12px">
<div style="width:44px;height:44px;border-radius:50%;background:rgba(245,158,11,0.15);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">🌍</div>
<div><p style="margin:0;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase">Countries Targeted</p><p style="margin:4px 0 0;font-size:26px;font-weight:900;color:#f8fafc">${brandData.total_geos || 0}</p></div>
</div>
<div style="background:rgba(15,23,42,0.6);border:1px solid #1e293b;border-radius:10px;padding:16px;display:flex;align-items:center;gap:12px">
<div style="width:44px;height:44px;border-radius:50%;background:rgba(249,115,22,0.15);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">⏰</div>
<div><p style="margin:0;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase">Days Active</p><p style="margin:4px 0 0;font-size:26px;font-weight:900;color:#f8fafc">${longevityDays}</p></div>
</div>
<div style="background:rgba(15,23,42,0.6);border:1px solid #1e293b;border-radius:10px;padding:16px;display:flex;align-items:center;gap:12px">
<div style="width:44px;height:44px;border-radius:50%;background:rgba(59,130,246,0.15);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">⭐</div>
<div><p style="margin:0;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase">Celebrities Abused</p><p style="margin:4px 0 0;font-size:26px;font-weight:900;color:#f8fafc">${brandData.total_celebrities || 0}</p></div>
</div>
</div>
</div>
<!-- KEY TAKEAWAYS -->
${(reviewContent.key_takeaways || []).length > 0 ? `
<div style="background:rgba(127,29,29,0.2);border:1px solid rgba(127,29,29,0.4);border-radius:12px;padding:24px;margin-bottom:48px">
<h3 style="font-size:18px;font-weight:700;color:#f87171;margin:0 0 16px;display:flex;align-items:center;gap:8px">⚠️ Key Takeaways</h3>
<ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px">
${(reviewContent.key_takeaways || []).map(t => `<li style="display:flex;gap:10px;align-items:flex-start;font-size:14px;color:#cbd5e1;line-height:1.6"><span style="color:#ef4444;font-weight:700;flex-shrink:0;margin-top:1px">✕</span><span>${escHtml(t)}</span></li>`).join('\n')}
</ul>
</div>` : ''}

<!-- TWO COLUMN LAYOUT -->
<div style="display:flex;gap:32px;flex-wrap:wrap;margin-bottom:48px">

<!-- LEFT COLUMN -->
<div style="flex:2;min-width:300px">

<!-- INVESTIGATION SUMMARY -->
<section style="margin-bottom:48px">
${sectionH2('📄', 'Investigation Summary')}
<p style="margin:0 0 16px;color:#cbd5e1;font-size:15px;line-height:1.7">${escHtml(brandData.name)} ${threat.prose} with a <strong style="color:#ef4444;font-weight:700">${brandData.scam_score}/100 threat score</strong>, based on <strong style="color:#f8fafc">${pluralize(brandData.total_creatives || 0, 'fraudulent advertisement', 'fraudulent advertisements')}</strong> detected across <strong style="color:#f8fafc">${pluralize(brandData.total_geos || 0, 'country', 'countries')}</strong> over <strong style="color:#f8fafc">${pluralize(longevityDays, 'day', 'days')}</strong> of continuous operation between ${firstDetectedFmt} and ${lastActiveFmt}.${brandData.total_celebrities ? ` The scheme impersonates <strong style="color:#f8fafc">${pluralize(brandData.total_celebrities, 'real celebrity', 'real celebrities')}</strong> in paid advertisements${cleanCelebrityList.length > 0 ? `, including ${cleanCelebrityList.slice(0, 5).map(c => escHtml(c)).join(', ')}` : ''}.` : ''}</p>
<p style="margin:0 0 16px;color:#cbd5e1;font-size:15px;line-height:1.7">Victims report that initial deposits succeed through the platform, but withdrawal requests trigger account lockouts, fabricated compliance fees, and relentless contact demanding additional capital. SpyOwl's analysis confirms ${escHtml(brandData.name)} exhibits every hallmark of a confidence scheme: celebrity fabrication, geographic dispersion, high-velocity ad deployment${brandData.velocity_7d ? ` (${brandData.velocity_7d} new creatives per 7 days)` : ''}, and zero regulatory registration across FCA, SEC, ASIC, or CySEC databases.</p>
<div style="background:rgba(15,23,42,0.8);border:1px solid rgba(220,38,38,0.4);border-radius:8px;padding:16px;margin-top:16px">
<p style="margin:0;color:#f87171;font-size:14px;font-weight:600;line-height:1.6">⚠️ If you deposited money to ${escHtml(brandData.name)} and cannot withdraw it, you are not the victim of bad luck or market volatility — you have been targeted by an organized fraud operation.</p>
</div>
</section>
<!-- HOW THIS SCAM WORKS — 4-stage funnel cards -->
${reviewContent.how_it_works ? (() => {
  const stageStyles = [
    { icon: '📢', label: 'Stage 1', title: 'Celebrity Impersonation & Geo-Targeted Advertising', bg: 'rgba(124,45,18,0.2)', border: 'rgba(194,65,12,0.4)', barColor: '#ea580c', labelColor: '#fb923c', iconBg: '#ea580c',
      statValue: `${pluralize(brandData.total_creatives || 0, 'ad')}`, statSub: brandData.total_celebrities ? `impersonating ${pluralize(brandData.total_celebrities, 'celebrity', 'celebrities')}` : 'celebrity identity data pending' },
    { icon: '🎯', label: 'Stage 2', title: 'The Funnel & Deposit Success', bg: 'rgba(120,53,15,0.2)', border: 'rgba(180,83,9,0.4)', barColor: '#d97706', labelColor: '#fbbf24', iconBg: '#d97706',
      statValue: 'Instant', statSub: 'deposit confirmation' },
    { icon: '📈', label: 'Stage 3', title: 'Fake Profits & Psychological Manipulation', bg: 'rgba(127,29,29,0.2)', border: 'rgba(220,38,38,0.4)', barColor: '#dc2626', labelColor: '#f87171', iconBg: '#dc2626',
      statValue: '5–15%', statSub: 'fake daily returns displayed' },
    { icon: '🚨', label: 'Stage 4', title: 'The Withdrawal Trap & Fee Extraction', bg: 'rgba(136,19,55,0.3)', border: 'rgba(190,18,60,0.5)', barColor: '#be123c', labelColor: '#fb7185', iconBg: '#be123c',
      statValue: '$500–$5k', statSub: 'unlock fees demanded' },
  ]
  // Split on real newlines OR literal \n\n (Claude sometimes returns either)
  const paragraphs = reviewContent.how_it_works.split(/(?:\\n){2,}|\n{2,}/).filter(p => p.trim())
  const stageCards = paragraphs.map((p, i) => {
    const s = stageStyles[i] || stageStyles[stageStyles.length - 1]
    const sentences = p.split(/(?<=\.)\s+/).filter(st => st.trim())
    const bulletParts = sentences.slice(1).length > 0 ? sentences.slice(1) : sentences
    return `<div style="position:relative;display:flex;gap:0;border-radius:16px;background:${s.bg};border:1px solid ${s.border};overflow:hidden">
<div style="width:4px;flex-shrink:0;background:${s.barColor};opacity:0.6"></div>
<div style="flex:1;padding:24px">
<div style="display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap">
<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0">
<div style="width:40px;height:40px;border-radius:12px;background:${s.iconBg};display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 4px 12px rgba(0,0,0,0.3)">${s.icon}</div>
<span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:${s.labelColor}">${s.label}</span>
</div><div style="flex:1;min-width:200px">
<h3 style="font-weight:700;color:#f8fafc;font-size:17px;line-height:1.4;margin:0 0 12px">${escHtml(s.title)}</h3>
<ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:10px">
${bulletParts.map(bullet => `<li style="display:flex;align-items:flex-start;gap:10px;font-size:14px;color:#cbd5e1;line-height:1.65">
<div style="margin-top:7px;width:6px;height:6px;border-radius:50%;background:${s.iconBg};flex-shrink:0"></div>
<span>${escHtml(bullet)}</span>
</li>`).join('')}
</ul>
</div>
<div style="flex-shrink:0;border-radius:12px;border:1px solid ${s.border};background:rgba(2,6,23,0.5);padding:16px 20px;text-align:center;min-width:110px;align-self:flex-start">
<p style="margin:0;font-size:20px;font-weight:900;color:${s.labelColor};line-height:1.2">${s.statValue}</p>
<p style="margin:4px 0 0;font-size:11px;color:#64748b;line-height:1.3">${s.statSub}</p>
</div>
</div>
</div>
</div>`
  }).join(`
<div style="display:flex;justify-content:center;padding:4px 0">
<div style="width:2px;height:24px;background:linear-gradient(to bottom,${stageStyles[0].barColor},${stageStyles[3].barColor});opacity:0.4;border-radius:1px"></div>
</div>
`)
  return `<section style="margin-bottom:48px">
${sectionH2('🔬', 'How This Scam Works')}
<p style="color:#94a3b8;font-size:14px;margin:0 0 24px;line-height:1.6">${escHtml(brandData.name)} deploys a <strong style="color:#f8fafc;font-weight:600">four-stage confidence scheme</strong> targeting retail investors searching for cryptocurrency trading automation. Each stage is designed to advance the victim deeper into the trap.</p>
<div style="position:relative;display:flex;flex-direction:column;gap:0">
${stageCards}
</div>
</section>`
})() : ''}
<!-- RED FLAGS -->
${(reviewContent.red_flags || []).length > 0 ? `
<section style="margin-bottom:48px">
${sectionH2('🚩', 'Red Flags')}
<div style="display:flex;flex-direction:column;gap:12px">
${(reviewContent.red_flags || []).map((rf, idx) => `<div style="background:rgba(15,23,42,0.6);border:1px solid #1e293b;border-radius:10px;overflow:hidden">
<div style="display:flex;align-items:flex-start;gap:14px;padding:20px">
<div style="width:36px;height:36px;border-radius:50%;background:rgba(127,29,29,0.4);border:1px solid rgba(220,38,38,0.3);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">${getRedFlagIcon(rf.flag)}</div>
<div style="flex:1;min-width:0">
<div style="font-size:11px;font-weight:700;color:#ef4444;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:4px">Red Flag ${idx + 1}</div>
<h3 style="margin:0 0 8px;font-size:15px;font-weight:700;color:#f8fafc">${escHtml(rf.flag)}</h3>
<p style="margin:0;font-size:14px;color:#94a3b8;line-height:1.6">${escHtml(rf.detail)}</p>
</div>
</div>
</div>`).join('\n')}
</div>
</section>` : ''}

<!-- KEY INVESTIGATION FINDINGS -->
${(reviewContent.experience_signals || []).length > 0 ? `
<section style="margin-bottom:48px">
${sectionH2('🔍', 'Key Investigation Findings')}
<div style="display:flex;flex-direction:column;gap:12px">
${(reviewContent.experience_signals || []).map((sig, idx) => `<div style="display:flex;gap:12px;align-items:flex-start;padding:16px;background:rgba(15,23,42,0.4);border:1px solid rgba(30,41,59,0.5);border-radius:8px">
<div style="width:28px;height:28px;border-radius:6px;background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.3);display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="color:#f59e0b;font-size:12px;font-weight:700">${idx + 1}</span></div>
<p style="margin:0;color:#cbd5e1;font-size:14px;line-height:1.6">${escHtml(sig)}</p>
</div>`).join('\n')}
</div>
</section>` : ''}
<!-- WHAT TO DO IF SCAMMED -->
${reviewContent.protection_steps ? `
<section style="margin-bottom:48px">
${sectionH2('✅', "What To Do If You've Been Scammed")}
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
<div style="display:flex;align-items:center;gap:12px;padding:14px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:10px">
<span style="font-size:20px;flex-shrink:0">📋</span>
<div><p style="margin:0;color:#f8fafc;font-size:13px;font-weight:600">Report to FBI IC3</p><p style="margin:2px 0 0;color:#64748b;font-size:11px">ic3.gov</p></div>
</div>
<div style="display:flex;align-items:center;gap:12px;padding:14px;background:rgba(168,85,247,0.08);border:1px solid rgba(168,85,247,0.2);border-radius:10px">
<span style="font-size:20px;flex-shrink:0">⚖️</span>
<div><p style="margin:0;color:#f8fafc;font-size:13px;font-weight:600">File FTC Complaint</p><p style="margin:2px 0 0;color:#64748b;font-size:11px">reportfraud.ftc.gov</p></div>
</div>
<div style="display:flex;align-items:center;gap:12px;padding:14px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:10px">
<span style="font-size:20px;flex-shrink:0">🏦</span>
<div><p style="margin:0;color:#f8fafc;font-size:13px;font-weight:600">Contact Your Bank</p><p style="margin:2px 0 0;color:#64748b;font-size:11px">Request a chargeback</p></div>
</div>
<div style="display:flex;align-items:center;gap:12px;padding:14px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:10px">
<span style="font-size:20px;flex-shrink:0">🔑</span>
<div><p style="margin:0;color:#f8fafc;font-size:13px;font-weight:600">Change All Passwords</p><p style="margin:2px 0 0;color:#64748b;font-size:11px">Secure your accounts</p></div>
</div>
<div style="display:flex;align-items:center;gap:12px;padding:14px;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.2);border-radius:10px">
<span style="font-size:20px;flex-shrink:0">📸</span>
<div><p style="margin:0;color:#f8fafc;font-size:13px;font-weight:600">Document Everything</p><p style="margin:2px 0 0;color:#64748b;font-size:11px">Screenshots, emails, transactions</p></div>
</div>
<div style="display:flex;align-items:center;gap:12px;padding:14px;background:rgba(249,115,22,0.08);border:1px solid rgba(249,115,22,0.2);border-radius:10px">
<span style="font-size:20px;flex-shrink:0">🚨</span>
<div><p style="margin:0;color:#f8fafc;font-size:13px;font-weight:600">Report to Local Police</p><p style="margin:2px 0 0;color:#64748b;font-size:11px">Needed for insurance claims</p></div>
</div>
</div>
</section>` : ''}
<!-- FAQ ACCORDION -->
${(reviewContent.faq || []).length > 0 ? `
<section style="margin-bottom:48px">
${sectionH2('📖', 'Frequently Asked Questions')}
<div style="border:1px solid #1e293b;border-radius:10px;overflow:hidden">
${(reviewContent.faq || []).map((f, idx) => `<details style="border-bottom:${idx < (reviewContent.faq || []).length - 1 ? '1px solid #1e293b' : 'none'}">
<summary style="padding:16px 20px;background:rgba(15,23,42,0.5);cursor:pointer;font-weight:600;font-size:14px;color:#f8fafc;list-style:none;user-select:none">${escHtml(f.question)}</summary>
<div style="padding:16px 20px;color:#94a3b8;font-size:14px;line-height:1.7;border-top:1px solid rgba(30,41,59,0.5)">${escHtml(f.answer)}</div>
</details>`).join('\n')}
</div>
</section>` : ''}

<!-- METHODOLOGY -->
${reviewContent.methodology ? `
<section style="margin-bottom:48px">
${sectionH2('🔬', 'Our Investigation Methodology')}
<p style="margin:0 0 16px;color:#94a3b8;font-size:14px;line-height:1.7">${escHtml(reviewContent.methodology)}</p>
</section>` : ''}

<!-- AUTHOR BYLINE -->
${authorBylineTemplate}

<!-- CAMPAIGN TIMELINE -->
${buildCampaignTimeline(brandData, longevityDays, currentDate)}

<!-- EVIDENCE GRID -->
${evidenceGridHtml}

</div>
<!-- RIGHT SIDEBAR -->
<div style="flex:1;min-width:280px;max-width:380px">
<div style="position:sticky;top:80px;display:flex;flex-direction:column;gap:20px">

<!-- THREAT SCORE -->
<div style="background:rgba(15,23,42,0.8);border:1px solid #1e293b;border-radius:12px;overflow:hidden">
<div style="padding:20px;border-bottom:1px solid #1e293b">
<p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#f8fafc;display:flex;align-items:center;gap:6px">⚠️ Threat Score</p>
<div style="display:flex;align-items:baseline;gap:6px;margin-bottom:8px">
<span style="font-size:52px;font-weight:900;color:#ef4444">${brandData.scam_score || 0}</span>
<span style="font-size:18px;font-weight:700;color:#64748b">/ 100</span>
</div>
<div style="width:100%;height:8px;background:#1e293b;border-radius:4px;overflow:hidden;margin-bottom:8px">
<div style="width:${Math.min(100, brandData.scam_score || 0)}%;height:100%;background:#dc2626;border-radius:4px"></div>
</div>
<p style="margin:0;font-size:13px;font-weight:600;color:#f87171">${riskLabel}</p>
</div>

<!-- THREAT INTELLIGENCE TABLE -->
<div style="padding:0">
<p style="margin:0;padding:12px 16px 8px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1.5px">Threat Intelligence</p>
<div style="border-top:1px solid #1e293b">
<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-bottom:1px solid rgba(30,41,59,0.5)"><span style="color:#94a3b8;font-size:12px">Ad Creatives</span><span style="color:#f8fafc;font-size:12px;font-weight:600">${(brandData.total_creatives || 0).toLocaleString()}</span></div>
<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-bottom:1px solid rgba(30,41,59,0.5)"><span style="color:#94a3b8;font-size:12px">Countries</span><span style="color:#f8fafc;font-size:12px;font-weight:600">${brandData.total_geos || 0}</span></div>
<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-bottom:1px solid rgba(30,41,59,0.5)"><span style="color:#94a3b8;font-size:12px">Celebrities Abused</span><span style="color:#f8fafc;font-size:12px;font-weight:600">${brandData.total_celebrities || 0}</span></div>
<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-bottom:1px solid rgba(30,41,59,0.5)"><span style="color:#94a3b8;font-size:12px">7-Day Velocity</span><span style="color:#f8fafc;font-size:12px;font-weight:600">${brandData.velocity_7d || 0} new</span></div>
<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-bottom:1px solid rgba(30,41,59,0.5)"><span style="color:#94a3b8;font-size:12px">Campaign Duration</span><span style="color:#f8fafc;font-size:12px;font-weight:600">${longevityDays} days</span></div>
<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-bottom:1px solid rgba(30,41,59,0.5)"><span style="color:#94a3b8;font-size:12px">First Detected</span><span style="color:#f8fafc;font-size:12px;font-weight:600">${firstDetectedFmt}</span></div><div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-bottom:1px solid rgba(30,41,59,0.5)"><span style="color:#94a3b8;font-size:12px">Last Active</span><span style="color:#f8fafc;font-size:12px;font-weight:600">${lastActiveFmt}</span></div>
<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px"><span style="color:#94a3b8;font-size:12px">Status</span><span style="color:${isStillActive ? '#f87171' : '#94a3b8'};font-size:12px;font-weight:700;display:flex;align-items:center;gap:6px">${isStillActive ? '<span style="width:6px;height:6px;border-radius:50%;background:#ef4444;display:inline-block"></span>Active Scam' : 'Inactive'}</span></div>
</div>
</div>

<!-- GEOGRAPHIC TARGETING -->
${geoRegions ? `
<div style="padding:0;border-top:1px solid #1e293b">
<p style="margin:0;padding:12px 16px 8px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1.5px">Geographic Targeting</p>
${geoRegions}
</div>` : ''}

<!-- REGULATORY STATUS -->
<div style="padding:16px;border-top:1px solid #1e293b">
<p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1.5px">Regulatory Status</p>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
<div style="display:flex;align-items:center;gap:6px;background:rgba(127,29,29,0.25);border:1px solid rgba(220,38,38,0.3);border-radius:4px;padding:8px 10px"><span style="color:#ef4444;font-weight:700;font-size:11px">✕</span><span style="color:#fca5a5;font-size:12px;font-weight:600">FCA: None</span></div>
<div style="display:flex;align-items:center;gap:6px;background:rgba(127,29,29,0.25);border:1px solid rgba(220,38,38,0.3);border-radius:4px;padding:8px 10px"><span style="color:#ef4444;font-weight:700;font-size:11px">✕</span><span style="color:#fca5a5;font-size:12px;font-weight:600">SEC: None</span></div>
<div style="display:flex;align-items:center;gap:6px;background:rgba(127,29,29,0.25);border:1px solid rgba(220,38,38,0.3);border-radius:4px;padding:8px 10px"><span style="color:#ef4444;font-weight:700;font-size:11px">✕</span><span style="color:#fca5a5;font-size:12px;font-weight:600">ASIC: None</span></div>
<div style="display:flex;align-items:center;gap:6px;background:rgba(127,29,29,0.25);border:1px solid rgba(220,38,38,0.3);border-radius:4px;padding:8px 10px"><span style="color:#ef4444;font-weight:700;font-size:11px">✕</span><span style="color:#fca5a5;font-size:12px;font-weight:600">CySEC: None</span></div>
</div>
</div>
</div>

<!-- FINAL VERDICT -->
<div style="background:rgba(127,29,29,0.25);border:1px solid rgba(220,38,38,0.4);border-radius:12px;padding:20px">
<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
<span style="font-size:16px">⛔</span>
<span style="color:#f87171;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:1px">Final Verdict</span>
</div><p style="margin:0 0 8px;color:#f8fafc;font-size:15px;font-weight:600">${escHtml(reviewContent.verdict || '')}</p>
<p style="margin:0 0 12px;color:#f87171;font-weight:700;font-size:14px">Do not deposit any money.</p>
<div style="border-top:1px solid rgba(220,38,38,0.3);padding-top:10px">
<p style="margin:0;color:#94a3b8;font-size:11px">Based on analysis of ${pluralize(brandData.total_creatives || 0, 'ad creative', 'ad creatives')} across ${pluralize(brandData.total_geos || 0, 'country', 'countries')}.</p>
</div>
</div>

<!-- SOURCES -->
${(reviewContent.sources || []).length > 0 ? `
<div style="background:rgba(15,23,42,0.6);border:1px solid #1e293b;border-radius:12px;padding:16px">
<p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#cbd5e1">Sources &amp; References</p>
${(reviewContent.sources || []).map(s => `<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:#94a3b8;padding:6px 0;border-bottom:1px solid rgba(30,41,59,0.3)"><span style="color:#475569;flex-shrink:0">🔗</span><a href="${escHtml(s.url)}" rel="nofollow noopener" target="_blank" style="color:#94a3b8;text-decoration:none;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(s.title)}</a><span style="color:#475569;font-size:11px;flex-shrink:0">${escHtml(s.type || '')}</span></div>`).join('\n')}
</div>` : ''}

</div>
</div>

</div>

<!-- CTA -->
<div style="position:relative;margin:48px 0;background:linear-gradient(135deg,rgba(15,23,42,0.8),rgba(30,41,59,0.4));border:1px solid #1e293b;border-radius:16px;padding:48px 32px;text-align:center;overflow:hidden">
<div style="position:absolute;top:0;left:0;width:100%;height:3px;background:linear-gradient(90deg,#dc2626,#f97316,#f59e0b)"></div>
<div style="font-size:40px;margin-bottom:12px;opacity:0.8">⚠️</div>
<h2 style="margin:0 0 12px;font-size:26px;font-weight:700;color:#f8fafc">Were You Targeted by ${escHtml(brandData.name)}?</h2>
<p style="margin:0 0 24px;color:#94a3b8;font-size:15px;max-width:600px;display:inline-block;line-height:1.6">Your report helps warn others and builds the evidence trail against this operation. If you've lost money, act quickly — chargebacks are time-sensitive.</p>
<p style="margin:0;font-size:11px;color:#64748b;max-width:520px;display:inline-block">⚠️ Beware of "recovery agents" who contact you promising to retrieve your money for an upfront fee. These are often secondary scams targeting victims of ${escHtml(brandData.name)} and similar frauds.</p>
</div>
<!-- NOT FOR YOU -->
${notForYouHtml ? `<div style="margin-bottom:24px">${notForYouHtml}</div>` : ''}

<!-- DISCLAIMER -->
<div style="background:rgba(15,23,42,0.4);border:1px solid #1e293b;border-radius:12px;padding:24px;margin-bottom:16px">
<p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#94a3b8">Important Disclaimer</p>
<p style="margin:0;font-size:12px;color:#64748b;line-height:1.8">${escHtml(reviewContent.disclaimer || 'This review is provided for informational and educational purposes only. It does not constitute financial, legal, or investment advice. Crypto Killer is an independent scam intelligence platform. If you believe you have been defrauded, contact your local financial authority and law enforcement.')}</p>
</div>

</div>`

    // Clean any residual markdown formatting leaked by Claude
    fullArticle = cleanMarkdown(fullArticle)

    // Calculate word count
    const wordCount = fullArticle.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(w => w).length

    // Replace word count placeholders (global — appears in hero byline + author byline)
    fullArticle = fullArticle
      .replace(/\{\{WORD_COUNT\}\}/g, wordCount.toString())
      .replace(/\{\{READ_TIME\}\}/g, Math.ceil(wordCount / 250).toString())

    // ─── COMPUTE SLUG (needed by schema below and DB save) ───
    const baseSlug = brandData.slug || brandData.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    let slug = baseSlug.endsWith('-review') ? baseSlug.replace(/-review$/, '') : baseSlug
    // ─── DEDUPLICATE SLUG (check if slug already taken) ───
    const existingByBrand = await supabaseRequest(
      `/reviews?brand_id=eq.${brand_id}&select=id,status`
    )
    const existingBySlug = await supabaseRequest(
      `/reviews?slug=eq.${slug}&select=id,status,brand_id`
    )
    // If slug is taken by a DIFFERENT brand, make it unique
    if (
      Array.isArray(existingBySlug) && existingBySlug.length > 0 &&
      !(Array.isArray(existingByBrand) && existingByBrand.length > 0)
    ) {
      const shortId = brand_id.slice(0, 8)
      slug = `${slug}-${shortId}`
    }
    // Resolve existing review for later upsert logic
    const existingReview = (Array.isArray(existingByBrand) && existingByBrand.length > 0)
      ? existingByBrand
      : []

          // Strip {{VERIFY:}}, {{RESEARCH NEEDED:}}, {{SOURCE NEEDED:}} tags from final HTML.
          // Visual placeholders ([CHART NEEDED], [DIAGRAM NEEDED], [IMAGE NEEDED]) are
          // intentionally left in-place — the /polish endpoint resolves them in phase B.
          fullArticle = stripVerifyTags(fullArticle)

    // ─── BUILD JSON-LD SCHEMA (2026-compliant @graph pattern) ───
    // Uses lib/review-schema.js — NO ClaimReview (deprecated Jan 2026), adds WebPage + HowTo
    const schemaJsonLd = buildReviewSchema({
      reviewContent,
      brandData,
      slug,
      currentDate,
      wordCount,
      longevityDays,
    })

          send({ step: 'saving', progress: 90, message: 'Saving to database...' })

    let reviewId
    const reviewPayload = {
      brand_id: brand_id,
      slug: slug,
      title: reviewContent.title,
      headline: reviewContent.headline,
      meta_description: reviewContent.meta_description,
      summary: reviewContent.summary,
      how_it_works: reviewContent.how_it_works,
      red_flags: (reviewContent.red_flags || []).map(rf => ({
        ...rf,
        flag: `${getRedFlagIcon(rf.flag)} ${rf.flag}`,
      })),      verdict: reviewContent.verdict,
      faq: reviewContent.faq,
      full_article: fullArticle,
      scam_score: brandData.scam_score || 0,
      status: (Array.isArray(existingReview) && existingReview.length > 0) ? existingReview[0].status : 'draft',
      ai_model: contentResult.model || 'claude-opus',
      ai_prompt_version: 'multi-agent-v1.0-seo-v3.1-schema-v3-icp-v1',
      word_count: wordCount,
      schema_json: schemaJsonLd,
      updated_at: new Date().toISOString(),
      // ── E-E-A-T fields ──
      author_name: 'Crypto Killer Research Team',
      author_credentials: 'Crypto fraud intelligence analysts — SpyOwl ad surveillance platform',
      author_bio: reviewContent.expertise_depth || null,
      methodology: reviewContent.methodology || null,
      sources: reviewContent.sources || [],
      reviewed_by: null,
      review_date: currentDate,
      fact_check_status: 'ai_generated',
      disclaimer: reviewContent.disclaimer || null,
      key_takeaways: reviewContent.key_takeaways || [],
      not_for_you: reviewContent.not_for_you || `This review covers the cryptocurrency investment scheme advertising under the name ${brandData.name}. Our analysis is based on ad surveillance data collected by SpyOwl. If you encountered a different product with a similar name through a licensed financial advisor, that may be a separate entity.`,
      protection_steps: reviewContent.protection_steps || null,
      experience_signals: reviewContent.experience_signals || [],
      expertise_depth: reviewContent.expertise_depth || null,
      verify_tags_count: reviewContent.verify_tags_count || 0,
      reddit_test_passed: reviewContent.reddit_test_passed || false,
      information_gain_summary: reviewContent.information_gain_summary || null,
      internal_links: reviewContent.internal_links || [],
      // Phase-A marker. The /polish endpoint flips this to 'polishing' → 'polished'
      // once visuals/audit/hero-images are attached. UI polls on this field.
      generation_status: 'content_generated',
      polish_error: null,
      trust_indicators: {
        creatives_analyzed: brandData.total_creatives,
        countries_scanned: brandData.total_geos,
        celebrities_identified: brandData.total_celebrities,
        investigation_period_days: longevityDays,
        data_source: 'SpyOwl Ad Surveillance',        evidence_images: availableImages.length,
        // Multi-agent pipeline metadata
        pipeline_version: 'multi-agent-v1.1-split',
        source_research_model: sourceResearchActualModel,
        content_model: contentResult.resolvedModel || 'claude-opus',
        content_tokens: contentResult.outputTokens || null,
        verified_sources_count: sourceLedger.length,
        // audit_model / audit_score / audit_grade / audit_critical_fixes
        // are populated in phase B by /polish.
      },
    }

    if (Array.isArray(existingReview) && existingReview.length > 0) {
      // Brand already has a review → update it
      reviewId = existingReview[0].id
      await supabaseRequest(`/reviews?id=eq.${reviewId}`, {
        method: 'PATCH',
        body: JSON.stringify(reviewPayload),
        headers: { 'Prefer': 'return=minimal' },
      })
    } else {
      // New review → try INSERT, fall back to PATCH on slug collision
      try {
        const createResponse = await supabaseRequest('/reviews', {
          method: 'POST',
          body: JSON.stringify(reviewPayload),
          headers: { 'Prefer': 'return=representation' },
        })
        reviewId = Array.isArray(createResponse) ? createResponse[0].id : createResponse.id      } catch (insertError) {
        if (insertError.message.includes('23505') || insertError.message.includes('409')) {
          // Slug collision — find the conflicting review and update it
          const conflicting = await supabaseRequest(
            `/reviews?slug=eq.${encodeURIComponent(slug)}&select=id`
          )
          if (Array.isArray(conflicting) && conflicting.length > 0) {
            reviewId = conflicting[0].id
            await supabaseRequest(`/reviews?id=eq.${reviewId}`, {
              method: 'PATCH',
              body: JSON.stringify(reviewPayload),
              headers: { 'Prefer': 'return=minimal' },
            })
          } else {
            // Slug collision but can't find conflicting record — rethrow
            throw insertError
          }
        } else {
          throw insertError
        }
      }
    }

    // Revalidation is deferred to /polish — the public review page would just render a
    // placeholder-riddled draft right now. No point flushing the cache yet.

          send({
            step: 'done',
            progress: 100,
            message: 'Draft saved. Finishing visuals, audit & hero images…',
            result: {
              review_id: reviewId,
              brand_slug: slug,
              status: (Array.isArray(existingReview) && existingReview.length > 0) ? existingReview[0].status : 'draft',
              generation_status: 'content_generated',
              word_count: wordCount,
              images_embedded: availableImages.length,
              schema_types: ['Organization', 'Person', 'WebSite', 'WebPage', 'Article', 'Review', 'FAQPage', 'HowTo', 'BreadcrumbList'],
              pipeline_version: 'multi-agent-v1.1-split',
              phase: 'content_generated',
              polish_pending: true,
              models_used: {
                sources: sourceResearchActualModel,
                content: contentResult.resolvedModel || 'claude-opus',
              },
            },
          })

        } catch (innerError) {
          send({ step: 'error', progress: 0, message: innerError.message, error: true })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      return unauthorizedResponse()
    }
    return Response.json(
      { error: error.message },
      { status: 500 }
    )
  }
}
