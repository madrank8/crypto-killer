const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { computeManifest, diffManifests } = require('../../lib/topical-map/methodology-manifest')

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'meth-'))
}

test('computeManifest hashes files by posix relative path, sorted, excluding VERSION/manifest.json', () => {
  const d = tmpdir()
  fs.writeFileSync(path.join(d, 'SKILL.md'), 'hello')
  fs.mkdirSync(path.join(d, 'references'))
  fs.writeFileSync(path.join(d, 'references', 'a.md'), 'world')
  fs.writeFileSync(path.join(d, 'VERSION'), '4.6')
  fs.writeFileSync(path.join(d, 'manifest.json'), '{}')

  const m = computeManifest(d)
  assert.deepEqual(Object.keys(m), ['SKILL.md', 'references/a.md'])
  // sha256('hello')
  assert.equal(m['SKILL.md'], '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
})

test('computeManifest is stable regardless of file creation order', () => {
  const d1 = tmpdir(); const d2 = tmpdir()
  fs.writeFileSync(path.join(d1, 'b.md'), 'x'); fs.writeFileSync(path.join(d1, 'a.md'), 'y')
  fs.writeFileSync(path.join(d2, 'a.md'), 'y'); fs.writeFileSync(path.join(d2, 'b.md'), 'x')
  assert.deepEqual(computeManifest(d1), computeManifest(d2))
})

test('diffManifests reports added, removed, changed', () => {
  const expected = { 'a.md': 'h1', 'b.md': 'h2' }
  const actual = { 'a.md': 'h1', 'b.md': 'DIFFERENT', 'c.md': 'h3' }
  assert.deepEqual(diffManifests(expected, actual), {
    added: ['c.md'],
    removed: [],
    changed: ['b.md'],
  })
})

test('diffManifests on identical manifests is empty', () => {
  const m = { 'a.md': 'h1' }
  assert.deepEqual(diffManifests(m, { ...m }), { added: [], removed: [], changed: [] })
})
