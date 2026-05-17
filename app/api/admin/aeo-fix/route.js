import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { callModel, extractJSON } from '@/lib/ai-models'

export const maxDuration = 60

/**
 * POST /api/admin/aeo-fix
 *
 * Targeted AEO fixes — returns JSON patches instead of the full article
 * to stay within Vercel's function timeout. The frontend applies patches.
 *
 * Body: {
 *   fullArticle: string,
 *   title: string,
 *   keyword: string,
 *   fixes: string[],
 *   contentType: 'content' | 'review',
 * }
 */

/** Extract headings + first paragraph after each for AI context */
function extractStructure(html) {
  if (!html) return ''
  const parts = []

  // Get first 800 chars (intro)
  parts.push('INTRO:\n' + html.slice(0, 800).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())

  // Extract all headings with their first paragraph
  const regex = /<(h[23])[^>]*>([\s\S]*?)<\/\1>\s*(?:<p[^>]*>([\s\S]*?)<\/p>)?/gi
  let m
  let idx = 0
  while ((m = regex.exec(html)) !== null) {
    const heading = m[2].replace(/<[^>]*>/g, '').trim()
    const para = m[3] ? m[3].replace(/<[^>]*>/g, '').trim().slice(0, 200) : '(no paragraph after heading)'
    parts.push(`H${m[1][1]}[${idx}]: ${heading}\n  → ${para}`)
    idx++
  }

  return parts.join('\n\n')
}

const FIX_PROMPTS = {
  extractive: `For each heading that lacks a strong extractive answer (40-60 word standalone declaration-first paragraph), generate one.
Return array: [{ "after_heading_index": N, "insert_html": "<p>answer...</p>" }]
Only generate for headings that need it — skip ones that already have good answers.`,

  headings: `Rewrite H2 headings to question-shaped format (What, How, Why, Is, Can, Should...).
Return array: [{ "heading_index": N, "old": "original heading", "new": "Question-shaped heading?" }]
Only rewrite headings that are NOT already questions. Keep 5-14 words.`,

  bluf: `The opening needs to be answer-first (BLUF). Generate a replacement for the first 1-2 paragraphs.
The new opening must: lead with the direct answer (40-80 words), include the keyword naturally, contain one specific fact.
Return: { "replace_intro": "<p>new opening paragraph...</p>" }`,

  entities: `Find proper nouns, brands, acronyms, tools that appear WITHOUT disambiguation on first mention.
Return array: [{ "entity": "name", "find": "exact text to find", "replace": "text with appositive clause added" }]
Example: { "entity": "SERP", "find": "SERP results", "replace": "SERP (Search Engine Results Page) results" }`,

  attribution: `Find vague claims like "studies show", "experts say", "research indicates" and generate named-source replacements.
Return array: [{ "find": "exact vague text", "replace": "named-source version with year" }]
Mark uncertain sources with [VERIFY].`,

  freshness: `Generate freshness signals to insert.
Return: { "updated_line": "<p class=\"updated-date\"><strong>Updated: April 2026</strong></p>", "year_inserts": [{ "near_heading_index": N, "text": "phrase with 2026 reference to weave in" }] }`,

  formatting: `Generate structural elements the article is missing.
Return: { "key_takeaways": "<div class=\\"key-takeaways\\"><h3>Key Takeaways</h3><ul><li>point 1</li>...</ul></div>", "faq_section": "<div class=\\"faq-section\\"><h2>Frequently Asked Questions</h2><h3>Q1?</h3><p>A1</p>...</div>" or null, "tables": [{ "after_heading_index": N, "html": "<table>...</table>" }] or [] }`,

  surface: `Generate new H2 sections to improve query fan-out coverage (target 10-15 H2s total).
Return array: [{ "new_section_html": "<h2>Question heading?</h2><p>40-60 word extractive answer...</p><p>Supporting detail...</p>", "insert_before_heading_index": N or "append" }]
Each new H2 should target a common sub-query. Include H3 sub-headings where relevant.`,
}

