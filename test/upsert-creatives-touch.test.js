'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

function latestUpsertCreativesSql() {
  const dir = path.join(__dirname, '../migrations')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  let found = null
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8')
    if (/CREATE OR REPLACE FUNCTION public\.upsert_creatives\s*\(/i.test(sql)) {
      found = { file: f, sql }
    }
  }
  return found
}

function conflictSetColumns(sql) {
  const match = sql.match(
    /ON CONFLICT \(id\) DO UPDATE SET([\s\S]*?)RETURNING/i,
  )
  assert.ok(match, 'upsert_creatives must have ON CONFLICT (id) DO UPDATE SET … RETURNING')
  return [...match[1].matchAll(/^\s*([a-z_]+)\s*=/gim)].map((m) => m[1])
}

test('latest upsert_creatives ON CONFLICT only touches last_seen, scrape_count, synced_at', () => {
  const latest = latestUpsertCreativesSql()
  assert.ok(latest, 'expected a migration that defines upsert_creatives')
  const cols = conflictSetColumns(latest.sql)
  assert.deepEqual(
    cols.sort(),
    ['last_seen_at', 'scrape_count', 'synced_at'].sort(),
    `${latest.file} ON CONFLICT SET must be touch-only, got: ${cols.join(', ')}`,
  )
})

test('latest upsert_creatives still inserts full creative rows', () => {
  const latest = latestUpsertCreativesSql()
  const insert = latest.sql.match(
    /INSERT INTO creatives \(([\s\S]*?)\)\s*SELECT/i,
  )
  assert.ok(insert, 'must INSERT into creatives')
  const cols = insert[1].split(',').map((c) => c.trim()).filter(Boolean)
  for (const required of ['offer_name', 'main_text', 'link_url', 'geo', 'last_seen_at']) {
    assert.ok(cols.includes(required), `INSERT must include ${required}`)
  }
})
