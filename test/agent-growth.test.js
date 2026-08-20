'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

// Pure helpers mirrored from lib/work-plan.js + lib/advisor-actions.js +
// lib/agent-chat.js (ESM). Keep in sync when changing skip / allowlist / tool parse.

function shouldSkipMaterialize(status) {
  return status === 'done' || status === 'dismissed' || status === 'running'
}

function normalizeSlug(target) {
  if (!target) return null
  const clean = String(target).trim().replace(/^https?:\/\/[^/]+/, '')
  const parts = clean.split('/').filter(Boolean)
  return (parts[parts.length - 1] || '').toLowerCase() || null
}

function canAutopublish(env, slug) {
  if (env.AGENT_AUTOPUBLISH !== '1') return false
  const raw = env.AGENT_AUTOPUBLISH_ALLOWLIST || ''
  if (!raw.trim()) return false
  const set = new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  )
  return set.has(String(slug || '').toLowerCase())
}

function runnerDisabled(env) {
  return env.AGENT_RUNNER === '0'
}

function autodraftDisabled(env) {
  return env.AGENT_AUTODRAFT === '0' || env.AGENT_RUNNER === '0'
}

function parseToolsFromMessage(message) {
  const tools = []
  const re = /\[\[tool:(\w+)\s+([^\]]+)\]\]/g
  let m
  while ((m = re.exec(message))) {
    const name = m[1]
    const args = {}
    for (const part of m[2].trim().split(/\s+/)) {
      const [k, ...rest] = part.split('=')
      if (k && rest.length) args[k] = rest.join('=')
    }
    tools.push({ name, args })
  }
  return tools
}

function prioritySort(items) {
  const RANK = { P0: 0, P1: 1, P2: 2 }
  return [...items].sort((a, b) => {
    const pr = (RANK[a.priority] ?? 9) - (RANK[b.priority] ?? 9)
    if (pr !== 0) return pr
    return new Date(b.created_at) - new Date(a.created_at)
  })
}

/** Mirror lib/agent-chat.js bulk insert shape (PostgREST PGRST102). */
function chatMessageBulkRows(threadId, userText, assistantReply, citations) {
  return [
    {
      thread_id: threadId,
      role: 'user',
      content: userText,
      citations_json: null,
    },
    {
      thread_id: threadId,
      role: 'assistant',
      content: assistantReply,
      citations_json: citations,
    },
  ]
}

function sameKeys(rows) {
  if (!rows.length) return true
  const keys = Object.keys(rows[0]).sort().join(',')
  return rows.every((r) => Object.keys(r).sort().join(',') === keys)
}

test('materialize skips done/dismissed/running fingerprints', () => {
  assert.equal(shouldSkipMaterialize('queued'), false)
  assert.equal(shouldSkipMaterialize('blocked'), false)
  assert.equal(shouldSkipMaterialize('done'), true)
  assert.equal(shouldSkipMaterialize('dismissed'), true)
  assert.equal(shouldSkipMaterialize('running'), true)
})

test('normalizeSlug strips host and path prefixes', () => {
  assert.equal(normalizeSlug('legacy-bitfundex'), 'legacy-bitfundex')
  assert.equal(normalizeSlug('https://cryptokiller.org/review/legacy-bitfundex'), 'legacy-bitfundex')
  assert.equal(normalizeSlug('/blog/fake-crypto-website'), 'fake-crypto-website')
  assert.equal(normalizeSlug(null), null)
})

test('canAutopublish requires flag + allowlist hit', () => {
  assert.equal(canAutopublish({}, 'foo'), false)
  assert.equal(canAutopublish({ AGENT_AUTOPUBLISH: '1' }, 'foo'), false)
  assert.equal(
    canAutopublish({ AGENT_AUTOPUBLISH: '1', AGENT_AUTOPUBLISH_ALLOWLIST: 'foo,bar' }, 'foo'),
    true
  )
  assert.equal(
    canAutopublish({ AGENT_AUTOPUBLISH: '1', AGENT_AUTOPUBLISH_ALLOWLIST: 'foo,bar' }, 'baz'),
    false
  )
  assert.equal(
    canAutopublish({ AGENT_AUTOPUBLISH: '0', AGENT_AUTOPUBLISH_ALLOWLIST: 'foo' }, 'foo'),
    false
  )
})

test('AGENT_RUNNER=0 disables runner', () => {
  assert.equal(runnerDisabled({ AGENT_RUNNER: '0' }), true)
  assert.equal(runnerDisabled({}), false)
  assert.equal(runnerDisabled({ AGENT_RUNNER: '1' }), false)
})

test('AGENT_AUTODRAFT=0 or AGENT_RUNNER=0 disables map autodraft', () => {
  assert.equal(autodraftDisabled({}), false)
  assert.equal(autodraftDisabled({ AGENT_AUTODRAFT: '0' }), true)
  assert.equal(autodraftDisabled({ AGENT_RUNNER: '0' }), true)
})

test('parseToolsFromMessage extracts allowlisted tool tags', () => {
  const tools = parseToolsFromMessage(
    'Check [[tool:lookup_brand slug=affitto-casa]] and [[tool:lookup_gsc query=crypto+scam days=14]]'
  )
  assert.equal(tools.length, 2)
  assert.deepEqual(tools[0], { name: 'lookup_brand', args: { slug: 'affitto-casa' } })
  assert.equal(tools[1].name, 'lookup_gsc')
  assert.equal(tools[1].args.query, 'crypto+scam')
  assert.equal(tools[1].args.days, '14')
})

test('prioritySort puts P0 before P1/P2', () => {
  const sorted = prioritySort([
    { priority: 'P2', created_at: '2026-08-01T12:00:00Z', title: 'c' },
    { priority: 'P0', created_at: '2026-08-01T10:00:00Z', title: 'a' },
    { priority: 'P1', created_at: '2026-08-01T11:00:00Z', title: 'b' },
  ])
  assert.deepEqual(
    sorted.map((x) => x.title),
    ['a', 'b', 'c']
  )
})

test('chat message bulk rows share keys (avoids PostgREST PGRST102)', () => {
  const rows = chatMessageBulkRows('tid', 'hi', 'hello', { tools: [] })
  assert.equal(sameKeys(rows), true)
  assert.equal(rows[0].citations_json, null)
  assert.deepEqual(rows[1].citations_json, { tools: [] })
})
