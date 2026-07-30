import { revalidatePath } from 'next/cache'
import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { appendUpdateHistory, makeEntry } from '@/lib/update-history'
import { headCheckUrl } from '@/lib/source-verify'
import { lintProseFields, detectHtmlPollution } from '@/lib/content-lint'
import { enqueuePublishOutbox, tryImmediateOutboxDelivery } from '@/lib/publish-outbox'

// Live delivery lives in lib/live-sync.js (shared with /sync + outbox worker).
// Publish quality gates stay in this file; sync is eventually consistent.

// ─── Publish-time data integrity gates ───────────────────────────
//
// Four classes of bug have leaked to production on cryptokiller.org in
// the last month despite the writer / polish / sync-shape stages:
//
//   (1) Unresolved visual placeholders ([CHART NEEDED: …]) rendered as
//       body text on the published page. The polish stage substitutes
//       these when visual generation succeeds, but silently leaves them
//       when it doesn't — so a partial visual failure becomes visible.
//   (2) Fabricated citation URLs — reddit/quora URLs that follow the
//       real URL pattern but don't resolve. Pull-quotes from these URLs
//       end up in the Quotation schema, attributable to real subreddits
//       or authors. YMYL defamation risk.
//   (3) Malformed plural agreement ("1 countries", "1 days") that slips
//       past the writer prompt.
//   (4) Self-contradicting sentences in a single paragraph ("all 28
//       creatives target HK exclusively" + "28 distributed outside HK").
//
// This gate runs BEFORE we flip the row to status=published. A hard-
// gated failure returns 422 with a structured errors[] array the admin
// UI can render; non-fatal drift goes in warnings[] and is allowed
// through. The gate is skipped on unpublish.

