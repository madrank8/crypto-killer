'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
  persistImportedMap,
  deleteOrphanMap,
} = require('../../lib/topical-map/import/persist')

function mockSupa(sequence) {
  let i = 0
  const calls = []
  const fn = async (path, opts = {}) => {
    calls.push({ path, opts })
    const step = sequence[i++]
    if (!step) throw new Error(`Unexpected call ${path}`)
    if (step.throw) throw new Error(step.throw)
    return step.return
  }
  fn.calls = calls
  return fn
}

function oneClusterStructure() {
  return {
    pillars: [
      {
        section: 'core',
        pillar: { title: 'P1', slug: 'p1', target_keyword: 'a' },
        clusters: [
          {
            title: 'C1',
            slug: 'c1',
            supporting: [{ title: 'S1', slug: 's1', target_keyword: 'b' }],
          },
        ],
      },
    ],
  }
}

describe('deleteOrphanMap', () => {
  it('returns cleaned=true when both deletes succeed', async () => {
    const supaFetch = mockSupa([{ return: null }, { return: null }])
    const result = await deleteOrphanMap(supaFetch, 'map-1')
    assert.equal(result.cleaned, true)
    assert.equal(supaFetch.calls.length, 2)
    assert.ok(supaFetch.calls[0].path.includes('/topics?map_id=eq.map-1'))
    assert.equal(supaFetch.calls[0].opts.method, 'DELETE')
    assert.ok(supaFetch.calls[1].path.includes('/topical_maps?id=eq.map-1'))
    assert.equal(supaFetch.calls[1].opts.method, 'DELETE')
  })

  it('returns cleaned=false with errors when a delete fails', async () => {
    const supaFetch = mockSupa([
      { throw: 'topics delete failed' },
      { return: null },
    ])
    const result = await deleteOrphanMap(supaFetch, 'map-1')
    assert.equal(result.cleaned, false)
    assert.ok(result.errors.some((e) => /topics delete failed/.test(e)))
  })

  it('is a no-op returning cleaned=true when mapId is falsy', async () => {
    const supaFetch = mockSupa([])
    const result = await deleteOrphanMap(supaFetch, null)
    assert.equal(result.cleaned, true)
    assert.equal(supaFetch.calls.length, 0)
  })
})

describe('persistImportedMap atomicity', () => {
  it('deletes map when topic insert fails mid-way', async () => {
    const structure = oneClusterStructure()
    const supaFetch = mockSupa([
      { return: [] }, // loadExistingSlugs first page
      { return: [{ id: 'map-1' }] }, // map insert
      { return: [{ id: 't-pillar', slug: 'p1' }] }, // pillar
      { throw: 'cluster insert boom' },
      { return: null }, // delete topics
      { return: null }, // delete map
    ])

    await assert.rejects(
      () =>
        persistImportedMap({
          structure,
          mapName: 'Test',
          seedKeyword: 'crypto scams',
          source: 'test',
          warnings: [],
          counts: { pillars: 1, clusters: 1, supporting: 1 },
          supaFetch,
        }),
      /boom|Failed|insert/i
    )
    assert.ok(supaFetch.calls.some((c) => c.path.includes('/topics?map_id=eq.map-1') && c.opts.method === 'DELETE'))
    assert.ok(supaFetch.calls.some((c) => c.path.includes('/topical_maps?id=eq.map-1') && c.opts.method === 'DELETE'))
  })

  it('surfaces CRITICAL when cleanup itself fails after an insert failure', async () => {
    const structure = oneClusterStructure()
    const supaFetch = mockSupa([
      { return: [] }, // loadExistingSlugs first page
      { return: [{ id: 'map-1' }] }, // map insert
      { return: [{ id: 't-pillar', slug: 'p1' }] }, // pillar
      { throw: 'cluster insert boom' },
      { throw: 'topics delete failed' }, // cleanup delete topics fails
      { return: null }, // cleanup delete map succeeds
    ])

    await assert.rejects(
      () =>
        persistImportedMap({
          structure,
          mapName: 'Test',
          seedKeyword: 'crypto scams',
          source: 'test',
          warnings: [],
          counts: { pillars: 1, clusters: 1, supporting: 1 },
          supaFetch,
        }),
      /CRITICAL: orphan map/i
    )
  })

  it('fails if post-insert count verify mismatches, and cleans up', async () => {
    const structure = oneClusterStructure()
    const supaFetch = mockSupa([
      { return: [] }, // loadExistingSlugs first page
      { return: [{ id: 'map-1' }] }, // map insert
      { return: [{ id: 't-pillar', slug: 'p1' }] }, // pillar insert
      { return: [{ id: 't-cluster', slug: 'c1' }] }, // cluster insert
      { return: [{ id: 't-supp', slug: 's1' }] }, // supporting insert
      { return: [{ id: 't-pillar' }, { id: 't-cluster' }] }, // count verify: only 2 of 3 rows visible
      { return: null }, // cleanup delete topics
      { return: null }, // cleanup delete map
    ])

    await assert.rejects(
      () =>
        persistImportedMap({
          structure,
          mapName: 'Test',
          seedKeyword: 'crypto scams',
          source: 'test',
          warnings: [],
          counts: { pillars: 1, clusters: 1, supporting: 1 },
          supaFetch,
        }),
      /mismatch/i
    )
    assert.ok(supaFetch.calls.some((c) => c.path.includes('/topics?map_id=eq.map-1') && c.opts.method === 'DELETE'))
    assert.ok(supaFetch.calls.some((c) => c.path.includes('/topical_maps?id=eq.map-1') && c.opts.method === 'DELETE'))
  })

  it('patches stats with real inserted counts on success', async () => {
    const structure = oneClusterStructure()
    const supaFetch = mockSupa([
      { return: [] }, // loadExistingSlugs first page
      { return: [{ id: 'map-1' }] }, // map insert
      { return: [{ id: 't-pillar', slug: 'p1' }] }, // pillar insert
      { return: [{ id: 't-cluster', slug: 'c1' }] }, // cluster insert
      { return: [{ id: 't-supp', slug: 's1' }] }, // supporting insert
      { return: [{ id: 't-pillar' }, { id: 't-cluster' }, { id: 't-supp' }] }, // count verify: matches
      { return: null }, // stats PATCH
    ])

    const result = await persistImportedMap({
      structure,
      mapName: 'Test',
      seedKeyword: 'crypto scams',
      source: 'test',
      warnings: [],
      counts: { pillars: 99, clusters: 99, supporting: 99 }, // deliberately wrong to prove real counts win
      supaFetch,
    })

    assert.equal(result.map_id, 'map-1')
    assert.equal(result.topic_count, 3)

    const patchCall = supaFetch.calls.find(
      (c) => c.path.includes('/topical_maps?id=eq.map-1') && c.opts.method === 'PATCH'
    )
    assert.ok(patchCall, 'expected stats PATCH call')
    const body = JSON.parse(patchCall.opts.body)
    assert.equal(body.stats.topic_count, 3)
    assert.equal(body.stats.pillar_count, 1)
    assert.equal(body.stats.cluster_count, 1)
    assert.equal(body.stats.supporting_count, 1)
  })
})
