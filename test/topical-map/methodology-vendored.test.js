const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { computeManifest, diffManifests } = require('../../lib/topical-map/methodology-manifest')

const DIR = path.join(__dirname, '..', '..', 'lib', 'topical-map', 'methodology')

test('vendored methodology matches its committed manifest', () => {
  const committed = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'))
  const actual = computeManifest(DIR)
  assert.deepEqual(diffManifests(committed, actual), { added: [], removed: [], changed: [] })
})

test('vendored VERSION is 4.6', () => {
  assert.equal(fs.readFileSync(path.join(DIR, 'VERSION'), 'utf8').trim(), '4.6')
})
