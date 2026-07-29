'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { validateImportedPages } = require('../../lib/topical-map/import/validate-sheet')
const { mapPageRow } = require('../../lib/topical-map/import/field-map')
const { parseSheetInput } = require('../../lib/topical-map/import/parse-sheet')

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

  it('fails when Page Title is blank on a page row', () => {
    const result = validateImportedPages([
      {
        title: '',
        url_path: '/wiki/test/',
        section: 'core',
        cluster_raw: '1. Wiki',
        rolling_placeholder: false,
        _sheet: {
          'Page Title (Title Tag Style)': '',
          'Suggested URL': '/wiki/test/',
          Section: 'CORE',
          Cluster: '1. Wiki',
          'Primary Query Cluster': 'test keyword',
          'Search Intent': 'Informational',
          Phase: '1',
          'Internal Links To': '/crypto-scams/',
        },
      },
    ])
    assert.equal(result.ok, false)
    assert.ok(result.errors[0].missing_columns.includes('Page Title (Title Tag Style)'))
  })

  it('does not require Internal Links for cluster/pillar shell rows', () => {
    const result = validateImportedPages([
      {
        title: 'Scam Type Wiki',
        topic_type: 'cluster',
        url_path: '/wiki/',
        section: 'core',
        cluster_raw: '2. Wiki',
        rolling_placeholder: false,
        _sheet: {
          'Page Title (Title Tag Style)': 'Scam Type Wiki',
          'Suggested URL': '/wiki/',
          Section: 'CORE',
          Cluster: '2. Wiki',
          'Primary Query Cluster': 'scam types',
          'Search Intent': 'Informational',
          Phase: '1',
          'Internal Links To': '',
        },
      },
    ])
    assert.equal(result.ok, true)
    assert.equal(result.errors.length, 0)
  })

  it('fails when sheet Page Title blank even if page.title is derived', () => {
    const result = validateImportedPages([
      {
        title: 'Derived Title',
        url_path: '/wiki/derived/',
        section: 'core',
        cluster_raw: '1. Wiki',
        rolling_placeholder: false,
        _sheet: {
          'Page Title (Title Tag Style)': '',
          'Suggested URL': '/wiki/derived/',
          Section: 'CORE',
          Cluster: '1. Wiki',
          'Primary Query Cluster': 'derived keyword',
          'Search Intent': 'Informational',
          Phase: '1',
          'Internal Links To': '/crypto-scams/',
        },
      },
    ])
    assert.equal(result.ok, false)
    assert.ok(result.errors[0].missing_columns.includes('Page Title (Title Tag Style)'))
    assert.equal(result.errors[0].title, 'Derived Title')
  })

  it('fails when sheet Suggested URL blank even if page.url_path is derived', () => {
    const result = validateImportedPages([
      {
        title: 'Has Title',
        url_path: '/wiki/derived-url/',
        section: 'core',
        cluster_raw: '1. Wiki',
        rolling_placeholder: false,
        _sheet: {
          'Page Title (Title Tag Style)': 'Has Title',
          'Suggested URL': '',
          Section: 'CORE',
          Cluster: '1. Wiki',
          'Primary Query Cluster': 'keyword',
          'Search Intent': 'Informational',
          Phase: '1',
          'Internal Links To': '/crypto-scams/',
        },
      },
    ])
    assert.equal(result.ok, false)
    assert.ok(result.errors[0].missing_columns.includes('Suggested URL'))
  })

  it('does not require Internal Links for pillar hub rows', () => {
    const result = validateImportedPages([
      {
        title: 'Crypto Scams Hub',
        url_path: '/crypto-scams/',
        cluster_number: 1,
        section: 'core',
        cluster_raw: '1. Wiki',
        rolling_placeholder: false,
        _sheet: {
          'Page Title (Title Tag Style)': 'Crypto Scams Hub',
          'Suggested URL': '/crypto-scams/',
          Section: 'CORE',
          Cluster: '1. Wiki',
          'Primary Query Cluster': 'crypto scams',
          'Search Intent': 'Informational',
          Phase: '1',
          'Internal Links To': '',
        },
      },
    ])
    assert.equal(result.ok, true)
    assert.equal(result.errors.length, 0)
  })

  it('requires Internal Links for explicit supporting rows', () => {
    const result = validateImportedPages([
      {
        title: 'Supporting Article',
        topic_type: 'supporting',
        url_path: '/wiki/supporting/',
        section: 'core',
        cluster_raw: '1. Wiki',
        rolling_placeholder: false,
        _sheet: {
          'Page Title (Title Tag Style)': 'Supporting Article',
          'Suggested URL': '/wiki/supporting/',
          Section: 'CORE',
          Cluster: '1. Wiki',
          'Primary Query Cluster': 'supporting keyword',
          'Search Intent': 'Informational',
          Phase: '1',
          'Internal Links To': '',
        },
      },
    ])
    assert.equal(result.ok, false)
    assert.ok(result.errors[0].missing_columns.includes('Internal Links To'))
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
          'Page Title (Title Tag Style)': 'Checker',
          'Suggested URL': '/check/',
          Section: 'CORE',
          Cluster: '4. Verification',
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

describe('mapPageRow → validateImportedPages integration', () => {
  const blankTitleRaw = {
    Section: 'CORE',
    Cluster: '1. Wiki',
    'Page Title (Title Tag Style)': '',
    'Suggested URL': '/wiki/missing-title/',
    'Primary Query Cluster': 'test keyword',
    'Search Intent': 'Informational',
    Phase: '1',
    'Internal Links To': '/crypto-scams/',
  }

  it('mapPageRow keeps blank-title rows with other page-map signals', () => {
    const mapped = mapPageRow(blankTitleRaw)
    assert.ok(mapped, 'expected mapped object, not null')
    assert.equal(mapped.title, '')
    assert.equal(mapped.url_path, '/wiki/missing-title/')
    assert.deepEqual(mapped._sheet['Page Title (Title Tag Style)'], '')
  })

  it('validateImportedPages fails blank-title rows from mapPageRow', () => {
    const mapped = mapPageRow(blankTitleRaw)
    const result = validateImportedPages([mapped])
    assert.equal(result.ok, false)
    assert.ok(result.errors[0].missing_columns.includes('Page Title (Title Tag Style)'))
  })

  it('mapPageRow returns null for completely blank padding rows', () => {
    assert.equal(mapPageRow({}), null)
    assert.equal(
      mapPageRow({
        Section: '',
        Cluster: '',
        'Page Title (Title Tag Style)': '',
        'Suggested URL': '',
        'Primary Query Cluster': '',
        Phase: '',
        'Internal Links To': '',
      }),
      null
    )
  })

  it('parseSheetInput includes blank-title rows and they fail validation', () => {
    const csv = [
      'Section,Cluster,Page Title (Title Tag Style),Suggested URL,Primary Query Cluster,Lead KW Volume,KD,Search Intent,Internal Links To,Notes / Angle,Phase',
      'CORE,1. Wiki,,/wiki/missing-title/,test keyword,,,Informational,/crypto-scams/,,1',
    ].join('\n')
    const { pages } = parseSheetInput({ csvText: csv })
    assert.equal(pages.length, 1)
    assert.equal(pages[0].title, '')
    const result = validateImportedPages(pages)
    assert.equal(result.ok, false)
    assert.ok(result.errors[0].missing_columns.includes('Page Title (Title Tag Style)'))
  })
})
