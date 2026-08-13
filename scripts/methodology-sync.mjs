// Vendors the topical-map-creation skill into the repo. Run on a workstation
// that has ~/.claude/skills/topical-map-creation. Not run in CI.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { computeManifest } = require('../lib/topical-map/methodology-manifest.js')

const SRC = path.join(os.homedir(), '.claude', 'skills', 'topical-map-creation')
const DEST = path.join(process.cwd(), 'lib', 'topical-map', 'methodology')

// Only the files the Tool-Assisted / Tier 1-3 port needs (see spec section 4).
// Extended through v4.9: launch conditions, v4.1/v4.8 addenda, changelog.
const FILES = [
  'SKILL.md',
  'references/step-overview.md',
  'references/procedure-detailed.md',
  'references/procedure-addendum.md',
  'references/site-type-playbooks.md',
  'references/aio-risk-score.md',
  'references/dataforseo.md',
  'references/supplementary.md',
  'references/author-cluster-assignment.md',
  'references/launch-conditions.md',
  'references/v41-additions.md',
  'references/v48-additions.md',
  'references/changelog.md',
]
const VERSION = '4.9'

if (!fs.existsSync(SRC)) {
  console.error(`Source skill not found at ${SRC}. Run this on a workstation with the skill installed.`)
  process.exit(1)
}

fs.rmSync(DEST, { recursive: true, force: true })
for (const rel of FILES) {
  const from = path.join(SRC, rel)
  const to = path.join(DEST, rel)
  if (!fs.existsSync(from)) {
    console.error(`Expected methodology file missing in source: ${rel}`)
    process.exit(1)
  }
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
}

fs.writeFileSync(path.join(DEST, 'VERSION'), VERSION + '\n')
const manifest = computeManifest(DEST)
fs.writeFileSync(path.join(DEST, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

console.log(`Vendored ${FILES.length} files at methodology v${VERSION}. Manifest has ${Object.keys(manifest).length} entries.`)
