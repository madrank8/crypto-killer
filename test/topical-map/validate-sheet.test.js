'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { validateImportedPages } = require('../../lib/topical-map/import/validate-sheet')

describe('validateImportedPages', () => {
  it('fails when Primary Query Cluster / Search Intent / Phase / Internal Links missing on a page row', () => {
    const pages = [
      {
        title: 'Pig Butchering Scam Explained',
        url_path: '/wiki/pig-butchering/',
        target_keyword: null,
        search_intent: 'informational', // normalizeIntent defaults — simulate blank by marking _blankIntent
        publication_wave: 3,
        internal_links_raw: [],
        section: 'core',
        cluster_raw: '1. Wiki',
        rolling_placeholder: false,
        _sheet: {
          'Primary Query Cluster': '',
          'Search Intent': '',
          Phase: '',
          'Internal Links To': '',
          'Page Title (Title Tag Style)': 'Pig Butchering Scam Explained',
          'Suggested URL': '/wiki/pig-butchering/',
          Section: 'CORE',
          Cluster: '1. Wiki',
        },
      },
    ]
    const result = validateImportedPages(pages)
    assert.equal(result.ok, false)
    assert.ok(result.errors[0].missing_columns.includes('Primary Query Cluster'))
    assert.ok(result.errors[0].missing_columns.includes('Search Intent'))
    assert.ok(result.errors[0].missing_columns.includes('Phase'))
    assert.ok(result.errors[0].missing_columns.includes('Internal Links To'))
  })

  it('skips rolling placeholders', () => {
    const result = validateImportedPages([
      {
        title: 'Ongoing alerts',
        rolling_placeholder: true,
        _sheet: {},
      },
    ])
    assert.equal(result.ok, true)
    assert.equal(result.errors.length, 0)
  })

  it('warns when Notes / Angle blank but does not fail', () => {
    const result = validateImportedPages([
      {
        title: 'Checker',
        url_path: '/check/',
        target_keyword: 'crypto scam checker',
        search_intent: 'transactional',
        publication_wave: 1,
        internal_links_raw: ['crypto-scams'],
        section: 'core',
        cluster_raw: '4. Verification',
        rolling_placeholder: false,
        notes: null,
        _sheet: {
          'Primary Query Cluster': 'crypto scam checker',
          'Search Intent': 'Transactional',
          Phase: '1',
          'Internal Links To': '/blog/crypto-scams/',
          'Notes / Angle': '',
        },
      },
    ])
    assert.equal(result.ok, true)
    assert.ok(result.warnings.some((w) => /Notes/i.test(w)))
  })
})
