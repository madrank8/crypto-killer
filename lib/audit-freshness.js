import { createHash } from 'crypto'

/**
 * Audit freshness stamping and verification.
 *
 * The quality auditor's verdict lives in `content.ai_audit` and the publish gate
 * blocks on it. Historically that verdict carried no evidence of WHICH version of
 * the article it judged, so an editor could fix every cited problem and still be
 * blocked forever by a verdict describing text that no longer exists. The only
 * escape was the override, which defeats the gate entirely.
 *
 * The fix is to stamp the verdict with the hash of the exact fields the auditor
 * read. If the article later changes, the hash no longer matches and the verdict
 * is provably stale: the gate says "re-audit" instead of repeating dead findings.
 *
 * The hash covers ONLY the auditor's inputs. Editing a field the auditor never
 * sees (say `hero_image_credit`) must not invalidate a valid verdict.
 *
 * One auditor input is deliberately excluded: `author_bio`, which lives inside
 * `ai_audit` itself and so cannot be hashed into `ai_audit.content_hash` without
 * a fixed point. Editing the bio therefore does not mark the verdict stale.
 */

/**
 * Fields the auditor reads, in the shape `qualityAuditorPrompt().userTemplate`
 * receives them. Keep this in lockstep with the `reviewContent` objects built in
 * `app/api/admin/content/fill/route.js` and
 * `app/api/admin/content/[id]/audit/route.js`. Adding an input to the auditor
 * without adding it here means content drift the freshness check cannot see.
 */
const AUDITED_FIELDS = [
  'headline',
  'title',
  'meta_description',
  'summary',
  'sections',
  'faq',
  'full_article',
  'internal_links',
  'item_reviewed',
  'not_for_you',
  'information_gain_summary',
  'verify_tags_count',
  'claims',
  'sources',
  'schema_json',
]

/**
 * JSON.stringify with keys sorted at every level, so two logically identical
 * objects hash identically regardless of key insertion order. Supabase does not
 * guarantee JSONB key order across reads, and an unstable hash would report
 * spurious staleness.
 */
function canonicalize(value) {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * @param {object} row - a `content` row (or the auditor's `reviewContent` object)
 * @returns {string} sha256 hex of the auditor-visible projection of `row`
 */
export function computeAuditHash(row) {
  const projection = {}
  for (const field of AUDITED_FIELDS) {
    projection[field] = row?.[field] ?? null
  }
  return createHash('sha256').update(canonicalize(projection), 'utf8').digest('hex')
}

/**
 * Attach freshness provenance to a verdict before it is persisted.
 *
 * @param {object} audit - the verdict object about to be written to `ai_audit`
 * @param {object} row - the content the auditor judged
 * @returns {object} a new audit object carrying `audited_at` and `content_hash`
 */
export function stampAudit(audit, row) {
  return {
    ...(audit && typeof audit === 'object' ? audit : {}),
    audited_at: new Date().toISOString(),
    content_hash: computeAuditHash(row),
  }
}

/**
 * @param {object} row - a `content` row including `ai_audit`
 * @returns {{ state: 'fresh' | 'stale' | 'unverifiable', audited_at: string|null, expected_hash: string|null, actual_hash: string }}
 *
 * `unverifiable` means the verdict predates stamping (no `content_hash`). Those
 * verdicts stay enforced — silently trusting an unprovable audit would open a
 * hole every legacy row could walk through — but callers should tell the operator
 * a re-audit will confirm or clear the finding.
 */
export function auditFreshness(row) {
  const audit = row?.ai_audit
  const expected = typeof audit?.content_hash === 'string' ? audit.content_hash : null
  const actual = computeAuditHash(row)
  const auditedAt = typeof audit?.audited_at === 'string' ? audit.audited_at : null

  let state
  if (!expected) state = 'unverifiable'
  else if (expected === actual) state = 'fresh'
  else state = 'stale'

  return { state, audited_at: auditedAt, expected_hash: expected, actual_hash: actual }
}
