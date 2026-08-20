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
    const keys = matchKeys({ url_path: '/blog/pig-butchering/', slug: 'other' })
    assert.ok(keys.includes('pig-butchering'))
    assert.ok(keys.includes('other'))
  })

  it('handles /review/ paths', () => {
    assert.ok(matchKeys({ url_path: '/review/quantum-ai/' }).includes('quantum-ai'))
  })

  it('includes keyword and title-before-colon slugs plus -scam variants', () => {
    const keys = matchKeys({
      url_path: '/check/',
      slug: 'crypto-scam-checker-2',
      target_keyword: 'crypto scam checker',
      title: 'Crypto Scam Checker: Check Any Platform in Seconds',
    })
    assert.ok(keys.includes('crypto-scam-checker'))
    assert.ok(keys.includes('pig-butchering') === false)
    const pig = matchKeys({ url_path: '/scams/pig-butchering/', title: 'Pig Butchering Scams: How It Works' })
    assert.ok(pig.includes('pig-butchering'))
    assert.ok(pig.includes('pig-butchering-scam'))
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

  it('matches live blog slug via target keyword when Koray folder differs', () => {
    const cat = {
      contentBySlug: new Map([
        ['crypto-scam-checker', { id: 'c-check', slug: 'crypto-scam-checker', topic_id: null, status: 'published' }],
      ]),
      reviewBySlug: new Map(),
    }
    const hit = matchPublishedArticle(
      {
        title: 'Crypto Scam Checker: Check Any Platform in Seconds',
        url_path: '/check/',
        slug: 'check',
        target_keyword: 'crypto scam checker',
      },
      cat
    )
    assert.equal(hit.id, 'c-check')
  })

  it('matches pig-butchering leaf to pig-butchering-scam', () => {
    const cat = {
      contentBySlug: new Map([
        ['pig-butchering-scam', { id: 'c-pig', slug: 'pig-butchering-scam', topic_id: null, status: 'published' }],
      ]),
      reviewBySlug: new Map(),
    }
    const hit = matchPublishedArticle({ url_path: '/scams/pig-butchering/', slug: 'pig-butchering-2' }, cat)
    assert.equal(hit.id, 'c-pig')
  })

  it('does not match cluster folders', () => {
    const cat = {
      contentBySlug: new Map([
        ['ai-trading-bot-scams', { id: 'c-ai', slug: 'ai-trading-bot-scams', topic_id: null, status: 'published' }],
      ]),
      reviewBySlug: new Map(),
    }
    assert.equal(
      matchPublishedArticle(
        { topic_type: 'cluster', title: 'AI Trading Bot Scams', slug: 'ai-trading-bot-scams' },
        cat
      ),
      null
    )
  })

  it('consumes a catalog hit so two topics cannot claim the same article', () => {
    const cat = {
      contentBySlug: new Map([
        ['crypto-scam-checker', { id: 'c-check', slug: 'crypto-scam-checker', topic_id: null, status: 'published' }],
      ]),
      reviewBySlug: new Map(),
    }
    const node = {
      title: 'Crypto Scam Checker: Check Any Platform in Seconds',
      url_path: '/check/',
      target_keyword: 'crypto scam checker',
    }
    assert.equal(matchPublishedArticle(node, cat).id, 'c-check')
    assert.equal(matchPublishedArticle(node, cat), null)
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

  it('keeps draft content as draft, not published', () => {
    assert.deepEqual(publishedLinkFields({ kind: 'content', id: 'c-d', slug: 'x', status: 'draft' }), {
      content_status: 'draft',
      content_id: 'c-d',
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
    assert.ok(calls[0].includes('status=in.(published,draft)'))
    assert.ok(calls[1].includes('status=in.(published,draft)'))
  })
})
