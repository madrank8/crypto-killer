/**
 * Execute a Work Plan item. Never publishes unless AGENT_AUTOPUBLISH=1
 * and the item's fingerprint/slug is allowlisted.
 */

import { supabaseRequest } from './supabase'
import { updateWorkItem } from './work-plan'

function normalizeSlug(target) {
  if (!target) return null
  const clean = String(target).trim().replace(/^https?:\/\/[^/]+/, '')
  const parts = clean.split('/').filter(Boolean)
  return (parts[parts.length - 1] || '').toLowerCase() || null
}

function autopublishEnabled() {
  return process.env.AGENT_AUTOPUBLISH === '1'
}

function allowlisted(slug) {
  const raw = process.env.AGENT_AUTOPUBLISH_ALLOWLIST || ''
  if (!raw.trim()) return false
  const set = new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
  return set.has(String(slug || '').toLowerCase())
}

async function logAgentAction({ action_type, fingerprint, content_id = null, detail = {} }) {
  try {
    await supabaseRequest('/agent_actions', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([{ action_type, fingerprint, content_id, detail }]),
    })
  } catch (e) {
    console.warn('[advisor-actions] audit log failed:', e.message)
  }
}

/**
 * @param {object} item work_plan_items row
 * @param {{ origin: string, authHeader: string }} ctx
 */
export async function executeWorkItem(item, ctx) {
  const slug = normalizeSlug(item.target)
  const { origin, authHeader } = ctx

  switch (item.action_type) {
    case 'new_review': {
      if (!slug) throw new Error('no brand target')
      const brands = await supabaseRequest(
        `/scam_brands?slug=eq.${encodeURIComponent(slug)}&select=id,slug,name&limit=1`,
        { useServiceRole: true }
      )
      const brand = brands?.[0]
      if (!brand) throw new Error(`Brand '${slug}' not found`)
      const createRes = await fetch(`${origin}/api/admin/reviews/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({ brand_id: brand.id }),
      })
      const created = await createRes.json()
      if (!createRes.ok) throw new Error(created.error || 'Create failed')
      const redirect = `/admin/review/${created.review_id}?generate=auto`
      await logAgentAction({
        action_type: 'new_review',
        fingerprint: item.fingerprint,
        detail: { review_id: created.review_id, redirect, existing: !!created.existing },
      })
      return {
        status: 'done',
        result: { action: created.existing ? 'opened_existing' : 'created', redirect },
      }
    }

    case 'refresh_review':
    case 'fix_ctr': {
      if (!slug) {
        return {
          status: 'blocked',
          result: { action: 'redirect_only', redirect: item.deep_link },
          error: 'no review slug — use deep_link manually',
        }
      }
      const reviews = await supabaseRequest(
        `/reviews?slug=eq.${encodeURIComponent(slug)}&select=id,slug&limit=1`,
        { useServiceRole: true }
      )
      const review = reviews?.[0]
      if (!review) {
        return {
          status: 'blocked',
          result: { action: 'redirect_only', redirect: item.deep_link },
          error: 'review not found',
        }
      }
      await logAgentAction({
        action_type: item.action_type,
        fingerprint: item.fingerprint,
        detail: { review_id: review.id, redirect: `/admin/review/${review.id}?polish=auto` },
      })
      return {
        status: 'done',
        result: {
          action: 'polish_ready',
          redirect: `/admin/review/${review.id}?polish=auto`,
        },
      }
    }

    case 'new_content': {
      // Autopublish path is gated; default is draft-only create stub via deep_link.
      if (autopublishEnabled() && allowlisted(slug) && item.content_id) {
        const pubRes = await fetch(`${origin}/api/admin/content/${item.content_id}/publish`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
          body: JSON.stringify({}),
        })
        const pub = await pubRes.json()
        await logAgentAction({
          action_type: 'autopublish',
          fingerprint: item.fingerprint,
          content_id: item.content_id,
          detail: { ok: pubRes.ok, body: pub },
        })
        if (!pubRes.ok) {
          return { status: 'blocked', error: pub.error || 'publish gate failed', result: pub }
        }
        return { status: 'done', result: { action: 'published', ...pub } }
      }
      return {
        status: 'blocked',
        error: autopublishEnabled()
          ? 'content not allowlisted or missing content_id — human publish required'
          : 'AGENT_AUTOPUBLISH off — open deep_link / editor to publish',
        result: { redirect: item.deep_link || '/admin/content' },
      }
    }

    default:
      return {
        status: 'blocked',
        error: `action_type ${item.action_type} needs human navigation`,
        result: { redirect: item.deep_link },
      }
  }
}

export async function runNextWorkItem(ctx) {
  if (process.env.AGENT_RUNNER === '0') {
    return { skipped: true, reason: 'AGENT_RUNNER=0' }
  }
  const { claimNextQueued } = await import('./work-plan')
  const item = await claimNextQueued()
  if (!item) return { skipped: true, reason: 'queue empty' }

  try {
    const outcome = await executeWorkItem(item, ctx)
    const patch = {
      status: outcome.status,
      last_error: outcome.error || null,
      outcome_json: outcome.result || null,
    }
    if (outcome.status === 'done') patch.executed_at = new Date().toISOString()
    await updateWorkItem(item.fingerprint, patch)
    return { ok: true, fingerprint: item.fingerprint, ...outcome }
  } catch (err) {
    await updateWorkItem(item.fingerprint, {
      status: 'blocked',
      last_error: err.message,
    })
    await logAgentAction({
      action_type: 'runner_error',
      fingerprint: item.fingerprint,
      detail: { error: err.message },
    })
    return { ok: false, fingerprint: item.fingerprint, error: err.message }
  }
}
