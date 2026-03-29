import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''

// Claude API needs 30-60s for full review generation
export const maxDuration = 60

/**
 * POST /api/admin/reviews/generate
 * Generate a scam review article using Claude API
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

    // Build Claude prompt — NO full_article in JSON to avoid parsing issues
    const systemPrompt = `You are an investigative journalist writing a crypto scam review article. Write a comprehensive, evidence-backed article grounded in the ad intelligence data provided.

Output valid JSON with these fields:
- title: SEO title, format "Is {Brand} a Scam? [2026 Investigation]" (under 60 chars)
- headline: Short verdict headline like "{Brand}: Confirmed Scam — {N} Red Flags Found"
- meta_description: SEO meta description (under 155 chars)
- summary: Opening verdict paragraph (150-200 words). Lead with the verdict. Cite specific numbers.
- how_it_works: Detailed explanation of how the scam operates (200-300 words). Reference specific evidence.
- red_flags: Array of 5-8 objects with {"flag": "string", "detail": "string"}. Each must cite specific evidence.
- verdict: Final verdict and recommendations (100-150 words). Include what to do if scammed.
- faq: Array of 5-8 objects with {"question": "string", "answer": "string"}.

CRITICAL RULES:
1. Output ONLY the JSON object — no markdown fences, no text before/after
2. All string values must be single-line (no literal newlines — use spaces instead)
3. Escape quotes with \\"
4. No trailing commas
5. Keep each string value under 2000 characters`

    const userPrompt = `Generate a scam review article for: ${brandData.name}

Brand Intelligence:
- Normalized Name: ${brandData.normalized_name}
- Scam Score: ${brandData.scam_score}/100
- Total Creatives Found: ${brandData.total_creatives}
- Geographic Spread: ${brandData.total_geos} countries
- Celebrity Names Referenced: ${brandData.total_celebrities}
- 7-Day Velocity: ${brandData.velocity_7d} new creatives
- Velocity Trend: ${brandData.velocity_trend}
- First Seen: ${brandData.first_seen_at}
- Last Seen: ${brandData.last_seen_at}

Celebrity Names: ${(brandData.celebrity_list || []).join(', ') || 'None detected'}
Countries: ${(brandData.geo_list || []).join(', ') || 'Unknown'}

Sample Creatives (${creativeSample.length} found):
${creativeSample
  .slice(0, 5)
  .map(
    (c, i) =>
      `${i + 1}. Offer: "${c.offer_name || c.normalized_offer}", Geo: ${c.geo || 'N/A'}, Celebrity: ${c.celebrity_name || 'None'}, Video: ${c.is_video ? 'Yes' : 'No'}`
  )
  .join('\n')}

Generate a detailed scam review article with comprehensive red flags, evidence-backed analysis, and practical guidance for victims.`

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
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in response')
      }
      let jsonStr = jsonMatch[0]

      // Repair common LLM JSON issues:
      // 1. Trailing commas before ] or }
      jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1')

      reviewContent = JSON.parse(jsonStr)
    } catch (parseError) {
      throw new Error(`Failed to parse Claude response: ${parseError.message}`)
    }

    // Build full_article server-side from structured sections
    const redFlagsList = (reviewContent.red_flags || [])
      .map((rf, i) => `${i + 1}. **${rf.flag}** — ${rf.detail}`)
      .join('\n\n')

    const faqList = (reviewContent.faq || [])
      .map(f => `**${f.question}**\n\n${f.answer}`)
      .join('\n\n')

    const fullArticle = `## Verdict\n\n${reviewContent.summary || ''}\n\n## Key Statistics\n\n- **Scam Score:** ${brandData.scam_score}/100\n- **Total Creatives:** ${brandData.total_creatives}\n- **Countries Targeted:** ${brandData.total_geos}\n- **Celebrities Exploited:** ${brandData.total_celebrities}\n- **7-Day Velocity:** ${brandData.velocity_7d} new creatives\n\n## How ${brandData.name} Works\n\n${reviewContent.how_it_works || ''}\n\n## Red Flags\n\n${redFlagsList}\n\n## What To Do If You've Been Scammed\n\n${reviewContent.verdict || ''}\n\n## FAQ\n\n${faqList}\n\n## Final Verdict\n\n${reviewContent.verdict || ''}`

    reviewContent.full_article = fullArticle

    // Calculate word count
    const wordCount = fullArticle.split(/\s+/).length

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
      full_article: reviewContent.full_article,
      scam_score: brandData.scam_score || 0,
      status: 'draft',
      ai_model: 'claude-haiku-4-5-20251001',
      word_count: wordCount,
      updated_at: new Date().toISOString(),
    }

    if (Array.isArray(existingReview) && existingReview.length > 0) {
      // Update existing review
      reviewId = existingReview[0].id
      await supabaseRequest(`/reviews?id=eq.${reviewId}`, {
        method: 'PATCH',
        body: JSON.stringify(reviewPayload),
        headers: { 'Prefer': 'return=minimal' },
      })
    } else {
      // Insert new review
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
