'use strict'

/**
 * Quality Fix Agent orchestrator — one classify → fix → reaudit → publish cycle.
 * All I/O is injected via `deps` (no Supabase/API wiring here).
 */

const { classifyFails } = require('./quality-fix-classify')
const { surgicalFixPrompt } = require('./quality-fix-surgical')
const { mergeVerifiedSources } = require('./quality-fix-research')
const { softenHardFails, isSoftenableFail } = require('./quality-fix-soften')

function sendStep(deps, event) {
  if (typeof deps.send === 'function') deps.send(event)
}

function buildRowExcerpt(row) {
  const article = row && row.full_article
  return {
    title: row?.title,
    headline: row?.headline,
    meta_description: row?.meta_description,
    summary: row?.summary,
    full_article: typeof article === 'string' ? article.slice(0, 8000) : article,
    sources: row?.sources,
    citations: row?.citations,
    not_for_you: row?.not_for_you,
    disclaimer: row?.disclaimer,
  }
}

function existingUrlsFromRow(row) {
  const urls = new Set()
  for (const list of [row?.sources, row?.citations]) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const u = item && (item.url || item.href)
      if (typeof u === 'string' && u) urls.add(u)
    }
  }
  return urls
}

function isNonEmptyPatch(patch) {
  return Boolean(patch && typeof patch === 'object' && Object.keys(patch).length > 0)
}

/** Fields the quality-fix agent is allowed to persist on a content/review row. */
const PERSIST_ALLOWLIST = new Set([
  'full_article',
  'sections',
  'sources',
  'citations',
  'not_for_you',
  'meta_description',
  'summary',
  'disclaimer',
  'headline',
  'title',
  'faq',
  'red_flags',
  'how_it_works',
  'verdict',
  'protection_steps',
  'methodology',
  'expertise_depth',
  'information_gain_summary',
  'experience_signals',
])

function sanitizePersistPatch(patch) {
  if (!isNonEmptyPatch(patch)) return {}
  const out = {}
  for (const [key, value] of Object.entries(patch)) {
    if (PERSIST_ALLOWLIST.has(key)) out[key] = value
  }
  return out
}

/**
 * After Prefer:return=representation, keep in-memory patched fields when the
 * returned row does not reflect them (known intermittent full_article no-op).
 */
function mergePersistResult(workingRow, sentPatch, returnedRow) {
  const sent = sanitizePersistPatch(sentPatch)
  const base = returnedRow && typeof returnedRow === 'object' ? { ...returnedRow } : { ...workingRow }
  const merged = { ...base }
  for (const [key, value] of Object.entries(sent)) {
    const returnedVal = returnedRow ? returnedRow[key] : undefined
    if (JSON.stringify(returnedVal) !== JSON.stringify(value)) {
      merged[key] = value
    }
  }
  return merged
}

function assertPersistStuck(sentPatch, returnedRow) {
  const sent = sanitizePersistPatch(sentPatch)
  if (!isNonEmptyPatch(sent)) return
  if (!returnedRow || typeof returnedRow !== 'object') {
    throw new Error('persistPatch returned no row — body fixes may not have stuck')
  }
  if (typeof sent.full_article === 'string' && sent.full_article.length > 0) {
    const got = returnedRow.full_article
    if (typeof got !== 'string') {
      throw new Error('persistPatch did not stick for full_article (missing on returned row)')
    }
    if (/risk-disclosure/i.test(sent.full_article) && !/risk-disclosure/i.test(got)) {
      throw new Error('persistPatch did not stick: risk-disclosure missing from returned full_article')
    }
    if (sent.full_article.length > 200 && got.length < Math.floor(sent.full_article.length * 0.5)) {
      throw new Error(
        `persistPatch did not stick for full_article (sent ${sent.full_article.length} chars, got ${got.length})`,
      )
    }
  }
}

function mergeInto(target, incoming) {
  if (!incoming || typeof incoming !== 'object') return target
  return { ...target, ...incoming }
}

function collectByTactic(classified, tactic) {
  return classified.filter((c) => c.tactic === tactic)
}

function failPayload(classified) {
  return classified.map((c) => ({
    key: c.key,
    reason: c.reason || c.operator_action || c.tactic,
  }))
}

function stampQualityFix({ applied, unfixable, published, softenPass = false }) {
  return {
    at: new Date().toISOString(),
    model: 'gpt-5.4',
    applied,
    unfixable,
    published,
    cycle: 1,
    soften_pass: Boolean(softenPass),
  }
}

