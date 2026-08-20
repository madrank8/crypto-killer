'use strict'

const { slugify } = require('../text-utils')

/**
 * Link imported topical-map topics to already-written articles/reviews so
 * operators do not re-write live pages.
 *
 * Matching is slug-based, not fuzzy title: Suggested URL leaf, topic.slug
 * (minus uniqueness suffixes), slugified keyword, slugified title-before-colon,
 * plus `-scam`/`-scams` variants. Cluster folders never match.
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
 * Load published + draft content/reviews keyed by leaf slug.
 * Drafts count as already-written (Edit, not Write).
 */
async function loadPublishedCatalog(supaFetch) {
  const contentBySlug = new Map()
  const reviewBySlug = new Map()

  const contentRows = await paginateSelect(
    supaFetch,
    '/content?status=in.(published,draft)&select=id,slug,topic_id,status'
  )
  for (const row of contentRows) {
    const slug = String(row?.slug || '').trim()
    if (slug) {
      contentBySlug.set(slug, {
        id: row.id,
        slug,
        topic_id: row.topic_id || null,
        status: row.status || 'published',
      })
    }
  }

  const reviewRows = await paginateSelect(
    supaFetch,
    '/reviews?status=in.(published,draft)&select=id,slug,status'
  )
  for (const row of reviewRows) {
    const slug = String(row?.slug || '').trim()
    if (slug) reviewBySlug.set(slug, { id: row.id, slug, status: row.status || 'published' })
  }

  return { contentBySlug, reviewBySlug }
}

function stripUniquenessSuffix(slug) {
  return String(slug || '').replace(/-\d+$/, '')
}

function withScamVariants(key) {
  const k = String(key || '').trim()
  if (!k) return []
  const out = [k]
  if (k.length >= 8 && !/scams?$/.test(k)) {
    out.push(`${k}-scam`)
    out.push(`${k}-scams`)
  }
  return out
}

/** Leaf slug candidates from Suggested URL / url_path, then topic.slug / keyword / title. */
function matchKeys(node) {
  const raw = []
  const path = String(node?.url_path || '').trim()
  if (path) {
    const parts = path.replace(/\/+$/, '').split('/').filter(Boolean)
    if (parts.length) raw.push(parts[parts.length - 1])
  }
  if (node?.slug) raw.push(stripUniquenessSuffix(node.slug))
  if (node?.target_keyword) raw.push(slugify(node.target_keyword))
  const beforeColon = String(node?.title || '').split(':')[0]
  if (beforeColon.trim()) raw.push(slugify(beforeColon))

  const keys = []
  for (const k of raw) keys.push(...withScamVariants(k))
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

function consumeMatch(catalog, hit) {
  if (!catalog || !hit?.slug) return
  catalog.contentBySlug?.delete(hit.slug)
  catalog.reviewBySlug?.delete(hit.slug)
}

/**
 * @returns {{ kind: 'content'|'review', id: string, slug: string, topic_id?: string|null, status?: string } | null}
 */
function matchPublishedArticle(node, catalog) {
  if (!catalog || !node) return null
  if (node.topic_type === 'cluster') return null

  const keys = matchKeys(node)
  if (!keys.length) return null

  for (const kind of preferKinds(node)) {
    const map = kind === 'content' ? catalog.contentBySlug : catalog.reviewBySlug
    if (!map) continue
    for (const key of keys) {
      const hit = map.get(key)
      if (hit) {
        const result = {
          kind,
          id: hit.id,
          slug: hit.slug,
          topic_id: hit.topic_id ?? null,
          status: hit.status || 'published',
        }
        consumeMatch(catalog, result)
        return result
      }
    }
  }
  return null
}

/**
 * Fields to set on a topics insert when a published/draft article/review matches.
 */
function publishedLinkFields(match) {
  if (!match) {
    return { content_status: 'planned', content_id: null, review_id: null }
  }
  const status = match.status === 'draft' ? 'draft' : 'published'
  if (match.kind === 'content') {
    return {
      content_status: status,
      content_id: match.id,
      review_id: null,
    }
  }
  return {
    content_status: status,
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
