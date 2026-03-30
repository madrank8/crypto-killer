import { supabaseRequest, SUPABASE_URL } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const SPYOWL_COOKIE = process.env.SPYOWL_COOKIE || ''
const SPYOWL_API = 'https://api.spyowl.icu'

// Supabase Storage public URL for creative images
const STORAGE_BASE = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/creative-images`
  : ''
const STORAGE_UPLOAD_BASE = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/creative-images`
  : ''
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// Claude API needs 30-60s for full review generation — bumped for E-E-A-T depth
export const maxDuration = 90

/**
 * POST /api/admin/reviews/generate
 * Generate a scam review article using Claude API — now with SSE progress streaming.
 * Full seo-blog-generator v3.1 + schema-markup-generator + ICP methodology.
 * Body: { brand_id }
 */
export async function POST(request) {
  try {
    verifyAdmin(request)

    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }

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
        const send = (data) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
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

    const creativeSample = Array.isArray(creatives) ? creatives : []

    // ─── EVIDENCE GRID: Top 3 countries × Top 3 celebs per country ───
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
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
      for (const [celeb] of topCelebs) {
        const creative = geoCreatives.find(c => c.celebrity_name === celeb)
        if (creative) evidenceGrid.push({ geo, celebrity: celeb, id: creative.id })
      }
    }

          send({ step: 'images', progress: 25, message: `Fetching ${evidenceGrid.length} evidence images...` })

    // Fetch images from SpyOwl API → upload to Supabase Storage → get public URLs
    let availableImages = []
    console.log(`[evidence] evidenceGrid has ${evidenceGrid.length} entries, STORAGE_BASE=${STORAGE_BASE ? 'set' : 'empty'}, SPYOWL_COOKIE=${SPYOWL_COOKIE ? 'set(' + SPYOWL_COOKIE.length + ' chars)' : 'empty'}`)
    if (STORAGE_BASE && evidenceGrid.length > 0) {
      const fetchPromises = evidenceGrid.map(async (entry) => {
        const publicUrl = `${STORAGE_BASE}/${entry.id}.webp`
        try {
          // Check if already in storage
          const headRes = await fetch(publicUrl, { method: 'HEAD' })
          console.log(`[evidence] HEAD ${entry.id}: ${headRes.status}`)
          if (headRes.ok) {
            return { ...entry, url: publicUrl }
          }
          // Fetch from SpyOwl API
          if (!SPYOWL_COOKIE) { console.log(`[evidence] No SPYOWL_COOKIE, skipping ${entry.id}`); return null }
          const spyUrl = `${SPYOWL_API}/s3/creatives/${entry.id}/mediaFile.webp`
          console.log(`[evidence] Fetching from SpyOwl: ${spyUrl}`)
          const spyRes = await fetch(spyUrl, {
            headers: { 'Cookie': SPYOWL_COOKIE },
          })
          console.log(`[evidence] SpyOwl response: ${spyRes.status} ${spyRes.statusText}`)
          if (!spyRes.ok) return null
          const imgBuffer = await spyRes.arrayBuffer()
          console.log(`[evidence] Image buffer size: ${imgBuffer.byteLength} bytes`)
          if (imgBuffer.byteLength < 1000) return null
          // Upload to Supabase Storage
          const uploadUrl = `${STORAGE_UPLOAD_BASE}/${entry.id}.webp`
          console.log(`[evidence] Uploading to: ${uploadUrl}`)
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
          console.log(`[evidence] Upload response: ${uploadRes.status} ${uploadRes.statusText}`)
          if (!uploadRes.ok) {
            const errText = await uploadRes.text().catch(() => 'no body')
            console.log(`[evidence] Upload error: ${errText}`)
            return null
          }
          return { ...entry, url: publicUrl }
        } catch (err) { console.log(`[evidence] Error for ${entry.id}: ${err.message}`); return null }
      })
      availableImages = (await Promise.all(fetchPromises)).filter(Boolean)
      console.log(`[evidence] Final availableImages: ${availableImages.length}`)
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

          send({ step: 'ai', progress: 35, message: 'Calling Claude AI — generating review (this takes 15-30s)...' })

    // ─── UPGRADED SYSTEM PROMPT ───
    // E-E-A-T v2.0 + seo-blog-generator v3.1 + schema-markup-generator + GEO/LLM citation
    const systemPrompt = `You are an investigative crypto fraud analyst at Crypto Killer, a scam intelligence platform powered by SpyOwl ad surveillance technology. You produce evidence-backed scam exposés that rank in Google Search, get cited by AI Overviews, and protect real people from losing money.

Your writing is grounded in four frameworks:
1. Google's Quality Raters Guidelines (E-E-A-T, Needs Met, YMYL)
2. Koray Tugberk Gubur's Algorithmic Authorship (declaration-first, EAV triplets, NLP-parseable)
3. GEO/AI Visibility optimization (extractive answers, standalone statements, structured data alignment)
4. Source Ledger methodology — every factual claim traces to a cited source

OUTPUT FORMAT: Valid JSON with these fields. All string values must use \\n for line breaks (no literal newlines). Escape quotes with \\". No trailing commas. No markdown fences. CRITICAL: Do NOT use markdown formatting (**bold**, *italic*, etc.) in any field. Use plain text only — HTML formatting is added by the rendering engine.

{
  "title": "SEO title under 60 chars. Format: Is {Brand} a Scam? {Score}/100 Threat Score [{Year}]",
  "headline": "H1 headline. Format: {Brand} Review: {N} Red Flags Exposed by SpyOwl Intelligence",
  "meta_description": "Under 155 chars. Must include: brand name, scam score, key evidence count, current year.",
  "summary": "2-3 sentences MAXIMUM, under 250 characters total. This is a card preview — NOT a full paragraph. First sentence answers the query: '{Brand} is a confirmed crypto scam with a {score}/100 threat score.' Second sentence: one key stat (ad count or country count). Third sentence (optional): one action. STRICT LIMIT: 250 characters. Anything longer breaks the homepage layout.",
  "key_takeaways": ["5-6 bullet points. Each must contain a specific number from the intelligence data. Declaration-first. These appear right after the intro as the BLUF summary."],
  "how_it_works": "250-350 words explaining the scam mechanics. Structure as a 4-step process: (1) Celebrity bait — fake endorsement ads using {celebrity names}, (2) Geo-targeting — ads served in {N} countries including {examples}, (3) The funnel — fake testimonials, urgency pressure, minimum deposit, (4) The trap — no withdrawals, account lockout, fake support. Each step must cite specific intelligence data. Use domain-specific verbs: 'targets', 'deploys', 'impersonates', 'funnels', 'exploits'. Vary sentence rhythm — mix 8-word declaratives with 20-word compound sentences. CRITICAL: Use \\n\\n between each stage to create paragraph breaks. Each stage should be its own paragraph, not one wall of text.",
  "red_flags": [{"flag": "Specific red flag title (under 8 words)", "detail": "70-100 words of evidence. MUST cite at least 2 specific numbers from intelligence data. Declaration-first. Include entity names (celebrities, countries, dates). End with a verdict statement."}],
  "protection_steps": "150-200 words. Actionable steps for readers: (1) Report to IC3.gov and local authorities, (2) Contact your bank for chargeback within 60 days, (3) File FTC complaint at ReportFraud.ftc.gov, (4) Document everything — screenshots of ads, transaction records, communications. Include specific org names and URLs.",
  "not_for_you": "80-120 words. The 'Not For You' block — name specific scenarios where this review may NOT apply. Example: 'This review covers the crypto investment scheme using the name {Brand}. If you encountered a different product with a similar name in a regulated market, or if {Brand} contacted you through a licensed financial advisor with verifiable credentials, that may be a separate entity. Our analysis is based on ad surveillance data from SpyOwl — it covers paid advertising campaigns, not organic search results or direct referrals.' This is a trust signal — the single strongest E-E-A-T differentiator.",
  "verdict": "ONE sentence, under 80 characters. This is displayed as a badge/label on homepage cards — NOT a paragraph. Format: '{Brand} is a confirmed crypto scam. Do not deposit any money.' STRICT LIMIT: 80 characters maximum. No paragraphs, no stats, no line breaks.",
  "faq": [{"question": "Natural question matching real search queries. Use formats: 'Is {Brand} legit or a scam?', 'Can I get my money back from {Brand}?', 'Is {Brand} regulated?', 'How does the {Brand} scam work?', 'Who is behind {Brand}?', 'What do {Brand} reviews say?', 'Has anyone made money with {Brand}?', 'How to report {Brand} scam?'", "answer": "40-60 words. CRITICAL: Each answer is an extractive AI Overview target. Must be standalone — makes complete sense without the question. Declaration-first. Include one specific data point. End with a concrete action or fact."}],

  "methodology": "150-200 words. EXPERIENCE SIGNAL — explain HOW the review was conducted. Structure: (1) Data collection — SpyOwl ad surveillance scanned {N} ad networks between {first_seen} and {last_seen}, capturing {total_creatives} creative assets. (2) Analysis — Each creative was classified by geo-targeting, celebrity impersonation, and offer language. (3) Cross-referencing — Brand claims were checked against regulatory databases (FCA, SEC EDGAR, ASIC, CySEC). (4) Pattern matching — Ad behavior was compared against 500+ known crypto scam campaigns in our database. (5) Scoring — The {score}/100 threat score reflects ad volume, celebrity abuse, geographic spread, and regulatory absence. End with: 'This methodology is applied consistently across all Crypto Killer investigations.' This section is the primary E-E-A-T Experience signal.",
  "expertise_depth": "80-120 words. EXPERTISE SIGNAL — why Crypto Killer is qualified to publish this review. Reference: SpyOwl monitors {N}+ ad networks across 50+ countries. The Crypto Killer database contains intelligence on 500+ scam brands with {total_creatives_platform_wide} ad creatives analyzed. Our team combines ad surveillance technology, blockchain analysis, and financial fraud pattern recognition. Reference specific technical capabilities: WHOIS analysis, SSL certificate inspection, payment processor identification. This appears as an author expertise sidebar.",
  "experience_signals": ["3-5 specific first-person investigation observations. Format: 'During our analysis of {Brand}, we observed that {specific technical finding}.' Examples: 'We traced the ad creatives to 3 separate Facebook ad accounts created within 48 hours of each other', 'The checkout flow redirected through 4 different domains before reaching the deposit page', 'SSL certificates for the landing pages were issued less than 72 hours before ad deployment'. Each must reference something only someone who actually investigated would know."],
  "sources": [{"title": "Source name", "url": "https://...", "type": "regulatory|database|news|government|technical", "accessed_date": "{current_date}"}],
  "disclaimer": "YMYL disclaimer. Format: 'This review is provided for informational and educational purposes only. It does not constitute financial, legal, or investment advice. Crypto Killer is an independent scam intelligence platform — we are not affiliated with {Brand} or any financial regulatory body. If you believe you have been defrauded, contact your local financial authority and law enforcement. Data accuracy: Our analysis is based on ad surveillance data collected between {first_seen} and {last_seen}. Threat scores are algorithmic assessments, not legal determinations of fraud.'"
}

═══ ALGORITHMIC AUTHORSHIP RULES (Koray Tugberk Gubur) ═══

1. DECLARATION-FIRST: Open every sentence with the fact, not a subordinate clause.
   YES: "${brandData.name} targets victims through ${brandData.total_creatives} fraudulent advertisements."
   NO: "When examining the evidence, it becomes apparent that this platform may be targeting..."

2. ONE IDEA PER SENTENCE: Clean dependency trees for NLP extraction. Break compound thoughts.

3. ENTITY-ATTRIBUTE-VALUE TRIPLETS: Every section must contain complete EAV triplets.
   "{Entity} {has/uses/targets} {specific value}."
   "${brandData.name} (entity) impersonates (attribute) ${brandData.total_celebrities} celebrities (value)."

4. NUMERIC SPECIFICITY: "${brandData.total_creatives} ad creatives" not "numerous ads".
   "${brandData.total_geos} countries" not "multiple regions". Always cite the exact number.

5. 3-EXAMPLE RULE: For every plural noun, provide 3 concrete examples from the data.
   "Countries targeted include {X}, {Y}, and {Z}."
   "Celebrities impersonated include {A}, {B}, and {C}."

6. DOMAIN-SPECIFIC VERBS: "targets", "exploits", "impersonates", "deploys", "funnels", "deceives", "fabricates"
   NEVER: "utilizes", "leverages", "navigates", "harnesses", "delves", "unlocks"

7. SALIENCE PRINCIPLE: Primary entity in subject position of every opening sentence.

8. SEMANTIC FRESHNESS: Reference ${currentYear} and current data. Use present tense for active scams.

═══ AI OVERVIEW & LLM EXTRACTABILITY ═══

- Every FAQ answer must work as a standalone citation (40-60 words)
- H2-level content opens with a 40-60 word extractive answer before expanding
- Lists and tables for factual data (AI systems parse these directly)
- Front-load the best information — AI Overviews extract from early content
- Question-format thinking: write as if answering "Is {Brand} a scam?"

═══ ANTI-SLOP RULES (STRICT) ═══

BANNED PHRASES — instant quality failure:
"In today's rapidly evolving", "It's important to note", "It's worth mentioning", "At the end of the day", "In the world of", "When it comes to", "Let's dive in", "Without further ado", "In this comprehensive", "Whether you're a beginner or", "One thing is clear", "The question remains", "Only time will tell", "As we navigate", "Stay tuned"

BANNED VOCABULARY:
"landscape", "crucial", "comprehensive", "robust", "cutting-edge", "game-changer", "deep dive", "paradigm", "synergy", "empower", "transform", "unlock", "harness", "delve", "explore" (as verb for reading), "journey", "realm", "Moreover", "Furthermore", "Notably"

STRUCTURE RULES:
- No copula avoidance: "is a scam" not "serves as a scam" or "functions as a scam"
- No synonym cycling: don't swap "scam/fraud/scheme/deception" every sentence
- No significance inflation: "detected" not "staggering number detected"
- No narrator-from-a-distance: "SpyOwl detected" not "It has been observed that"
- Vary rhythm: mix 6-word sentences with 22-word sentences. No metronomic pattern.
- Every section ends on a verdict or action, not a trail-off

═══ E-E-A-T SIGNAL REQUIREMENTS (CRITICAL FOR YMYL) ═══

EXPERIENCE (the E that separates you from generic AI content):
- methodology section: Describe the actual investigation process with dates, tools, and scope
- experience_signals: Include 3-5 observations that ONLY someone who investigated would know
- Use first-person plural ("We detected", "Our analysis found", "SpyOwl captured")
- Reference specific technical details: domain registration dates, SSL cert ages, ad account patterns

EXPERTISE:
- expertise_depth: Explain WHY Crypto Killer is qualified (SpyOwl tech, database scale, methodology)
- Use precise technical language: "WHOIS lookup", "SSL certificate inspection", "payment processor identification"
- Quantify the platform's experience: "analyzed 500+ scam brands", "monitored N+ ad networks"

AUTHORITATIVENESS:
- sources array: Include 4-6 real authoritative sources. Required source types:
  * At least 1 regulatory body (FCA, SEC, ASIC, FINMA, CySEC)
  * At least 1 government resource (IC3.gov, ReportFraud.ftc.gov, ActionFraud)
  * At least 1 technical source (WHOIS lookup, SSL databases)
  * At least 1 consumer protection resource (BBB, Trustpilot, ScamAdviser)
  Use REAL URLs for government and regulatory bodies. For brand-specific lookups, use the correct URL pattern.

TRUSTWORTHINESS:
- disclaimer: Full YMYL disclaimer with date range and methodology transparency
- not_for_you: Honest scope limitations — strongest single trust signal
- Present data provenance: "SpyOwl detected" not "sources report"
- Acknowledge what you DON'T know: "Our analysis covers paid advertising campaigns; we cannot confirm or deny [specific claim]"

═══ SOURCE LEDGER RULES ═══
Every sources entry must have: title, url, type, accessed_date.
The url must be a real, navigable URL. Examples:
- {"title": "FCA Warning List", "url": "https://www.fca.org.uk/scamsmart/warning-list", "type": "regulatory", "accessed_date": "${currentDate}"}
- {"title": "SEC EDGAR Company Search", "url": "https://www.sec.gov/cgi-bin/browse-edgar?company=&CIK=&type=&dateb=&owner=include&count=40&search_text=&action=getcompany", "type": "regulatory", "accessed_date": "${currentDate}"}
- {"title": "IC3 Internet Crime Complaint Center", "url": "https://www.ic3.gov/", "type": "government", "accessed_date": "${currentDate}"}
- {"title": "FTC Report Fraud", "url": "https://reportfraud.ftc.gov/", "type": "government", "accessed_date": "${currentDate}"}
- {"title": "ScamAdviser", "url": "https://www.scamadviser.com/", "type": "consumer_protection", "accessed_date": "${currentDate}"}
Include at least 4 sources. Type must be one of: regulatory, database, news, government, technical, consumer_protection.

═══ RED FLAGS REQUIREMENTS ═══
Generate 6-8 flags. Each flag.detail MUST cite at least 2 specific numbers. Cover these categories (when data supports):
1. Celebrity impersonation (names + count)
2. Geographic spread (countries + count)
3. Ad volume and velocity (creative count + 7d rate)
4. Campaign longevity (days active + date range)
5. No regulatory compliance (absence of license)
6. Fake testimonials and social proof
7. High-pressure tactics and urgency
8. No verifiable company information

═══ FAQ REQUIREMENTS ═══
Generate 6-8 Q&As. Each answer is an AI Overview extraction target.

═══ ICP AUDIENCE LANGUAGE (mined from 55+ real victim conversations) ═══

Your reader is one of these people:
A) PRE-SCAM SEARCHER: Saw an ad, Googled "[brand] scam" before depositing. Needs instant confirmation.
B) MID-SCAM DOUBTER: Already deposited, withdrawal failed, now searching. Needs validation + action steps.
C) POST-SCAM VICTIM: Lost money, feeling shame. Needs to know they're not stupid, recovery scams are real, and what to report.
D) CONCERNED FAMILY: Searching on behalf of elderly parent, romantic partner, or child. Needs evidence to show their loved one.

WRITE IN THEIR LANGUAGE — these are real phrases from victim conversations:
- Pain: "lost my life savings", "couldn't withdraw a cent", "deposits succeeded, cash-outs didn't", "they keep harassing me with 20 calls a day", "felt completely helpless"
- Emotion: "felt so dumb", "ashamed and embarrassed", "drain you mentally and emotionally", "it's a nightmare", "it hit me — I had been scammed"
- Search intent: "is [brand] legit", "[brand] scam", "can I get my money back", "how to report crypto scam"
- Decision moments: "after months I decided to ask for a payout", "the interest rates turned my brain off", "all the research I did after depositing should have been done beforehand"
- Warning phrases: "anyone who tells you to pay by cryptocurrency is a scammer", "no trading bot can guarantee profits", "recovery services are just another scam"

TONE CALIBRATION:
- Never mock or condescend. Victims include retirees, professionals, and educated people — scams exploit emotions, not intelligence.
- Validate the reader's suspicion ("You're right to be suspicious" / "The fact that you're researching this is the smartest move you can make")
- Address shame directly — "Being targeted by a sophisticated scam does not reflect on your intelligence"
- When discussing recovery scams, be firm but compassionate — victims are desperate and vulnerable to secondary exploitation
- Use "targeted" not "fell for" — the scam targeted them, they didn't fail

CRITICAL: Output ONLY the JSON object. No explanation before or after.`

    const userPrompt = `Generate a ${currentYear} scam review for: ${brandData.name}

INTELLIGENCE DATA (cite these numbers directly — every claim must trace to this data):
- Threat Score: ${brandData.scam_score}/100
- Total Ad Creatives Detected: ${brandData.total_creatives}
- Geographic Spread: ${brandData.total_geos} countries
- Celebrities Impersonated: ${brandData.total_celebrities}
- 7-Day Ad Velocity: ${brandData.velocity_7d} new creatives
- Velocity Trend: ${brandData.velocity_trend}
- Campaign Duration: ${longevityDays} days (first seen: ${brandData.first_seen_at}, last seen: ${brandData.last_seen_at})
- Brand Status: ${brandData.status}

CELEBRITY NAMES (use in 3-example rule): ${(brandData.celebrity_list || []).join(', ') || 'None detected'}
COUNTRIES TARGETED (use in 3-example rule): ${(brandData.geo_list || []).join(', ') || 'Unknown'}

AD CREATIVE SAMPLES (${creativeSample.length} of ${brandData.total_creatives} total):
${creativeSample
  .slice(0, 8)
  .map(
    (c, i) =>
      `${i + 1}. "${c.offer_name || c.normalized_offer}" | Geo: ${c.geo || 'N/A'} | Celebrity: ${c.celebrity_name || 'None'} | Video: ${c.is_video ? 'Yes' : 'No'}`
  )
  .join('\n')}

EVIDENCE IMAGES AVAILABLE: ${availableImages.length} verified screenshots in database

Write a review that:
1. Passes Google's E-E-A-T quality rater assessment for YMYL content
2. Gets extracted by AI Overviews for "Is ${brandData.name} a scam?" queries
3. Every single claim traces to the intelligence data above — zero fabrication
4. Includes the "Not For You" trust block (strongest E-E-A-T differentiator)
5. Uses ${currentYear} temporal markers for semantic freshness
6. Speaks to ALL FOUR ICP segments — the pre-scam searcher (open with instant answer), mid-scam doubter (validate withdrawal failure pattern), post-scam victim (no shame + concrete reporting steps), and concerned family member (shareable evidence)
7. Uses real victim language in the summary and how_it_works: reference patterns like "deposits succeed but cash-outs don't", "relentless phone calls from changing numbers", "fees to unlock withdrawals that never arrive"
8. FAQ must include at least one recovery question ("Can I get my money back from ${brandData.name}?") and one family question ("How do I convince someone ${brandData.name} is a scam?")
9. protection_steps must warn about recovery scams — "Any company claiming they can recover your crypto for an upfront fee is a secondary scam targeting people who've already lost money"
10. The summary's first sentence must directly answer the search query "Is ${brandData.name} a scam?" — this is the AI Overview extraction target

E-E-A-T CRITICAL REQUIREMENTS:
11. methodology: Describe the ACTUAL investigation process — SpyOwl scanned ad networks between ${brandData.first_seen_at || 'detection start'} and ${brandData.last_seen_at || 'present'}, capturing ${brandData.total_creatives} creatives. Cross-referenced against regulatory databases. Reference the specific intelligence data above.
12. expertise_depth: Explain why Crypto Killer is qualified — SpyOwl monitors ad networks across 50+ countries, database of 500+ scam brands. Reference technical capabilities.
13. experience_signals: Include 3-5 SPECIFIC observations from investigating THIS brand. Reference actual creative counts, geo patterns, celebrity impersonation patterns from the data above. Each must sound like something only an investigator who looked at the actual ads would know.
14. sources: Include 4-6 real authoritative sources with valid URLs. At least 1 regulatory (FCA/SEC/ASIC), 1 government (IC3/FTC), 1 technical, 1 consumer protection.
15. disclaimer: Full YMYL disclaimer with investigation date range and scope limitations.`

    // ─── Call Claude API ───
    const anthropicResponse = await fetch(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 8192,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: userPrompt,
            },
          ],
        }),
      }
    )

          send({ step: 'ai_done', progress: 70, message: 'AI response received — parsing content...' })

    if (!anthropicResponse.ok) {
      const errorText = await anthropicResponse.text()
      throw new Error(
        `Claude API error: ${anthropicResponse.status} - ${errorText}`
      )
    }

    const anthropicData = await anthropicResponse.json()

    if (anthropicData.stop_reason === 'max_tokens') {
      console.warn('Claude response was truncated at max_tokens — attempting repair')
    }

    const responseText =
      anthropicData.content[0].type === 'text'
        ? anthropicData.content[0].text
        : ''

    let reviewContent
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in response')
      }
      let jsonStr = jsonMatch[0]

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
    // Contains ONLY the analytical deep-dive content that Base44 does NOT render
    // from individual fields. Base44's ReviewDetail.jsx separately renders:
    //   - Summary (hero section)
    //   - How It Works (from how_it_works field)
    //   - Red Flags (via <RedFlags> component)
    //   - Protection Steps (via <ActionSteps> component)
    //   - FAQs (via <FAQSection> component)
    //   - Verdict (via verdict section)
    // So full_article provides: byline, takeaways, methodology, investigation
    // findings, threat intelligence tables, evidence images, sources, disclaimer.
    // Table cell styles
    const thStyle = 'padding:10px 14px;text-align:left;font-size:13px;font-weight:600;color:#f59e0b;background:rgba(245,158,11,0.1);border-bottom:2px solid rgba(245,158,11,0.3)'
    const tdLabelStyle = 'padding:10px 14px;font-size:14px;color:rgba(255,255,255,0.7);border-bottom:1px solid rgba(255,255,255,0.06)'
    const tdValueStyle = 'padding:10px 14px;font-size:14px;color:rgba(255,255,255,0.95);border-bottom:1px solid rgba(255,255,255,0.06);font-weight:500'
    const tableStyle = 'width:100%;border-collapse:collapse;margin:16px 0 24px;background:rgba(255,255,255,0.03);border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.08)'

    let fullArticle = `${authorBylineTemplate}

<h3 style="color:#f59e0b;font-size:17px;margin:28px 0 12px">Key Takeaways</h3>
<ul style="list-style:none;padding:0;margin:0 0 20px">
${(reviewContent.key_takeaways || []).map(t => `<li style="padding:8px 12px;margin:6px 0;background:rgba(245,158,11,0.06);border-radius:6px;border-left:2px solid rgba(245,158,11,0.4);line-height:1.6;color:rgba(255,255,255,0.85)">✅ ${escHtml(t)}</li>`).join('\n')}
</ul>
${evidenceGridHtml}

${methodologyHtml}
${experienceSignalsHtml}

<h2 style="color:#f59e0b;font-size:20px;margin:32px 0 12px;border-bottom:1px solid rgba(245,158,11,0.3);padding-bottom:8px">Threat Intelligence Overview</h2>
<p style="line-height:1.7;margin:0 0 16px;color:rgba(255,255,255,0.85)">${escHtml(brandData.name)} has been flagged by our ad surveillance system with a threat score of ${brandData.scam_score}/100. The platform has deployed ${brandData.total_creatives} ad creatives across ${brandData.total_geos} countries over a ${longevityDays}-day campaign.</p>
<table style="${tableStyle}">
<thead><tr><th style="${thStyle}">Metric</th><th style="${thStyle}">Value</th></tr></thead>
<tbody>
<tr><td style="${tdLabelStyle}">Threat Score</td><td style="${tdValueStyle}"><strong style="color:#ef4444">${brandData.scam_score}/100</strong></td></tr>
<tr><td style="${tdLabelStyle}">Ad Creatives Detected</td><td style="${tdValueStyle}">${brandData.total_creatives}</td></tr>
<tr><td style="${tdLabelStyle}">Countries Targeted</td><td style="${tdValueStyle}">${brandData.total_geos}</td></tr>
<tr><td style="${tdLabelStyle}">Celebrities Impersonated</td><td style="${tdValueStyle}">${brandData.total_celebrities}</td></tr>
<tr><td style="${tdLabelStyle}">7-Day Velocity</td><td style="${tdValueStyle}">${brandData.velocity_7d} new creatives</td></tr>
<tr><td style="${tdLabelStyle}">Campaign Duration</td><td style="${tdValueStyle}">${longevityDays} days</td></tr>
<tr><td style="${tdLabelStyle}">First Detected</td><td style="${tdValueStyle}">${brandData.first_seen_at ? new Date(brandData.first_seen_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Unknown'}</td></tr>
<tr><td style="${tdLabelStyle}">Last Active</td><td style="${tdValueStyle}">${brandData.last_seen_at ? new Date(brandData.last_seen_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Unknown'}</td></tr>
</tbody>
</table>

${(brandData.geo_list || []).length > 0 ? `<h3 style="color:#f59e0b;font-size:17px;margin:24px 0 12px">Geographic Targeting Breakdown</h3>
<table style="${tableStyle}">
<thead><tr><th style="${thStyle}">Region</th><th style="${thStyle}">Countries</th></tr></thead>
<tbody>
${(() => {
  const geos = brandData.geo_list || []
  const regions = { 'Europe': [], 'Asia': [], 'Americas': [], 'Africa': [], 'Oceania': [], 'Other': [] }
  const regionMap = { 'GB': 'Europe', 'DE': 'Europe', 'FR': 'Europe', 'IT': 'Europe', 'ES': 'Europe', 'NL': 'Europe', 'PL': 'Europe', 'SE': 'Europe', 'AT': 'Europe', 'CH': 'Europe', 'BE': 'Europe', 'CZ': 'Europe', 'DK': 'Europe', 'FI': 'Europe', 'NO': 'Europe', 'IE': 'Europe', 'PT': 'Europe', 'RO': 'Europe', 'HU': 'Europe', 'GR': 'Europe', 'SK': 'Europe', 'BG': 'Europe', 'HR': 'Europe', 'SI': 'Europe', 'LT': 'Europe', 'LV': 'Europe', 'EE': 'Europe', 'US': 'Americas', 'CA': 'Americas', 'BR': 'Americas', 'MX': 'Americas', 'AR': 'Americas', 'CO': 'Americas', 'CL': 'Americas', 'PE': 'Americas', 'IN': 'Asia', 'JP': 'Asia', 'KR': 'Asia', 'SG': 'Asia', 'MY': 'Asia', 'TH': 'Asia', 'PH': 'Asia', 'ID': 'Asia', 'VN': 'Asia', 'TW': 'Asia', 'HK': 'Asia', 'AU': 'Oceania', 'NZ': 'Oceania', 'ZA': 'Africa', 'NG': 'Africa', 'KE': 'Africa', 'EG': 'Africa' }
  geos.forEach(g => { const r = regionMap[g] || 'Other'; regions[r].push(g) })
  return Object.entries(regions).filter(([,v]) => v.length > 0).map(([region, countries]) =>
    `<tr><td style="${tdLabelStyle}"><strong>${region}</strong></td><td style="${tdValueStyle}">${countries.join(', ')} (${countries.length})</td></tr>`
  ).join('\n')
})()}
</tbody>
</table>` : ''}

${notForYouHtml ? `<h2 style="color:#f59e0b;font-size:20px;margin:32px 0 12px;border-bottom:1px solid rgba(245,158,11,0.3);padding-bottom:8px">When This Review May Not Apply</h2>\n${notForYouHtml}` : ''}

${sourcesHtml}

${disclaimerHtml}`

    // Clean any residual markdown formatting leaked by Claude
    fullArticle = cleanMarkdown(fullArticle)

    // Calculate word count
    const wordCount = fullArticle.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(w => w).length

    // Replace word count placeholders in the author byline
    fullArticle = fullArticle
      .replace('{{WORD_COUNT}}', wordCount.toString())
      .replace('{{READ_TIME}}', Math.ceil(wordCount / 250).toString())

    // ─── COMPUTE SLUG (needed by schema below and DB save) ───
    const baseSlug = brandData.slug || brandData.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    const slug = baseSlug.endsWith('-review') ? baseSlug : `${baseSlug}-review`

    // ─── BUILD JSON-LD SCHEMA (@graph pattern) ───
    // Organization → Person/Author → WebSite → Article → Review → ClaimReview → FAQPage
    // Full E-E-A-T entity graph with @id cross-references
    const siteUrl = 'https://crypto-killer.base44.app'
    const reviewUrl = `${siteUrl}/reviews/${slug}`

    const schemaJsonLd = {
      '@context': 'https://schema.org',
      '@graph': [
        // ── Organization Entity (Authoritativeness) ──
        {
          '@type': 'Organization',
          '@id': `${siteUrl}/#organization`,
          name: 'Crypto Killer',
          url: siteUrl,
          description: 'Scam intelligence platform powered by SpyOwl ad surveillance technology. Crypto Killer analyzes fraudulent advertising campaigns to protect consumers from cryptocurrency investment scams.',
          knowsAbout: [
            'Cryptocurrency Scams',
            'Crypto Fraud Detection',
            'Ad Surveillance Technology',
            'Investment Scam Analysis',
            'Celebrity Impersonation Scams',
            'Financial Consumer Protection',
            'Digital Advertising Fraud',
          ],
          sameAs: [
            'https://github.com/nicro296/crypto-killer',
          ],
          subjectOf: {
            '@type': 'WebSite',
            '@id': `${siteUrl}/#website`,
          },
        },
        // ── Person/Author Entity (Expertise + Experience) ──
        {
          '@type': 'Person',
          '@id': `${siteUrl}/#author`,
          name: 'Crypto Killer Research Team',
          jobTitle: 'Crypto Fraud Intelligence Analysts',
          worksFor: { '@id': `${siteUrl}/#organization` },
          description: reviewContent.expertise_depth || 'Specialists in ad surveillance, blockchain analysis, and financial fraud pattern recognition.',
          knowsAbout: [
            'Cryptocurrency Fraud Investigation',
            'Ad Surveillance Analysis',
            'Scam Pattern Recognition',
            'Financial Regulatory Compliance',
            'WHOIS and SSL Certificate Analysis',
          ],
          hasCredential: {
            '@type': 'EducationalOccupationalCredential',
            credentialCategory: 'Professional Experience',
            description: 'SpyOwl ad surveillance platform operators with access to 500+ scam brand investigations.',
          },
        },
        // ── WebSite Entity ──
        {
          '@type': 'WebSite',
          '@id': `${siteUrl}/#website`,
          url: siteUrl,
          name: 'Crypto Killer',
          publisher: { '@id': `${siteUrl}/#organization` },
        },
        // ── Article Entity (primary content) ──
        {
          '@type': 'Article',
          '@id': `${reviewUrl}#article`,
          headline: reviewContent.headline || reviewContent.title,
          description: reviewContent.meta_description,
          datePublished: currentDate,
          dateModified: currentDate,
          wordCount: wordCount,
          author: { '@id': `${siteUrl}/#author` },
          publisher: { '@id': `${siteUrl}/#organization` },
          isPartOf: { '@id': `${siteUrl}/#website` },
          mainEntityOfPage: { '@id': `${reviewUrl}#webpage` },
          about: {
            '@type': 'Thing',
            name: brandData.name,
            description: `Alleged cryptocurrency investment scam with ${brandData.scam_score}/100 threat score`,
          },
          mentions: [
            ...(brandData.celebrity_list || []).slice(0, 5).map(celeb => ({
              '@type': 'Person',
              name: celeb,
            })),
          ],
          citation: (reviewContent.sources || []).map(s => ({
            '@type': 'CreativeWork',
            name: s.title,
            url: s.url,
          })),
          speakable: {
            '@type': 'SpeakableSpecification',
            cssSelector: ['.author-byline', 'h2', 'h3', '.card p:first-of-type'],
          },
        },
        // ── Review Entity (rating) ──
        {
          '@type': 'Review',
          '@id': `${reviewUrl}#review`,
          itemReviewed: {
            '@type': 'Product',
            name: brandData.name,
            description: 'Cryptocurrency investment platform',
            category: 'Cryptocurrency Investment',
          },
          reviewRating: {
            '@type': 'Rating',
            ratingValue: Math.max(1, Math.round((100 - brandData.scam_score) / 20)),
            bestRating: 5,
            worstRating: 1,
            ratingExplanation: `Threat score of ${brandData.scam_score}/100 based on ${brandData.total_creatives} ad creatives detected across ${brandData.total_geos} countries.`,
          },
          author: { '@id': `${siteUrl}/#author` },
          publisher: { '@id': `${siteUrl}/#organization` },
          reviewBody: reviewContent.verdict,
          datePublished: currentDate,
        },
        // ── ClaimReview Entity (fact-check signal) ──
        {
          '@type': 'ClaimReview',
          '@id': `${reviewUrl}#claimreview`,
          url: reviewUrl,
          claimReviewed: `${brandData.name} is a legitimate cryptocurrency investment platform`,
          author: { '@id': `${siteUrl}/#organization` },
          datePublished: currentDate,
          reviewRating: {
            '@type': 'Rating',
            ratingValue: 1,
            bestRating: 5,
            worstRating: 1,
            alternateName: brandData.scam_score >= 80 ? 'False' : brandData.scam_score >= 50 ? 'Mostly False' : 'Unverified',
          },
          itemReviewed: {
            '@type': 'Claim',
            name: `${brandData.name} is a legitimate investment platform`,
            author: { '@type': 'Organization', name: brandData.name },
            datePublished: brandData.first_seen_at || currentDate,
            appearance: {
              '@type': 'CreativeWork',
              name: `${brandData.name} advertising campaign`,
              description: `${brandData.total_creatives} ad creatives detected across ${brandData.total_geos} countries`,
            },
          },
        },
        // ── FAQPage Entity (AI extraction target) ──
        {
          '@type': 'FAQPage',
          '@id': `${reviewUrl}#faqpage`,
          mainEntity: (reviewContent.faq || []).map(f => ({
            '@type': 'Question',
            name: f.question,
            acceptedAnswer: {
              '@type': 'Answer',
              text: f.answer,
            },
          })),
        },
      ],
    }

          send({ step: 'saving', progress: 90, message: 'Saving to database...' })

    // Check if review already exists for this brand
    const existingReview = await supabaseRequest(
      `/reviews?brand_id=eq.${brand_id}&select=id,status`
    )

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
      })),
      verdict: reviewContent.verdict,
      faq: reviewContent.faq,
      full_article: fullArticle,
      scam_score: brandData.scam_score || 0,
      status: (Array.isArray(existingReview) && existingReview.length > 0) ? existingReview[0].status : 'draft',
      ai_model: 'claude-haiku-4-5-20251001',
      ai_prompt_version: 'eeat-v2.0-seo-v3.1-schema-v2-icp-v1',
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
      trust_indicators: {
        creatives_analyzed: brandData.total_creatives,
        countries_scanned: brandData.total_geos,
        celebrities_identified: brandData.total_celebrities,
        investigation_period_days: longevityDays,
        data_source: 'SpyOwl Ad Surveillance',
        evidence_images: availableImages.length,
      },
    }

    if (Array.isArray(existingReview) && existingReview.length > 0) {
      reviewId = existingReview[0].id
      await supabaseRequest(`/reviews?id=eq.${reviewId}`, {
        method: 'PATCH',
        body: JSON.stringify(reviewPayload),
        headers: { 'Prefer': 'return=minimal' },
      })
    } else {
      const createResponse = await supabaseRequest('/reviews', {
        method: 'POST',
        body: JSON.stringify(reviewPayload),
        headers: { 'Prefer': 'return=representation' },
      })
      reviewId = Array.isArray(createResponse) ? createResponse[0].id : createResponse.id
    }

          send({
            step: 'done',
            progress: 100,
            message: 'Review generated successfully!',
            result: {
              review_id: reviewId,
              brand_slug: slug,
              status: (Array.isArray(existingReview) && existingReview.length > 0) ? existingReview[0].status : 'draft',
              word_count: wordCount,
              images_embedded: availableImages.length,
              schema_types: ['Organization', 'Person', 'Article', 'Review', 'ClaimReview', 'FAQPage'],
              eeat_version: 'v2.0',
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
    })
  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      return unauthorizedResponse()
    }
    return Response.json(
      { error: error.message },
      { status: 500 }
    )
  }
}
