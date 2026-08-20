'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  sullivanDisabled,
  sullivanFingerprint,
  allowLlmType,
  parseLlmClassify,
  existingSullivanType,
  classifySullivanType,
  eligibleForSullivan,
  pickNextSullivan,
} = require('../../lib/topical-map/sullivan-agent')

const TODAY = '2026-08-20'

function supporting(overrides = {}) {
  return {
    id: 't-1',
    title: 'Circle K Bitcoin ATM Scam',
    slug: 'circle-k',
    url_path: '/alerts/circle-k/',
    topic_type: 'supporting',
    content_status: 'planned',
    scheduled_for: TODAY,
    priority_score: 70,
    content_id: null,
    review_id: null,
    notes: '',
    ...overrides,
  }
}

describe('sullivanDisabled', () => {
  it('is on by default', () => {
    assert.equal(sullivanDisabled({}), false)
  })

  it('respects AGENT_SULLIVAN=0 and AGENT_RUNNER=0', () => {
    assert.equal(sullivanDisabled({ AGENT_SULLIVAN: '0' }), true)
    assert.equal(sullivanDisabled({ AGENT_RUNNER: '0' }), true)
  })
})

describe('allowLlmType / parseLlmClassify', () => {
  it('accepts a path type and ignores extra forcing_inputs keys', () => {
    const parsed = {
      content_type: 'firsthand_review',
      forcing_inputs: { direct_anecdotes: ['invented'] },
      direct_anecdotes: ['nope'],
    }
    assert.equal(parseLlmClassify(parsed, ''), 'firsthand_review')
  })

  it('notes-only contrarian without a thesis becomes none', () => {
    assert.equal(allowLlmType('contrarian_opinion', 'just some notes about recovery'), null)
    assert.equal(parseLlmClassify({ content_type: 'contrarian_opinion' }, 'just some notes'), null)
  })

  it('contrarian_opinion only when notes already hold a thesis', () => {
    assert.equal(
      allowLlmType('contrarian_opinion', 'Thesis: everyone says recovery firms work. They do not.'),
      'contrarian_opinion'
    )
  })

  it('case_study only when notes already describe an execution', () => {
    assert.equal(allowLlmType('case_study', 'a writeup of someone else'), null)
    assert.equal(allowLlmType('case_study', 'We ran a sprint on IC3 filings'), 'case_study')
  })

  it('none / invalid / missing type stay null', () => {
    assert.equal(allowLlmType('none', ''), null)
    assert.equal(allowLlmType('educational', ''), null)
    assert.equal(parseLlmClassify(null, ''), null)
    assert.equal(parseLlmClassify({ content_type: 'none' }, ''), null)
  })
})

describe('existingSullivanType', () => {
  it('returns a human-saved Sullivan type without the notes gate', () => {
    assert.equal(existingSullivanType({ content_type: 'case_study' }), 'case_study')
    assert.equal(existingSullivanType({ content_type: 'educational' }), null)
    assert.equal(existingSullivanType(null), null)
  })
})

describe('classifySullivanType', () => {
  it('/alerts/circle-k is firsthand_review without calling the LLM', async () => {
    let called = false
    const out = await classifySullivanType(supporting(), {
      callModel: async () => {
        called = true
        return { text: '{}' }
      },
      extractJSON: () => ({ content_type: 'none' }),
    })
    assert.equal(out.content_type, 'firsthand_review')
    assert.equal(out.source, 'deterministic')
    assert.equal(called, false)
  })

  it('/research/ is original_data_study', async () => {
    const out = await classifySullivanType({
      title: 'Ad Spend Report',
      url_path: '/research/ad-spend/',
    })
    assert.equal(out.content_type, 'original_data_study')
    assert.equal(out.source, 'deterministic')
  })

  it('/scams/ becomes infrastructure only with ≥3 child topics', async () => {
    const topic = { id: 'scam-hub', title: 'Pig Butchering', url_path: '/scams/pig-butchering/' }
    const out = await classifySullivanType(topic, {
      supaFetch: async (path) => {
        if (path.includes('/topics?parent_id=')) {
          return [{ title: 'A' }, { title: 'B' }, { title: 'C' }]
        }
        return []
      },
    })
    assert.equal(out.content_type, 'infrastructure')
    assert.equal(out.source, 'scams_graph')
  })

  it('/scams/ with a single explainer stays none (does not force a data study)', async () => {
    const out = await classifySullivanType(
      { id: 'scam-1', title: 'Pig Butchering', url_path: '/scams/pig-butchering/' },
      { supaFetch: async () => [] }
    )
    assert.equal(out.content_type, null)
    assert.equal(out.source, 'none')
  })

  it('LLM fallback may return none for notes-only contrarian', async () => {
    const out = await classifySullivanType(
      {
        title: 'Why recovery advice is wrong',
        url_path: '/learn/recovery-myths/',
        notes: 'just thinking out loud',
      },
      {
        callModel: async () => ({ text: '{"content_type":"contrarian_opinion"}' }),
        extractJSON: (text) => JSON.parse(text),
      }
    )
    assert.equal(out.content_type, null)
    assert.equal(out.source, 'llm_none')
  })
})

describe('pickNextSullivan', () => {
  it('skips cluster folders and already sullivan_ok topics', () => {
    const cluster = supporting({
      id: 'folder',
      topic_type: 'cluster',
      title: 'Entity & Hub Spokes',
      url_path: '/scams/',
    })
    const ok = supporting({ id: 'ok', slug: 'ok-page' })
    const due = supporting({ id: 'due', slug: 'due-page', scheduled_for: TODAY })
    const briefsById = new Map([['ok', { sullivan_ok: true }]])
    const picked = pickNextSullivan([cluster, ok, due], { briefsById, today: TODAY })
    assert.equal(picked.next.id, 'due')
    assert.equal(picked.due.length, 1)
  })

  it('prefers due-today over soonest future date', () => {
    const future = supporting({
      id: 'future',
      slug: 'future-page',
      scheduled_for: '2026-08-27',
      priority_score: 99,
    })
    const due = supporting({
      id: 'due',
      slug: 'due-page',
      scheduled_for: TODAY,
      priority_score: 10,
    })
    const picked = pickNextSullivan([future, due], { today: TODAY, briefsById: new Map() })
    assert.equal(picked.next.id, 'due')
  })

  it('eligibleForSullivan rejects hubs and linked articles', () => {
    assert.equal(
      eligibleForSullivan(supporting({ topic_type: 'cluster' }), { today: TODAY }),
      false
    )
    assert.equal(
      eligibleForSullivan(supporting({ content_id: 'c-1' }), { today: TODAY }),
      false
    )
    assert.equal(
      eligibleForSullivan(supporting({ scheduled_for: null }), { today: TODAY }),
      false
    )
  })
})

describe('sullivanFingerprint', () => {
  it('is stable per topic', () => {
    assert.equal(sullivanFingerprint('t-1'), 'sullivan_evidence:t-1')
  })
})
