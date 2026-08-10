'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { requireSullivanBrief } = require('../../lib/content-brief/gate')

describe('requireSullivanBrief', () => {
  it('skips when no topic_id', async () => {
    const r = await requireSullivanBrief({ topicId: null, contentType: 'guide' })
    assert.equal(r.ok, true)
    assert.equal(r.skipped, 'no_topic')
  })

  it('skips Discover mode without requiring a brief', async () => {
    const r = await requireSullivanBrief({
      topicId: '00000000-0000-0000-0000-000000000001',
      contentType: 'discover',
    })
    assert.equal(r.ok, true)
    assert.equal(r.skipped, 'discover')
    assert.equal(r.brief, null)
  })
})
