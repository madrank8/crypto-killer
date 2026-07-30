'use strict'

/**
 * Link imported topical-map topics to already-published articles/reviews so
 * operators do not re-write live pages. Matching is strict leaf-slug only
 * (url_path leaf, then topic.slug). No fuzzy title matching.
 */

async function paginateSelect(supaFetch, basePath) {
  const rows = []
  const pageSize = 1000
  let offset = 0
  for (;;) {
    const batch = await supaFetch(`${basePath}&limit=${pageSize}&offset=${offset}`, {
      useServiceRole: true,
    })
    const page = Array.isArray(batch) ? batch : []
    rows.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }
  return rows
}

/**
 * Load published content + reviews keyed by leaf slug.
 * @returns {{ contentBySlug: Map<string, {id, slug, topic_id}>, reviewBySlug: Map<string, {id, slug}> }}
 */
async function loadPublishedCatalog(supaFetch) {
  const contentBySlug = new Map()
  const reviewBySlug = new Map()

  const contentRows = await paginateSelect(
    supaFetch,
    '/content?status=eq.published&select=id,slug,topic_id'
  )
  for (const row of contentRows) {
    const slug = String(row?.slug || '').trim()
    if (slug) contentBySlug.set(slug, { id: row.id, slug, topic_id: row.topic_id || null })
  }

  const reviewRows = await paginateSelect(
    supaFetch,
    '/reviews?status=eq.published&select=id,slug'
  )
  for (const row of reviewRows) {
    const slug = String(row?.slug || '').trim()
    if (slug) reviewBySlug.set(slug, { id: row.id, slug })
  }

  return { contentBySlug, reviewBySlug }
}

/** Leaf slug candidates from Suggested URL / url_path, then topic.slug. */
function matchKeys(node) {
  const keys = []
  const path = String(node?.url_path || '').trim()
  if (path) {
    const parts = path.replace(/\/+$/, '').split('/').filter(Boolean)
    if (parts.length) keys.push(parts[parts.length - 1])
  }
  if (node?.slug) keys.push(String(node.slug).trim())
  return [...new Set(keys.filter(Boolean))]
}

function preferKinds(node) {
  const path = String(node?.url_path || '')
  if (/\/review\//i.test(path) || node?.content_type === 'brand_review') {
    return ['review', 'content']
  }
  if (/\/blog\//i.test(path)) return ['content', 'review']
  return ['content', 'review']
}

/**
 * @returns {{ kind: 'content'|'review', id: string, slug: string, topic_id?: string|null } | null}
 */
function matchPublishedArticle(node, catalog) {
  if (!catalog) return null
  const keys = matchKeys(node)
  if (!keys.length) return null

  for (const kind of preferKinds(node)) {
    const map = kind === 'content' ? catalog.contentBySlug : catalog.reviewBySlug
    for (const key of keys) {
      const hit = map.get(key)
      if (hit) return { kind, id: hit.id, slug: hit.slug, topic_id: hit.topic_id ?? null }
    }
  }
  return null
}

/**
 * Fields to set on a topics insert when a published article/review matches.
 */
function publishedLinkFields(match) {
  if (!match) {
    return { content_status: 'planned', content_id: null, review_id: null }
  }
  if (match.kind === 'content') {
    return {
      content_status: 'published',
      content_id: match.id,
      review_id: null,
    }
  }
  return {
    content_status: 'published',
    content_id: null,
    review_id: match.id,
  }
}

module.exports = {
  loadPublishedCatalog,
  matchKeys,
  matchPublishedArticle,
  publishedLinkFields,
  preferKinds,
}
