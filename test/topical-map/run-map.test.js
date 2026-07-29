'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { startMapReadiness } = require('../../lib/topical-map/readiness/run-map')

// Three quoted sentences (>=20 chars each) so gather-stack's quote extractor
// counts them as distinct anecdotes.
function reviewHtmlWithQuotes(quotes) {
  return `<article><p>Intro.</p>${quotes.map((q) => `<p>${q}</p>`).join('')}</article>`
}

const THREE_QUOTES = [
  '"I sent them 400 dollars and never heard back again after that day."',
  '"Support stopped responding within twenty four hours of my withdrawal request."',
  '"The platform locked my account the moment I asked to cash out my balance."',
]

const ONE_QUOTE = ['"I sent them 400 dollars and never heard back again after that day."']

/**
 * A path/query-keyed mock matching the shared supaFetch(path, opts) shape
 * (lib/supabase.js). Handlers are matched by substring so a single mock can
 * serve every table this orchestrator touches (topics, content_briefs,
 * reviews, topical_maps) across three concurrently-processed topics.
 */
function buildMockSupaFetch({ topics, briefsByTopic, reviewsBySlug, mapStats }) {
  const calls = []
  const briefWrites = []
  const savedStats = { current: mapStats || {} }

  const fn = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null })

    if (path.startsWith('/topics?map_id=') && path.includes('topic_type=eq.supporting')) {
      return topics
    }
    if (path.startsWith('/content_briefs?topic_id=eq.')) {
      const topicId = path.match(/topic_id=eq\.([^&]+)/)[1]
      if (opts.method === 'PATCH' || opts.method === 'POST') {
        const body = JSON.parse(opts.body)
        briefWrites.push({ method: opts.method, topicId, body })
        return null
      }
      const existing = briefsByTopic[topicId]
      return existing ? [existing] : []
    }
    if (path.startsWith('/content_briefs') && opts.method === 'POST') {
      const body = JSON.parse(opts.body)
      briefWrites.push({ method: 'POST', topicId: body.topic_id, body })
      return null
    }
    if (path.startsWith('/reviews?slug=eq.')) {
      const slug = decodeURIComponent(path.match(/slug=eq\.([^&]+)/)[1])
      const review = reviewsBySlug[slug]
      return review ? [review] : []
    }
    if (path.startsWith('/topical_maps?id=eq.') && path.includes('select=stats')) {
      return [{ stats: savedStats.current }]
    }
    if (path.startsWith('/topical_maps?id=eq.') && opts.method === 'PATCH') {
      const body = JSON.parse(opts.body)
      savedStats.current = body.stats
      return null
    }

    throw new Error(`Unexpected supaFetch call: ${opts.method || 'GET'} ${path}`)
  }

  fn.calls = calls
  fn.briefWrites = briefWrites
  fn.savedStats = savedStats
  return fn
}

function buildMockFetchImpl({ firecrawlBySlugSegment }) {
  const firecrawlCalls = []
  return async (endpoint, opts) => {
    if (opts) {
      // Firecrawl scrape call: POST https://api.firecrawl.dev/v2/scrape with
      // { url, formats } in the body -- the scraped page URL, not `endpoint`.
      const { url: scrapedUrl } = JSON.parse(opts.body)
      firecrawlCalls.push(scrapedUrl)
      const hit = Object.entries(firecrawlBySlugSegment).find(([seg]) => scrapedUrl.includes(seg))
      if (!hit) return { ok: false, status: 500 }
      const [, markdown] = hit
      if (markdown === null) return { ok: false, status: 500 }
      return { ok: true, json: async () => ({ data: { markdown, links: [] } }) }
    }
    // Live-site HTML fallback fetch (single-arg call from gather-stack.js)
    return { ok: false }
  }
}

