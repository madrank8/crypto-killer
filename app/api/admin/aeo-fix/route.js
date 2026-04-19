import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { callModel } from '@/lib/ai-models'

export const maxDuration = 120

/**
 * POST /api/admin/aeo-fix
 *
 * Targeted AEO fixes — patches specific issues in an article without
 * regenerating the whole thing. Sends the current HTML + fix instructions
 * to an LLM and returns the patched HTML.
 *
 * Body: {
 *   fullArticle: string,       // current HTML
 *   title: string,
 *   keyword: string,
 *   metaDescription: string,
 *   fixes: string[],           // category IDs to fix
 *   contentType: 'content' | 'review',
 * }
 *
 * fixes can include:
 *   'extractive'   — add 40-60 word answer blocks after headings
 *   'headings'     — rewrite H2s to question-shaped
 *   'bluf'         — rewrite opening to answer-first
 *   'entities'     — add entity disambiguation on first mentions
 *   'attribution'  — replace vague claims with named-source phrasing
 *   'freshness'    — add current-year references and "Updated" line
 *   'formatting'   — add tables, FAQ blocks, key-takeaway boxes
 *   'surface'      — improve heading depth, add inline citations
 *   'seo'          — (meta fixes are UI-side, article-level only here)
 */

const FIX_INSTRUCTIONS = {
  extractive: `EXTRACTIVE ANSWERS:
- After every H2 and H3 heading, ensure there is a 40-60 word standalone paragraph that directly answers the heading's question/topic.
- The answer must be DECLARATION-FIRST — lead with the answer, not with "In this section" or "Let's explore".
- The answer must make sense if lifted out of context (no orphan pronouns like "this" or "it" referring to something else).
- If a heading already has a good extractive answer, leave it alone.
- Only add/fix answers that are missing or start with filler phrases.`,

  headings: `QUESTION-SHAPED HEADINGS:
- Rewrite H2 headings to mirror natural-language queries users would type into AI search.
- Use question words: What, How, Why, Is, Can, Should, Does, Which, Where, When.
- Keep H2s between 5-14 words. Too short (< 3 words) is too vague, too long (> 14) gets truncated.
- Preserve the primary keyword inside the question when possible.
- Do NOT change H3 headings unless they are obviously broken.
- If a heading is already question-shaped, leave it alone.`,

  bluf: `BLUF (BOTTOM LINE UP FRONT):
- Rewrite the first 1-2 paragraphs to lead with the answer, not a story or introduction.
- Remove any opening that starts with "In this guide", "In this article", "Welcome to", "Let's explore", "Today we'll".
- The first paragraph should directly answer the page's primary question in 40-80 words.
- Include the target keyword naturally in the first 100 words.
- Include at least one named source or specific fact in the first 200 words.
- Keep the rest of the article unchanged.`,

  entities: `ENTITY DISAMBIGUATION:
- On FIRST mention of every proper noun, brand, drug, tool, framework, acronym, or law, add a brief appositive clause that disambiguates it.
  Example: "Enclomiphene" → "Enclomiphene, a selective estrogen receptor modulator,"
  Example: "SERP" → "SERP (Search Engine Results Page)"
- Do NOT add disambiguation on subsequent mentions — only the first.
- If an entity is already disambiguated on first mention, leave it alone.
- Target 15+ distinct named entities for articles over 1500 words.`,

  attribution: `ATTRIBUTION-READY CLAIMS:
- Find every instance of vague attribution like "studies show", "experts say", "research indicates", "according to experts", "data suggests" and replace with NAMED sources.
  Example: "Studies show X increases by 30%" → "A 2024 Journal of Clinical Endocrinology study (n=412) found X increases by 30%"
- Every statistic must have a year attached.
- Every claim should have a named source inline (not footnoted).
- If you cannot verify a specific source, use plausible attribution format and mark with [VERIFY] so the editor knows to check.
- Do NOT invent fake studies or authors.`,

  freshness: `FRESHNESS SIGNALS:
- Add a visible "Updated: April 2026" line near the top of the article (after the first paragraph or in a metadata block).
- Ensure at least 2-3 references to "2026" or "2025" appear naturally in the content where discussing current state.
- If citing old statistics, add recent context: "As of 2026, this trend has [continued/accelerated/changed]."
- Do NOT change dateModified schema here — that's handled separately.`,

  formatting: `STRUCTURED FORMATTING:
- Add a "Key Takeaways" or "Quick Summary" box near the top with 3-5 bullet points summarizing the article.
  Format: <div class="key-takeaways"><h3>Key Takeaways</h3><ul><li>...</li></ul></div>
- If the article discusses comparisons, add an HTML comparison table with relevant columns.
- Ensure there are at least 2 ordered or unordered lists in the body.
- If FAQ items exist but aren't in the article HTML, add a FAQ section at the bottom:
  <div class="faq-section"><h2>Frequently Asked Questions</h2> then each Q&A as <h3>Question?</h3><p>Answer</p>
- Leave existing structural elements in place — only ADD missing ones.`,

  surface: `AI SURFACE FIT:
- If the article has fewer than 8 H2 headings, add relevant H2 sections to improve query fan-out coverage.
- Each new H2 should target a common sub-query related to the topic.
- Under every new H2, add a 40-60 word extractive answer + 1-2 supporting paragraphs.
- Add H3 sub-headings under longer H2 sections to create heading depth.
- Ensure there are inline citations/external links in the body (at least 3-4).
- If no images are in the article body, add placeholder comments where images should go: <!-- IMAGE: description of recommended image -->`,
}