export async function POST(request) {
  try {
    verifyAdmin(request)
  } catch {
    return unauthorizedResponse()
  }

  try {
    const body = await request.json()
    const { fullArticle, title, keyword, fixes, contentType } = body

    if (!fullArticle) {
      return Response.json({ error: 'No article content provided' }, { status: 400 })
    }
    if (!fixes || !Array.isArray(fixes) || fixes.length === 0) {
      return Response.json({ error: 'No fixes specified' }, { status: 400 })
    }

    const validFixes = fixes.filter(f => FIX_PROMPTS[f])
    if (validFixes.length === 0) {
      return Response.json({ error: 'No valid fix categories' }, { status: 400 })
    }

    // Extract article structure (headings + first paras) — much smaller than full HTML
    const structure = extractStructure(fullArticle)
    const wordCount = fullArticle.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length

    const fixInstructions = validFixes.map(f => `### ${f.toUpperCase()}\n${FIX_PROMPTS[f]}`).join('\n\n')

    const systemPrompt = `You are an AEO (Answer Engine Optimization) editor. You return ONLY valid JSON — no markdown fences, no explanation.
Given an article's structure (headings + first paragraphs), generate targeted patches.
All HTML output must be clean, semantic HTML. No markdown.
The keyword is "${keyword || 'none'}" and the content type is "${contentType || 'content'}".`

    const userPrompt = `ARTICLE: "${title || 'Untitled'}" (~${wordCount} words)

STRUCTURE:
${structure}

GENERATE PATCHES FOR:
${fixInstructions}

Return a single JSON object with a key for each fix category requested. Example shape:
{
  "extractive": [...],
  "headings": [...],
  "bluf": {...},
  ...
}
Return ONLY the JSON.`

    const result = await callModel('claude-haiku', systemPrompt, userPrompt, {
      maxTokens: 4000,
      timeoutMs: 45000,
    })

    if (!result?.text) {
      return Response.json({ error: 'AI returned empty response' }, { status: 500 })
    }

    let patches
    try {
      patches = extractJSON(result.text)
    } catch {
      // Try to clean up and parse
      let cleaned = result.text.trim()
      if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\w*\s*/, '').replace(/\s*```$/, '')
      patches = JSON.parse(cleaned)
    }

    // Apply patches to the article
    let fixedHtml = fullArticle
    const applied = []

    // ── Apply heading rewrites ──
    if (patches.headings && Array.isArray(patches.headings)) {
      for (const h of patches.headings) {
        if (h.old && h.new) {
          const escaped = h.old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const re = new RegExp(`(<h2[^>]*>)\\s*${escaped}\\s*(</h2>)`, 'i')
          if (re.test(fixedHtml)) {
            fixedHtml = fixedHtml.replace(re, `$1${h.new}$2`)
            applied.push(`heading: "${h.old}" → "${h.new}"`)
          }
        }
      }
    }

    // ── Apply BLUF replacement ──
    if (patches.bluf?.replace_intro) {
      // Replace first <p>...</p> with the new intro
      const firstP = fixedHtml.match(/^(\s*(?:<[^p][^>]*>[\s\S]*?<\/[^p][^>]*>\s*)*)<p[^>]*>[\s\S]*?<\/p>/i)
      if (firstP) {
        fixedHtml = fixedHtml.replace(
          /^(\s*(?:<[^p][^>]*>[\s\S]*?<\/[^p][^>]*>\s*)*)<p[^>]*>[\s\S]*?<\/p>/i,
          `$1${patches.bluf.replace_intro}`
        )
        applied.push('bluf: replaced opening paragraph')
      }
    }

    // ── Apply extractive answer inserts ──
    if (patches.extractive && Array.isArray(patches.extractive)) {
      // Find all heading positions, apply in reverse order
      const headingRegex = /<h[23][^>]*>[\s\S]*?<\/h[23]>/gi
      const headingPositions = []
      let hm
      while ((hm = headingRegex.exec(fixedHtml)) !== null) {
        headingPositions.push({ index: hm.index, end: hm.index + hm[0].length, text: hm[0] })
      }

      const sorted = [...patches.extractive].sort((a, b) =>
        (b.after_heading_index || 0) - (a.after_heading_index || 0)
      )

      for (const patch of sorted) {
        const hIdx = patch.after_heading_index
        if (hIdx != null && headingPositions[hIdx] && patch.insert_html) {
          const pos = headingPositions[hIdx].end
          fixedHtml = fixedHtml.slice(0, pos) + '\n' + patch.insert_html + fixedHtml.slice(pos)
          applied.push(`extractive: added answer after heading ${hIdx}`)
        }
      }
    }

    // ── Apply entity disambiguation ──
    if (patches.entities && Array.isArray(patches.entities)) {
      for (const e of patches.entities) {
        if (e.find && e.replace && fixedHtml.includes(e.find)) {
          // Only replace first occurrence
          fixedHtml = fixedHtml.replace(e.find, e.replace)
          applied.push(`entity: disambiguated "${e.entity || e.find}"`)
        }
      }
    }

    // ── Apply attribution fixes ──
    if (patches.attribution && Array.isArray(patches.attribution)) {
      for (const a of patches.attribution) {
        if (a.find && a.replace && fixedHtml.includes(a.find)) {
          fixedHtml = fixedHtml.replace(a.find, a.replace)
          applied.push(`attribution: "${a.find.slice(0, 30)}..." → named source`)
        }
      }
    }

    // ── Apply freshness signals ──
    if (patches.freshness) {
      if (patches.freshness.updated_line) {
        // Insert after first paragraph
        const firstPEnd = fixedHtml.indexOf('</p>')
        if (firstPEnd !== -1) {
          const insertPos = firstPEnd + 4
          fixedHtml = fixedHtml.slice(0, insertPos) + '\n' + patches.freshness.updated_line + fixedHtml.slice(insertPos)
          applied.push('freshness: added "Updated" line')
        }
      }
    }

    // ── Apply formatting (key takeaways, FAQ, tables) ──
    if (patches.formatting) {
      if (patches.formatting.key_takeaways && !fixedHtml.includes('key-takeaways')) {
        // Insert after first paragraph (or after updated_line if we just added it)
        const firstPEnd = fixedHtml.indexOf('</p>')
        if (firstPEnd !== -1) {
          const insertPos = firstPEnd + 4
          fixedHtml = fixedHtml.slice(0, insertPos) + '\n' + patches.formatting.key_takeaways + fixedHtml.slice(insertPos)
          applied.push('formatting: added Key Takeaways box')
        }
      }
      if (patches.formatting.faq_section && !fixedHtml.includes('faq-section')) {
        fixedHtml = fixedHtml + '\n\n' + patches.formatting.faq_section
        applied.push('formatting: added FAQ section')
      }
    }

    // ── Apply surface fit (new sections) ──
    if (patches.surface && Array.isArray(patches.surface)) {
      // Append new sections at the end (before any FAQ section)
      const faqPos = fixedHtml.indexOf('<div class="faq-section">')
      for (const s of patches.surface) {
        if (s.new_section_html) {
          if (faqPos !== -1) {
            fixedHtml = fixedHtml.slice(0, faqPos) + s.new_section_html + '\n\n' + fixedHtml.slice(faqPos)
          } else {
            fixedHtml = fixedHtml + '\n\n' + s.new_section_html
          }
          applied.push('surface: added new H2 section')
        }
      }
    }

    return Response.json({
      success: true,
      fixedArticle: fixedHtml,
      fixesApplied: validFixes,
      patchesApplied: applied,
      patchCount: applied.length,
      model: result.resolvedModel || result.label || 'unknown',
    })
  } catch (err) {
    console.error('[aeo-fix] Error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
