'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  matchKeys,
  matchPublishedArticle,
  publishedLinkFields,
  loadPublishedCatalog,
} = require('../../lib/topical-map/import/link-existing')

describe('matchKeys', () => {
  it('uses url_path leaf then slug', () => {
    assert.deepEqual(matchKeys({ url_path: '/blog/pig-butchering/', slug: 'other' }), [
      'pig-butchering',
      'other',
    ])
  })

  it('handles /review/ paths', () => {
    assert.deepEqual(matchKeys({ url_path: '/review/quantum-ai/' }), ['quantum-ai'])
  })
})

describe('matchPublishedArticle', () => {
  const catalog = {
    contentBySlug: new Map([
      ['pig-butchering', { id: 'c-1', slug: 'pig-butchering', topic_id: null }],
    ]),
    reviewBySlug: new Map([['quantum-ai', { id: 'r-1', slug: 'quantum-ai' }]]),
  }

  it('links blog leaf slug to published content', () => {
    const hit = matchPublishedArticle({ url_path: '/wiki/pig-butchering/', slug: 'pig-butchering-2' }, catalog)
    assert.equal(hit.kind, 'content')
    assert.equal(hit.id, 'c-1')
  })

  it('prefers review when url_path is /review/', () => {
    const both = {
      contentBySlug: new Map([['quantum-ai', { id: 'c-q', slug: 'quantum-ai', topic_id: null }]]),
      reviewBySlug: new Map([['quantum-ai', { id: 'r-1', slug: 'quantum-ai' }]]),
    }
    const hit = matchPublishedArticle({ url_path: '/review/quantum-ai/', slug: 'quantum-ai' }, both)
    assert.equal(hit.kind, 'review')
    assert.equal(hit.id, 'r-1')
  })

  it('returns null when no published match', () => {
    assert.equal(matchPublishedArticle({ url_path: '/wiki/brand-new/', slug: 'brand-new' }, catalog), null)
  })
})

describe('publishedLinkFields', () => {
  it('sets content_id for content hits', () => {
    assert.deepEqual(publishedLinkFields({ kind: 'content', id: 'c-1', slug: 'x' }), {
      content_status: 'published',
      content_id: 'c-1',
      review_id: null,
    })
  })

  it('sets review_id for review hits', () => {
    assert.deepEqual(publishedLinkFields({ kind: 'review', id: 'r-1', slug: 'x' }), {
      content_status: 'published',
      content_id: null,
      review_id: 'r-1',
    })
  })

  it('defaults to planned when no match', () => {
    assert.deepEqual(publishedLinkFields(null), {
      content_status: 'planned',
      content_id: null,
      review_id: null,
    })
  })
})

describe('loadPublishedCatalog', () => {
  it('indexes published content and reviews by slug', async () => {
    const calls = []
    const supaFetch = async (path) => {
      calls.push(path)
      if (path.startsWith('/content?')) {
        return [{ id: 'c-1', slug: 'alpha', topic_id: null }]
      }
      if (path.startsWith('/reviews?')) {
        return [{ id: 'r-1', slug: 'beta' }]
      }
      throw new Error(`unexpected ${path}`)
    }
    const catalog = await loadPublishedCatalog(supaFetch)
    assert.equal(catalog.contentBySlug.get('alpha').id, 'c-1')
    assert.equal(catalog.reviewBySlug.get('beta').id, 'r-1')
    assert.ok(calls[0].includes('status=eq.published'))
    assert.ok(calls[1].includes('status=eq.published'))
  })
})
