import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { callModel, getAvailableModels } from '@/lib/ai-models'

export async function GET(request) {
  const admin = verifyAdmin(request)
  if (!admin) return unauthorizedResponse()

  const available = getAvailableModels()
  const results = { available, tests: {} }

  // Test each provider with a minimal prompt
  const providers = [
    { key: 'gemini-flash', label: 'Gemini Flash' },
    { key: 'gpt-4o', label: 'GPT-4o' },
    { key: 'claude-haiku', label: 'Claude Haiku' },
  ]

  for (const p of providers) {
    try {
      const start = Date.now()
      const res = await callModel(p.key, 'Reply with exactly: OK', 'Test', { maxTokens: 10 })
      results.tests[p.key] = {
        status: 'ok',
        ms: Date.now() - start,
        text: res.text.slice(0, 50),
        model: res.model,
        provider: res.provider,
        usedFallback: res.usedFallback,
      }
    } catch (err) {
      results.tests[p.key] = {
        status: 'error',
        error: err.message,
      }
    }
  }

  return Response.json(results)
}
