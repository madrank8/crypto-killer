'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

// Pure helpers mirrored from lib/publish-outbox.js + lib/research-ledger.js +
// lib/live-sync.js. Those modules are ESM (Next import path); node:test here
// is CJS and would pull supabase/live-sync deps on import. Keep the math in
// sync with the lib exports when changing backoff / TTL / integrity rules.

const OUTBOX_BACKOFF_MINUTES = [1, 2, 5, 15, 30, 60, 120, 360]

function nextAttemptAt(attempts, now = new Date()) {
  const idx = Math.max(0, Math.min(attempts - 1, OUTBOX_BACKOFF_MINUTES.length - 1))
  const mins = OUTBOX_BACKOFF_MINUTES[idx]
  return new Date(now.getTime() + mins * 60 * 1000).toISOString()
}

function isLedgerFresh(ledger, now = new Date()) {
  if (!ledger?.expires_at) return false
  const exp = Date.parse(ledger.expires_at)
  if (!Number.isFinite(exp)) return false
  return exp > now.getTime()
}

function hasUsableSources(ledger) {
  return Array.isArray(ledger?.sources) && ledger.sources.length > 0
}

function evaluateReviewSyncIntegrity(syncReview, syncResult) {
  const expectedLen = Number(syncReview.full_article_length ?? 0)
  const receivedLen = Number(syncResult?.full_article_length ?? -1)
  const lengthMatches = receivedLen === expectedLen
  const lengthOk = receivedLen < 0 || lengthMatches
  const expectedHash = String(syncReview.full_article_hash ?? '')
  const incomingHash = String(syncResult?.incoming_full_article_hash ?? '')
  const liveSyncOk = syncResult?.ok === true
  const hashConfirmedByLive = syncResult?.full_article_hash_matches === true
  const rescueIntegrity =
    expectedHash.length === 64 &&
    incomingHash === expectedHash &&
    lengthOk
  const integrityOk = hashConfirmedByLive || rescueIntegrity
  return { success: liveSyncOk && integrityOk }
}

test('nextAttemptAt uses escalating backoff', () => {
  const now = new Date('2026-07-30T12:00:00.000Z')
  assert.equal(nextAttemptAt(1, now), '2026-07-30T12:01:00.000Z')
  assert.equal(nextAttemptAt(2, now), '2026-07-30T12:02:00.000Z')
  assert.equal(nextAttemptAt(3, now), '2026-07-30T12:05:00.000Z')
  assert.equal(nextAttemptAt(8, now), '2026-07-30T18:00:00.000Z')
  assert.equal(nextAttemptAt(99, now), '2026-07-30T18:00:00.000Z')
})

test('isLedgerFresh respects expires_at', () => {
  const now = new Date('2026-07-30T12:00:00.000Z')
  assert.equal(isLedgerFresh({ expires_at: '2026-07-30T11:00:00.000Z' }, now), false)
  assert.equal(isLedgerFresh({ expires_at: '2026-07-31T12:00:00.000Z' }, now), true)
  assert.equal(isLedgerFresh({}, now), false)
})

test('hasUsableSources requires non-empty array', () => {
  assert.equal(hasUsableSources({ sources: [] }), false)
  assert.equal(hasUsableSources({ sources: [{ url: 'https://x.test' }] }), true)
  assert.equal(hasUsableSources(null), false)
})

test('evaluateReviewSyncIntegrity requires positive confirmation', () => {
  const hash = 'a'.repeat(64)
  assert.equal(
    evaluateReviewSyncIntegrity(
      { full_article_length: 100, full_article_hash: hash },
      { ok: true, full_article_hash_matches: true, full_article_length: 100 },
    ).success,
    true,
  )
  assert.equal(
    evaluateReviewSyncIntegrity(
      { full_article_length: 100, full_article_hash: hash },
      { ok: true, incoming_full_article_hash: hash, full_article_length: 100 },
    ).success,
    true,
  )
  assert.equal(
    evaluateReviewSyncIntegrity(
      { full_article_length: 100, full_article_hash: hash },
      { ok: true },
    ).success,
    false,
  )
  assert.equal(
    evaluateReviewSyncIntegrity(
      { full_article_length: 100, full_article_hash: hash },
      { ok: false, full_article_hash_matches: true },
    ).success,
    false,
  )
})
