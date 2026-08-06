'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { isWritableContentTopic, hasQaFlag } = require('../../lib/topical-map/writable-topic')

describe('isWritableContentTopic', () => {
  it('allows supporting pages with a keyword or title', () => {
    assert.equal(
      isWritableContentTopic({
        topic_type: 'supporting',
        title: 'Pig Butchering Scam: How It Works',
        target_keyword: 'pig butchering scam',
      }),
      true
    )
  })

  it('blocks cluster folders', () => {
    assert.equal(
      isWritableContentTopic({ topic_type: 'cluster', title: 'Scam Type Wiki', target_keyword: null }),
      false
    )
  })

  it('allows real sheet hub pillars (title-tag style with colon + KW)', () => {
    assert.equal(
      isWritableContentTopic({
        topic_type: 'pillar',
        title: 'Crypto Scams: Types, Red Flags, and How to Spot Them',
        target_keyword: 'crypto scams',
      }),
      true
    )
  })

  it('blocks synthetic structural pillars', () => {
    assert.equal(
      isWritableContentTopic({
        topic_type: 'pillar',
        title: 'Victim Journey',
        target_keyword: null,
      }),
      false
    )
    assert.equal(
      isWritableContentTopic({
        topic_type: 'pillar',
        title: 'Scam Alerts (Trending)',
        target_keyword: 'scam alerts',
      }),
      false
    )
    assert.equal(
      isWritableContentTopic({
        topic_type: 'pillar',
        title: 'Safe Crypto Education',
        target_keyword: null,
        qa_flags: [{ type: 'synthetic_hub', detail: 'x' }],
      }),
      false
    )
  })

  it('blocks supporting with rolling notes', () => {
    assert.equal(
      isWritableContentTopic({
        topic_type: 'supporting',
        title: 'Ongoing alerts',
        notes: 'Rolling cadence: 2-4/week',
      }),
      false
    )
  })

  it('hasQaFlag reads string or object flags', () => {
    assert.equal(hasQaFlag({ qa_flags: ['synthetic_hub'] }, 'synthetic_hub'), true)
    assert.equal(hasQaFlag({ qa_flags: [{ type: 'synthetic_hub' }] }, 'synthetic_hub'), true)
    assert.equal(hasQaFlag({ qa_flags: [] }, 'synthetic_hub'), false)
  })
})
