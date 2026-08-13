'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { formatFullBriefForPrompt } = require('../../lib/content-brief/prompt')

describe('formatFullBriefForPrompt', () => {
  it('returns empty for null/empty', () => {
    assert.equal(formatFullBriefForPrompt(null), '')
    assert.equal(formatFullBriefForPrompt({}), '')
  })

  it('includes Sullivan vs map format labels and heading seeds', () => {
    const text = formatFullBriefForPrompt({
      content_type: 'firsthand_review',
      content_format: 'Evergreen Article',
      locale: 'en-US',
      primary_keyword: 'rug pull',
      heading_structure: [
        {
          h2: 'What is a rug pull?',
          heading_level: 'H2',
          starting_statement: 'A rug pull drains liquidity after hype.',
          instruction: 'Define then list red flags.',
          ple_unit: { pixel: 'diagram', letter: 'definitional', byte: 'Article' },
        },
      ],
      faq_sweep: {
        carrier_h2: 'Common Questions',
        items: [{ question: 'Can I recover funds?', answer_target: 'Rarely once LP is gone.' }],
      },
      claim_categories: { expert_sources: ['FTC reports'] },
      internal_link_targets: { root: '/', seed_pages: ['/crypto-scams/'] },
    })
    assert.match(text, /Sullivan content_type \(SC-098\): firsthand_review/)
    assert.match(text, /Map content_format \(page format — NOT Sullivan\): Evergreen Article/)
    assert.match(text, /What is a rug pull\?/)
    assert.match(text, /starting_statement: A rug pull drains/)
    assert.match(text, /ple_unit: pixel=diagram/)
    assert.match(text, /Can I recover funds\?/)
    assert.match(text, /FTC reports/)
  })
})
