'use strict'

// Map-level readiness orchestrator (topical-map import robustness design spec
// section 7 / task 7). For every SUPPORTING topic on a map: propose a Sullivan
// content_type -> gather stack evidence -> fill remaining gaps from Firecrawl
// (already-known URLs only) -> validate the Sullivan Gate -> upsert
// content_briefs with whatever was honestly gathered.
//
// Two honesty rules this module adds on top of gather-stack.js /
// gather-firecrawl.js (which already never invent a forcing input):
//
//   1. A human-declared content_type already saved on the topic's brief is
//      NEVER overridden by this module's own deterministic proposal - the
//      author's own classification always wins.
//   2. A human-supplied forcing input already saved on the topic's brief is
//      NEVER overwritten by a machine-gathered value, and machine gathering
//      never erases it. Several forcing inputs (e.g. field_observation_count,
//      recurring_pattern, semantic_role) have NO honest automated source by
//      design (see gather-stack.js) - this module's only way to see the
//      Sullivan Gate pass for those content types is a human having already
//      supplied them via the content-brief UI. This run only closes the gaps
//      an automated, cited source can honestly close.
//
// Never calls an LLM. Never invents a Wikidata Q-ID, an anecdote, or any
// other forcing input - a field with no real source is left in `missing`.

const { proposeSullivanType } = require('./propose-sullivan-type')
const { gatherStackEvidence } = require('./gather-stack')
const { gatherFirecrawlEvidence, mergeFirecrawlIntoEvidence } = require('./gather-firecrawl')
const { validateSullivanGate } = require('../../content-brief/sullivan')

const PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || 'https://cryptokiller.org'

function absoluteUrl(pathOrUrl) {
  if (typeof pathOrUrl !== 'string' || !pathOrUrl.trim()) return null
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  const base = PUBLIC_SITE_URL.replace(/\/$/, '')
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`
  return `${base}${path}`
}

const isBlankValue = (v) =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)

/**
 * Union of machine-gathered and human-supplied forcing inputs. A human value
 * always wins on conflict; a blank/missing human value never clobbers a real
 * gathered one. This is the only place gathered and human evidence combine.
 */
function mergeForcingInputs(gathered, existingHuman) {
  const merged = { ...(gathered && typeof gathered === 'object' ? gathered : {}) }
  for (const [field, value] of Object.entries(existingHuman && typeof existingHuman === 'object' ? existingHuman : {})) {
    if (!isBlankValue(value)) merged[field] = value
  }
  return merged
}

async function loadSupportingTopics(supaFetch, mapId) {
  const rows = await supaFetch(
    `/topics?map_id=eq.${mapId}&topic_type=eq.supporting&select=id,title,slug,url_path,content_type,content_format,notes,target_keyword,internal_links_to&order=sort_order.asc`
  )
  return Array.isArray(rows) ? rows : []
}

async function loadExistingBrief(supaFetch, topicId) {
  const rows = await supaFetch(
    `/content_briefs?topic_id=eq.${encodeURIComponent(topicId)}&select=id,content_type,forcing_inputs,sullivan_ok&limit=1`
  )
  return Array.isArray(rows) ? rows[0] || null : null
}

/**
 * Upsert the Sullivan gate verdict + forcing inputs this stage owns. Never
 * touches an already-assembled `brief` (Section 12 assembly stays a separate,
 * human-gated step in .../topics/[id]/content-brief/route.js).
 */
async function upsertContentBrief({ supaFetch, mapId, topicId, contentType, forcingInputs, sullivanOk, hasExisting }) {
  const row = {
    topic_id: topicId,
    map_id: mapId,
    content_type: contentType || null,
    forcing_inputs: forcingInputs && typeof forcingInputs === 'object' ? forcingInputs : {},
    sullivan_ok: sullivanOk === true,
    status: 'draft',
    updated_at: new Date().toISOString(),
  }

  if (hasExisting) {
    await supaFetch(`/content_briefs?topic_id=eq.${encodeURIComponent(topicId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    })
  } else {
    await supaFetch('/content_briefs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    })
  }
}

/**
 * Run the full evidence pipeline for one topic: propose -> stack gather ->
 * (optional) Firecrawl fill -> Sullivan gate -> content_briefs upsert.
 *
 * @returns { topic_id, outcome: 'sullivan_ok'|'needs_evidence'|'skipped', content_type, missing, sources }
 */
