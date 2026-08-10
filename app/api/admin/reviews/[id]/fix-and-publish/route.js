import { revalidatePath } from 'next/cache'
import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { remediateReviewAudit } from '@/lib/review-audit-remediate'
import { runReviewQualityAudit } from '@/lib/run-review-quality-audit'

export const maxDuration = 300

async function patchReview(id, patch) {
  await supabaseRequest(`/reviews?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    headers: { Prefer: 'return=minimal' },
  })
}

/**
 * POST /api/admin/reviews/[id]/fix-and-publish
 *
 * One-click recovery for quality-audit VETO:
 *   remediating → auditing → publishing → done | blocked
 *
 * Never silent override. Publishes only when the gate clears after re-audit.
 */
export async function POST(request, { params }) {
  try {
    verifyAdmin(request)

    const { id } = await params
    if (!id) {
      return Response.json({ error: 'review id required' }, { status: 400 })
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false
        const send = (data) => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
          } catch {
            closed = true
          }
        }

        try {
          send({ step: 'load', progress: 5, message: 'Loading review…' })

          const reviewRows = await supabaseRequest(`/reviews?id=eq.${id}&select=*`)
          if (!Array.isArray(reviewRows) || reviewRows.length === 0) {
            throw new Error('Review not found')
          }
          let review = reviewRows[0]

          const brandRows = await supabaseRequest(
            `/scam_brands?id=eq.${review.brand_id}&select=*`,
          )
          if (!Array.isArray(brandRows) || brandRows.length === 0) {
            throw new Error('Brand not found for this review')
          }
          const brandData = brandRows[0]

          // ─── REMEDIATE ───────────────────────────────────────────────
          send({ step: 'remediating', progress: 15, message: 'Applying safe automatic fixes…' })

          const { patch, applied, unfixable } = remediateReviewAudit(review)

          if (Object.keys(patch).length > 0) {
            const remediationMeta = {
              at: new Date().toISOString(),
              applied,
              unfixable,
            }
            const trust = {
              ...(review.trust_indicators || {}),
              remediation: remediationMeta,
            }
            await patchReview(id, { ...patch, trust_indicators: trust })
            review = { ...review, ...patch, trust_indicators: trust }
            send({
              step: 'remediated',
              progress: 30,
              message: `Applied ${applied.length} fix${applied.length === 1 ? '' : 'es'}`,
              applied,
            })
          } else {
            send({
              step: 'remediated',
              progress: 30,
              message: applied.length
                ? 'No new patch (already remediated)'
                : 'No mechanical fixes matched — re-auditing anyway',
              applied,
              unfixable,
            })
          }

          // ─── RE-AUDIT ────────────────────────────────────────────────
          send({ step: 'auditing', progress: 40, message: 'Re-running quality audit…' })

          const auditOut = await runReviewQualityAudit(review, brandData, {
            onProgress: (msg) => send({ step: 'auditing', progress: 50, message: msg }),
          })

          const trustWithRemediation = {
            ...auditOut.trust_indicators,
            remediation: {
              at: new Date().toISOString(),
              applied,
              unfixable,
            },
          }

          await patchReview(id, {
            trust_indicators: trustWithRemediation,
            audit_hard_fail: auditOut.audit_hard_fail,
            audit_hard_fail_reason: auditOut.audit_hard_fail_reason,
          })

          review = {
            ...review,
            trust_indicators: trustWithRemediation,
            audit_hard_fail: auditOut.audit_hard_fail,
            audit_hard_fail_reason: auditOut.audit_hard_fail_reason,
          }

          const score = auditOut.auditReport?.overall_score ?? null
          send({
            step: 'audited',
            progress: 70,
            message: auditOut.audit_hard_fail
              ? `Audit still VETOED: ${auditOut.audit_hard_fail_reason || 'hard fail'}`
              : `Audit cleared (${score ?? '?'}/100)`,
            audit_summary: {
              score,
              grade: auditOut.auditReport?.grade ?? null,
              hard_fail: auditOut.audit_hard_fail,
              hard_fail_reason: auditOut.audit_hard_fail_reason,
            },
          })

          if (auditOut.audit_hard_fail) {
            const reasons = [
              auditOut.audit_hard_fail_reason || 'quality audit VETO',
              ...unfixable.map((u) => u.operator_action || u.reason),
            ].filter(Boolean)

            send({
              step: 'blocked',
              progress: 100,
              message: 'Still blocked after Fix & Publish — see reasons',
              result: {
                ok: false,
                ready: false,
                applied,
                unfixable,
                reasons,
                audit_summary: {
                  score,
                  grade: auditOut.auditReport?.grade ?? null,
                  hard_fail: true,
                  hard_fail_reason: auditOut.audit_hard_fail_reason,
                },
              },
            })
            controller.close()
            closed = true
            return
          }

          // ─── PUBLISH (no override) ───────────────────────────────────
          send({ step: 'publishing', progress: 80, message: 'Publish gate clear — publishing…' })

          const origin = new URL(request.url).origin
          const publishRes = await fetch(`${origin}/api/admin/reviews/${id}/publish`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: request.headers.get('authorization') || '',
            },
            body: JSON.stringify({ action: 'publish' }),
          })

          const publishBody = await publishRes.json().catch(() => ({}))

          if (!publishRes.ok) {
            const gateErrors = Array.isArray(publishBody.errors)
              ? publishBody.errors
              : [publishBody.error || `Publish failed (${publishRes.status})`]

            send({
              step: 'blocked',
              progress: 100,
              message: 'Audit cleared but publish gate blocked',
              result: {
                ok: false,
                ready: false,
                applied,
                unfixable,
                reasons: gateErrors,
                publish: publishBody,
                audit_summary: {
                  score,
                  grade: auditOut.auditReport?.grade ?? null,
                  hard_fail: false,
                },
              },
            })
            controller.close()
            closed = true
            return
          }

          try {
            if (review.slug) revalidatePath(`/review/${review.slug}`)
            revalidatePath('/')
            revalidatePath('/scams')
          } catch {
            /* non-fatal */
          }

          send({
            step: 'done',
            progress: 100,
            message: 'Fixed and published',
            result: {
              ok: true,
              ready: true,
              published: true,
              applied,
              unfixable,
              audit_summary: {
                score,
                grade: auditOut.auditReport?.grade ?? null,
                hard_fail: false,
              },
              publish: publishBody,
            },
          })
        } catch (err) {
          console.error('[fix-and-publish]', err)
          send({
            step: 'error',
            progress: 100,
            message: err?.message || String(err),
            result: { ok: false, ready: false, error: err?.message || String(err) },
          })
        } finally {
          try {
            controller.close()
          } catch {
            /* already closed */
          }
          closed = true
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    if (String(error?.message || '').includes('Unauthorized')) {
      return unauthorizedResponse()
    }
    return Response.json({ error: error.message }, { status: 500 })
  }
}
