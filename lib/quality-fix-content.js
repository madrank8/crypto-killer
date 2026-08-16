'use strict'

/**
 * Content-row adapter for the shared Quality Fix Agent.
 * Wires remediations, surgical model, research, persist, reaudit, and publish
 * (never override) for topical `content` rows.
 */

const { callModel, extractJSON } = require('./ai-models')
const { remediateContent } = require('./remediate-content')
const { evaluateHardFails } = require('./audit-gate')
const { supaFetch } = require('./supabase')
const { applySurgicalPatches } = require('./quality-fix-surgical')
const { researchSourcesForClaims } = require('./quality-fix-research')
const { runQualityFixAgent } = require('./quality-fix-agent')
const { callQualityFixModel } = require('./quality-fix-model')

let _auditFnsPromise = null

async function loadAuditFns() {
  if (!_auditFnsPromise) {
    // Relative path so Next webpack rewrites @/ inside run-quality-audit.
    _auditFnsPromise = import('./run-quality-audit.js')
  }
  return _auditFnsPromise
}

function resolveOrigin(origin) {
  if (typeof origin === 'string' && origin.trim()) return origin.replace(/\/$/, '')
  const site = process.env.NEXT_PUBLIC_SITE_URL
  if (typeof site === 'string' && site.trim()) return site.replace(/\/$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`.replace(/\/$/, '')
  return 'http://localhost:3000'
}

/**
 * Load a content row by id.
 * @param {string} id
 */
async function loadContent(id) {
  if (!id || typeof id !== 'string') throw new Error('content id is required')
  const rows = await supaFetch(
    `/content?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
  )
  const row = Array.isArray(rows) ? rows[0] : null
  if (!row) throw new Error(`Content not found: ${id}`)
  return row
}

/**
 * Wire real I/O deps for runQualityFixAgent.
 * @param {{ id: string, authorization?: string|null, send?: Function, origin?: string, fetchImpl?: Function, auditFns?: { runQualityAudit: Function, mergeAuditVerdict: Function } }} opts
 */
