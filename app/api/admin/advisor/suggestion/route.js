import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

/**
 * PATCH /api/admin/advisor/suggestion
 * Body: { fingerprint, state: 'done'|'dismissed'|null }
 * null state = reopen (delete the row).
 */
export async function PATCH(request) {
  try {
    verifyAdmin(request)
  } catch {
    return unauthorizedResponse()
  }

  try {
    const { fingerprint, state } = await request.json()
    if (!fingerprint || typeof fingerprint !== 'string') {
      return Response.json({ error: 'fingerprint required' }, { status: 400 })
    }

    if (state === null) {
      await supabaseRequest(`/advisor_suggestion_states?fingerprint=eq.${encodeURIComponent(fingerprint)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      })
      return Response.json({ ok: true, fingerprint, state: null })
    }

    if (!['done', 'dismissed'].includes(state)) {
      return Response.json({ error: 'state must be done, dismissed, or null' }, { status: 400 })
    }

    await supabaseRequest('/advisor_suggestion_states?on_conflict=fingerprint', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ fingerprint: fingerprint.slice(0, 200), state, updated_at: new Date().toISOString() }]),
    })
    return Response.json({ ok: true, fingerprint, state })
  } catch (err) {
    console.error('[advisor/suggestion]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
