/**
 * lib/article-html.js — shared HTML builders for the content writers.
 * Date: 2026-06-11 (P1-2, content-writing feature audit)
 *
 * Extracted from app/api/admin/content/fill/route.js, which held the
 * canonical copy. The legacy monolithic writer (content/generate) carried a
 * diverged duplicate (older comments, missing the 'todo' link filter, dead
 * faq/sources locals) — both routes now import from here so future changes
 * land in one place.
 *
 * Render contract (CRITICAL — division of labour with the Replit SSR):
 *   RENDERED HERE: Key Takeaways -> body sections (with distributed social
 *   proof + visual placeholders) -> Not For You -> Related Investigations ->
 *   author bio.
 *   NOT RENDERED HERE: article.summary, FAQ, Source Ledger, any JSON-LD.
 *   Replit's renderBlogPost emits those from the structured columns; inline
 *   copies produced duplicate intros/FAQ/structured-data (the
 *   romance-scammer-red-flags incident).
 */

/**
 * Apply inline formatting: VERIFY tags, bold, italic, inline code.
 */
function applyInlineFormatting(text) {
  return text
    .replace(/\{\{VERIFY:\s*(.+?)\s*\|\s*(.+?)\}\}/g,
      '<span class="verify-tag" data-verify="true" title="$2">[$1]</span>')
    .replace(/\{\{RESEARCH NEEDED:\s*(.+?)\}\}/g,
      '<span class="research-tag" data-verify="research">[$1]</span>')
    .replace(/\{\{SOURCE NEEDED:\s*(.+?)\}\}/g,
      '<span class="source-tag" data-verify="source">[$1]</span>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
}

/**
 * Convert markdown-flavored section body into rich HTML.
 * Parses: tables, unordered/ordered lists, callout boxes, blockquotes,
 * bold/italic, inline code, and {{VERIFY}} tags. Falls back to <p> for plain text.
 */
function bodyToHtml(body) {
  if (!body) return ''
  const text = String(body)

  // Split into blocks on double newlines
  const blocks = text.split(/\n{2,}/).filter(b => b.trim())
  const htmlParts = []

  for (const block of blocks) {
    const trimmed = block.trim()

    // ── H3 subheading: ### heading text ──
    const h3Match = trimmed.match(/^###\s+(.+)$/)
    if (h3Match) {
      htmlParts.push(`<h3>${applyInlineFormatting(h3Match[1].trim())}</h3>`)
      continue
    }

    // ── Callout boxes: {{WARNING: text}} or {{TIP: text}} ──
    const calloutMatch = trimmed.match(/^\{\{(WARNING|TIP|NOTE|CAUTION):\s*([\s\S]+?)\}\}$/i)
    if (calloutMatch) {
      const type = calloutMatch[1].toLowerCase()
      const content = applyInlineFormatting(calloutMatch[2].trim())
      htmlParts.push(`<div class="callout callout-${type}"><strong>${calloutMatch[1].charAt(0).toUpperCase() + calloutMatch[1].slice(1).toLowerCase()}:</strong> ${content}</div>`)
      continue
    }

    // ── Markdown table: lines starting with | ──
    const lines = trimmed.split('\n')
    if (lines.length >= 2 && lines[0].trim().startsWith('|') && lines[1].trim().match(/^\|[\s:|-]+\|$/)) {
      const parseRow = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      const headers = parseRow(lines[0])
      const dataRows = lines.slice(2).filter(l => l.trim().startsWith('|'))
      let table = '<div class="table-wrapper"><table>\n<thead><tr>'
      headers.forEach(h => { table += `<th>${applyInlineFormatting(h)}</th>` })
      table += '</tr></thead>\n<tbody>'
      dataRows.forEach(row => {
        const cells = parseRow(row)
        table += '\n<tr>'
        cells.forEach(c => { table += `<td>${applyInlineFormatting(c)}</td>` })
        table += '</tr>'
      })
      table += '\n</tbody></table></div>'
      htmlParts.push(table)
      continue
    }

    // ── Blockquote: lines starting with > ──
    if (lines[0].trim().startsWith('>')) {
      const quoteLines = lines.map(l => l.trim().replace(/^>\s?/, ''))
      let attribution = ''
      let quoteText = quoteLines
      if (quoteLines.length > 1 && /^(—|--|-)/.test(quoteLines[quoteLines.length - 1])) {
        attribution = quoteLines[quoteLines.length - 1].replace(/^(—|--|-)\s*/, '')
        quoteText = quoteLines.slice(0, -1)
      }
      let bq = `<blockquote class="expert-quote"><p>${applyInlineFormatting(quoteText.join(' '))}</p>`
      if (attribution) bq += `\n<cite>— ${applyInlineFormatting(attribution)}</cite>`
      bq += '</blockquote>'
      htmlParts.push(bq)
      continue
    }

    // ── Unordered list: lines starting with - or * ──
    if (lines.every(l => /^\s*[-*]\s+/.test(l) || !l.trim())) {
      const items = lines.filter(l => l.trim()).map(l => l.trim().replace(/^[-*]\s+/, ''))
      htmlParts.push(`<ul>\n${items.map(i => `<li>${applyInlineFormatting(i)}</li>`).join('\n')}\n</ul>`)
      continue
    }

    // ── Ordered list: lines starting with 1. 2. etc ──
    if (lines.every(l => /^\s*\d+\.\s+/.test(l) || !l.trim())) {
      const items = lines.filter(l => l.trim()).map(l => l.trim().replace(/^\d+\.\s+/, ''))
      htmlParts.push(`<ol>\n${items.map(i => `<li>${applyInlineFormatting(i)}</li>`).join('\n')}\n</ol>`)
      continue
    }

    // ── Default: paragraph ──
    let html = trimmed.replace(/\n/g, '<br/>')
    html = applyInlineFormatting(html)
    if (/<(figure|div|img|table|blockquote)\b/i.test(html)) {
      htmlParts.push(html)
    } else {
      htmlParts.push(`<p>${html}</p>`)
    }
  }

  return htmlParts.join('\n')
}

/**
 * Build full HTML from structured article data.
 *
 * Renders ONLY: Key Takeaways → Body sections (with social proof + visuals) →
 *               Not For You → Related Investigations → Author bio.
 *
 * DOES NOT render: article.summary, FAQ section, Source Ledger, Article
 * JSON-LD, FAQPage JSON-LD. Those are rendered by the Replit SSR layer
 * (artifacts/crypto-review/server/prerender.ts -> renderBlogPost) from the
 * structured `summary`, `faq`, `sources` columns and from the @graph
 * builder. Rendering them inline here too produced visible duplicate
 * intro paragraphs, two FAQ sections, two Source sections, and double
 * structured data per page (the romance-scammer-red-flags incident).
 *
 * This mirrors the matching fix in app/api/admin/content/generate/route.js
 * (commit 4822c58).
 */
function buildArticleHtml(article, persona) {
  const sections = Array.isArray(article.sections) ? article.sections : []
  const keyTakeaways = Array.isArray(article.key_takeaways) ? article.key_takeaways : []
  const notForYou = article.not_for_you || ''
  const authorName = article.author_name || persona?.name || 'CryptoKiller Research Team'

  // Strip leading author name from bio if the model echoed it back. The
  // renderer prepends "{authorName} — " around the bio, so a bio that
  // starts with "P. Nair investigates ..." becomes "P. Nair — P. Nair
  // investigates ...". Defensive strip at write time.
  const rawBio = article.author_bio || `investigates cryptocurrency fraud at CryptoKiller.`
  const escapedAuthor = authorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const stutterStripRe = new RegExp(`^\\s*${escapedAuthor}\\s*[—\\-:,]?\\s*`, 'i')
  const authorBio = String(rawBio).replace(stutterStripRe, '').trim() || rawBio

  // Filter internal_links to entries with real slugs. The prompt forbids
  // '#' / 'TBD' placeholders, but a defensive filter prevents broken links
  // in the rendered HTML even if the model regresses or legacy drafts
  // slip through. Drops the Related Investigations section entirely if
  // nothing valid survives.
  const internalLinks = (Array.isArray(article.internal_links) ? article.internal_links : [])
    .filter((l) => {
      const t = String(l?.target_slug || '').trim()
      return t && t !== '#' && t !== 'TBD' && t.toLowerCase() !== 'todo' && t.length > 1
    })

  const socialProof = Array.isArray(article.social_proof) ? article.social_proof : []
  const visualPlaceholders = Array.isArray(article.visual_placeholders) ? article.visual_placeholders : []

  const parts = []

  // NOTE: article.summary is NOT rendered here. Replit SSR emits it as a
  // <p class="article-summary"> between byline and body. Rendering it inline
  // would produce the visible duplicate intro paragraph.

  // Key Takeaways (BLUF) — Replit SSR does NOT render this, so we do.
  if (keyTakeaways.length > 0) {
    parts.push(`<div class="key-takeaways">
<h2>Key Takeaways</h2>
<ul>
${keyTakeaways.map((t) => `<li>${t}</li>`).join('\n')}
</ul>
</div>`)
  }

  // Distribute social proof evenly — first quote appears by section 1, max 1 per section, no clustering
  const socialProofMap = {}
  if (socialProof.length > 0 && sections.length > 0) {
    const count = socialProof.length
    const sLen = sections.length
    const startIdx = sLen > 1 ? 1 : 0
    const availableSlots = sLen - startIdx
    const step = count <= 1 ? 1 : Math.max(1, Math.floor(availableSlots / count))
    socialProof.forEach((sp, i) => {
      const targetIdx = Math.min(startIdx + i * step, sLen - 1)
      let finalIdx = targetIdx
      while (socialProofMap[finalIdx] && finalIdx < sLen - 1) finalIdx++
      if (!socialProofMap[finalIdx]) socialProofMap[finalIdx] = []
      socialProofMap[finalIdx].push(sp)
    })
  }

  // Distribute visual placeholders across sections
  const visualMap = {}
  if (visualPlaceholders.length > 0) {
    const interval = Math.max(1, Math.floor(sections.length / visualPlaceholders.length))
    visualPlaceholders.forEach((vp, i) => {
      const targetIdx = Math.min(i * interval, sections.length - 1)
      if (!visualMap[targetIdx]) visualMap[targetIdx] = []
      visualMap[targetIdx].push(vp)
    })
  }

  // Defence-in-depth: strip the two patterns the writer prompt now forbids,
  // in case a model regression slips one in. The publish quality gate also
  // catches these but cleaning at render time keeps the rendered HTML safe.
  //   1. "This section [verb]..." opener (description-of-section, not content)
  //   2. "This topic relates to the broader area of '...'" trailer (taxonomy leak)
  // Plus strip a leading echo of article.summary if the model repeats it
  // at the start of the first section body — produces visible duplicate
  // intro paragraphs on the published page.
  const SKELETON_OPENER = /^\s*This\s+section\s+(?:explains|walks\s+through|defines|addresses|provides|details|covers|describes|outlines|introduces|presents|discusses|examines|explores|breaks\s+down)[^.]*\.\s*/i
  const TAXONOMY_TRAILER = /\s*This\s+(?:topic|article|guide|page|section)\s+(?:relates\s+to|is\s+part\s+of|falls\s+under|sits\s+under|belongs\s+to)\s+the\s+broader\s+(?:area|topic|category)\s+of\s+["“'][^"”']+["”']\.?\s*/gi

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    let cleanBody = String(s.body || '')
    cleanBody = cleanBody.replace(SKELETON_OPENER, '')
    cleanBody = cleanBody.replace(TAXONOMY_TRAILER, ' ')
    if (i === 0 && article.summary) {
      const sumWords = String(article.summary).trim().split(/\s+/).slice(0, 12).join(' ')
      if (sumWords.length > 30 && cleanBody.startsWith(sumWords)) {
        cleanBody = cleanBody.slice(sumWords.length).replace(/^[^A-Z0-9]*/, '').trim()
      }
    }
    cleanBody = cleanBody.trim()

    let sectionHtml = `<h2>${s.heading || 'Section'}</h2>\n${bodyToHtml(cleanBody)}`

    if (visualMap[i]) {
      for (const vp of visualMap[i]) {
        const match = String(vp).match(/\[(\w+)(?:\s+NEEDED)?:\s*(.+?)(?:\s*\|\s*Alt:\s*(.+?))?\]/)
        if (match) {
          sectionHtml += `\n<figure class="visual-placeholder" data-type="${match[1].toLowerCase()}">
<div class="placeholder-box" role="img" aria-label="${match[3]?.trim() || match[2].trim()}">[${match[1].toUpperCase()}: ${match[2].trim()}]</div>
<figcaption>${match[3]?.trim() || match[2].trim()}</figcaption>
</figure>`
        }
      }
    }

    if (socialProofMap[i]) {
      for (const sp of socialProofMap[i]) {
        sectionHtml += `\n<blockquote class="social-proof" data-proof-type="${sp.type || 'industry'}">
<p>${sp.content || ''}</p>
<cite>— <strong>${sp.source || 'Source'}</strong>${sp.attribution ? `, ${sp.attribution}` : ''}</cite>
</blockquote>`
      }
    }

    parts.push(sectionHtml)
  }

  if (notForYou) {
    parts.push(`<div class="not-for-you">\n<h2>When This Guide Does NOT Apply</h2>\n${bodyToHtml(notForYou)}\n</div>`)
  }

  // FAQ — DO NOT render in fullArticle. Replit SSR (renderBlogPost) emits
  // both the FAQ section and the FAQPage JSON-LD from row.faq. Inline
  // render produced two FAQ sections per page and duplicate structured data.

  // Source Ledger — DO NOT render in fullArticle. Same reason: Replit SSR
  // renders a single Sources section from row.sources. The structured
  // `sources` column is the canonical store.

  if (internalLinks.length > 0) {
    parts.push(`<div class="related-reading">\n<h3>Related Investigations</h3>\n<ul>\n${internalLinks.map((l) => `<li><a href="${l.target_slug}">${l.anchor_text}</a> — ${l.context || ''}</li>`).join('\n')}\n</ul>\n</div>`)
  }

  parts.push(`<div class="author-bio">\n<p><strong>${authorName}</strong> — ${authorBio}</p>\n</div>`)

  // Article JSON-LD — emitted by Replit SSR from the full @graph (with
  // ClaimReview / Article / Speakable / citation[] / about / mentions).
  // Don't emit a second BlogPosting here; duplicate structured-data
  // downgrades the trust signal.

  return parts.join('\n\n')
}

module.exports = { applyInlineFormatting, bodyToHtml, buildArticleHtml }
