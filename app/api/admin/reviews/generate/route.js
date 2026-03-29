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

    // Build Claude prompt
    const systemPrompt = `You are an investigative journalist writing a crypto scam review article. Write a comprehensive, evidence-backed article grounded in the ad intelligence data provided.

Output valid JSON with these fields:
- title: SEO title, format "Is {Brand} a Scam? [2026 Investigation]" (under 60 chars)
- headline: Short verdict headline like "{Brand}: Confirmed Scam — {N} Red Flags Found"
- meta_description: SEO meta description (under 155 chars)
- summary: Opening verdict paragraph (200-300 words). Lead with the verdict. Cite specific numbers.
- how_it_works: Detailed explanation of how the scam operates (300-400 words). Reference specific evidence from the data.
- red_flags: Array of 5-8 objects with {flag: string, detail: string}. Each must cite specific evidence from the data (countries, celebrity names, creative counts).
- verdict: Final verdict and recommendations (150-200 words). Include what to do if scammed.
- faq: Array of 5-8 objects with {question: string, answer: string}. Common questions about this scam.
- full_article: Complete markdown article (1200-1800 words) combining all sections with proper headings. Structure: ## Verdict → ## Key Statistics → ## How {Brand} Works → ## Red Flags → ## What To Do If You've Been Scammed → ## FAQ → ## Final Verdict

Be concise but specific — cite exact numbers from the data. Every red flag must be backed by evidence.`

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
          model: 'claude-sonnet-4-6',
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
      reviewContent = JSON.parse(jsonMatch[0])
    } catch (parseError) {
      throw new Error(`Failed to parse Claude response: ${parseError.message}`)
    }

    // Calculate word count
    const wordCount = (reviewContent.full_article || '').split(/\s+/).length

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
      ai_model: 'claude-sonnet-4-6',
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
