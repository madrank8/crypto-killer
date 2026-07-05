/**
 * AI Advisor engine.
 *
 * Feeds the analytics snapshot (lib/advisor-data) to Claude Sonnet via the
 * existing multi-provider callModel(), validates the structured output,
 * resolves deep links against a server-side whitelist (model output is never
 * rendered as a raw href), and persists the report to advisor_reports.
 */

import { callModel, extractJSON } from './ai-models'
import { buildAdvisorSnapshot } from './advisor-data'
import { supabaseRequest } from './supabase'

const ADVISOR_MODEL = 'claude-sonnet'

/* ─── Deep-link whitelist: action_type → route builder ───
   The model only supplies action_type + target; WE build the href. */
const DEEP_LINKS = {
  new_review: (t) => `/admin/brands?q=${encodeURIComponent(t || '')}`,
  refresh_review: (t) => (t ? `/admin/reviews?q=${encodeURIComponent(t)}` : '/admin/reviews'),
  fix_ctr: (t) => (t ? `/admin/reviews?q=${encodeURIComponent(t)}` : '/admin/reviews'),
  translate: () => '/admin/reviews',
  new_content: () => '/admin/topical-map',
  scraper: () => '/admin/scraper',
  other: () => '/admin/analytics',
}

const SYSTEM_PROMPT = `You are the growth advisor for CryptoKiller (cryptokiller.org), an independent crypto-scam intelligence site (YMYL). You analyze a JSON analytics snapshot and produce a concise, brutally practical action report.

Rules:
- EVERY suggestion must cite specific numbers from the snapshot in its "why" (e.g. "487 impressions, 0.4% CTR, position 6.2"). Never invent data. If a section has an "error" field or is empty, skip it silently.
- Prioritize by expected traffic/authority impact per unit of effort.
- The single highest-value pattern: surging scam brands with NO review yet (opportunities.hot_brands_without_review) — reviews for actively-advertised scams capture search demand competitors miss. These are usually P0.
- Second: striking-distance queries (position 8-20) and CTR opportunities (high impressions, sub-1.5% CTR) — title/meta/content fixes on existing pages.
- Also watch: stale published reviews (freshness matters for YMYL rankings), translation coverage gaps vs traffic countries, publish-velocity drops, traffic anomalies.
- 4-8 suggestions max. Quality over quantity. No generic advice ("post more content") — every suggestion names a target.
- health_score: 0-100 holistic read of growth trajectory (data volume is early-stage; judge trajectory, not absolute size).

Output STRICT JSON, no prose outside it:
{
  "summary": "2-3 sentences, the executive read",
  "health_score": <0-100>,
  "insights": [
    { "title": "...", "detail": "... (cite numbers)", "trend": "up"|"down"|"flat", "severity": "info"|"warn"|"critical" }
  ],
  "suggestions": [
    {
      "title": "imperative, specific",
      "why": "reasoning citing snapshot numbers",
      "priority": "P0"|"P1"|"P2",
      "impact": "high"|"medium"|"low",
      "effort": "minutes"|"hours"|"days",
      "action_type": "new_review"|"refresh_review"|"fix_ctr"|"translate"|"new_content"|"scraper"|"other",
      "target": "brand slug / review slug / query string the action applies to"
    }
  ]
}`

function fingerprint(s) {
  return `${s.action_type}:${(s.target || s.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`
}

function validateReport(raw) {
  const report = {
    summary: typeof raw.summary === 'string' ? raw.summary.slice(0, 1000) : '',
    health_score: Math.min(100, Math.max(0, parseInt(raw.health_score, 10) || 0)),
    insights: [],
    suggestions: [],
  }
  for (const i of Array.isArray(raw.insights) ? raw.insights.slice(0, 10) : []) {
    if (!i || !i.title) continue
    report.insights.push({
      title: String(i.title).slice(0, 200),
      detail: String(i.detail || '').slice(0, 600),
      trend: ['up', 'down', 'flat'].includes(i.trend) ? i.trend : 'flat',
      severity: ['info', 'warn', 'critical'].includes(i.severity) ? i.severity : 'info',
    })
  }
  for (const s of Array.isArray(raw.suggestions) ? raw.suggestions.slice(0, 10) : []) {
    if (!s || !s.title) continue
    const action_type = DEEP_LINKS[s.action_type] ? s.action_type : 'other'
    const target = s.target ? String(s.target).slice(0, 120) : null
    const suggestion = {
      title: String(s.title).slice(0, 200),
      why: String(s.why || '').slice(0, 800),
      priority: ['P0', 'P1', 'P2'].includes(s.priority) ? s.priority : 'P2',
      impact: ['high', 'medium', 'low'].includes(s.impact) ? s.impact : 'medium',
      effort: ['minutes', 'hours', 'days'].includes(s.effort) ? s.effort : 'hours',
      action_type,
      target,
      deep_link: DEEP_LINKS[action_type](target), // server-built, never model HTML
    }
    suggestion.fingerprint = fingerprint(suggestion)
    report.suggestions.push(suggestion)
  }
  return report
}

/**
 * Run a full advisor analysis and persist the report.
 * @param {object} opts - { trigger: 'manual'|'cron', days }
 * @returns {object} the stored report row (id, report, ...)
 */
export async function runAdvisor({ trigger = 'manual', days = 28 } = {}) {
  const snapshot = await buildAdvisorSnapshot(days)

  let row
  try {
    const res = await callModel(
      ADVISOR_MODEL,
      SYSTEM_PROMPT,
      `Analytics snapshot:\n\`\`\`json\n${JSON.stringify(snapshot)}\n\`\`\`\nProduce the report JSON.`,
      { maxTokens: 4000, effort: 'medium' }
    )
    const report = validateReport(extractJSON(res.text))

    row = {
      trigger_type: trigger,
      period_days: days,
      model: res.resolvedModel || ADVISOR_MODEL,
      status: 'complete',
      report,
      tokens_in: res.inputTokens || null,
      tokens_out: res.outputTokens || null,
    }
  } catch (err) {
    row = {
      trigger_type: trigger,
      period_days: days,
      model: ADVISOR_MODEL,
      status: 'error',
      error: String(err.message).slice(0, 500),
      report: null,
    }
  }

  const inserted = await supabaseRequest('/advisor_reports', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([row]),
  })
  const stored = Array.isArray(inserted) ? inserted[0] : inserted
  if (row.status === 'error') {
    const e = new Error(row.error)
    e.reportId = stored?.id
    throw e
  }
  return stored
}
