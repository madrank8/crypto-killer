/**
 * Content (blog) sync shape normalizer — audit 2026-07-05 (A4).
 *
 * The content table holds TWO generations of schema shapes:
 *   LEGACY (retired mono writer):  how_to = { steps: [{name, text}] },
 *     item_list = ARRAY, claims = [{claimReviewed, ratingValue, ratingLabel,
 *     originator}], quotes = [{text, attribution}]
 *   CURRENT (schema-enrichment-resolver): full JSON-LD nodes —
 *     HowTo { step: [...] }, ItemList OBJECT, Claim { text }, Quotation.
 *
 * Reviews go through lib/sync-shape.js; content used to ship the raw row
 * with NO normalizer, so the Replit renderer had to dual-accept or silently
 * mis-render one generation. This module canonicalizes to the CURRENT
 * (resolver / JSON-LD) shapes at sync time.
 *
 * Philosophy mirrors sync-shape.js: silent tolerance in, strict shape out.
 * Malformed items are dropped, never thrown on.
 */

function normalizeContentHowTo(howTo) {
  if (!howTo || typeof howTo !== 'object' || Array.isArray(howTo)) return null

  // Already JSON-LD (resolver shape)
  if (Array.isArray(howTo.step)) {
    const step = howTo.step
      .filter((s) => s && (s.name || s.text))
      .map((s, i) => ({
        '@type': 'HowToStep',
        position: Number.isFinite(s.position) ? s.position : i + 1,
        name: String(s.name || s.text || '').slice(0, 200),
        ...(s.text && s.name ? { text: String(s.text).slice(0, 500) } : {}),
        ...(s.url ? { url: s.url } : {}),
      }))
    if (step.length < 2) return null
    return { ...howTo, '@type': 'HowTo', step }
  }

  // Legacy flat shape { steps: [{name, text}] }
  if (Array.isArray(howTo.steps)) {
    const step = howTo.steps
      .filter((s) => s && (s.name || s.text))
      .map((s, i) => ({
        '@type': 'HowToStep',
        position: i + 1,
        name: String(s.name || s.text || '').slice(0, 200),
        ...(s.text && s.name ? { text: String(s.text).slice(0, 500) } : {}),
      }))
    if (step.length < 2) return null
    return {
      '@type': 'HowTo',
      name: String(howTo.name || howTo.title || 'How-to guide').slice(0, 200),
      ...(howTo.description ? { description: String(howTo.description).slice(0, 500) } : {}),
      step,
    }
  }

  return null
}

function normalizeContentItemList(itemList) {
  // Legacy: bare array of items/strings → wrap into ItemList object
  if (Array.isArray(itemList)) {
    const elements = itemList
      .filter(Boolean)
      .map((it, i) => ({
        '@type': 'ListItem',
        position: Number.isFinite(it?.position) ? it.position : i + 1,
        name: String(it?.name || it?.item || it || '').slice(0, 300),
      }))
      .filter((it) => it.name)
    if (elements.length === 0) return null
    return { '@type': 'ItemList', numberOfItems: elements.length, itemListElement: elements }
  }
  // Current: ItemList object — validate the element array key variants
  if (itemList && typeof itemList === 'object') {
    const elements = itemList.itemListElement || itemList.items || []
    if (!Array.isArray(elements) || elements.length === 0) return null
    return {
      ...itemList,
      '@type': 'ItemList',
      numberOfItems: elements.length,
      itemListElement: elements,
    }
  }
  return null
}

function normalizeContentClaims(claims) {
  if (!Array.isArray(claims)) return []
  const out = []
  for (const c of claims) {
    if (!c || typeof c !== 'object') continue
    // Current resolver shape: Claim { text }
    if (c['@type'] === 'Claim' && typeof c.text === 'string' && c.text.trim()) {
      out.push(c)
      continue
    }
    // Legacy flat fact-check shape → honest Claim node (matches the A2
    // decision: content-path claims are Claim, not ClaimReview — nobody
    // fact-checked the legacy rows either).
    const text = typeof c.claimReviewed === 'string' ? c.claimReviewed : (typeof c.text === 'string' ? c.text : null)
    if (!text || !text.trim()) continue
    const claim = { '@type': 'Claim', text: text.trim().slice(0, 500) }
    const originator = c.originator || c.source
    if (typeof originator === 'string' && originator.trim()) {
      claim.author = { '@type': 'Organization', name: originator.trim().slice(0, 120) }
    } else if (originator && typeof originator === 'object' && originator.name) {
      claim.author = { '@type': originator['@type'] || 'Organization', name: String(originator.name).slice(0, 120) }
    }
    if (typeof c.firstAppearance === 'string') claim.firstAppearance = c.firstAppearance
    else if (typeof c.appearance === 'string') claim.firstAppearance = c.appearance
    out.push(claim)
  }
  return out
}

function normalizeContentQuotes(quotes) {
  if (!Array.isArray(quotes)) return []
  const out = []
  for (const q of quotes) {
    if (!q || typeof q !== 'object') continue
    const text = typeof q.text === 'string' ? q.text.trim() : ''
    if (text.length < 20) continue
    // Attribution: resolver shape (spokenByCharacter.name) or legacy flat
    // (attribution / source string)
    const name =
      q.spokenByCharacter?.name ||
      (typeof q.attribution === 'string' ? q.attribution : null) ||
      (typeof q.source === 'string' ? q.source : null)
    if (!name || !String(name).trim()) continue
    out.push({
      '@type': 'Quotation',
      text: text.slice(0, 600),
      spokenByCharacter: { '@type': 'Person', name: String(name).trim().slice(0, 120) },
    })
  }
  return out
}

/**
 * Canonicalize a content row's schema columns for the Replit sync payload.
 * Returns a SHALLOW COPY with normalized how_to/item_list/claims/quotes and
 * pipeline diagnostics stripped (ai_audit carries internal error strings
 * that have no business on the public renderer).
 */
function shapeContentForSync(content) {
  if (!content || typeof content !== 'object') return content
  const shaped = { ...content }
  shaped.how_to = normalizeContentHowTo(content.how_to)
  shaped.item_list = normalizeContentItemList(content.item_list)
  shaped.claims = normalizeContentClaims(content.claims)
  shaped.quotes = normalizeContentQuotes(content.quotes)
  // Internal diagnostics stay internal.
  delete shaped.ai_audit
  delete shaped.outline_sections
  return shaped
}

export {
  shapeContentForSync,
  normalizeContentHowTo,
  normalizeContentItemList,
  normalizeContentClaims,
  normalizeContentQuotes,
}
