const { test } = require('node:test')
const assert = require('node:assert/strict')
const { callQualityFixModel, QUALITY_FIX_MODELS } = require('../lib/quality-fix-model')

test('QUALITY_FIX_MODELS prefer gpt-5.4-mini then claude-sonnet', () => {
  assert.deepEqual(QUALITY_FIX_MODELS, ['gpt-5.4-mini', 'claude-sonnet'])
})

test('callQualityFixModel falls through when first model 403s', async () => {
  const calls = []
  const callModelFn = async (model) => {
    calls.push(model)
    if (model === 'gpt-5.4-mini') {
      throw new Error('OpenAI API error 403: model_not_found')
    }
    return { text: '{"patches":[]}', model }
  }
  const out = await callQualityFixModel(callModelFn, 'sys', 'user')
  assert.deepEqual(calls, ['gpt-5.4-mini', 'claude-sonnet'])
  assert.match(out.text, /patches/)
})
