import { supabaseRequest, SUPABASE_URL } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''

// Supabase Storage public URL for creative images
const STORAGE_BASE = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/creative-images`
  : ''

// Claude API needs 30-60s for full review generation
export const maxDuration = 60

/**
 * POST /api/admin/reviews/generate
 * Generate a scam review article using Claude API
 * Full seo-blog-generator v3.1 + schema-markup-generator methodology:
 * E-E-A-T, BLUF, Algorithmic Authorship, AI Overview extractability,
 * entity-rich writing, anti-slop, "Not For You" block, FAQPage schema,
 * declaration-first structure, 3-example rule, numeric specificity.
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

    // Fetch brand data
    const brand = await supabaseRequest(
      `/scam_brands?id=eq.${brand_id}&select=*`
    )

    if (!Array.isArray(brand) || brand.length === 0) {
      return Response.json(
        { error: 'Brand not found' },
        { status: 404 }
      )
    }

    const brandData = brand[0]

    // Fetch sample creatives for this brand
    const creatives = await supabaseRequest(
      `/creatives?normalized_offer=eq.${encodeURIComponent(
        brandData.normalized_name
      )}&select=*&limit=20`
    )

    const creativeSample = Array.isArray(creatives) ? creatives : []

    // ─── SELECT DIVERSE CREATIVE IMAGES ───
    const photoCreatives = creativeSample.filter(c => !c.is_video)
    const imageCreatives = []
    const seenGeos = new Set()
    const seenCelebs = new Set()

    // Priority 1: Diverse celebrities
    for (const c of photoCreatives) {
      if (imageCreatives.length >= 10) break
      if (c.celebrity_name && c.celebrity_name !== 'Not mentioned' && !seenCelebs.has(c.celebrity_name)) {
        seenCelebs.add(c.celebrity_name)
        seenGeos.add(c.geo)
        imageCreatives.push(c)
      }
    }
    // Priority 2: Diverse geos
    for (const c of photoCreatives) {
      if (imageCreatives.length >= 10) break
      if (!seenGeos.has(c.geo) && !imageCreatives.find(ic => ic.id === c.id)) {
        seenGeos.add(c.geo)
        imageCreatives.push(c)
      }
    }
    // Priority 3: Fill remaining up to at least 3
    for (const c of photoCreatives) {
      if (imageCreatives.length >= 10) break
      if (imageCreatives.length < 3 && !imageCreatives.find(ic => ic.id === c.id)) {
        imageCreatives.push(c)
      }
    }

    // Check which images exist in Supabase Storage
    let availableImages = []
    if (STORAGE_BASE && imageCreatives.length > 0) {
      const checkPromises = imageCreatives.map(async (c) => {
        try {
          const imgUrl = `${STORAGE_BASE}/${c.id}.webp`
          const headRes = await fetch(imgUrl, { method: 'HEAD' })
          if (headRes.ok) {
            return {
              id: c.id,
              url: imgUrl,
              celebrity: c.celebrity_name && c.celebrity_name !== 'Not mentioned' ? c.celebrity_name : null,
              geo: c.geo,
              offer: c.offer_name || c.normalized_offer,
            }
          }
          return null
        } catch { return null }
      })
      availableImages = (await Promise.all(checkPromises)).filter(Boolean)
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

    // ─── UPGRADED SYSTEM PROMPT ───
    // Full seo-blog-generator v3.1 + schema-markup-generator methodology
    const systemPrompt = `You are an investigative crypto fraud analyst at Crypto Killer, a scam intelligence platform powered by SpyOwl ad surveillance technology. You produce evidence-backed scam exposés that rank in Google Search, get cited by AI Overviews, and protect real people from losing money.

Your writing is grounded in three frameworks:
1. Google's Quality Raters Guidelines (E-E-A-T, Needs Met, YMYL)
2. Koray Tugberk Gubur's Algorithmic Authorship (declaration-first, EAV triplets, NLP-parseable)
3. GEO/AI Visibility optimization (extractive answers, standalone statements, structured data alignment)

OUTPUT FORMAT: Valid JSON with these fields. All string values must use \\n for line breaks (no literal newlines). Escape quotes with \\". No trailing commas. No markdown fences.

