const { test } = require('node:test')
const assert = require('node:assert/strict')
const { MODELS } = require('../lib/ai-models')

test('MODELS includes gpt-5.4 OpenAI flagship pin', () => {
  assert.ok(MODELS['gpt-5.4'])
  assert.equal(MODELS['gpt-5.4'].provider, 'openai')
  assert.equal(MODELS['gpt-5.4'].model, 'gpt-5.4')
  assert.ok(MODELS['gpt-5.4'].maxTokens >= 8192)
})
