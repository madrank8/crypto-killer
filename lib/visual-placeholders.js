/**
 * Visual placeholder HTML transforms.
 *
 * Failed image generation used to leave a dashed `ck-visual--placeholder`
 * figure in the article. Retry only looks for `[TYPE NEEDED: …]` markers, and
 * the publish gate used to ignore the dashed class — so those boxes shipped
 * live. These helpers revive (for retry), strip (so they never publish), and
 * unwrap leftover `visual-pending` wrappers around real figures.
 */

const FAILED_FIGURE_RE =
  /<figure\b[^>]*class="[^"]*ck-visual--placeholder[^"]*"[^>]*>[\s\S]*?<\/figure>/gi

const VISUAL_PENDING_RE =
  /<div\b[^>]*class="[^"]*visual-pending[^"]*"[^>]*>([\s\S]*?)<\/div>/gi

const MARKER_RE =
  /\[\s*(?:CHART|DIAGRAM|IMAGE|SCREENSHOT|PHOTO|INFOGRAPHIC|STEP-BY-STEP)\s*(?:NEEDED)?\s*:/i

const LEGACY_BOX_RE = /class="(?:visual-placeholder|placeholder-box)"/i

function typeFromFallback(figureHtml) {
  if (figureHtml.includes('📊')) return 'CHART'
  if (figureHtml.includes('🔀')) return 'DIAGRAM'
  return 'IMAGE'
}

function descriptionFromFallback(figureHtml) {
  const match = figureHtml.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)
  return (match ? match[1] : '').replace(/<[^>]+>/g, '').trim()
}

function reviveFailedVisualPlaceholders(html) {
  if (!html || typeof html !== 'string') return html
  FAILED_FIGURE_RE.lastIndex = 0
  return html.replace(FAILED_FIGURE_RE, (figure) => {
    const description = descriptionFromFallback(figure)
    if (!description) return ''
    return `[${typeFromFallback(figure)} NEEDED: ${description}]`
  })
}

function stripFailedVisualPlaceholders(html) {
  if (!html || typeof html !== 'string') return html
  FAILED_FIGURE_RE.lastIndex = 0
  let next = html.replace(FAILED_FIGURE_RE, '')
  next = next.replace(/<div\b[^>]*class="[^"]*visual-pending[^"]*"[^>]*>\s*<\/div>/gi, '')
  return next
}

function unwrapVisualPending(html) {
  if (!html || typeof html !== 'string') return html
  VISUAL_PENDING_RE.lastIndex = 0
  return html.replace(VISUAL_PENDING_RE, (_, inner) => String(inner || '').trim())
}

function hasUnrenderedVisuals(html) {
  if (!html || typeof html !== 'string') return false
  return MARKER_RE.test(html) || LEGACY_BOX_RE.test(html) || /ck-visual--placeholder/i.test(html)
}

function sanitizeVisualHtml(html) {
  return unwrapVisualPending(stripFailedVisualPlaceholders(html))
}

export {
  reviveFailedVisualPlaceholders,
  stripFailedVisualPlaceholders,
  unwrapVisualPending,
  hasUnrenderedVisuals,
  sanitizeVisualHtml,
}
