// Verifies the vendored methodology has not drifted. Two checks:
//   1. Vendored tree matches its own committed manifest.json (always).
//   2. If the source skill is present, vendored tree matches source (dev only).
// Exit 1 on any drift. In CI (~/.claude absent) only check 1 runs.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { computeManifest, diffManifests } = require('../lib/topical-map/methodology-manifest.js')

const DEST = path.join(process.cwd(), 'lib', 'topical-map', 'methodology')
const committed = JSON.parse(fs.readFileSync(path.join(DEST, 'manifest.json'), 'utf8'))
const actual = computeManifest(DEST)
const selfDiff = diffManifests(committed, actual)
if (selfDiff.added.length || selfDiff.removed.length || selfDiff.changed.length) {
  console.error('Vendored methodology does not match manifest.json:', JSON.stringify(selfDiff, null, 2))
  process.exit(1)
}

const SRC = path.join(os.homedir(), '.claude', 'skills', 'topical-map-creation')
if (!fs.existsSync(SRC)) {
  console.log('Source skill not present (CI or non-dev machine); manifest self-check passed.')
  process.exit(0)
}

const srcManifest = {}
for (const rel of Object.keys(committed)) {
  const from = path.join(SRC, rel)
  if (!fs.existsSync(from)) { srcManifest[rel] = '__MISSING_IN_SOURCE__'; continue }
  const crypto = await import('node:crypto')
  srcManifest[rel] = crypto.createHash('sha256').update(fs.readFileSync(from)).digest('hex')
}
const srcDiff = diffManifests(committed, srcManifest)
if (srcDiff.changed.length || srcDiff.removed.length) {
  console.error('Vendored methodology has DRIFTED from the source skill. Re-run `npm run methodology:sync` and review:', JSON.stringify(srcDiff, null, 2))
  process.exit(1)
}
console.log('Vendored methodology matches source skill.')
