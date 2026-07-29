'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { parseSheetInput, parseCsvText, extractSpreadsheetId } = require('../../lib/topical-map/import/parse-sheet')
const { consolidateKoray, isGrowthPartnerShape } = require('../../lib/topical-map/import/koray-structure')
const { mapPageRow, normalizeSection, buildTopicFields } = require('../../lib/topical-map/import/field-map')

const FIXTURE = path.join(__dirname, 'fixtures', 'page-map-sample.csv')

describe('topical-map sheet import parse', () => {
  it('parses the page-map fixture CSV', () => {
    const csv = fs.readFileSync(FIXTURE, 'utf8')
    const parsed = parseSheetInput({ csvText: csv })
    assert.ok(parsed.pages.length >= 10)
    assert.equal(parsed.pages[0].section, 'core')
    assert.equal(parsed.pages[0].target_keyword, 'crypto scams')
    assert.equal(parsed.pages[0].publication_wave, 2)
    assert.equal(parsed.pages[0].keyword_data_source, 'spreadsheet')
  })

  it('extracts Google Sheet ids from share URLs', () => {
    assert.equal(
      extractSpreadsheetId('https://docs.google.com/spreadsheets/d/193r_4J8kS079_DpJoJQnrpoOANHp1UjEXE2wzQlGdbU/edit?usp=sharing'),
      '193r_4J8kS079_DpJoJQnrpoOANHp1UjEXE2wzQlGdbU'
    )
  })

  it('cleans Suggested URL parentheticals', () => {
    const row = mapPageRow({
      Section: 'CORE',
      Cluster: '4. Verification & Tools',
      'Page Title (Title Tag Style)': 'Checker',
      'Suggested URL': '/check/ (or homepage)',
      'Primary Query Cluster': 'crypto scam checker',
      'Lead KW Volume': '90',
      KD: '72',
      'Search Intent': 'Transactional',
      Phase: '1',
    })
    assert.equal(row.url_path, '/check/')
  })
})

describe('koray consolidator', () => {
  it('nests Wiki under Crypto Scams and merges Victim Journey', () => {
    const csv = fs.readFileSync(FIXTURE, 'utf8')
    const { pages } = parseSheetInput({ csvText: csv })
    assert.equal(isGrowthPartnerShape(pages), true)

    const { structure, counts, warnings } = consolidateKoray(pages)
    assert.ok(counts.pillars >= 6)

    const crypto = structure.pillars.find((b) => /crypto scams/i.test(b.pillar.title))
    assert.ok(crypto, 'Crypto Scams pillar present')
    assert.equal(crypto.section, 'core')
    assert.equal(crypto.pillar.page_role, 'Root')

    const clusterTitles = (crypto.clusters || []).map((c) => c.title)
    assert.ok(clusterTitles.some((t) => /wiki/i.test(t)), 'Wiki cluster nested under Crypto Scams')
    assert.ok(
      (crypto.clusters || []).some((c) => (c.supporting || []).some((s) => /pig butchering/i.test(s.title))),
      'Wiki leaf under Wiki cluster'
    )

    const victim = structure.pillars.find((b) => /victim journey/i.test(b.pillar.title))
    assert.ok(victim, 'Victim Journey pillar')
    const vClusters = (victim.clusters || []).map((c) => c.title.toLowerCase())
    assert.ok(vClusters.some((t) => t.includes('recover')))
    assert.ok(vClusters.some((t) => t.includes('report')))

    const alerts = structure.pillars.find((b) => /scam alerts/i.test(b.pillar.title))
    assert.ok(alerts)
    assert.equal(alerts.pillar.title, 'Scam Alerts (Trending)')
    assert.equal(alerts.pillar.url_path, '/alerts/')
    assert.ok(
      !(alerts.clusters || []).some((c) =>
        (c.supporting || []).some((s) => /ongoing|2-4/i.test(s.title))
      ),
      'Rolling alerts not a leaf page'
    )
    assert.ok(
      warnings.some((w) => /rolling/i.test(w)) || /rolling/i.test(alerts.pillar.notes || ''),
      'Rolling cadence captured as note/warning'
    )
  })

  it('maps Phase to publication_wave', () => {
    const csv = fs.readFileSync(FIXTURE, 'utf8')
    const { pages } = parseSheetInput({ csvText: csv })
    const { structure } = consolidateKoray(pages)
    const recover = structure.pillars
      .flatMap((b) => b.clusters || [])
      .flatMap((c) => c.supporting || [])
      .find((s) => /recovery services/i.test(s.title))
    assert.ok(recover)
    assert.equal(recover.publication_wave, 1)
  })

  it('never maps Section onto page_role', () => {
    const csv = fs.readFileSync(FIXTURE, 'utf8')
    const { pages } = parseSheetInput({ csvText: csv })
    const { structure } = consolidateKoray(pages)

    for (const branch of structure.pillars) {
      assert.equal(branch.pillar.page_role, 'Root')
      assert.ok(['core', 'outer'].includes(branch.pillar.section))
      for (const c of branch.clusters || []) {
        assert.equal(c.page_role, 'Core')
        for (const s of c.supporting || []) {
          assert.equal(s.page_role, 'Outer')
          // Outer page_role can still have section=core (depth ≠ thematic axis)
          assert.ok(['core', 'outer'].includes(s.section))
        }
      }
    }

    // Explicit: a CORE-section leaf must still be page_role Outer
    const redFlags = structure.pillars
      .flatMap((b) => b.clusters || [])
      .flatMap((c) => c.supporting || [])
      .find((s) => /red flags/i.test(s.title))
    assert.ok(redFlags)
    assert.equal(redFlags.section, 'core')
    assert.equal(redFlags.page_role, 'Outer')
  })
})

