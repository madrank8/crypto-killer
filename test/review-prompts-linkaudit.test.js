const { test } = require('node:test'); const assert = require('node:assert/strict')
const { qualityAuditorPrompt } = require('../lib/review-prompts')

// Guards the fix for the false "zero internal links" veto: the auditor must be
// told internal links live in internal_links[] (target_slug = real sibling),
// not only in prose anchors.
test('auditor LINK AUDIT counts real-slug internal_links, not just prose', () => {
  const { system } = qualityAuditorPrompt()
  assert.match(system, /internal_links\[\]/)
  assert.match(system, /target_slug/)
  assert.match(system, /Do NOT report "zero internal links"/i)
})
