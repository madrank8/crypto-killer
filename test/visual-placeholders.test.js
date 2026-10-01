const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  reviveFailedVisualPlaceholders,
  stripFailedVisualPlaceholders,
  unwrapVisualPending,
  hasUnrenderedVisuals,
  sanitizeVisualHtml,
} = require('../lib/visual-placeholders')

const FAILED_IMAGE = `<div class="visual-pending"><figure class="ck-visual ck-visual--placeholder" style="margin:2rem 0;text-align:center;padding:2rem;background:rgba(99,102,241,0.08);border:2px dashed rgba(99,102,241,0.3);border-radius:12px;">
  <div style="font-size:2rem;margin-bottom:0.5rem;">🖼️</div>
  <p style="color:#94a3b8;font-size:0.9rem;margin:0;">Side-by-side comparison of a fabricated AI bot dashboard (animated balance counter, hard-coded 90%+ win rate badge, fictional ticker) versus a regulated exchange's verifiable order history</p>
</figure></div>`

const REAL_FIGURE = `<div class="visual-pending"><figure class="ck-visual ck-visual--diagram" style="margin:2rem 0;text-align:center;">
  <img src="https://example.com/diagram.png" alt="Fund flow" />
</figure></div>`

test('revive converts dashed fallback figures back into [TYPE NEEDED] markers so retry can see them', () => {
  const revived = reviveFailedVisualPlaceholders(FAILED_IMAGE)
  assert.match(revived, /\[IMAGE NEEDED: Side-by-side comparison of a fabricated AI bot dashboard/)
  assert.doesNotMatch(revived, /ck-visual--placeholder/)
})

test('revive maps chart/diagram emoji back to the original type', () => {
  const chart = FAILED_IMAGE.replace('🖼️', '📊').replace('ck-visual--placeholder', 'ck-visual ck-visual--placeholder')
  assert.match(reviveFailedVisualPlaceholders(chart), /\[CHART NEEDED:/)
  const diagram = FAILED_IMAGE.replace('🖼️', '🔀')
  assert.match(reviveFailedVisualPlaceholders(diagram), /\[DIAGRAM NEEDED:/)
})

test('strip removes dashed fallback figures instead of leaving a grey box on the page', () => {
  const html = `<p>Before.</p>${FAILED_IMAGE}<p>After.</p>`
  const stripped = stripFailedVisualPlaceholders(html)
  assert.doesNotMatch(stripped, /ck-visual--placeholder/)
  assert.doesNotMatch(stripped, /Side-by-side comparison/)
  assert.match(stripped, /Before/)
  assert.match(stripped, /After/)
})

test('unwrapVisualPending keeps real figures and drops empty wrappers', () => {
  const unwrapped = unwrapVisualPending(REAL_FIGURE)
  assert.match(unwrapped, /ck-visual--diagram/)
  assert.doesNotMatch(unwrapped, /visual-pending/)
  assert.equal(unwrapVisualPending('<div class="visual-pending">   </div>'), '')
})

test('hasUnrenderedVisuals catches dashed fallback cards the old publish gate missed', () => {
  assert.equal(hasUnrenderedVisuals(FAILED_IMAGE), true)
  assert.equal(hasUnrenderedVisuals('<p>[IMAGE NEEDED: a chart]</p>'), true)
  assert.equal(hasUnrenderedVisuals('<figure class="placeholder-box">x</figure>'), true)
  assert.equal(hasUnrenderedVisuals(REAL_FIGURE), false)
})

test('sanitizeVisualHtml drops dashed fallbacks and pending wrappers but keeps real figures', () => {
  const html = `<p>Intro.</p>${FAILED_IMAGE}${REAL_FIGURE}<p>Outro.</p>`
  const cleaned = sanitizeVisualHtml(html)
  assert.doesNotMatch(cleaned, /ck-visual--placeholder/)
  assert.doesNotMatch(cleaned, /visual-pending/)
  assert.doesNotMatch(cleaned, /Side-by-side comparison/)
  assert.match(cleaned, /ck-visual--diagram/)
  assert.match(cleaned, /Intro/)
  assert.equal(hasUnrenderedVisuals(cleaned), false)
})
