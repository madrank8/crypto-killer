'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { assertImportCoverage } = require('../../lib/topical-map/import/coverage')
const { parseSheetInput } = require('../../lib/topical-map/import/parse-sheet')
const { consolidateKoray } = require('../../lib/topical-map/import/koray-structure')

const FIXTURE = path.join(__dirname, 'fixtures', 'page-map-sample.csv')

describe('assertImportCoverage', () => {
  it('fails when a non-rolling sheet page title is absent from the tree', () => {
    const pages = [
      {
        title: 'Exchange Safety Report: Binance',
        rolling_placeholder: false,
        cluster_raw: '8. Exchange Safety Reports',
        url_path: '/review/binance-safety/',
      },
    ]
    const structure = {
      pillars: [
        {
          section: 'core',
          pillar: { title: 'Only Pillar', slug: 'only' },
          clusters: [{ title: 'Other', slug: 'other', supporting: [] }],
        },
      ],
    }
    const result = assertImportCoverage({
      pages,
      structure,
      counts: { pillars: 1, clusters: 1, supporting: 0 },
    })
    assert.equal(result.ok, false)
    assert.ok(result.missing_titles.includes('Exchange Safety Report: Binance'))
  })

  it('passes when every non-rolling page title appears under supporting or as pillar page', () => {
    const pages = [
      { title: 'Leaf A', rolling_placeholder: false, url_path: '/a/' },
    ]
    const structure = {
      pillars: [
        {
          section: 'core',
          pillar: { title: 'P', slug: 'p' },
          clusters: [
            {
              title: 'C',
              slug: 'c',
              supporting: [{ title: 'Leaf A', slug: 'a' }],
            },
          ],
        },
      ],
    }
    const result = assertImportCoverage({
      pages,
      structure,
      counts: { pillars: 1, clusters: 1, supporting: 1 },
    })
    assert.equal(result.ok, true)
  })

  it('skips rolling placeholder pages when checking title membership', () => {
    const pages = [
      { title: 'Leaf A', rolling_placeholder: false, url_path: '/a/' },
      { title: 'Ongoing: rolling alerts', rolling_placeholder: true, url_path: '/alerts/' },
    ]
    const structure = {
      pillars: [
        {
          section: 'outer',
          pillar: { title: 'P', slug: 'p' },
          clusters: [
            {
              title: 'C',
              slug: 'c',
              supporting: [{ title: 'Leaf A', slug: 'a' }],
            },
          ],
        },
      ],
    }
    const result = assertImportCoverage({
      pages,
      structure,
      counts: { pillars: 1, clusters: 1, supporting: 1 },
    })
    assert.equal(result.ok, true)
    assert.equal(result.missing_titles.length, 0)
  })

  it('ignores pages without a title (blank rows already caught by the sheet gate)', () => {
    const pages = [{ title: '', rolling_placeholder: false, url_path: '/blank/' }]
    const structure = {
      pillars: [
        {
          section: 'core',
          pillar: { title: 'P', slug: 'p' },
          clusters: [{ title: 'C', slug: 'c', supporting: [] }],
        },
      ],
    }
    const result = assertImportCoverage({ pages, structure, counts: { pillars: 1, clusters: 1, supporting: 0 } })
    assert.equal(result.ok, true)
  })

  it('flags a counts mismatch as a secondary (non-title) error', () => {
    const pages = [{ title: 'Leaf A', rolling_placeholder: false, url_path: '/a/' }]
    const structure = {
      pillars: [
        {
          section: 'core',
          pillar: { title: 'P', slug: 'p' },
          clusters: [{ title: 'C', slug: 'c', supporting: [{ title: 'Leaf A', slug: 'a' }] }],
        },
      ],
    }
    const result = assertImportCoverage({
      pages,
      structure,
      counts: { pillars: 1, clusters: 1, supporting: 99 },
    })
    assert.equal(result.ok, false)
    assert.equal(result.missing_titles.length, 0, 'title membership still holds')
    assert.ok(result.errors.some((e) => /counts\.supporting/.test(e)))
  })
})

describe('assertImportCoverage fixture regression', () => {
  it('passes coverage for the page-map sample CSV once parsed and consolidated', () => {
    const csv = fs.readFileSync(FIXTURE, 'utf8')
    const { pages } = parseSheetInput({ csvText: csv })
    const { structure, counts } = consolidateKoray(pages)

    const result = assertImportCoverage({ pages, structure, counts })

    assert.equal(result.ok, true, `expected coverage ok, got errors: ${result.errors.join('; ')}`)
    assert.equal(result.missing_titles.length, 0)
  })

  it('does not drop the rolling placeholder title from the fixture requirement', () => {
    const csv = fs.readFileSync(FIXTURE, 'utf8')
    const { pages } = parseSheetInput({ csvText: csv })
    const rolling = pages.find((p) => p.rolling_placeholder)
    assert.ok(rolling, 'fixture must include a rolling placeholder row')

    const { structure, counts } = consolidateKoray(pages)
    const result = assertImportCoverage({ pages, structure, counts })
    assert.equal(result.ok, true)
  })
})
