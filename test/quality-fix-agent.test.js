const { test } = require('node:test')
const assert = require('node:assert/strict')
const { runQualityFixAgent } = require('../lib/quality-fix-agent')
const { applySurgicalPatches } = require('../lib/quality-fix-surgical')

function baseDeps(overrides = {}) {
  return {
    remediateDeterministic: () => ({ patch: { full_article: '<p>with disclosure</p>' }, applied: [{ key: 'missing_risk_or_ftc_disclosure', what: 'appended' }], unfixable: [] }),
    runSurgicalModel: async () => ({ patches: [], load_bearing_claims: [] }),
    applySurgicalPatches: () => ({ patch: {}, applied: [], rejected: [] }),
    researchSourcesForClaims: async () => ({ sources: [], rejected: [] }),
    persistPatch: async (patch) => ({
      id: '1',
      ...patch,
      full_article: patch.full_article || '',
      ai_audit: {},
    }),
    reaudit: async (row) => ({ row, hardFails: [] }),
    publish: async () => ({ ok: true, status: 200 }),
    send: () => {},
    ...overrides,
  }
}

const LOAD_BEARING_CLAIM = 'FBI reports $5.6 billion in crypto fraud losses'

function researchCandidateRow() {
  return {
    id: '1',
    title: 'Crypto fraud guide',
    full_article: `<p>${LOAD_BEARING_CLAIM} according to analysts.</p><p>Also fix this fluff phrase.</p>`,
    sources: [],
  }
}

function firstPassSurgicalOut() {
  return {
    patches: [
      {
        op: 'replace_span',
        field: 'full_article',
        find: LOAD_BEARING_CLAIM,
        replace: 'Significant crypto fraud losses have been reported',
      },
      {
        op: 'replace_span',
        field: 'full_article',
        find: 'Also fix this fluff phrase.',
        replace: 'Also note the reporting lag.',
      },
    ],
    load_bearing_claims: [
      { text: LOAD_BEARING_CLAIM, why_load_bearing: 'section thesis depends on this figure' },
    ],
  }
}

test('auto-publishes when reaudit clears hard fails', async () => {
  const out = await runQualityFixAgent({
    kind: 'content',
    row: { id: '1', full_article: '<p>x</p>' },
    hardFails: [{ key: 'missing_risk_or_ftc_disclosure', reason: 'missing' }],
    autoPublish: true,
    deps: baseDeps(),
  })
  assert.equal(out.ready, true)
  assert.equal(out.published, true)
  assert.equal(out.ok, true)
})

test('does not publish when unfixable remains after reaudit', async () => {
  const out = await runQualityFixAgent({
    kind: 'content',
    row: { id: '1' },
    hardFails: [{ key: 'commodity_no_information_gain', reason: 'commodity' }],
    deps: baseDeps({
      remediateDeterministic: () => ({ patch: {}, applied: [], unfixable: [{ key: 'commodity_no_information_gain', reason: 'commodity', operator_action: 'add evidence' }] }),
      reaudit: async (row) => ({ row, hardFails: [{ key: 'commodity_no_information_gain', reason: 'commodity' }] }),
      publish: async () => { throw new Error('publish must not be called') },
    }),
  })
  assert.equal(out.published, false)
  assert.equal(out.ready, false)
  assert.ok(out.unfixable.length >= 1)
})

test('never calls publish with override', async () => {
  let publishArgs = null
  const out = await runQualityFixAgent({
    kind: 'content',
    row: { id: '1' },
    hardFails: [{ key: 'missing_risk_or_ftc_disclosure', reason: 'x' }],
    deps: baseDeps({
      publish: async (row, opts) => {
        publishArgs = opts
        return { ok: true, status: 200 }
      },
    }),
  })
  assert.equal(out.published, true)
  assert.equal(publishArgs?.override, undefined)
})

test('deps throw returns ok false without publishing', async () => {
  const out = await runQualityFixAgent({
    kind: 'content',
    row: { id: '1', full_article: '<p>x</p>' },
    hardFails: [{ key: 'missing_risk_or_ftc_disclosure', reason: 'missing' }],
    deps: baseDeps({
      persistPatch: async () => {
        throw new Error('persist exploded')
      },
      publish: async () => {
        throw new Error('publish must not be called')
      },
    }),
  })
  assert.equal(out.ok, false)
  assert.equal(out.published, false)
  assert.equal(out.ready, false)
  assert.ok(out.reasons.some((r) => String(r).includes('persist exploded')))
})