export async function POST(request) {
  try {
    verifyAdmin(request)
  } catch {
    return unauthorizedResponse()
  }

  try {
    const body = await request.json()
    const { fullArticle, title, keyword, metaDescription, fixes, contentType } = body

    if (!fullArticle) {
      return Response.json({ error: 'No article content provided' }, { status: 400 })
    }
    if (!fixes || !Array.isArray(fixes) || fixes.length === 0) {
      return Response.json({ error: 'No fixes specified' }, { status: 400 })
    }

    // Build fix instructions from requested categories
    const fixBlocks = fixes
      .filter(f => FIX_INSTRUCTIONS[f])
      .map(f => FIX_INSTRUCTIONS[f])

    if (fixBlocks.length === 0) {
      return Response.json({ error: 'No valid fix categories' }, { status: 400 })
    }

    const systemPrompt = `You are an expert SEO and AEO (Answer Engine Optimization) editor.
Your job is to apply TARGETED fixes to an existing article. You must:
1. ONLY modify what the fix instructions specify — preserve everything else exactly.
2. Keep the same HTML structure, CSS classes, and formatting.
3. Never remove existing content unless the fix explicitly replaces it.
4. Return the COMPLETE article HTML with fixes applied.
5. Do NOT add markdown — output pure HTML only.
6. Do NOT wrap the output in code fences or backticks.
7. Do NOT add explanations before or after — output ONLY the fixed HTML.`

    const userPrompt = `ARTICLE CONTEXT:
- Title: ${title || 'Untitled'}
- Target keyword: ${keyword || 'none'}
- Meta description: ${metaDescription || 'none'}
- Content type: ${contentType || 'content'}
- Word count: ~${fullArticle.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length} words

FIX INSTRUCTIONS — Apply ALL of the following:

${fixBlocks.join('\n\n---\n\n')}

CURRENT ARTICLE HTML:

${fullArticle}`

    const result = await callModel('claude-sonnet', systemPrompt, userPrompt, {
      maxTokens: 16000,
    })

    if (!result?.text) {
      return Response.json({ error: 'AI returned empty response' }, { status: 500 })
    }

    // Clean up response — strip code fences if the model added them
    let fixedHtml = result.text.trim()
    if (fixedHtml.startsWith('```html')) {
      fixedHtml = fixedHtml.replace(/^```html\s*/, '').replace(/\s*```$/, '')
    } else if (fixedHtml.startsWith('```')) {
      fixedHtml = fixedHtml.replace(/^```\s*/, '').replace(/\s*```$/, '')
    }

    return Response.json({
      success: true,
      fixedArticle: fixedHtml,
      fixesApplied: fixes.filter(f => FIX_INSTRUCTIONS[f]),
      model: result.resolvedModel || result.label || 'unknown',
    })
  } catch (err) {
    console.error('[aeo-fix] Error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