describe('startMapReadiness', () => {
  it('runs three topics through propose -> stack -> firecrawl -> Sullivan gate -> content_briefs upsert', async () => {
    const topics = [
      {
        id: 't-1',
        title: 'Quantum AI Review',
        content_type: 'brand_review',
        url_path: '/review/quantum-ai/',
        slug: 'quantum-ai',
      },
      {
        id: 't-2',
        title: 'Scam Alert HQ Review',
        content_type: 'brand_review',
        url_path: '/review/scam-alert-hq/',
        slug: 'scam-alert-hq',
      },
      {
        id: 't-3',
        title: 'Broken Coin Review',
        content_type: 'brand_review',
        url_path: '/review/broken-coin/',
        slug: 'broken-coin',
      },
    ]

    // t-1: already has the two forever-human-only fields on file. Stack alone
    // supplies the rest (3 quotes + credentials) -> Sullivan gate passes
    // without ever touching Firecrawl.
    // t-2: same human fields on file, but the stack-visible review only has
    // one quote -> Firecrawl fills the remaining anecdotes -> gate passes.
    // t-3: no prior brief, no review anywhere, Firecrawl also comes up empty
    // -> gate still fails, topic stays needs_evidence.
    const briefsByTopic = {
      't-1': {
        id: 'cb-1',
        content_type: 'firsthand_review',
        forcing_inputs: {
          field_observation_count: '400 callouts since 2019',
          recurring_pattern: 'Victims report the identical withdrawal-lock script',
        },
        sullivan_ok: false,
      },
      't-2': {
        id: 'cb-2',
        content_type: 'firsthand_review',
        forcing_inputs: {
          field_observation_count: '150 tickets triaged since 2021',
          recurring_pattern: 'Same fake KYC delay tactic every time',
        },
        sullivan_ok: false,
      },
    }

    const reviewsBySlug = {
      'quantum-ai': {
        id: 'r-1',
        slug: 'quantum-ai',
        full_article: reviewHtmlWithQuotes(THREE_QUOTES),
        author_credentials: 'Lead investigator, 6 years in fraud analysis',
      },
      'scam-alert-hq': {
        id: 'r-2',
        slug: 'scam-alert-hq',
        full_article: reviewHtmlWithQuotes(ONE_QUOTE),
        author_credentials: 'Senior fraud analyst, 4 years in the field',
      },
      // 'broken-coin' intentionally absent: no review anywhere in the stack.
    }

    const supaFetch = buildMockSupaFetch({ topics, briefsByTopic, reviewsBySlug, mapStats: { imported_by: 'sheet-import' } })
    const fetchImpl = buildMockFetchImpl({
      firecrawlBySlugSegment: {
        'scam-alert-hq': reviewHtmlWithQuotes(THREE_QUOTES),
        'broken-coin': null, // Firecrawl also fails/empty for this one
      },
    })

    const summary = await startMapReadiness({ mapId: 'map-1', supaFetch, fetchImpl, firecrawlApiKey: 'fc-test-key' })

    assert.deepEqual(summary, { processed: 3, sullivan_ok: 2, needs_evidence: 1, skipped: 0 })

    // t-1: stack alone was enough -> Firecrawl must never have been called for it.
    const t1Write = supaFetch.briefWrites.find((w) => w.topicId === 't-1')
    assert.equal(t1Write.method, 'PATCH')
    assert.equal(t1Write.body.sullivan_ok, true)
    assert.equal(t1Write.body.content_type, 'firsthand_review')
    assert.equal(t1Write.body.forcing_inputs.direct_anecdotes.length, 3)
    assert.equal(t1Write.body.forcing_inputs.field_observation_count, '400 callouts since 2019')
    assert.equal(t1Write.body.status, undefined, 'PATCH must not demote brief status')

    // t-2: needed Firecrawl to fill the anecdotes; existing human fields preserved.
    const t2Write = supaFetch.briefWrites.find((w) => w.topicId === 't-2')
    assert.equal(t2Write.method, 'PATCH')
    assert.equal(t2Write.body.sullivan_ok, true)
    assert.equal(t2Write.body.forcing_inputs.direct_anecdotes.length, 3)
    assert.equal(t2Write.body.forcing_inputs.recurring_pattern, 'Same fake KYC delay tactic every time')
    assert.equal(t2Write.body.status, undefined)

    // t-3: nothing anywhere -> still missing, never invented, new row created.
    const t3Write = supaFetch.briefWrites.find((w) => w.topicId === 't-3')
    assert.equal(t3Write.method, 'POST')
    assert.equal(t3Write.body.sullivan_ok, false)
    assert.deepEqual(t3Write.body.forcing_inputs, {})
    assert.equal(t3Write.body.status, 'draft')

    // Map-level readiness summary persisted to topical_maps.stats.readiness.
    const stats = supaFetch.savedStats.current
    assert.ok(stats.readiness)
    assert.equal(stats.readiness.processed, 3)
    assert.equal(stats.readiness.sullivan_ok, 2)
    assert.equal(stats.readiness.needs_evidence, 1)
    assert.equal(stats.readiness.skipped, 0)
    assert.equal(stats.readiness.topics['t-3'].outcome, 'needs_evidence')
    assert.ok(stats.readiness.topics['t-3'].missing.includes('direct_anecdotes'))
    // Prior stats keys survive the merge (never clobber unrelated stats).
    assert.equal(stats.imported_by, 'sheet-import')
  })

  it('never invents a Sullivan type: a topic with no deterministic signal is skipped, not written', async () => {
    const topics = [
      { id: 't-4', title: 'How Crypto Wallets Work', content_type: 'educational', url_path: '/learn/how-wallets-work/' },
    ]
    const supaFetch = buildMockSupaFetch({ topics, briefsByTopic: {}, reviewsBySlug: {}, mapStats: {} })

    const summary = await startMapReadiness({ mapId: 'map-2', supaFetch })

    assert.deepEqual(summary, { processed: 1, sullivan_ok: 0, needs_evidence: 0, skipped: 1 })
    assert.equal(supaFetch.briefWrites.length, 0)
  })

  it('a human-declared content_type on an existing brief overrides the deterministic proposal', async () => {
    const topics = [
      { id: 't-5', title: 'Our Recovery Playbook', content_type: 'educational', url_path: '/learn/recovery-playbook/' },
    ]
    // No deterministic signal (educational, no glossary/review/dataset cues) but
    // the author already declared this a case_study manually via the brief UI.
    const briefsByTopic = {
      't-5': { id: 'cb-5', content_type: 'case_study', forcing_inputs: {}, sullivan_ok: false },
    }
    const supaFetch = buildMockSupaFetch({ topics, briefsByTopic, reviewsBySlug: {}, mapStats: {} })

    const summary = await startMapReadiness({ mapId: 'map-3', supaFetch })

    assert.equal(summary.skipped, 0)
    assert.equal(summary.needs_evidence, 1)
    const write = supaFetch.briefWrites.find((w) => w.topicId === 't-5')
    assert.equal(write.body.content_type, 'case_study')
  })

  it('throws when mapId or supaFetch is missing', async () => {
    await assert.rejects(() => startMapReadiness({ supaFetch: async () => [] }), /mapId/)
    await assert.rejects(() => startMapReadiness({ mapId: 'map-1' }), /supaFetch/)
  })
})