test('autoPublish defaults to true', async () => {
  let publishedCalled = false
  const out = await runQualityFixAgent({
    kind: 'content',
    row: { id: '1', full_article: '<p>x</p>' },
    hardFails: [{ key: 'missing_risk_or_ftc_disclosure', reason: 'missing' }],
    deps: baseDeps({
      publish: async () => {
        publishedCalled = true
        return { ok: true, status: 200 }
      },
    }),
  })
  assert.equal(publishedCalled, true)
  assert.equal(out.published, true)
})

test('score does not block publish when hard fails empty', async () => {
  const out = await runQualityFixAgent({
    kind: 'content',
    row: { id: '1', full_article: '<p>x</p>', ai_audit: { overall_score: 40 } },
    hardFails: [{ key: 'missing_risk_or_ftc_disclosure', reason: 'missing' }],
    deps: baseDeps({
      reaudit: async (row) => ({
        row: { ...row, ai_audit: { overall_score: 40 } },
        hardFails: [],
      }),
    }),
  })
  assert.equal(out.ready, true)
  assert.equal(out.published, true)
})

test('defers load-bearing remove patches until after research; cites when sources found', async () => {
  const applyCalls = []
  let preResearch = null
  let surgicalCall = 0
  const SOURCE_URL = 'https://www.fbi.gov/news/press-releases/crypto-fraud'

  const out = await runQualityFixAgent({
    kind: 'content',
    row: researchCandidateRow(),
    hardFails: [{ key: 'unverified_claims_in_article', reason: 'unverified: ' + LOAD_BEARING_CLAIM }],
    deps: baseDeps({
      remediateDeterministic: () => ({ patch: {}, applied: [], unfixable: [] }),
      runSurgicalModel: async () => {
        surgicalCall += 1
        if (surgicalCall === 1) return firstPassSurgicalOut()
        return {
          patches: [
            {
              op: 'insert_ledger_link',
              field: 'full_article',
              find: LOAD_BEARING_CLAIM,
              url: SOURCE_URL,
              anchor: LOAD_BEARING_CLAIM,
            },
          ],
          load_bearing_claims: [],
        }
      },
      applySurgicalPatches: (row, patches) => {
        applyCalls.push({ full_article: row.full_article, patches: patches.map((p) => ({ ...p })) })
        return applySurgicalPatches(row, patches)
      },
      researchSourcesForClaims: async () => {
        preResearch = {
          riskyApplied: applyCalls.some((c) =>
            c.patches.some(
              (p) => p.op === 'replace_span' && String(p.find).includes(LOAD_BEARING_CLAIM),
            ),
          ),
          claimIntact: applyCalls.every((c) => c.full_article.includes(LOAD_BEARING_CLAIM)),
          // If no applies yet, original row still has claim
          claimPresent:
            applyCalls.length === 0 ||
            applyCalls.every((c) => c.full_article.includes(LOAD_BEARING_CLAIM)),
        }
        return {
          sources: [
            {
              url: SOURCE_URL,
              title: 'FBI crypto fraud alert',
              type: 'government',
              extract: LOAD_BEARING_CLAIM,
            },
          ],
          rejected: [],
        }
      },
      persistPatch: async (patch) => ({
        id: '1',
        full_article: patch.full_article || '',
        sources: patch.sources || [],
        ai_audit: {},
      }),
    }),
  })

  assert.ok(preResearch, 'research must run')
  assert.equal(preResearch.riskyApplied, false, 'remove patch must not apply before research')
  assert.equal(preResearch.claimPresent, true, 'claim must exist at research time')
  assert.equal(out.ok, true)
  assert.ok(
    String(out.row.full_article).includes(LOAD_BEARING_CLAIM),
    'claim must remain after successful research citation',
  )
  assert.ok(
    String(out.row.full_article).includes(SOURCE_URL),
    'ledger link must be inserted when research finds a source',
  )
  assert.equal(
    applyCalls.some((c) =>
      c.patches.some(
        (p) =>
          p.op === 'replace_span' &&
          String(p.find).includes(LOAD_BEARING_CLAIM) &&
          String(p.replace).includes('Significant crypto fraud'),
      ),
    ),
    false,
    'first-pass risky remove must never apply when research cites the claim',
  )
})