{
  "title": "SEO title under 60 chars. Format: Is {Brand} a Scam? {Score}/100 Threat Score [{Year}]",
  "headline": "H1 headline. Format: {Brand} Review: {N} Red Flags Exposed by SpyOwl Intelligence",
  "meta_description": "Under 155 chars. Must include: brand name, scam score, key evidence count, current year.",
  "summary": "BLUF opening paragraph (150-200 words). RULE: Answer the searcher's question in the FIRST sentence using declaration-first structure. Example: '{Brand} is a confirmed crypto scam with a {score}/100 threat score, based on {N} ad creatives detected across {N} countries.' Follow with 3-4 EAV triplets citing specific data. This paragraph is the primary AI Overview extraction target — every sentence must be standalone and make sense without context.",
  "key_takeaways": ["5-6 bullet points. Each must contain a specific number from the intelligence data. Declaration-first. These appear right after the intro as the BLUF summary."],
  "how_it_works": "250-350 words explaining the scam mechanics. Structure as a 4-step process: (1) Celebrity bait — fake endorsement ads using {celebrity names}, (2) Geo-targeting — ads served in {N} countries including {examples}, (3) The funnel — fake testimonials, urgency pressure, minimum deposit, (4) The trap — no withdrawals, account lockout, fake support. Each step must cite specific intelligence data. Use domain-specific verbs: 'targets', 'deploys', 'impersonates', 'funnels', 'exploits'. Vary sentence rhythm — mix 8-word declaratives with 20-word compound sentences.",
  "red_flags": [{"flag": "Specific red flag title (under 8 words)", "detail": "70-100 words of evidence. MUST cite at least 2 specific numbers from intelligence data. Declaration-first. Include entity names (celebrities, countries, dates). End with a verdict statement."}],
  "protection_steps": "150-200 words. Actionable steps for readers: (1) Report to IC3.gov and local authorities, (2) Contact your bank for chargeback within 60 days, (3) File FTC complaint at ReportFraud.ftc.gov, (4) Document everything — screenshots of ads, transaction records, communications. Include specific org names and URLs.",
  "not_for_you": "80-120 words. The 'Not For You' block — name specific scenarios where this review may NOT apply. Example: 'This review covers the crypto investment scheme using the name {Brand}. If you encountered a different product with a similar name in a regulated market, or if {Brand} contacted you through a licensed financial advisor with verifiable credentials, that may be a separate entity. Our analysis is based on ad surveillance data from SpyOwl — it covers paid advertising campaigns, not organic search results or direct referrals.' This is a trust signal — the single strongest E-E-A-T differentiator.",
  "verdict": "100-150 words. Final assessment paragraph. Restate the threat score, total evidence volume, and geographic spread. End with: 'Based on {N} ad creatives detected across {N} countries over {N} days, {Brand} exhibits every hallmark of a crypto investment scam.' No generic advice — be specific.",
  "faq": [{"question": "Natural question matching real search queries. Use formats: 'Is {Brand} legit or a scam?', 'Can I get my money back from {Brand}?', 'Is {Brand} regulated?', 'How does the {Brand} scam work?', 'Who is behind {Brand}?', 'What do {Brand} reviews say?', 'Has anyone made money with {Brand}?', 'How to report {Brand} scam?'", "answer": "40-60 words. CRITICAL: Each answer is an extractive AI Overview target. Must be standalone — makes complete sense without the question. Declaration-first. Include one specific data point. End with a concrete action or fact."}]
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
10. The summary's first sentence must directly answer the search query "Is ${brandData.name} a scam?" — this is the AI Overview extraction target`

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

    // ─── BUILD HTML ARTICLE ───
    const escHtml = (str) => (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    // Build evidence image HTML blocks
    const buildImageHtml = (img, caption) => {
      const altText = img.celebrity
        ? `${escHtml(brandData.name)} scam ad impersonating ${escHtml(img.celebrity)} detected in ${img.geo}`
        : `${escHtml(brandData.name)} fraudulent advertisement detected in ${img.geo}`
      return `<figure><img src="${img.url}" alt="${altText}" /><figcaption>${escHtml(caption)}</figcaption></figure>`
    }

    // Distribute images across sections
    const summaryImages = availableImages.slice(0, 2)
    const howItWorksImages = availableImages.slice(2, 4)
    const redFlagImages = availableImages.slice(4, 7)
    const extraImages = availableImages.slice(7, 10)

    const summaryImagesHtml = summaryImages
      .map(img => buildImageHtml(img, img.celebrity
        ? `SpyOwl detected this ${escHtml(brandData.name)} ad impersonating ${escHtml(img.celebrity)} targeting ${img.geo} users.`
        : `Scam advertisement for ${escHtml(brandData.name)} detected by SpyOwl in ${img.geo}.`
      )).join('\n')

    const howItWorksImagesHtml = howItWorksImages
      .map(img => buildImageHtml(img, img.celebrity
        ? `Fake celebrity endorsement ad using ${escHtml(img.celebrity)}'s likeness without consent.`
        : `${escHtml(brandData.name)} ad creative captured by SpyOwl surveillance.`
      )).join('\n')

    const redFlagImagesHtml = redFlagImages
      .map(img => buildImageHtml(img,
        `Evidence: ${escHtml(brandData.name)} ad targeting ${img.geo}${img.celebrity ? ` using ${escHtml(img.celebrity)}` : ''}.`
      )).join('\n')

    const extraImagesHtml = extraImages
      .map(img => buildImageHtml(img,
        `Additional scam ad variant detected in ${img.geo}.`
      )).join('\n')

    // Key takeaways HTML
    const keyTakeawaysHtml = (reviewContent.key_takeaways || [])
      .map(t => `<li>${escHtml(t)}</li>`)
      .join('\n')

    // Red flags HTML
    const redFlagsHtml = (reviewContent.red_flags || [])
      .map(rf => `<li><strong>${escHtml(rf.flag)}</strong> — ${escHtml(rf.detail)}</li>`)
      .join('\n')

    // FAQ HTML with proper semantic structure (optimized for AI extraction)
    const faqHtml = (reviewContent.faq || [])
      .map(f => `<h3>${escHtml(f.question)}</h3>\n<p>${escHtml(f.answer)}</p>`)
      .join('\n\n')

    // Protection steps — split by numbered items if present
    const protectionHtml = escHtml(reviewContent.protection_steps || reviewContent.verdict || '')

    // Not For You block
    const notForYouHtml = reviewContent.not_for_you
      ? `<blockquote><strong>Important Disclaimer:</strong> ${escHtml(reviewContent.not_for_you)}</blockquote>`
      : ''

    // ─── FULL ARTICLE HTML ───
    // Structured for SEO: proper H2 hierarchy, extractive answers first,
    // BLUF intro, Key Takeaways, evidence images distributed
    const fullArticle = `<h2>${escHtml(brandData.name)}: Investigation Summary</h2>
<p>${escHtml(reviewContent.summary)}</p>

<h3>Key Takeaways</h3>
<ul>
${keyTakeawaysHtml}
</ul>
${summaryImagesHtml}

<h2>Threat Intelligence Overview</h2>
<p>${escHtml(brandData.name)} has been flagged by SpyOwl's ad surveillance system with a threat score of ${brandData.scam_score}/100. The platform has deployed ${brandData.total_creatives} ad creatives across ${brandData.total_geos} countries over a ${longevityDays}-day campaign.</p>
<table>
<thead><tr><th>Metric</th><th>Value</th></tr></thead>
<tbody>
<tr><td>Threat Score</td><td><strong>${brandData.scam_score}/100</strong></td></tr>
<tr><td>Ad Creatives Detected</td><td>${brandData.total_creatives}</td></tr>
<tr><td>Countries Targeted</td><td>${brandData.total_geos}</td></tr>
<tr><td>Celebrities Impersonated</td><td>${brandData.total_celebrities}</td></tr>
<tr><td>7-Day Velocity</td><td>${brandData.velocity_7d} new creatives</td></tr>
<tr><td>Campaign Duration</td><td>${longevityDays} days</td></tr>
<tr><td>First Detected</td><td>${brandData.first_seen_at ? new Date(brandData.first_seen_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Unknown'}</td></tr>
<tr><td>Last Active</td><td>${brandData.last_seen_at ? new Date(brandData.last_seen_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Unknown'}</td></tr>
</tbody>
</table>

<h2>How the ${escHtml(brandData.name)} Scam Works</h2>
<p>${escHtml(reviewContent.how_it_works)}</p>
${howItWorksImagesHtml}

<h2>Red Flags: ${(reviewContent.red_flags || []).length} Warning Signs</h2>
<ol>
${redFlagsHtml}
</ol>
${redFlagImagesHtml}

<h2>What To Do If You've Been Targeted</h2>
<p>${protectionHtml}</p>

${notForYouHtml ? `<h2>When This Review May Not Apply</h2>\n${notForYouHtml}` : ''}

<h2>Frequently Asked Questions About ${escHtml(brandData.name)}</h2>
${faqHtml}
${extraImagesHtml}

<h2>${escHtml(brandData.name)}: Final Verdict</h2>
<p>${escHtml(reviewContent.verdict)}</p>`

    // Calculate word count
    const wordCount = fullArticle.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(w => w).length

    // ─── BUILD JSON-LD SCHEMA ───
    // Article + FAQPage (AI-extractable even without rich results) + Review
    const schemaJsonLd = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': 'https://crypto-killer.vercel.app/#organization',
          name: 'Crypto Killer',
          url: 'https://crypto-killer.vercel.app',
          description: 'Scam intelligence platform powered by SpyOwl ad surveillance technology.',
          knowsAbout: [
            'Cryptocurrency Scams',
            'Crypto Fraud Detection',
            'Ad Surveillance',
            'Investment Scam Analysis',
            'Celebrity Impersonation Scams'
          ],
        },
        {
          '@type': 'WebSite',
          '@id': 'https://crypto-killer.vercel.app/#website',
          url: 'https://crypto-killer.vercel.app',
          name: 'Crypto Killer',
          publisher: { '@id': 'https://crypto-killer.vercel.app/#organization' },
        },
        {
          '@type': 'Article',
          '@id': `https://crypto-killer.vercel.app/reviews/${brandData.slug}/#article`,
          headline: reviewContent.headline || reviewContent.title,
          description: reviewContent.meta_description,
          datePublished: currentDate,
          dateModified: currentDate,
          wordCount: wordCount,
          publisher: { '@id': 'https://crypto-killer.vercel.app/#organization' },
          isPartOf: { '@id': 'https://crypto-killer.vercel.app/#website' },
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
        },
        {
          '@type': 'Review',
          '@id': `https://crypto-killer.vercel.app/reviews/${brandData.slug}/#review`,
          itemReviewed: {
            '@type': 'Thing',
            name: brandData.name,
            description: `Cryptocurrency investment platform`,
          },
          reviewRating: {
            '@type': 'Rating',
            ratingValue: Math.max(1, Math.round((100 - brandData.scam_score) / 20)),
            bestRating: 5,
            worstRating: 1,
          },
          author: { '@id': 'https://crypto-killer.vercel.app/#organization' },
          reviewBody: reviewContent.verdict,
        },
        {
          '@type': 'FAQPage',
          '@id': `https://crypto-killer.vercel.app/reviews/${brandData.slug}/#faqpage`,
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

    // Check if review already exists for this brand
    const existingReview = await supabaseRequest(
      `/reviews?brand_id=eq.${brand_id}&select=id`
    )

    const slug = brandData.slug || brandData.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    let reviewId
    const reviewPayload = {
      brand_id: brand_id,
      slug: slug,
      title: reviewContent.title,
      headline: reviewContent.headline,
      meta_description: reviewContent.meta_description,
      summary: reviewContent.summary,
      how_it_works: reviewContent.how_it_works,
      red_flags: reviewContent.red_flags,
      verdict: reviewContent.verdict,
      faq: reviewContent.faq,
      full_article: fullArticle,
      scam_score: brandData.scam_score || 0,
      status: 'draft',
      ai_model: 'claude-haiku-4-5-20251001',
      ai_prompt_version: 'seo-blog-v3.1-schema-v1-icp-v1',
      word_count: wordCount,
      schema_json: schemaJsonLd,
      updated_at: new Date().toISOString(),
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

    return Response.json({
      review_id: reviewId,
      brand_slug: brandData.slug,
      status: 'draft',
      word_count: wordCount,
      images_embedded: availableImages.length,
      schema_types: ['Article', 'Review', 'FAQPage'],
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