describe('field-map section vs page_role', () => {
  it('normalizeSection only returns core/outer', () => {
    assert.equal(normalizeSection('CORE'), 'core')
    assert.equal(normalizeSection('OUTER'), 'outer')
  })

  it('buildTopicFields sets page_role from topic_type only', () => {
    const pillar = buildTopicFields(
      { title: 'X', slug: 'x', search_volume: 0, keyword_difficulty: 0 },
      { topicType: 'pillar', section: 'outer', sortOrder: 0 }
    )
    assert.equal(pillar.page_role, 'Root')
    assert.equal(pillar.section, 'outer')

    const leaf = buildTopicFields(
      { title: 'Y', slug: 'y', search_volume: 10, keyword_difficulty: 20 },
      { topicType: 'supporting', section: 'core', sortOrder: 0, ancestorSlugs: ['a', 'b'] }
    )
    assert.equal(leaf.page_role, 'Outer')
    assert.equal(leaf.section, 'core')
  })
})

describe('persist slug uniqueness', () => {
  const {
    allocateUniqueSlug,
    assignSlugsAgainstUsed,
  } = require('../../lib/topical-map/import/persist')

  it('suffixes when slug already exists globally', () => {
    const used = new Set(['biggest-crypto-scammers'])
    assert.equal(allocateUniqueSlug('biggest-crypto-scammers', used), 'biggest-crypto-scammers-2')
    assert.equal(allocateUniqueSlug('biggest-crypto-scammers', used), 'biggest-crypto-scammers-3')
  })

  it('rewrites internal_links_to when a linked slug is remapped', () => {
    const used = new Set(['biggest-crypto-scammers'])
    const structure = {
      pillars: [
        {
          section: 'core',
          pillar: {
            title: 'Hub',
            slug: 'hub',
            internal_links_to: ['biggest-crypto-scammers'],
          },
          clusters: [
            {
              title: 'Biggest Crypto Scammers',
              slug: 'biggest-crypto-scammers',
              internal_links_to: [],
              supporting: [],
            },
          ],
        },
      ],
    }
    assignSlugsAgainstUsed(structure, used)
    assert.equal(structure.pillars[0].clusters[0].slug, 'biggest-crypto-scammers-2')
    assert.deepEqual(structure.pillars[0].pillar.internal_links_to, [
      'biggest-crypto-scammers-2',
    ])
  })
})