function loadBearingClaimTexts(loadBearingClaims) {
  return (Array.isArray(loadBearingClaims) ? loadBearingClaims : [])
    .map((c) => (c && typeof c.text === 'string' ? c.text : ''))
    .filter((t) => t.length > 0)
}

function patchMentionsClaimText(patch, claimText) {
  if (!patch || typeof patch !== 'object' || !claimText) return false
  for (const key of ['find', 'replace', 'body']) {
    const val = patch[key]
    if (typeof val === 'string' && val.includes(claimText)) return true
  }
  return false
}

/**
 * Split surgical patches so load-bearing claim text is not softened/removed
 * before research + insert_ledger_link can run.
 */
function partitionPatchesForLoadBearing(patches, loadBearingClaims) {
  const list = Array.isArray(patches) ? patches : []
  const claimTexts = loadBearingClaimTexts(loadBearingClaims)
  if (!claimTexts.length) {
    return { safePatches: list, riskyPatches: [] }
  }
  const safePatches = []
  const riskyPatches = []
  for (const patch of list) {
    const risky = claimTexts.some((text) => patchMentionsClaimText(patch, text))
    if (risky) riskyPatches.push(patch)
    else safePatches.push(patch)
  }
  return { safePatches, riskyPatches }
}

async function applyPatchList(deps, workingRow, patches, applied) {
  const list = Array.isArray(patches) ? patches : []
  if (!list.length) return { workingRow, patch: {} }
  const result = deps.applySurgicalPatches(workingRow, list)
  if (Array.isArray(result.applied)) applied.push(...result.applied)
  const next = isNonEmptyPatch(result.patch) ? result.patch : workingRow
  return { workingRow: next, patch: isNonEmptyPatch(result.patch) ? result.patch : {} }
}

async function applyModelPatches(deps, workingRow, modelOut, applied) {
  const patches = Array.isArray(modelOut?.patches) ? modelOut.patches : []
  return applyPatchList(deps, workingRow, patches, applied)
}

async function runResearchEscalation(deps, ctx, workingRow, loadBearingClaims, applied) {
  sendStep(deps, { step: 'research', status: 'active' })
  const research = await deps.researchSourcesForClaims({
    claims: loadBearingClaims,
    topicTitle: workingRow.title || workingRow.headline || '',
    existingUrls: existingUrlsFromRow(workingRow),
  })
  const sources = Array.isArray(research?.sources) ? research.sources : []
  let patch = {}

  if (sources.length) {
    const merged = mergeVerifiedSources(workingRow, sources)
    workingRow = { ...workingRow, ...merged }
    patch = { sources: merged.sources }
    if (Array.isArray(merged.citations)) patch.citations = merged.citations

    const prompt = surgicalFixPrompt({
      kind: ctx.kind,
      fails: loadBearingClaims.map((c, i) => ({
        key: 'load_bearing_claim_' + i,
        reason: 'insert_ledger_link for verified source: ' + (c.text || c.why_load_bearing || ''),
      })),
      rowExcerpt: buildRowExcerpt(workingRow),
    })
    const modelOut = await deps.runSurgicalModel(prompt)
    const appliedResult = await applyModelPatches(deps, workingRow, modelOut, applied)
    workingRow = appliedResult.workingRow
    patch = mergeInto(patch, appliedResult.patch)
  } else {
    // Failed research → soften / remove load-bearing claims (fail closed)
    const prompt = surgicalFixPrompt({
      kind: ctx.kind,
      fails: loadBearingClaims.map((c, i) => ({
        key: 'load_bearing_unverified_' + i,
        reason:
          'Research found no verified source; soften or remove claim: ' +
          (c.text || c.why_load_bearing || ''),
      })),
      rowExcerpt: buildRowExcerpt(workingRow),
    })
    const modelOut = await deps.runSurgicalModel(prompt)
    const appliedResult = await applyModelPatches(deps, workingRow, modelOut, applied)
    workingRow = appliedResult.workingRow
    patch = mergeInto(patch, appliedResult.patch)
  }

  sendStep(deps, { step: 'research', status: 'done' })
  return { workingRow, patch }
}

