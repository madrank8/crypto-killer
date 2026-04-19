'use client'

import { useState, useMemo } from 'react'

// ─── Helpers ────────────────────────────────────────────────────────────────────

function stripHtml(html) {
  if (!html) return ''
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

function countWords(text) {
  if (!text) return 0
  return text.split(/\s+/).filter(Boolean).length
}

function extractHeadings(html) {
  if (!html) return []
  const regex = /<(h[23])[^>]*>([\s\S]*?)<\/\1>/gi
  const headings = []
  let m
  while ((m = regex.exec(html)) !== null) {
    headings.push({ tag: m[1].toLowerCase(), text: stripHtml(m[2]) })
  }
  return headings
}

function getFirstParagraphAfterHeading(html) {
  if (!html) return []
  const results = []
  const regex = /<(h[23])[^>]*>([\s\S]*?)<\/\1>\s*<p[^>]*>([\s\S]*?)<\/p>/gi
  let m
  while ((m = regex.exec(html)) !== null) {
    results.push({
      heading: stripHtml(m[2]),
      paragraph: stripHtml(m[3]),
      wordCount: countWords(stripHtml(m[3])),
    })
  }
  return results
}

const QUESTION_WORDS = /^(what|how|why|when|where|is|can|do|should|are|does|which)\b/i

const FILLER_OPENERS = /^(in this section|let'?s explore|when it comes to)/i

const NARRATIVE_OPENERS =
  /(in this guide|in this article|in this post|welcome to|let'?s explore|today we'?ll)/i

const VAGUE_ATTRIBUTION =
  /(studies show|experts say|research indicates|according to experts)/i

// ─── Scoring Engine ─────────────────────────────────────────────────────────────

function runAudit(props) {
  const {
    contentType = 'content',
    title = '',
    headline = '',
    metaDescription = '',
    fullArticle = '',
    slug = '',
    keyword = '',
    sections = [],
    faq = [],
    sources = [],
    internalLinks = [],
    heroImage = '',
    heroImageAlt = '',
    wordCount: wc = 0,
    redFlags = [],
    verdict = '',
  } = props

  const plainText = stripHtml(fullArticle)
  const wordCount = wc || countWords(plainText)
  const headings = extractHeadings(fullArticle)
  const h2s = headings.filter((h) => h.tag === 'h2')
  const h3s = headings.filter((h) => h.tag === 'h3')
  const blocks = getFirstParagraphAfterHeading(fullArticle)
  const first200 = plainText.split(/\s+/).slice(0, 200).join(' ')
  const first300 = plainText.split(/\s+/).slice(0, 300).join(' ')
  const firstParagraphMatch = fullArticle.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
  const firstParagraph = firstParagraphMatch ? stripHtml(firstParagraphMatch[1]) : ''
  const lowerKeyword = keyword.toLowerCase()

  const categories = []

  // ── 1. Extractive Answer Coverage ──
  {
    let score = 10
    const findings = []
    const totalHeadings = headings.length || 1
    const noSubstantial = headings.length - blocks.length
    const pctMissing = noSubstantial / totalHeadings

    if (pctMissing > 0.3) {
      score -= 3
      findings.push({
        pass: false,
        text: `${Math.round(pctMissing * 100)}% of headings lack a substantial paragraph after them (threshold: 30%)`,
      })
    } else {
      findings.push({ pass: true, text: 'Most headings have a substantial paragraph following them' })
    }

    const fillerBlocks = blocks.filter((b) => FILLER_OPENERS.test(b.paragraph))
    if (fillerBlocks.length > 0) {
      score -= 2
      findings.push({
        pass: false,
        text: `${fillerBlocks.length} paragraph(s) after headings open with filler phrases`,
      })
    } else {
      findings.push({ pass: true, text: 'No filler openers detected after headings' })
    }

    const badLength = blocks.filter((b) => b.wordCount < 25 || b.wordCount > 90)
    if (badLength.length > 0) {
      score -= 1
      findings.push({
        pass: false,
        text: `${badLength.length} extractive block(s) outside 25-90 word range`,
      })
    } else if (blocks.length > 0) {
      findings.push({ pass: true, text: 'Extractive blocks are within 25-90 word range' })
    }

    categories.push({ id: 'extractive', name: 'Extractive Answer Coverage', score: Math.max(0, score), findings })
  }

  // ── 2. Question-Shaped Headings ──
  {
    let score = 10
    const findings = []
    const questionH2s = h2s.filter((h) => QUESTION_WORDS.test(h.text))
    const pctQuestion = h2s.length ? questionH2s.length / h2s.length : 0

    if (questionH2s.length === 0 && h2s.length > 0) {
      score -= 2
      findings.push({ pass: false, text: 'No question-shaped H2 headings found' })
    } else if (pctQuestion < 0.3 && h2s.length > 0) {
      score -= 3
      findings.push({
        pass: false,
        text: `Only ${Math.round(pctQuestion * 100)}% of H2s are question-shaped (need 30%+)`,
      })
    } else {
      findings.push({
        pass: true,
        text: `${Math.round(pctQuestion * 100)}% of H2s are question-shaped`,
      })
    }

    const longH2s = h2s.filter((h) => h.text.split(/\s+/).length > 14)
    if (longH2s.length > 0) {
      score -= 1
      findings.push({ pass: false, text: `${longH2s.length} H2(s) exceed 14 words` })
    } else if (h2s.length > 0) {
      findings.push({ pass: true, text: 'All H2s are 14 words or fewer' })
    }

    const shortH2s = h2s.filter((h) => h.text.split(/\s+/).length < 3)
    if (shortH2s.length > 0) {
      score -= 1
      findings.push({ pass: false, text: `${shortH2s.length} H2(s) shorter than 3 words` })
    } else if (h2s.length > 0) {
      findings.push({ pass: true, text: 'All H2s are 3+ words' })
    }

    categories.push({ id: 'headings', name: 'Question-Shaped Headings', score: Math.max(0, score), findings })
  }

  // ── 3. BLUF & Hook ──
  {
    let score = 10
    const findings = []

    if (NARRATIVE_OPENERS.test(first200)) {
      score -= 4
      findings.push({ pass: false, text: 'Article opens with a narrative/story phrasing' })
    } else {
      findings.push({ pass: true, text: 'No narrative filler at the opening' })
    }

    if (lowerKeyword && !first200.toLowerCase().includes(lowerKeyword)) {
      score -= 2
      findings.push({ pass: false, text: 'Target keyword not found in first 200 words' })
    } else if (lowerKeyword) {
      findings.push({ pass: true, text: 'Keyword appears in first 200 words' })
    }

    if (countWords(firstParagraph) < 30) {
      score -= 2
      findings.push({
        pass: false,
        text: `First paragraph is only ${countWords(firstParagraph)} words (need 30+)`,
      })
    } else {
      findings.push({ pass: true, text: 'First paragraph has adequate length' })
    }

    const hasNamedSource = /([A-Z][a-z]+(?:\s[A-Z][a-z]+)+|(?:FBI|SEC|FTC|CFTC|DOJ|SEC|FINRA|Reuters|Bloomberg|CoinDesk|Chainalysis))/g.test(first300)
    if (!hasNamedSource) {
      score -= 1
      findings.push({ pass: false, text: 'No named source or statistic in first 300 words' })
    } else {
      findings.push({ pass: true, text: 'Named source found in first 300 words' })
    }

    categories.push({ id: 'bluf', name: 'BLUF & Hook', score: Math.max(0, score), findings })
  }

  // ── 4. Entity Disambiguation ──
  {
    let score = 10
    const findings = []

    // Simple entity extraction: capitalized multi-word names
    const entityMatches = plainText.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)+\b/g) || []
    const entities = [...new Set(entityMatches)]

    if (wordCount > 1500 && entities.length < 10) {
      score -= 3
      findings.push({
        pass: false,
        text: `Only ${entities.length} distinct entities found in ${wordCount}-word article (need 10+)`,
      })
    } else if (wordCount <= 1500 && entities.length < 5) {
      score -= 1
      findings.push({
        pass: false,
        text: `Only ${entities.length} distinct entities found (need 5+)`,
      })
    } else {
      findings.push({ pass: true, text: `${entities.length} distinct entities identified` })
    }

    // Acronym check: 2+ uppercase letters not immediately followed by definition
    const acronyms = plainText.match(/\b[A-Z]{2,}\b/g) || []
    const uniqueAcronyms = [...new Set(acronyms)].filter(
      (a) => !['FAQ', 'HTML', 'CSS', 'URL', 'SEO', 'AI', 'US', 'UK'].includes(a)
    )
    const undefinedAcronyms = uniqueAcronyms.filter((acr) => {
      const defPattern = new RegExp(`\\(${acr}\\)`, 'i')
      return !defPattern.test(plainText)
    })

    if (undefinedAcronyms.length > 0) {
      score -= 2
      findings.push({
        pass: false,
        text: `${undefinedAcronyms.length} acronym(s) without nearby definition: ${undefinedAcronyms.slice(0, 5).join(', ')}`,
      })
    } else {
      findings.push({ pass: true, text: 'All acronyms appear to be defined' })
    }

    categories.push({ id: 'entities', name: 'Entity Disambiguation', score: Math.max(0, score), findings })
  }

  // ── 5. Attribution & Sources ──
  {
    let score = 10
    const findings = []

    if (VAGUE_ATTRIBUTION.test(plainText)) {
      score -= 3
      findings.push({
        pass: false,
        text: 'Vague attribution found (e.g. "studies show", "experts say") without named source',
      })
    } else {
      findings.push({ pass: true, text: 'No vague attributions detected' })
    }

    if (sources.length < 3) {
      score -= 2
      findings.push({
        pass: false,
        text: `Only ${sources.length} source(s) listed (need 3+)`,
      })
    } else {
      findings.push({ pass: true, text: `${sources.length} sources listed` })
    }

    const externalLinks = (fullArticle.match(/<a\s[^>]*href="https?:\/\//gi) || []).length
    if (externalLinks === 0) {
      score -= 2
      findings.push({ pass: false, text: 'No external links found in article body' })
    } else {
      findings.push({ pass: true, text: `${externalLinks} external link(s) found` })
    }

    const yearNearStats = /\b(20[0-9]{2})\b/.test(plainText)
    if (!yearNearStats) {
      score -= 1
      findings.push({ pass: false, text: 'No year/date mentioned near statistics' })
    } else {
      findings.push({ pass: true, text: 'Year references found near data' })
    }

    categories.push({ id: 'attribution', name: 'Attribution & Sources', score: Math.max(0, score), findings })
  }

  // ── 6. Freshness Signals ──
  {
    let score = 10
    const findings = []

    if (!/\b(2026|2025)\b/.test(plainText) && !/\b(2026|2025)\b/.test(title)) {
      score -= 3
      findings.push({ pass: false, text: 'No current year (2025/2026) mentioned' })
    } else {
      findings.push({ pass: true, text: 'Current year mentioned in content' })
    }

    if (!/updated|last updated/i.test(plainText) && !/updated|last updated/i.test(fullArticle)) {
      score -= 2
      findings.push({ pass: false, text: 'No "Updated" or "Last updated" text visible' })
    } else {
      findings.push({ pass: true, text: '"Updated" text found' })
    }

    if (!/dateModified/i.test(fullArticle)) {
      score -= 2
      findings.push({ pass: false, text: 'No dateModified in schema/meta detected' })
    } else {
      findings.push({ pass: true, text: 'dateModified found in schema' })
    }

    const oldYears = plainText.match(/\b(2020|2021|2022)\b/g) || []
    const anyRecent = /\b(2024|2025|2026)\b/.test(plainText)
    if (oldYears.length > 0 && !anyRecent) {
      score -= 1
      findings.push({ pass: false, text: 'Source dates appear to be 3+ years old with no recent dates' })
    } else {
      findings.push({ pass: true, text: 'Source dates are reasonably recent' })
    }

    categories.push({ id: 'freshness', name: 'Freshness Signals', score: Math.max(0, score), findings })
  }

  // ── 7. Structured Formatting ──
  {
    let score = 10
    const findings = []

    const hasTables = /<table/i.test(fullArticle)
    if (!hasTables && wordCount > 1500) {
      score -= 3
      findings.push({ pass: false, text: 'No tables found in article >1500 words' })
    } else if (hasTables) {
      findings.push({ pass: true, text: 'Table(s) found in article' })
    } else {
      findings.push({ pass: true, text: 'Article under 1500 words; table not required' })
    }

    const listCount = (fullArticle.match(/<(ul|ol)/gi) || []).length
    if (listCount < 2) {
      score -= 2
      findings.push({ pass: false, text: `Only ${listCount} list(s) found (need 2+)` })
    } else {
      findings.push({ pass: true, text: `${listCount} lists found` })
    }

    if (!faq || faq.length === 0) {
      score -= 2
      findings.push({ pass: false, text: 'No FAQ block detected' })
    } else {
      findings.push({ pass: true, text: `FAQ block with ${faq.length} items` })
    }

    const hasTakeaways =
      /key.?takeaway|summary.?box|takeaway|key.?point|in.?summary|bottom.?line/i.test(fullArticle)
    if (!hasTakeaways) {
      score -= 1
      findings.push({ pass: false, text: 'No key-takeaways or summary box detected' })
    } else {
      findings.push({ pass: true, text: 'Key takeaways / summary box found' })
    }

    const hasComparison = /comparison|vs\.?|versus|compared to|head.?to.?head/i.test(fullArticle)
    if (!hasComparison && !hasTables) {
      score -= 1
      findings.push({ pass: false, text: 'No comparison or data-driven element found' })
    } else {
      findings.push({ pass: true, text: 'Comparison or data element present' })
    }

    categories.push({ id: 'formatting', name: 'Structured Formatting', score: Math.max(0, score), findings })
  }

  // ── 8. Schema Readiness ──
  {
    let score = 10
    const findings = []

    const hasJsonLd = /application\/ld\+json/i.test(fullArticle) || /@context/i.test(fullArticle)
    if (!hasJsonLd) {
      score -= 3
      findings.push({ pass: false, text: 'No JSON-LD schema detected in article' })
    } else {
      findings.push({ pass: true, text: 'JSON-LD schema detected' })
    }

    const hasFaqSchema = /FAQPage/i.test(fullArticle)
    if (!hasFaqSchema && faq && faq.length > 0) {
      score -= 2
      findings.push({ pass: false, text: 'FAQ items exist but no FAQPage schema found' })
    } else if (hasFaqSchema) {
      findings.push({ pass: true, text: 'FAQPage schema present' })
    } else {
      findings.push({ pass: true, text: 'No FAQ items, so FAQPage schema not required' })
    }

    const hasArticleSchema =
      /BlogPosting|Article|Review|NewsArticle/i.test(fullArticle)
    if (!hasArticleSchema) {
      score -= 2
      findings.push({ pass: false, text: 'No BlogPosting/Article/Review schema type found' })
    } else {
      findings.push({ pass: true, text: 'Article/Review schema type detected' })
    }

    if (!/author/i.test(fullArticle)) {
      score -= 1
      findings.push({ pass: false, text: 'No author reference found in schema' })
    } else {
      findings.push({ pass: true, text: 'Author reference present' })
    }

    if (!/dateModified/i.test(fullArticle)) {
      score -= 1
      findings.push({ pass: false, text: 'No dateModified in schema' })
    } else {
      findings.push({ pass: true, text: 'dateModified present in schema' })
    }

    categories.push({ id: 'schema', name: 'Schema Readiness', score: Math.max(0, score), findings })
  }

  // ── 9. AI Surface Fit ──
  {
    let score = 10
    const findings = []

    if (wordCount < 1500) {
      score -= 3
      findings.push({
        pass: false,
        text: `Word count is ${wordCount} (need 1500+ for AI extraction)`,
      })
    } else {
      findings.push({ pass: true, text: `Word count: ${wordCount}` })
    }

    if (h2s.length < 8) {
      score -= 2
      findings.push({
        pass: false,
        text: `Only ${h2s.length} H2 headings (need 8+ for query fan-out)`,
      })
    } else {
      findings.push({ pass: true, text: `${h2s.length} H2 headings` })
    }

    const externalLinks = (fullArticle.match(/<a\s[^>]*href="https?:\/\//gi) || []).length
    if (externalLinks === 0) {
      score -= 2
      findings.push({ pass: false, text: 'No inline citations or external links' })
    } else {
      findings.push({ pass: true, text: `${externalLinks} external links / citations` })
    }

    const bodyImages = (fullArticle.match(/<img\s/gi) || []).length
    if (bodyImages === 0 && !heroImage) {
      score -= 1
      findings.push({ pass: false, text: 'No images in article body' })
    } else {
      findings.push({ pass: true, text: 'Multimodal content (images) present' })
    }

    if (h3s.length === 0 && h2s.length > 0) {
      score -= 1
      findings.push({ pass: false, text: 'Flat heading structure (no H3s under H2s)' })
    } else if (h3s.length > 0) {
      findings.push({ pass: true, text: 'Hierarchical heading structure with H3s' })
    }

    categories.push({ id: 'surface', name: 'AI Surface Fit', score: Math.max(0, score), findings })
  }

  // ── 10. On-Page SEO Basics ──
  {
    let score = 10
    const findings = []

    if (!title || title.length > 60) {
      score -= 2
      findings.push({
        pass: false,
        text: !title ? 'Title is missing' : `Title is ${title.length} chars (max 60)`,
      })
    } else {
      findings.push({ pass: true, text: `Title length: ${title.length} chars` })
    }

    const metaLen = (metaDescription || '').length
    if (metaLen < 120 || metaLen > 155) {
      score -= 2
      findings.push({
        pass: false,
        text: metaLen === 0
          ? 'Meta description is missing'
          : `Meta description is ${metaLen} chars (target 120-155)`,
      })
    } else {
      findings.push({ pass: true, text: `Meta description: ${metaLen} chars` })
    }

    if (lowerKeyword && !title.toLowerCase().includes(lowerKeyword)) {
      score -= 2
      findings.push({ pass: false, text: 'Keyword not found in title' })
    } else if (lowerKeyword) {
      findings.push({ pass: true, text: 'Keyword present in title' })
    }

    if (lowerKeyword && !(metaDescription || '').toLowerCase().includes(lowerKeyword)) {
      score -= 1
      findings.push({ pass: false, text: 'Keyword not in meta description' })
    } else if (lowerKeyword) {
      findings.push({ pass: true, text: 'Keyword present in meta description' })
    }

    if (lowerKeyword && !(slug || '').toLowerCase().includes(lowerKeyword.replace(/\s+/g, '-'))) {
      score -= 1
      findings.push({ pass: false, text: 'Keyword not in slug' })
    } else if (lowerKeyword) {
      findings.push({ pass: true, text: 'Keyword present in slug' })
    }

    if (!heroImage || !heroImageAlt) {
      score -= 1
      findings.push({
        pass: false,
        text: !heroImage ? 'No hero image set' : 'Hero image missing alt text',
      })
    } else {
      findings.push({ pass: true, text: 'Hero image with alt text present' })
    }

    if (!internalLinks || internalLinks.length === 0) {
      score -= 1
      findings.push({ pass: false, text: 'No internal links' })
    } else {
      findings.push({ pass: true, text: `${internalLinks.length} internal link(s)` })
    }

    categories.push({ id: 'seo', name: 'On-Page SEO Basics', score: Math.max(0, score), findings })
  }

  const totalScore = categories.reduce((sum, c) => sum + c.score, 0)
  const tier =
    totalScore >= 80
      ? 'CITATION-READY'
      : totalScore >= 50
        ? 'PARTIALLY OPTIMIZED'
        : 'NOT OPTIMIZED'

  return { totalScore, tier, categories }
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

function ScoreBadge({ score, max = 10 }) {
  const color =
    score >= max * 0.8
      ? 'text-green-400'
      : score >= max * 0.5
        ? 'text-amber-400'
        : 'text-red-400'
  return <span className={`font-bold ${color}`}>{score}/{max}</span>
}

function MiniBar({ score, max = 10 }) {
  const pct = Math.round((score / max) * 100)
  const bg =
    score >= max * 0.8
      ? 'bg-green-500'
      : score >= max * 0.5
        ? 'bg-amber-500'
        : 'bg-red-500'
  return (
    <div className="h-1.5 w-full rounded-full bg-gray-800 overflow-hidden">
      <div className={`h-full rounded-full ${bg} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function TierBadge({ tier }) {
  const styles = {
    'CITATION-READY': 'bg-green-500/15 text-green-400 border-green-500/30',
    'PARTIALLY OPTIMIZED': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    'NOT OPTIMIZED': 'bg-red-500/15 text-red-400 border-red-500/30',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${styles[tier]}`}
    >
      {tier}
    </span>
  )
}

// Categories that can be fixed by the AI endpoint
const FIXABLE_CATEGORIES = new Set([
  'extractive', 'headings', 'bluf', 'entities', 'attribution',
  'freshness', 'formatting', 'surface',
])

function CategoryCard({ category, defaultOpen, onFix, fixing, fixingId }) {
  const [open, setOpen] = useState(defaultOpen)
  const canFix = FIXABLE_CATEGORIES.has(category.id) && category.score < 8
  const isFixing = fixing && fixingId === category.id

  return (
    <div className="rounded-lg border border-gray-800/60 bg-gray-800/30 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <svg
            className={`w-3 h-3 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-xs font-medium text-gray-300 truncate">{category.name}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ScoreBadge score={category.score} />
          <div className="w-12">
            <MiniBar score={category.score} />
          </div>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-1.5 border-t border-gray-800/40">
          {category.findings.map((f, i) => (
            <div key={i} className="flex items-start gap-1.5 pt-1.5">
              <span className={`text-xs shrink-0 ${f.pass ? 'text-green-400' : 'text-red-400'}`}>
                {f.pass ? '\u2713' : '\u2717'}
              </span>
              <span className={`text-[11px] leading-tight ${f.pass ? 'text-gray-500' : 'text-gray-400'}`}>
                {f.text}
              </span>
            </div>
          ))}
          {canFix && onFix && (
            <button
              onClick={(e) => { e.stopPropagation(); onFix(category.id) }}
              disabled={fixing}
              className="mt-2 w-full text-[11px] px-2.5 py-1.5 rounded-md bg-indigo-600/10 text-indigo-400 hover:bg-indigo-600/20 border border-indigo-600/20 transition disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              {isFixing ? (
                <><span className="animate-spin">&#x27F3;</span> Fixing...</>
              ) : (
                <><span>&#x2728;</span> AI Fix This</>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function SeoAeoAudit({ onFix, fixing = false, fixingId = null, ...props }) {
  const { totalScore, tier, categories } = useMemo(() => runAudit(props), [
    props.contentType,
    props.title,
    props.headline,
    props.metaDescription,
    props.fullArticle,
    props.slug,
    props.keyword,
    props.sections,
    props.faq,
    props.sources,
    props.internalLinks,
    props.heroImage,
    props.heroImageAlt,
    props.wordCount,
    props.redFlags,
    props.verdict,
  ])

  const totalPassed = categories.reduce(
    (sum, c) => sum + c.findings.filter((f) => f.pass).length,
    0
  )
  const totalChecks = categories.reduce((sum, c) => sum + c.findings.length, 0)
  const criticalIssues = categories.filter((c) => c.score < 5).length

  const barColor =
    totalScore >= 80
      ? 'bg-green-500'
      : totalScore >= 50
        ? 'bg-amber-500'
        : 'bg-red-500'

  const readinessLabel =
    totalScore >= 80
      ? 'CITATION-READY: Ship it'
      : totalScore >= 50
        ? 'FIX BEFORE SHIP'
        : 'DO NOT SHIP'

  const readinessColor =
    totalScore >= 80
      ? 'text-green-400'
      : totalScore >= 50
        ? 'text-amber-400'
        : 'text-red-400'

  const readinessIcon =
    totalScore >= 80 ? (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    ) : totalScore >= 50 ? (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ) : (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    )

  return (
    <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
          SEO &amp; AEO Audit
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={`text-lg font-bold ${
              totalScore >= 80
                ? 'text-green-400'
                : totalScore >= 50
                  ? 'text-amber-400'
                  : 'text-red-400'
            }`}
          >
            {totalScore}
          </span>
          <span className="text-xs text-gray-600">/100</span>
          <TierBadge tier={tier} />
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 w-full rounded-full bg-gray-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor} transition-all`}
          style={{ width: `${totalScore}%` }}
        />
      </div>

      {/* Readiness */}
      <div className={`flex items-center gap-1.5 ${readinessColor}`}>
        {readinessIcon}
        <span className="text-xs font-semibold uppercase tracking-wide">{readinessLabel}</span>
      </div>

      {/* Fix All Failing button */}
      {onFix && totalScore < 80 && (() => {
        const failingFixable = categories
          .filter(c => c.score < 8 && FIXABLE_CATEGORIES.has(c.id))
          .map(c => c.id)
        return failingFixable.length > 0 ? (
          <button
            onClick={() => onFix(failingFixable)}
            disabled={fixing}
            className="w-full text-xs px-3 py-2 rounded-lg bg-indigo-600/15 text-indigo-400 hover:bg-indigo-600/25 border border-indigo-600/25 transition disabled:opacity-40 flex items-center justify-center gap-1.5 font-medium"
          >
            {fixing ? (
              <><span className="animate-spin">&#x27F3;</span> Fixing {fixingId === 'all' ? 'all issues' : fixingId}...</>
            ) : (
              <><span>&#x2728;</span> AI Fix All Failing ({failingFixable.length} categories)</>
            )}
          </button>
        ) : null
      })()}

      {/* Categories */}
      <div className="space-y-1.5">
        {categories.map((cat, i) => (
          <CategoryCard
            key={i}
            category={cat}
            defaultOpen={cat.score < 7}
            onFix={onFix ? (id) => onFix([id]) : null}
            fixing={fixing}
            fixingId={fixingId}
          />
        ))}
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between border-t border-gray-800/40 pt-3">
        <span className="text-[11px] text-gray-500">
          {totalPassed}/{totalChecks} checks passed
        </span>
        {criticalIssues > 0 && (
          <span className="text-[11px] text-red-400 font-medium">
            {criticalIssues} critical categor{criticalIssues === 1 ? 'y' : 'ies'}
          </span>
        )}
      </div>
    </div>
  )
}

export { SeoAeoAudit }
