const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const EXCLUDE = new Set(['VERSION', 'manifest.json', 'README.md'])

function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name)
    const rel = path.posix.join(base, name)
    const stat = fs.statSync(abs)
    if (stat.isDirectory()) {
      walk(abs, rel, out)
    } else if (!EXCLUDE.has(rel)) {
      out.push([rel, crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex')])
    }
  }
}

function computeManifest(dir) {
  const entries = []
  walk(dir, '', entries)
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return Object.fromEntries(entries)
}

function diffManifests(expected, actual) {
  const eKeys = new Set(Object.keys(expected))
  const aKeys = new Set(Object.keys(actual))
  const added = [...aKeys].filter((k) => !eKeys.has(k)).sort()
  const removed = [...eKeys].filter((k) => !aKeys.has(k)).sort()
  const changed = [...eKeys].filter((k) => aKeys.has(k) && expected[k] !== actual[k]).sort()
  return { added, removed, changed }
}

module.exports = { computeManifest, diffManifests }