async function runQualityFixAgent(ctx) {
  const deps = ctx.deps || {}
  const autoPublish = ctx.autoPublish !== false
  const applied = []
  const unfixable = []
  let workingRow = { ...(ctx.row || {}) }
  let accumulatedPatch = {}

  try {
    sendStep(deps, { step: 'classify', status: 'active' })
    const classified = classifyFails(ctx.hardFails || [], ctx.gateReasons || [])
    for (const item of classified) {
      if (item.tactic === 'unfixable') {
        unfixable.push({
          key: item.key,
          reason: item.reason || 'unfixable',
          operator_action: item.operator_action,
        })
      }
    }
    sendStep(deps, { step: 'classify', status: 'done' })

    const deterministic = collectByTactic(classified, 'deterministic')
    const researchCandidates = collectByTactic(classified, 'research_candidate')
    const surgical = collectByTactic(classified, 'surgical')

    // Still attempt fixable tactics even when unfixable items exist
    if (deterministic.length) {
      sendStep(deps, { step: 'deterministic', status: 'active' })
      const det = deps.remediateDeterministic(workingRow, failPayload(deterministic)) || {}
      if (Array.isArray(det.applied)) applied.push(...det.applied)
      if (Array.isArray(det.unfixable)) {
        for (const u of det.unfixable) unfixable.push(u)
      }
      if (isNonEmptyPatch(det.patch)) {
        const detPatch = sanitizePersistPatch(det.patch)
        accumulatedPatch = mergeInto(accumulatedPatch, detPatch)
        workingRow = mergeInto(workingRow, detPatch)
        // Flush mechanical body fixes immediately so a later surgical full-row
        // mistake or concurrent editor save cannot erase them silently.
        sendStep(deps, { step: 'apply', status: 'active', message: 'Persisting deterministic fixes…' })
        const returned = await deps.persistPatch(detPatch)
        assertPersistStuck(detPatch, returned)
        workingRow = mergePersistResult(workingRow, detPatch, returned)
        sendStep(deps, { step: 'apply', status: 'done' })
      }
      sendStep(deps, { step: 'deterministic', status: 'done' })
    }

    if (researchCandidates.length) {
      sendStep(deps, { step: 'surgical', status: 'active' })
      const prompt = surgicalFixPrompt({
        kind: ctx.kind,
        fails: failPayload(researchCandidates),
        rowExcerpt: buildRowExcerpt(workingRow),
      })
      const modelOut = (await deps.runSurgicalModel(prompt)) || {}
      const loadBearing = Array.isArray(modelOut.load_bearing_claims)
        ? modelOut.load_bearing_claims.filter((c) => c && (c.text || c.why_load_bearing))
        : []
      const allPatches = Array.isArray(modelOut.patches) ? modelOut.patches : []

      if (loadBearing.length) {
        // Apply only patches that do not mention load-bearing claim text.
        // Risky first-pass removes/softens are deferred: research + insert_ledger_link
        // (or empty-research soften) owns those claims — never apply riskyPatches that
        // would remove a claim research successfully cited.
        const { safePatches } = partitionPatchesForLoadBearing(allPatches, loadBearing)
        const safeResult = await applyPatchList(deps, workingRow, safePatches, applied)
        workingRow = safeResult.workingRow
        accumulatedPatch = mergeInto(accumulatedPatch, safeResult.patch)

        const researchResult = await runResearchEscalation(
          deps,
          ctx,
          workingRow,
          loadBearing,
          applied,
        )
        workingRow = researchResult.workingRow
        accumulatedPatch = mergeInto(accumulatedPatch, researchResult.patch)
      } else {
        // No load-bearing claims → apply all surgical patches from this pass
        const appliedResult = await applyPatchList(deps, workingRow, allPatches, applied)
        workingRow = appliedResult.workingRow
        accumulatedPatch = mergeInto(accumulatedPatch, appliedResult.patch)
      }
      sendStep(deps, { step: 'surgical', status: 'done' })
    }

    if (surgical.length) {
      sendStep(deps, { step: 'surgical', status: 'active' })
      const prompt = surgicalFixPrompt({
        kind: ctx.kind,
        fails: failPayload(surgical),
        rowExcerpt: buildRowExcerpt(workingRow),
      })
      const modelOut = (await deps.runSurgicalModel(prompt)) || {}
      const appliedResult = await applyModelPatches(deps, workingRow, modelOut, applied)
      workingRow = appliedResult.workingRow
      accumulatedPatch = mergeInto(accumulatedPatch, appliedResult.patch)
      sendStep(deps, { step: 'surgical', status: 'done' })
    }

    if (isNonEmptyPatch(accumulatedPatch)) {
      sendStep(deps, { step: 'apply', status: 'active' })
      const toPersist = sanitizePersistPatch(accumulatedPatch)
      if (isNonEmptyPatch(toPersist)) {
        const returned = await deps.persistPatch(toPersist)
        assertPersistStuck(toPersist, returned)
        workingRow = mergePersistResult(workingRow, toPersist, returned)
      }
      sendStep(deps, { step: 'apply', status: 'done' })
    }

    sendStep(deps, { step: 'reaudit', status: 'active' })
    let audit = (await deps.reaudit(workingRow)) || {}
    if (audit.row) workingRow = audit.row
    let remainingFails = Array.isArray(audit.hardFails) ? audit.hardFails : []
    sendStep(deps, { step: 'reaudit', status: 'done' })

    // Publish readiness loop phase 2: fail-closed soften once if hard fails remain.
    // Still one agent invocation; never invent; never override.
    let softenPass = false
    const softenableRemaining = remainingFails.filter(isSoftenableFail)
    if (remainingFails.length > 0 && softenableRemaining.length > 0) {
      sendStep(deps, { step: 'soften', status: 'active', message: 'Fail-closed soften pass…' })
      const softenFn = typeof deps.softenFails === 'function' ? deps.softenFails : softenHardFails
      const softened = softenFn(workingRow, remainingFails) || {}
      if (Array.isArray(softened.applied)) applied.push(...softened.applied)
      if (Array.isArray(softened.unfixable)) {
        for (const u of softened.unfixable) unfixable.push(u)
      }
      if (isNonEmptyPatch(softened.patch)) {
        softenPass = true
        const softenPatch = sanitizePersistPatch(softened.patch)
        workingRow = mergeInto(workingRow, softenPatch)
        const returned = await deps.persistPatch(softenPatch)
        assertPersistStuck(softenPatch, returned)
        workingRow = mergePersistResult(workingRow, softenPatch, returned)
        sendStep(deps, { step: 'reaudit', status: 'active', message: 'Re-audit after soften…' })
        audit = (await deps.reaudit(workingRow)) || {}
        if (audit.row) workingRow = audit.row
        remainingFails = Array.isArray(audit.hardFails) ? audit.hardFails : []
        sendStep(deps, { step: 'reaudit', status: 'done' })
      }
      sendStep(deps, { step: 'soften', status: 'done' })
    }

    // Anything still failing after soften → human-only panel payload
    if (remainingFails.length > 0) {
      for (const fail of remainingFails) {
        const already = unfixable.some((u) => u.key === fail.key && u.reason === fail.reason)
        if (already) continue
        unfixable.push({
          key: fail.key || 'unknown',
          reason: fail.reason || fail.key || 'remaining hard fail',
          operator_action:
            'Unfixable after readiness loop — edit the named claim manually. Do not use publish override.',
        })
      }
    }

    // Score does not block — only remaining hard fails
    const ready = remainingFails.length === 0
    let published = false
    const reasons = remainingFails.map((f) => f.reason || f.key).filter(Boolean)

    if (ready && autoPublish) {
      sendStep(deps, { step: 'publish', status: 'active' })
      // NEVER pass override
      const pub = await deps.publish(workingRow)
      published = Boolean(pub && pub.ok)
      sendStep(deps, {
        step: published ? 'done' : 'needs_review',
        status: published ? 'done' : 'failed',
        published,
      })
    } else {
      sendStep(deps, {
        step: ready ? 'done' : 'needs_review',
        status: 'done',
        published: false,
        ready,
        human_only: !ready,
      })
    }

    const quality_fix = stampQualityFix({ applied, unfixable, published, softenPass })
    const audit_summary = {
      hard_fails: remainingFails,
      overall_score: workingRow?.ai_audit?.overall_score,
      quality_fix,
    }

    return {
      ok: true,
      ready,
      published,
      applied,
      unfixable,
      audit_summary,
      reasons,
      row: workingRow,
      quality_fix,
      human_only: !ready,
    }
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    const quality_fix = stampQualityFix({ applied, unfixable, published: false })
    return {
      ok: false,
      ready: false,
      published: false,
      applied,
      unfixable,
      audit_summary: { quality_fix },
      reasons: [message],
      row: workingRow,
      quality_fix,
    }
  }
}

module.exports = { runQualityFixAgent }
