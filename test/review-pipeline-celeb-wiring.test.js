const { test } = require('node:test'); const assert = require('node:assert/strict')
const fs = require('node:fs'); const path = require('node:path')

// Regression guard: the celebrity hard constraint (blocks.celeb) must reach the
// agents that write experience_signals (trustPrompts) and faq (faqPrompts).
// It was previously only wired into headline/core, so those two agents invented
// geo-plausible celebrities (Pauline Hanson, Sudha Murthy) with no roster to
// check against.
const src = fs.readFileSync(path.join(__dirname, '../lib/review-pipeline.js'), 'utf8')

function functionBody(name) {
  const start = src.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} not found`)
  // up to the next top-level "function " declaration
  const next = src.indexOf('\nfunction ', start + 1)
  return src.slice(start, next === -1 ? undefined : next)
}

for (const fn of ['trustPrompts', 'faqPrompts', 'skeletonPrompts', 'corePrompts']) {
  test(`${fn} injects the celebrity hard constraint (blocks.celeb)`, () => {
    assert.match(functionBody(fn), /\$\{blocks\.celeb\}/, `${fn} must include blocks.celeb`)
  })
}
