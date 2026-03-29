import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''

// Claude API needs 30-60s for full review generation
export const maxDuration = 60

/**
 * POST /api/admin/reviews/generate
 * Generate a scam review article using Claude API
 * Uses SEO blog generator methodology: E-E-A-T, BLUF, Algorithmic Authorship,
 * AI Overview extractability, entity-rich writing, anti-slop.
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

    // Calculate longevity
    const firstSeen = brandData.first_seen_at ? new Date(brandData.first_seen_at) : null
    const lastSeen = brandData.last_seen_at ? new Date(brandData.last_seen_at) : null
    const longevityDays = firstSeen && lastSeen
      ? Math.round((lastSeen - firstSeen) / (1000 * 60 * 60 * 24))
      : 0

    // ─── SEO-OPTIMIZED SYSTEM PROMPT ───
    // Based on seo-blog-generator skill v3.1: E-E-A-T, BLUF, Algorithmic Authorship,
    // AI Overview extractability, entity-rich writing, anti-slop methodology.
    const systemPrompt = `You are an investigative crypto fraud analyst at Crypto Killer, a scam intelligence platform powered by SpyOwl ad surveillance data. You write evidence-backed scam reviews that rank in search and get cited by AI systems.

OUTPUT FORMAT: Valid JSON with these fields. All string values must be single-line (no literal newlines — use spaces). Escape quotes with \\". No trailing commas. No markdown fences.

{
  "title": "SEO title under 60 chars, format: Is {Brand} a Scam? [{Year} Review]",
  "headline": "Verdict headline: {Brand}: Confirmed Scam — {N} Red Flags Exposed",
  "meta_description": "Under 155 chars. Include brand name + scam score + key evidence.",
  "summary": "BLUF opening (150-200 words). CRITICAL: Answer the searcher's question in the FIRST sentence. Declaration-first: '{Brand} is a confirmed crypto scam with a {score}/100 threat score, based on {N} ad creatives detected across {N} countries.' Then cite 3-4 key data points. Entity-rich: name specific celebrities, countries, creative counts. No throat-clearers ('In today's world...'). No vague claims without numbers.",
  "how_it_works": "200-300 words. Declaration-first sentences. Explain the scam's mechanics step-by-step using evidence from the creatives data: (1) how victims are targeted (celebrity endorsement ads, geo-targeting), (2) what the ads promise, (3) how the funnel works (fake testimonials → deposit → no withdrawal). Use specific entity names from the data — real celebrity names, real country names, real creative counts. No generic filler.",
  "red_flags": [{"flag": "Short specific title", "detail": "Evidence-backed detail citing exact numbers from the data. Must reference specific entities (celebrity names, country names, creative counts, dates). Declaration-first sentence structure."}],
  "verdict": "100-150 words. Final assessment with actionable advice. What to do if scammed: report to IC3.gov, contact bank, file FTC complaint. Include the scam score as a risk indicator.",
  "faq": [{"question": "Question format matching real search queries about this scam", "answer": "40-60 word extractive answer. Standalone — must make sense without surrounding context. Declaration-first. Include a specific data point."}]
}

SEO WRITING RULES (from Koray Tugberk Gubur's Algorithmic Authorship):
1. DECLARATION-FIRST: Open every statement with the fact, not a dependent clause. YES: "${brandData.name} targets victims through celebrity endorsement ads." NO: "When looking at the data, it becomes clear that..."
2. ONE IDEA PER SENTENCE: Cleaner dependency trees for NLP extraction.
3. ENTITY-ATTRIBUTE-VALUE TRIPLETS: "${brandData.name} (entity) has been detected in (attribute) ${brandData.total_geos} countries (value)."
4. NUMERIC SPECIFICITY: "${brandData.total_creatives} creatives" not "numerous creatives". "${brandData.total_geos} countries" not "multiple countries".
5. DOMAIN-SPECIFIC VERBS: "targets", "exploits", "impersonates", "deceives" — not "utilizes", "leverages", "navigates".
6. 3-EXAMPLE RULE: For plural nouns, give 3 concrete examples. "Countries targeted include [X], [Y], and [Z]."
7. AI OVERVIEW EXTRACTABILITY: Each FAQ answer must be a standalone extractive answer (40-60 words) that an AI system can cite directly.

ANTI-SLOP RULES:
- NO: "In today's rapidly evolving", "It's important to note", "landscape", "crucial", "comprehensive", "robust", "cutting-edge", "game-changer", "deep dive", "at the end of the day", "it's worth noting"
- NO: Copula avoidance ("serves as" → just use "is"). No synonym cycling. No significance inflation.
- YES: Plain, direct language. Short sentences mixed with longer ones. Specific numbers over vague qualifiers.

RED FLAGS REQUIREMENTS: Generate 5-8 flags. Each flag.detail MUST cite at least one specific number from the intelligence data. Cover these categories when data supports it: (1) Celebrity impersonation, (2) Geographic spread, (3) Ad volume/velocity, (4) False promises, (5) No regulatory compliance, (6) Fake testimonials, (7) Urgency tactics, (8) No verifiable company info.

FAQ REQUIREMENTS: Generate 5-8 Q&As. Questions must match real search queries: "Is {Brand} legit?", "Can I get my money back from {Brand}?", "Is {Brand} regulated?", "How does the {Brand} scam work?", "Who is behind {Brand}?"

CRITICAL: Output ONLY the JSON object. No explanation before or after.`

    const userPrompt = `Generate an SEO-optimized scam review for: ${brandData.name}

INTELLIGENCE DATA (cite these numbers directly):
- Threat Score: ${brandData.scam_score}/100
- Total Ad Creatives Detected: ${brandData.total_creatives}
- Geographic Spread: ${brandData.total_geos} countries
- Celebrities Impersonated: ${brandData.total_celebrities}
- 7-Day Ad Velocity: ${brandData.velocity_7d} new creatives
- Velocity Trend: ${brandData.velocity_trend}
- Campaign Duration: ${longevityDays} days (${brandData.first_seen_at} to ${brandData.last_seen_at})

CELEBRITY NAMES: ${(brandData.celebrity_list || []).join(', ') || 'None detected'}
COUNTRIES TARGETED: ${(brandData.geo_list || []).join(', ') || 'Unknown'}

AD CREATIVE SAMPLES (${creativeSample.length} of ${brandData.total_creatives} total):
${creativeSample
  .slice(0, 5)
  .map(
    (c, i) =>
      `${i + 1}. "${c.offer_name || c.normalized_offer}" | Geo: ${c.geo || 'N/A'} | Celebrity: ${c.celebrity_name || 'None'} | Video: ${c.is_video ? 'Yes' : 'No'}`
  )
  .join('\n')}

Write a review that would pass Google's E-E-A-T quality rater assessment. Every claim must trace to the intelligence data above. No fabricated statistics.`

    // Call Claude API
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
          max_tokens: 4096,
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

    // Extract JSON from Claude response
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

      reviewContent = JSON.parse(jsonStr)
    } catch (parseError) {
      throw new Error(`Failed to parse Claude response: ${parseError.message}`)
    }

    // ─── BUILD HTML ARTICLE SERVER-SIDE ───
    // Structured for TipTap editor, SEO-optimized with proper heading hierarchy
    const escHtml = (str) => (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    const redFlagsHtml = (reviewContent.red_flags || [])
      .map(rf => `<li><strong>${escHtml(rf.flag)}</strong> — ${escHtml(rf.detail)}</li>`)
      .join('\n')

    const faqHtml = (reviewContent.faq || [])
      .map(f => `<h3>${escHtml(f.question)}</h3>\n<p>${escHtml(f.answer)}</p>`)
      .join('\n\n')

    const fullArticle = `<h2>${escHtml(brandData.name)}: Investigation Summary</h2>
<p>${escHtml(reviewContent.summary)}</p>

<h2>Key Threat Intelligence</h2>
<ul>
<li><strong>Threat Score:</strong> ${brandData.scam_score}/100</li>
<li><strong>Ad Creatives Detected:</strong> ${brandData.total_creatives}</li>
<li><strong>Countries Targeted:</strong> ${brandData.total_geos}</li>
<li><strong>Celebrities Impersonated:</strong> ${brandData.total_celebrities}</li>
<li><strong>7-Day Velocity:</strong> ${brandData.velocity_7d} new creatives</li>
<li><strong>Campaign Duration:</strong> ${longevityDays} days</li>
</ul>

<h2>How the ${escHtml(brandData.name)} Scam Works</h2>
<p>${escHtml(reviewContent.how_it_works)}</p>

<h2>Red Flags</h2>
<ol>
${redFlagsHtml}
</ol>

<h2>What To Do If You've Been Scammed</h2>
<p>${escHtml(reviewContent.verdict)}</p>

<h2>Frequently Asked Questions</h2>
${faqHtml}

<h2>Final Verdict</h2>
<p>${escHtml(reviewContent.verdict)}</p>`

    // Calculate word count from HTML (strip tags)
    const wordCount = fullArticle.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(w => w).length

    // Check if review already exists for this brand
    const existingReview = await supabaseRequest(
      `/reviews?brand_id=eq.${brand_id}&select=id`
    )

    // Generate slug from brand name
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
      word_count: wordCount,
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