function buildContentAgentDeps({
  id,
  authorization,
  send,
  origin,
  fetchImpl,
  auditFns,
} = {}) {
  if (!id) throw new Error('buildContentAgentDeps requires id')

  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch.bind(globalThis)
  const baseOrigin = resolveOrigin(origin)

  async function runSurgicalModel(prompt) {
    const system =
      prompt && typeof prompt.system === 'string'
        ? prompt.system
        : 'You fix YMYL publish-gate failures surgically. Return JSON only.'
    const user =
      prompt && typeof prompt.user === 'string'
        ? prompt.user
        : typeof prompt === 'string'
          ? prompt
          : JSON.stringify(prompt || {})

    const result = await callQualityFixModel(callModel, system, user, {
      label: 'quality-fix-surgical',
    })
    return extractJSON(result.text)
  }

  async function persistPatch(patch) {
    const body = {
      ...(patch && typeof patch === 'object' ? patch : {}),
      updated_at: new Date().toISOString(),
    }
    const updated = await supaFetch(
      `/content?id=eq.${encodeURIComponent(id)}&select=*`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(body),
      },
    )
    const row = Array.isArray(updated) ? updated[0] : updated
    if (!row) throw new Error('Failed to persist content patch')
    return row
  }

  async function reaudit(workingRow) {
    const fns = auditFns || (await loadAuditFns())
    const runQualityAudit = fns.runQualityAudit
    const mergeAuditVerdict = fns.mergeAuditVerdict
    const { audit, auditError, auditModelUsed } = await runQualityAudit(workingRow)
    const merged = mergeAuditVerdict(workingRow, audit, { auditError, auditModelUsed })
    await supaFetch(`/content?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        ai_audit: merged,
        updated_at: new Date().toISOString(),
      }),
    })
    const row = { ...workingRow, ai_audit: merged }
    const gate = evaluateHardFails(merged, row)
    return { row, hardFails: gate.failed, audit: merged }
  }

  async function publish() {
    const url = `${baseOrigin}/api/admin/content/${encodeURIComponent(id)}/publish`
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authorization || '',
      },
      // NEVER pass override — only the real publish gate may decide.
      body: JSON.stringify({ action: 'publish' }),
    })
    let data = null
    try {
      data = await res.json()
    } catch {
      data = null
    }
    return { ok: res.ok, status: res.status, data }
  }

  return {
    remediateDeterministic: (row, hardFails) => remediateContent(row, hardFails),
    runSurgicalModel,
    applySurgicalPatches,
    researchSourcesForClaims: (opts) =>
      researchSourcesForClaims({
        ...opts,
        callModelFn: callModel,
      }),
    persistPatch,
    reaudit,
    publish,
    send: typeof send === 'function' ? send : () => {},
  }
}

/**
 * Build orchestrator context for a content id.
 * @param {string} id
 * @param {{ authorization?: string|null, send?: Function, autoPublish?: boolean, origin?: string, row?: object, hardFails?: Array, gateReasons?: Array, fetchImpl?: Function, auditFns?: object, deps?: object }} options
 */
async function buildContentAgentContext(id, options = {}) {
  const row = options.row || (await loadContent(id))
  const hardFails =
    Array.isArray(options.hardFails)
      ? options.hardFails
      : evaluateHardFails(row.ai_audit, row).failed

  const wired = buildContentAgentDeps({
    id,
    authorization: options.authorization,
    send: options.send,
    origin: options.origin,
    fetchImpl: options.fetchImpl,
    auditFns: options.auditFns,
  })

  return {
    kind: 'content',
    row,
    hardFails,
    gateReasons: Array.isArray(options.gateReasons) ? options.gateReasons : [],
    autoPublish: options.autoPublish !== false,
    deps: { ...wired, ...(options.deps || {}) },
  }
}

/**
 * Persist quality_fix stamp onto ai_audit.
 * @param {string} id
 * @param {object} ai_audit
 * @param {Function} [stampPersist]
 */
async function persistQualityFixStamp(id, ai_audit, stampPersist) {
  if (typeof stampPersist === 'function') {
    return stampPersist(ai_audit)
  }
  await supaFetch(`/content?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      ai_audit,
      updated_at: new Date().toISOString(),
    }),
  })
  return ai_audit
}

/**
 * Run one quality-fix cycle for a content row and stamp ai_audit.quality_fix.
 * @param {string} id
 * @param {{ authorization?: string|null, send?: Function, autoPublish?: boolean, origin?: string, row?: object, hardFails?: Array, runAgent?: Function, stampPersist?: Function, fetchImpl?: Function, auditFns?: object, deps?: object }} options
 */
async function runContentQualityFix(id, options = {}) {
  const ctx = await buildContentAgentContext(id, options)
  const runAgent = typeof options.runAgent === 'function' ? options.runAgent : runQualityFixAgent
  const result = await runAgent(ctx)

  const quality_fix =
    result?.quality_fix || {
      at: new Date().toISOString(),
      model: 'gpt-5.4-mini',
      applied: Array.isArray(result?.applied) ? result.applied : [],
      unfixable: Array.isArray(result?.unfixable) ? result.unfixable : [],
      published: Boolean(result?.published),
      cycle: 1,
    }

  const prevAudit =
    result?.row?.ai_audit && typeof result.row.ai_audit === 'object' ? result.row.ai_audit : {}
  const ai_audit = { ...prevAudit, quality_fix }
  await persistQualityFixStamp(id, ai_audit, options.stampPersist)

  const row = { ...(result?.row || ctx.row), ai_audit }
  return {
    ...result,
    quality_fix,
    row,
    audit_summary: {
      ...(result?.audit_summary || {}),
      quality_fix,
      overall_score: ai_audit.overall_score,
    },
  }
}

module.exports = {
  loadContent,
  buildContentAgentDeps,
  buildContentAgentContext,
  runContentQualityFix,
}
