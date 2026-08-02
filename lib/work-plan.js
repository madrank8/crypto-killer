/**
 * Work Plan queue: materialize Advisor suggestions into durable cards.
 */

import { supabaseRequest } from './supabase'

const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2 }

/**
 * Upsert open suggestions from a stored advisor report into work_plan_items.
 * Skips fingerprints already done/dismissed.
 */
export async function materializeFromReport(stored) {
  const suggestions = stored?.report?.suggestions
  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    return { upserted: 0 }
  }

  // Load known fingerprints so we never clobber done/dismissed/running.
  const existing = await supabaseRequest(
    '/work_plan_items?select=fingerprint,status&limit=500',
    { useServiceRole: true }
  ).catch(() => [])
  const byFp = new Map((existing || []).map((r) => [r.fingerprint, r.status]))

  let upserted = 0
  for (const s of suggestions) {
    if (!s?.fingerprint) continue
    const status = byFp.get(s.fingerprint)
    if (status === 'done' || status === 'dismissed' || status === 'running') continue

    const row = {
      fingerprint: String(s.fingerprint).slice(0, 200),
      action_type: s.action_type || 'other',
      target: s.target || null,
      title: String(s.title || 'Untitled').slice(0, 300),
      why: s.why ? String(s.why).slice(0, 1000) : null,
      priority: ['P0', 'P1', 'P2'].includes(s.priority) ? s.priority : 'P2',
      status: 'queued',
      deep_link: s.deep_link || null,
      source_report_id: stored.id || null,
      updated_at: new Date().toISOString(),
    }
    await supabaseRequest('/work_plan_items?on_conflict=fingerprint', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([row]),
    })
    upserted++
  }

  return { upserted }
}

/**
 * Enqueue a single operator/chat-originated item.
 */
export async function enqueueWorkItem({
  fingerprint,
  action_type,
  target,
  title,
  why,
  priority = 'P2',
  deep_link = null,
}) {
  if (!fingerprint || !title) throw new Error('fingerprint and title required')
  const row = {
    fingerprint: String(fingerprint).slice(0, 200),
    action_type: action_type || 'other',
    target: target || null,
    title: String(title).slice(0, 300),
    why: why ? String(why).slice(0, 1000) : null,
    priority: ['P0', 'P1', 'P2'].includes(priority) ? priority : 'P2',
    status: 'queued',
    deep_link,
    updated_at: new Date().toISOString(),
  }
  const inserted = await supabaseRequest('/work_plan_items?on_conflict=fingerprint', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([row]),
  })
  return Array.isArray(inserted) ? inserted[0] : inserted
}

export async function listWorkPlan({ status = null, limit = 50 } = {}) {
  let path = `/work_plan_items?select=*&order=created_at.desc&limit=${Math.min(limit, 100)}`
  if (status) path = `/work_plan_items?status=eq.${encodeURIComponent(status)}&select=*&order=created_at.desc&limit=${Math.min(limit, 100)}`
  const rows = await supabaseRequest(path, { useServiceRole: true })
  return (rows || []).sort((a, b) => {
    const pr = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
    if (pr !== 0) return pr
    return new Date(b.created_at) - new Date(a.created_at)
  })
}

export async function updateWorkItem(fingerprint, patch) {
  if (!fingerprint) throw new Error('fingerprint required')
  const body = { ...patch, updated_at: new Date().toISOString() }
  await supabaseRequest(
    `/work_plan_items?fingerprint=eq.${encodeURIComponent(fingerprint)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    }
  )
  return { ok: true, fingerprint, ...patch }
}

/**
 * Claim next queued item for the runner (highest priority first).
 */
export async function claimNextQueued() {
  if (process.env.AGENT_RUNNER === '0') return null
  const rows = await listWorkPlan({ status: 'queued', limit: 20 })
  const next = rows[0]
  if (!next) return null
  await updateWorkItem(next.fingerprint, { status: 'running' })
  return next
}