async function processTopic({ topic, mapId, supaFetch, fetchImpl, firecrawlApiKey }) {
  const existingBrief = await loadExistingBrief(supaFetch, topic.id)
  const existingForcingInputs =
    existingBrief?.forcing_inputs && typeof existingBrief.forcing_inputs === 'object' ? existingBrief.forcing_inputs : {}

  // A human-declared content_type already on file is the author's own
  // classification and is never replaced by our deterministic guess.
  const contentType = existingBrief?.content_type || proposeSullivanType(topic)

  if (!contentType) {
    // No deterministic signal and no prior human declaration: better left
    // blocked than force-fit into the wrong Sullivan path. Nothing to write.
    return { topic_id: topic.id, outcome: 'skipped', content_type: null, missing: [], sources: 0 }
  }

  let evidence = await gatherStackEvidence({ topic, proposeType: contentType, supaFetch, fetchImpl })
  let forcingInputs = mergeForcingInputs(evidence.forcing_inputs, existingForcingInputs)
  let gate = validateSullivanGate({ content_type: contentType, forcing_inputs: forcingInputs })

  if (!gate.ok) {
    const urls = [absoluteUrl(topic.url_path)].filter(Boolean)
    const firecrawl = await gatherFirecrawlEvidence({ urls, apiKey: firecrawlApiKey, fetchImpl })
    if (Array.isArray(firecrawl.pages) && firecrawl.pages.length) {
      evidence = mergeFirecrawlIntoEvidence(evidence, firecrawl.pages, contentType)
      forcingInputs = mergeForcingInputs(evidence.forcing_inputs, existingForcingInputs)
      gate = validateSullivanGate({ content_type: contentType, forcing_inputs: forcingInputs })
    }
  }

  await upsertContentBrief({
    supaFetch,
    mapId,
    topicId: topic.id,
    contentType,
    forcingInputs,
    sullivanOk: gate.ok,
    hasExisting: Boolean(existingBrief),
  })

  return {
    topic_id: topic.id,
    outcome: gate.ok ? 'sullivan_ok' : 'needs_evidence',
    content_type: contentType,
    missing: gate.ok ? [] : gate.missing.map((m) => m.field),
    sources: evidence.sources.length,
  }
}

async function loadMapStats(supaFetch, mapId) {
  const rows = await supaFetch(`/topical_maps?id=eq.${encodeURIComponent(mapId)}&select=stats&limit=1`)
  const row = Array.isArray(rows) ? rows[0] : null
  return row?.stats && typeof row.stats === 'object' ? row.stats : {}
}

function summarize(results) {
  return {
    processed: results.length,
    sullivan_ok: results.filter((r) => r.outcome === 'sullivan_ok').length,
    needs_evidence: results.filter((r) => r.outcome === 'needs_evidence').length,
    skipped: results.filter((r) => r.outcome === 'skipped').length,
  }
}

/**
 * Persist the run's outcome to topical_maps.stats.readiness (no new table for
 * v1, per the plan). Merges onto whatever stats already exist so unrelated
 * keys (import metadata, enrich-metrics history, etc.) survive.
 */
async function saveReadinessStats({ supaFetch, mapId, results }) {
  const prevStats = await loadMapStats(supaFetch, mapId)
  const topics = {}
  for (const r of results) {
    topics[r.topic_id] = {
      outcome: r.outcome,
      content_type: r.content_type,
      missing: r.missing,
      sources: r.sources,
    }
  }
  const nowIso = new Date().toISOString()
  const readiness = { ...summarize(results), ran_at: nowIso, topics }

  await supaFetch(`/topical_maps?id=eq.${encodeURIComponent(mapId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ stats: { ...prevStats, readiness }, updated_at: nowIso }),
  })

  return readiness
}

/**
 * Orchestrate Sullivan-gate readiness for every supporting topic on a map.
 * Fire-and-forget safe: never throws for an individual topic's evidence gaps,
 * only for structural problems (missing mapId/supaFetch, or a hard failure
 * from a dependency).
 *
 * @param mapId topical_maps.id
 * @param supaFetch PostgREST-style fetch (lib/supabase.js shape) - required
 * @param fetchImpl optional fetch-like function for live-site + Firecrawl calls
 * @param firecrawlApiKey optional override; gather-firecrawl.js otherwise
 *   falls back to process.env.FIRECRAWL_API_KEY and silently skips if unset
 * @returns { processed, sullivan_ok, needs_evidence, skipped }
 */
async function startMapReadiness({ mapId, supaFetch, fetchImpl, firecrawlApiKey } = {}) {
  if (!mapId) throw new Error('startMapReadiness requires mapId')
  if (typeof supaFetch !== 'function') throw new Error('startMapReadiness requires supaFetch')

  const topics = await loadSupportingTopics(supaFetch, mapId)

  const results = []
  for (const topic of topics) {
    results.push(await processTopic({ topic, mapId, supaFetch, fetchImpl, firecrawlApiKey }))
  }

  await saveReadinessStats({ supaFetch, mapId, results })
  return summarize(results)
}

module.exports = {
  startMapReadiness,
  processTopic,
  upsertContentBrief,
  mergeForcingInputs,
  absoluteUrl,
}