test('empty research softens load-bearing claim after deferred remove is withheld', async () => {
  const applyCalls = []
  let preResearch = null
  let surgicalCall = 0
  const SOFTENED = 'Significant crypto fraud losses have been reported'

  const out = await runQualityFixAgent({
    kind: 'content',
    row: researchCandidateRow(),
    hardFails: [{ key: 'unverified_claims_in_article', reason: 'unverified: ' + LOAD_BEARING_CLAIM }],
    deps: baseDeps({
      remediateDeterministic: () => ({ patch: {}, applied: [], unfixable: [] }),
      runSurgicalModel: async () => {
        surgicalCall += 1
        if (surgicalCall === 1) return firstPassSurgicalOut()
        return {
          patches: [
            {
              op: 'replace_span',
              field: 'full_article',
              find: LOAD_BEARING_CLAIM,
              replace: SOFTENED,
            },
          ],
          load_bearing_claims: [],
        }
      },
      applySurgicalPatches: (row, patches) => {
        applyCalls.push({ full_article: row.full_article, patches: patches.map((p) => ({ ...p })) })
        return applySurgicalPatches(row, patches)
      },
      researchSourcesForClaims: async () => {
        preResearch = {
          riskyApplied: applyCalls.some((c) =>
            c.patches.some(
              (p) => p.op === 'replace_span' && String(p.find).includes(LOAD_BEARING_CLAIM),
            ),
          ),
          claimPresent:
            applyCalls.length === 0 ||
            applyCalls.every((c) => c.full_article.includes(LOAD_BEARING_CLAIM)),
        }
        return { sources: [], rejected: [] }
      },
      persistPatch: async (patch) => ({
        id: '1',
        full_article: patch.full_article || '',
        ai_audit: {},
      }),
    }),
  })

  assert.ok(preResearch, 'research must run')
  assert.equal(preResearch.riskyApplied, false, 'remove patch must not run before empty research')
  assert.equal(preResearch.claimPresent, true, 'claim must still exist before empty-research soften')
  assert.equal(out.ok, true)
  assert.ok(
    String(out.row.full_article).includes(SOFTENED),
    'empty research must soften via post-research replace_span',
  )
  assert.equal(
    String(out.row.full_article).includes(LOAD_BEARING_CLAIM),
    false,
    'original load-bearing claim text should be gone after soften',
  )
})

test('readiness loop: soften pass clears remaining fail then publishes', async () => {
  let reauditCalls = 0
  const out = await runQualityFixAgent({
    kind: 'content',
    row: {
      id: '1',
      full_article: '<p>Intro. "73% of victims lose everything" according to a blog. Outro.</p>',
    },
    hardFails: [{ key: 'fabricated_source_or_stat', reason: 'Claim "73% of victims lose everything" is fabricated' }],
    autoPublish: true,
    deps: baseDeps({
      remediateDeterministic: () => ({ patch: {}, applied: [], unfixable: [] }),
      runSurgicalModel: async () => ({ patches: [], load_bearing_claims: [] }),
      reaudit: async (row) => {
        reauditCalls += 1
        const html = String(row.full_article || '')
        if (html.includes('73%')) {
          return {
            row,
            hardFails: [
              {
                key: 'fabricated_source_or_stat',
                reason: 'Claim "73% of victims lose everything" is fabricated',
              },
            ],
          }
        }
        return { row, hardFails: [] }
      },
    }),
  })
  assert.equal(out.ok, true)
  assert.equal(out.ready, true)
  assert.equal(out.published, true)
  assert.ok(reauditCalls >= 2, 'expected reaudit after soften')
  assert.equal(out.quality_fix.soften_pass, true)
  assert.ok(out.applied.some((a) => a.key === 'soften_pass'))
})

test('readiness loop: remaining fails become human_only unfixable', async () => {
  const out = await runQualityFixAgent({
    kind: 'content',
    row: { id: '1', full_article: '<p>Commodity fluff only.</p>' },
    hardFails: [{ key: 'commodity_no_information_gain', reason: 'no evidence' }],
    deps: baseDeps({
      remediateDeterministic: () => ({ patch: {}, applied: [], unfixable: [] }),
      reaudit: async (row) => ({
        row,
        hardFails: [{ key: 'commodity_no_information_gain', reason: 'no evidence' }],
      }),
      publish: async () => {
        throw new Error('publish must not be called')
      },
    }),
  })
  assert.equal(out.published, false)
  assert.equal(out.ready, false)
  assert.equal(out.human_only, true)
  assert.ok(out.unfixable.some((u) => u.key === 'commodity_no_information_gain'))
})