const PLACEHOLDER_RE = /\[\s*(CHART|DIAGRAM|IMAGE|INFOGRAPHIC|SCREENSHOT|PHOTO|STEP-BY-STEP)\s+NEEDED/i

// URL liveness checking (UNVERIFIABLE_DOMAINS, HEAD_403_OK, headCheckUrl)
// moved to lib/source-verify.js — shared with the generation-time ledger
// verification in reviews/generate and content/outline. Same semantics;
// single source of truth.

// Plural-agreement patterns moved to lib/content-lint.js — the shared
// lint (lintProseFields) now covers plural mismatches PLUS the anti-slop
// kill lists from the writer prompts, for both reviews and articles.

const MIN_FULL_ARTICLE_WORDS = 700

/**
 * Collect every human-prose field on the review into one array so we
 * can run regex scans against the whole corpus at once. Keeps ordering
 * stable for deterministic error messages.
 */
function collectProseFields(review) {
  const fields = []
  const push = (label, val) => {
    if (typeof val === 'string' && val.trim()) fields.push({ label, text: val })
  }
  push('title', review.title)
  push('headline', review.headline)
  push('meta_description', review.meta_description)
  push('summary', review.summary)
  push('verdict', review.verdict)
  push('how_it_works', review.how_it_works)
  push('not_for_you', review.not_for_you)
  push('protection_steps', review.protection_steps)
  push('methodology', review.methodology)
  push('expertise_depth', review.expertise_depth)
  push('full_article', review.full_article)
  push('disclaimer', review.disclaimer)
  push('information_gain_summary', review.information_gain_summary)

  const redFlags = Array.isArray(review.red_flags) ? review.red_flags : []
  redFlags.forEach((rf, i) => {
    push(`red_flags[${i}].flag`, rf?.flag || rf?.title)
    push(`red_flags[${i}].detail`, rf?.detail || rf?.description)
  })
  const faq = Array.isArray(review.faq) ? review.faq : []
  faq.forEach((f, i) => {
    push(`faq[${i}].question`, f?.question)
    push(`faq[${i}].answer`, f?.answer)
  })
  const takeaways = Array.isArray(review.key_takeaways) ? review.key_takeaways : []
  takeaways.forEach((t, i) => push(`key_takeaways[${i}]`, typeof t === 'string' ? t : t?.text))

  return fields
}

// headCheckUrl now imported from lib/source-verify.js (see note above).

/**
 * Run every publish-time integrity gate on a review row. Returns:
 *   { errors: string[], warnings: string[] }
 * Non-empty errors[] blocks publish (422). warnings[] is informational
 * and rendered in the response but doesn't block.
 *
 * @param {object} review  — Supabase review row (full *, not shaped)
 */
async function validateReviewReadyToPublish(review) {
  const errors = []
  const warnings = []
  const issues = []

  // ─── (1) Visual-placeholder leak check ─────────────────────────
  const fields = collectProseFields(review)
  for (const { label, text } of fields) {
    const m = text.match(PLACEHOLDER_RE)
    if (m) {
      const snippet = text.slice(m.index, m.index + 120).replace(/\s+/g, ' ')
      issues.push({
        code: 'UNRESOLVED_VISUAL_PLACEHOLDER',
        field: label,
        snippet,
        auto_fix: ['remove_placeholder_text'],
      })
      errors.push(
        `Unresolved visual placeholder in \`${label}\`: "${snippet}…" ` +
        `— polish pipeline did not substitute this placeholder before publish. ` +
        `Re-run /polish or remove the placeholder, then retry publish.`
      )
      break // one is enough
    }
  }

  // ─── (1b) full_article presence/quality gate ───────────────────
  // Published reviews must carry the writer-emitted long-form body.
  // Without this, Replit falls back to legacy template rendering.
  const fullArticle =
    typeof review.full_article === 'string' ? review.full_article.trim() : ''
  const fullArticleWords = fullArticle
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length
  if (fullArticleWords < MIN_FULL_ARTICLE_WORDS) {
    errors.push(
      `full_article is missing or too thin (words=${fullArticleWords}, min=${MIN_FULL_ARTICLE_WORDS}). ` +
      `Run AI Generate/Fill, save, and retry publish.`
    )
  }
  // Structural-pollution gate: the body is an HTML fragment, never a full
  // document or a structured-data dump. Blocks render-breaking content
  // (embedded <html>/<body>, raw <script>, JSON-LD blobs) from being synced
  // to the public renderer. (Audit: YMYL writing-process review.)
  errors.push(...detectHtmlPollution(fullArticle, 'full_article'))

  // ─── (2) Citation URL validation (HEAD + blocked-domain check) ─
  const citations = Array.isArray(review.citations) ? review.citations : []
  const sources = Array.isArray(review.sources) ? review.sources : []
  const urlsToCheck = [
    ...citations.map((c) => ({ url: c?.url, source: 'citations' })).filter((u) => Boolean(u.url)),
    ...sources.map((s) => ({ url: s?.url, source: 'sources' })).filter((u) => Boolean(u.url)),
  ]
  // Dedupe within the review (same URL in both citations+sources is common)
  const uniqueUrls = Array.from(new Set(urlsToCheck.map((u) => u.url)))
  const urlSources = uniqueUrls.reduce((acc, url) => {
    acc[url] = urlsToCheck.filter((entry) => entry.url === url).map((entry) => entry.source)
    return acc
  }, {})
  if (uniqueUrls.length > 0) {
    const results = await Promise.allSettled(uniqueUrls.map((u) => headCheckUrl(u)))
    for (let i = 0; i < results.length; i++) {
      const url = uniqueUrls[i]
      const r = results[i]
      if (r.status === 'rejected') {
        errors.push(`Citation URL check threw: ${url} (${r.reason?.message || r.reason})`)
        continue
      }
      if (!r.value.ok) {
        // Audit 2026-07-05 (A8 parity): transient network failures
        // (timeouts/resets on bot-hostile gov hosts) soft-warn instead of
        // blocking — same policy as the content publish gate. Permanent
        // failures (404/410/DNS/unverifiable) still block.
        if (/^network-transient:/i.test(r.value.reason || '')) {
          warnings.push(`Citation URL check timed out (transient) — ${url}: ${r.value.reason}. Verify manually if it persists.`)
          continue
        }
        issues.push({
          code: 'INVALID_CITATION_URL',
          url,
          reason: r.value.reason,
          fields: Array.from(new Set(urlSources[url] || [])),
          auto_fix: ['remove_citation_url', 'replace_with_vetted_source'],
        })
        errors.push(`Citation URL invalid — ${url}: ${r.value.reason}`)
      }
    }
  }

  // ─── (3) Deterministic prose lint (lib/content-lint.js) ────────
  // AI-tell kill phrases → errors (block publish). Slop vocabulary and
  // plural mismatches → warnings. This replaces the old plural-only loop
  // and finally ENFORCES the writer prompt's anti-slop kill lists, which
  // were previously checked only by the (advisory) Phase 5 LLM auditor.
  const allText = fields.map((f) => f.text).join('\n')
  const lint = lintProseFields(fields)
  errors.push(...lint.errors)
  warnings.push(...lint.warnings)

  // ─── (4) Trivial self-contradiction heuristic (warning) ────────
  // Catches the most obvious cases — the full semantic check lives in
  // lib/sync-shape.js coherence guard on the sync path.
  const hkExclusive = /all\s+\d+\s+(?:ad\s+)?creatives?\s+target[^.]+?exclusively/i.test(allText)
  const hkOutside = /creatives?\s+distributed\s+outside/i.test(allText)
  if (hkExclusive && hkOutside) {
    warnings.push('Possible self-contradiction: text claims "all N creatives target X exclusively" AND "creatives distributed outside X" in the same review.')
  }

  // ─── Quality-auditor verdict gate ───────────────────────────────
  // The Phase-5 auditor (Claude Sonnet 4.6, run at polish time) persists a VETO
  // flag (audit_hard_fail) and score (trust_indicators.audit_score). The audit
  // is no longer advisory — a VETO or a clear-fail score blocks publish.
  if (review.audit_hard_fail === true) {
    errors.push(
      `quality audit VETO — ${review.audit_hard_fail_reason || 'a hard-fail check failed (fabricated source, unverified claim, missing disclosure, fake freshness/reviews, or commodity content)'}. Fix and re-run Polish.`
    )
  }
  const auditScore = Number(review?.trust_indicators?.audit_score)
  if (Number.isFinite(auditScore) && auditScore < 60) {
    errors.push(`quality audit score ${auditScore}/100 is below the YMYL publish floor (60). Address the auditor's critical fixes and re-run Polish.`)
  } else if (Number.isFinite(auditScore) && auditScore < 80) {
    warnings.push(`quality audit score ${auditScore}/100 is below the target (80) — review the auditor's findings before publishing.`)
  }

  // AI disclosure presence (canon Step 6.8 — MANDATORY; audit 2026-07-05
  // W4c). Warning until the Replit renderer ships the "How this was
  // created" block, then upgrade to a blocking error.
  if (!review.ai_disclosure) {
    warnings.push('ai_disclosure is missing (canon seo-blog-generator Step 6.8 marks it mandatory) — regenerate to attach it. This becomes a blocking error once the live renderer displays the block.')
  }

  if (!Number.isFinite(auditScore)) {
    // Audit 2026-07-05 (R5): an ABSENT audit used to sail through this gate
    // — the polish route sets audit_score:null when the auditor call errors,
    // and NaN < 60 is false. An errored/skipped audit is a failed audit,
    // never a pass. Publishing requires a current verdict on record.
    errors.push('no quality audit on record (trust_indicators.audit_score is missing) — re-run Polish so the auditor produces a verdict before publishing.')
  }

  // ─── Real ad-evidence presence (don't silently ship evidence-less) ──
  // Celebrity-impersonation reviews should embed the real scraped ad creatives
  // (the SpyOwl screenshots) as first-party evidence. The generate route embeds
  // them when the SpyOwl fetch succeeds, but that fetch can fail silently
  // (expired cookie / SpyOwl down) and ship a review with NO evidence images.
  // Surface that as a warning so it's caught, not missed. (Warning, not block,
  // because SpyOwl is an external dependency and shouldn't be able to wedge
  // publishing.)
  const itemListItems = Array.isArray(review.item_list?.items) ? review.item_list.items : []
  const isCelebrityCase = Number(review.item_list?.numberOfItems) > 0 || itemListItems.length > 0
  const embeddedEvidence = (String(review.full_article || '').match(/\/creative-images\//g) || []).length
  if (isCelebrityCase && embeddedEvidence === 0) {
    warnings.push('No scraped ad-creative evidence embedded — this is a celebrity-impersonation review but full_article has 0 SpyOwl creative images. Refresh the SpyOwl cookie in Settings and re-embed (regenerate or "Embed Ad Evidence") so the real evidence ships on the live review.')
  }

  return { errors, warnings, issues }
}

/**
 * POST /api/admin/reviews/[id]/publish
 * Publish or unpublish a review
 * Body: { action: "publish" | "unpublish" }
 *
 * On publish: also syncs the review to the live site (Replit) via webhook
 */
export async function POST(request, { params }) {
  try {
    verifyAdmin(request)

    const { id } = await params
    const { action, override } = await request.json()

    if (!action || !['publish', 'unpublish'].includes(action)) {
      return Response.json(
        { error: 'Invalid action. Must be "publish" or "unpublish"' },
        { status: 400 }
      )
    }

    // Operator escape hatch (parity with the content publish route): an
    // explicit override ships past the integrity gate rather than dead-ending
    // on a flaky auditor / "re-run Polish" loop. Loud, not silent — the
    // bypassed reasons are recorded on the row (audit_hard_fail_reason keeps
    // its meaning; we stamp a published_override marker).
    const overrideGate = action === 'publish' && override === true
    let overrideRecord = null

    // Prepare update payload
    const updates = {}

    if (action === 'publish') {
      updates.status = 'published'
      updates.published_at = new Date().toISOString()
    } else {
      updates.status = 'draft'
      updates.published_at = null
    }

    updates.updated_at = new Date().toISOString()

    // Fetch the review for revalidation and sync
    const reviewData = await supaFetch(`/reviews?id=eq.${id}&select=*`)
    const review = Array.isArray(reviewData) ? reviewData[0] : null
    const reviewSlug = review?.slug

    // ─── INTEGRITY GATE (publish action only) ────────────────────
    // Block publish on unresolved placeholders or unverifiable citations.
    // Unpublish bypasses — we want an emergency unpublish to always work.
    if (action === 'publish' && review) {
      const gate = await validateReviewReadyToPublish(review)
      if (gate.errors.length > 0 && !overrideGate) {
        return Response.json(
          {
            error: 'Review failed publish-time integrity gate',
            reason: 'Fix the issues below and retry publish. This gate exists to keep fabricated sources and unresolved visual placeholders off the live site.',
            errors: gate.errors,
            warnings: gate.warnings,
            issues: gate.issues || [],
            // Every gate block is overridable — the operator is never trapped.
            // The UI re-POSTs { action:'publish', override:true } after showing
            // these reasons.
            overridable: true,
            review_id: id,
          },
          { status: 422 }
        )
      }
      if (gate.errors.length > 0 && overrideGate) {
        console.warn(`[publish] review ${id} published via OVERRIDE, bypassing:`, JSON.stringify(gate.errors))
        overrideRecord = {
          at: new Date().toISOString(),
          bypassed_reasons: gate.errors,
          bypassed_warnings: gate.warnings || [],
        }
        updates.fact_check_status = 'ai_generated_with_warnings'
      }
      if (gate.warnings.length > 0) {
        // Warnings don't block. They ride along in the success response
        // so the admin UI can surface them after publish completes.
        console.warn(
          `[publish] review ${id} passed gate with ${gate.warnings.length} warning(s):`,
          gate.warnings
        )
        updates.fact_check_status = 'ai_generated_with_warnings'
      }

      // ─── Deterministic schema validator (audit 2026-07-05, R4b) ────
      // validate-publish holds the 8 Floventra-class checks (placeholder
      // leak, celeb-count drift, citation self-contradiction, blocked
      // grounding URLs, Dataset distribution, …) but was previously
      // called by NOTHING. Self-fetch it here; its 422 failures block.
      // A transport failure of the validator itself only warns — the
      // primary gate above already ran.
      try {
        const origin = new URL(request.url).origin
        const vRes = await fetch(`${origin}/api/admin/reviews/validate-publish`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: request.headers.get('authorization') || '',
          },
          body: JSON.stringify({ reviewId: id }),
          signal: AbortSignal.timeout(30000),
        })
        const vData = await vRes.json().catch(() => null)
        if (vRes.status === 422 && vData && Array.isArray(vData.failures)) {
          if (!overrideGate) {
            return Response.json(
              {
                error: 'Review failed schema/content validation (validate-publish)',
                failures: vData.failures,
                overridable: true,
                review_id: id,
              },
              { status: 422 }
            )
          }
          console.warn(`[publish] review ${id} OVERRIDE bypassing validate-publish failures:`, JSON.stringify(vData.failures))
          overrideRecord = {
            at: overrideRecord?.at || new Date().toISOString(),
            bypassed_reasons: [...(overrideRecord?.bypassed_reasons || []), ...vData.failures.map((f) => (typeof f === 'string' ? f : JSON.stringify(f)))],
            bypassed_warnings: overrideRecord?.bypassed_warnings || [],
          }
          updates.fact_check_status = 'ai_generated_with_warnings'
        }
        if (!vRes.ok && vRes.status !== 422) {
          console.warn(`[publish] validate-publish returned ${vRes.status} — continuing (primary gate already passed)`)
        }
      } catch (vErr) {
        console.warn('[publish] validate-publish unreachable (non-blocking):', vErr?.message)
      }
    }

    // Perform update
    await supaFetch(
      `/reviews?id=eq.${id}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(updates),
      }
    )

    // Visible update provenance (2026-07-08): seed the update log on FIRST
    // publish only (re-publishes after regeneration already got their
    // 'regenerated' entry from the generate route).
    if (action === 'publish' && review && !review.published_at) {
      const newHistory = await appendUpdateHistory(id, makeEntry('published', 'Investigation published'))
      // Fold into `updates` so the sync below ({ ...review, ...updates })
      // ships the seeded log to Replit in this same request.
      if (newHistory) updates.update_history = newHistory
    }

    // Durable trail for an override publish — never a silent gate bypass.
    if (action === 'publish' && overrideRecord) {
      const note = `Published via OVERRIDE — bypassed: ${overrideRecord.bypassed_reasons.slice(0, 6).join(' | ')}`
      const newHistory = await appendUpdateHistory(id, makeEntry('published_override', note))
      if (newHistory) updates.update_history = newHistory
    }

    // Also mirror the publish state onto the linked scam_brand row.
    // The Replit live-site sync runs a two-phase job: Phase A walks
    // scam_brands and stamps each matching review's status from
    // brand.review_status. If we only flip reviews.status here, Phase A
    // will fight us on every cron tick and eventually win. Setting
    // scam_brands.review_status in the same moment makes both phases
    // agree. See the 2026-04-20 incident notes.
    if (review?.brand_id) {
      try {
        await supaFetch(
          `/scam_brands?id=eq.${review.brand_id}`,
          {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              review_status: action === 'publish' ? 'published' : 'pending',
              updated_at: new Date().toISOString(),
            }),
          },
        )
      } catch (brandUpdateErr) {
        // Non-fatal — the review itself is already flipped. Log and move on.
        console.error('[publish] scam_brands.review_status mirror failed:', brandUpdateErr.message)
      }
    }

    // Revalidate cached pages so changes appear immediately
    try {
      if (reviewSlug) revalidatePath(`/review/${reviewSlug}`)
      revalidatePath('/')
      revalidatePath('/scams')
    } catch (revalError) {
      console.warn('Revalidation error (non-fatal):', revalError.message)
    }

    // ─── SYNC TO LIVE SITE (publish + unpublish) via durable outbox ───
    // Supabase status flip already happened. Enqueue + best-effort immediate
    // delivery; cron /api/cron/publish-outbox retries failures. Publish is
    // no longer fail-closed on Replit downtime — DB success stands, sync
    // is eventually consistent.
    let syncStatus = null
    let outboxJob = null
    if (action === 'publish' || action === 'unpublish') {
      try {
        outboxJob = await enqueuePublishOutbox({
          kind: 'review',
          entityId: id,
          slug: reviewSlug || review?.slug || null,
          action,
        })
        syncStatus = await tryImmediateOutboxDelivery(outboxJob)
      } catch (syncErr) {
        syncStatus = { success: false, error: syncErr.message }
        console.error('[publish] Live sync/outbox error:', syncErr.message)
      }
    }

    const syncOk = syncStatus?.success === true
    const syncPending = !syncOk && !!outboxJob?.id
    const liveSyncFailed = action === 'publish' && !syncOk
    if (liveSyncFailed) {
      try {
        await supaFetch(`/reviews?id=eq.${id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            generation_notes: `${String(review?.generation_notes || '').slice(0, 1500)}${review?.generation_notes ? '\n\n' : ''}LIVE SYNC ${syncPending ? 'PENDING' : 'FAILED'} at publish (${new Date().toISOString()}): ${String(syncStatus?.error || 'unconfirmed integrity').slice(0, 300)} — Supabase says published; outbox will retry. Use the Sync button to force a retry.`,
          }),
        })
      } catch (markErr) {
        console.error('[publish] failed to persist live_sync marker:', markErr.message)
      }
    }

    return Response.json({
      // DB flip succeeded. Live sync may still be pending in the outbox.
      success: true,
      id,
      action,
      status: updates.status,
      published_at: updates.published_at,
      sync_ok: syncOk,
      sync_pending: syncPending,
      outbox_id: outboxJob?.id || null,
      live_sync: syncStatus,
      ...(action === 'publish' && syncStatus === null
        ? { warnings_sync: 'Live sync SKIPPED — outbox enqueue failed or env missing.' }
        : {}),
      ...(liveSyncFailed
        ? {
            sync_error: `Published in Supabase but LIVE SYNC ${syncPending ? 'PENDING' : 'FAILED'}: ${syncStatus?.error || 'integrity unconfirmed'}. Worker will retry; or use Sync button.`,
          }
        : {}),
      ...(action === 'publish' && updates.fact_check_status === 'ai_generated_with_warnings'
        ? { warnings: 'Review published with non-blocking warnings (plural agreement, coherence heuristics). See server logs.' }
        : {}),
      overridden: !!overrideRecord,
      override: overrideRecord,
    })
  } catch (error) {
    if (String(error?.message || '').includes('Unauthorized')) {
      return unauthorizedResponse()
    }
    return Response.json(
      { error: error.message },
      { status: 500 }
    )
  }
}
