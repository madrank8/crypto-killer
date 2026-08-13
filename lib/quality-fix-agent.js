'use strict'

/**
 * Quality Fix Agent orchestrator — one classify → fix → reaudit → publish cycle.
 * All I/O is injected via `deps` (no Supabase/API wiring here).
 */

const { classifyFails } = require('./quality-fix-classify')
const { surgicalFixPrompt } = require('./quality-fix-surgical')
const { mergeVerifiedSources } = require('./quality-fix-research')

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

function stampQualityFix({ applied, unfixable, published }) {
  return {
    at: new Date().toISOString(),
    model: 'gpt-5.4',
    applied,
    unfixable,
    published,
    cycle: 1,
  }
}

async function applyModelPatches(deps, workingRow, modelOut, applied) {
  const patches = Array.isArray(modelOut?.patches) ? modelOut.patches : []
  if (!patches.length) return { workingRow, patch: {} }
  const result = deps.applySurgicalPatches(workingRow, patches)
  if (Array.isArray(result.applied)) applied.push(...result.applied)
  const next = isNonEmptyPatch(result.patch) ? result.patch : workingRow
  return { workingRow: next, patch: isNonEmptyPatch(result.patch) ? result.patch : {} }
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
        accumulatedPatch = mergeInto(accumulatedPatch, det.patch)
        workingRow = mergeInto(workingRow, det.patch)
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

      // Non-load-bearing → apply surgical patches from this pass
      const appliedResult = await applyModelPatches(deps, workingRow, modelOut, applied)
      workingRow = appliedResult.workingRow
      accumulatedPatch = mergeInto(accumulatedPatch, appliedResult.patch)

      if (loadBearing.length) {
        const researchResult = await runResearchEscalation(
          deps,
          ctx,
          workingRow,
          loadBearing,
          applied,
        )
        workingRow = researchResult.workingRow
        accumulatedPatch = mergeInto(accumulatedPatch, researchResult.patch)
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
      workingRow = await deps.persistPatch(accumulatedPatch)
      sendStep(deps, { step: 'apply', status: 'done' })
    }

    sendStep(deps, { step: 'reaudit', status: 'active' })
    const audit = (await deps.reaudit(workingRow)) || {}
    if (audit.row) workingRow = audit.row
    const remainingFails = Array.isArray(audit.hardFails) ? audit.hardFails : []
    sendStep(deps, { step: 'reaudit', status: 'done' })

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
      })
    }

    const quality_fix = stampQualityFix({ applied, unfixable, published })
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
