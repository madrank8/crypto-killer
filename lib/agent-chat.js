/**
 * Admin AI chat grounded on Advisor snapshot + allowlisted lookups.
 * Read/recommend only — never publishes or mutates content bodies.
 */

import { callModel, extractJSON } from './ai-models'
import { buildAdvisorSnapshot } from './advisor-data'
import { supabaseRequest } from './supabase'
import { listWorkPlan } from './work-plan'

const CHAT_MODEL = 'claude-sonnet'
const MAX_HISTORY = 20
const MAX_MESSAGE_CHARS = 2000

const SYSTEM_PROMPT = `You are CryptoKiller's internal growth analyst (admin-only). You answer operator questions using ONLY the JSON context pack and tool results provided in the user message.

Rules:
- Cite specific numbers from the data (impressions, CTR, velocity, counts). Never invent metrics, brands, or URLs.
- If the answer is not in the data, say so clearly ("not in current snapshot").
- Be concise and practical. Prefer bullet points for multi-part answers.
- You may propose suggested_actions the operator can queue (not execute). action_type must be one of: new_review, refresh_review, fix_ctr, translate, new_content, scraper, other.
- Do NOT claim you published, scraped, or edited anything — you cannot.

After reasoning, end with STRICT JSON (no markdown fences) on the last line block:
{"reply":"markdown-friendly answer text","suggested_actions":[{"title":"...","action_type":"new_review","target":"slug-or-query","priority":"P0|P1|P2","why":"..."}]}
suggested_actions may be [].`

async function lookupContent({ slug, id }) {
  if (id) {
    const rows = await supabaseRequest(
      `/content?id=eq.${encodeURIComponent(id)}&select=id,slug,title,status,meta_description,published_at,content_type,author_persona_id,ai_audit&limit=1`,
      { useServiceRole: true }
    )
    const c = rows?.[0]
    if (!c) return { error: 'content not found' }
    return summarizeContent(c)
  }
  if (!slug) return { error: 'slug or id required' }
  const [content, reviews] = await Promise.all([
    supabaseRequest(
      `/content?slug=eq.${encodeURIComponent(slug)}&select=id,slug,title,status,meta_description,published_at,content_type,author_persona_id,ai_audit&limit=1`,
      { useServiceRole: true }
    ),
    supabaseRequest(
      `/reviews?slug=eq.${encodeURIComponent(slug)}&select=id,slug,title,status,published_at,updated_at,target_keyword&limit=1`,
      { useServiceRole: true }
    ),
  ])
  if (content?.[0]) return { kind: 'content', ...summarizeContent(content[0]) }
  if (reviews?.[0]) {
    const r = reviews[0]
    return {
      kind: 'review',
      id: r.id,
      slug: r.slug,
      title: r.title,
      status: r.status,
      published_at: r.published_at,
      updated_at: r.updated_at,
      target_keyword: r.target_keyword,
    }
  }
  return { error: `no content or review with slug ${slug}` }
}

function summarizeContent(c) {
  const audit = c.ai_audit && typeof c.ai_audit === 'object' ? c.ai_audit : null
  return {
    kind: 'content',
    id: c.id,
    slug: c.slug,
    title: c.title,
    status: c.status,
    content_type: c.content_type,
    published_at: c.published_at,
    meta_description: c.meta_description ? String(c.meta_description).slice(0, 200) : null,
    author_persona_id: c.author_persona_id,
    audit_score: audit?.score ?? audit?.overall_score ?? null,
    audit_hard_fails: Array.isArray(audit?.hard_fails) ? audit.hard_fails.slice(0, 8) : null,
  }
}

async function lookupBrand({ slug, name }) {
  const q = slug
    ? `slug=eq.${encodeURIComponent(slug)}`
    : name
      ? `name=ilike.*${encodeURIComponent(String(name).slice(0, 80))}*`
      : null
  if (!q) return { error: 'slug or name required' }
  const brands = await supabaseRequest(
    `/scam_brands?${q}&select=id,slug,name,velocity_7d,velocity_trend,total_creatives,total_geos,scam_score,top_geo&limit=5`,
    { useServiceRole: true }
  )
  if (!brands?.length) return { error: 'brand not found' }
  const brand = brands[0]
  const reviews = await supabaseRequest(
    `/reviews?brand_id=eq.${brand.id}&select=id,slug,status&limit=5`,
    { useServiceRole: true }
  )
  return {
    brand: {
      slug: brand.slug,
      name: brand.name,
      velocity_7d: brand.velocity_7d,
      trend: brand.velocity_trend,
      creatives: brand.total_creatives,
      geos: brand.total_geos,
      scam_score: brand.scam_score,
      top_geo: brand.top_geo,
    },
    reviews: (reviews || []).map((r) => ({ slug: r.slug, status: r.status })),
    has_published_review: (reviews || []).some((r) => r.status === 'published'),
  }
}

async function lookupGsc({ query, url, days = 28 }) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  if (query) {
    const rows = await supabaseRequest(
      `/gsc_daily?dimension=eq.query&key=eq.${encodeURIComponent(query)}&date=gte.${since}&select=date,clicks,impressions,position&limit=500`,
      { useServiceRole: true }
    )
    return aggregateGsc(rows, { dimension: 'query', key: query })
  }
  if (url) {
    const rows = await supabaseRequest(
      `/gsc_daily?dimension=eq.page&key=eq.${encodeURIComponent(url)}&date=gte.${since}&select=date,clicks,impressions,position&limit=500`,
      { useServiceRole: true }
    )
    return aggregateGsc(rows, { dimension: 'page', key: url })
  }
  return { error: 'query or url required' }
}

function aggregateGsc(rows, meta) {
  let clicks = 0
  let impressions = 0
  let posSum = 0
  let posW = 0
  for (const r of rows || []) {
    clicks += r.clicks || 0
    impressions += r.impressions || 0
    posSum += (r.position || 0) * (r.impressions || 0)
    posW += r.impressions || 0
  }
  return {
    ...meta,
    days_rows: (rows || []).length,
    clicks,
    impressions,
    ctr: impressions ? +(clicks / impressions).toFixed(4) : 0,
    position: posW ? +(posSum / posW).toFixed(1) : null,
  }
}

export async function runLookups(tools = []) {
  const results = []
  for (const t of (tools || []).slice(0, 5)) {
    const name = t?.name
    const args = t?.args || {}
    try {
      if (name === 'lookup_content') results.push({ name, result: await lookupContent(args) })
      else if (name === 'lookup_brand') results.push({ name, result: await lookupBrand(args) })
      else if (name === 'lookup_gsc') results.push({ name, result: await lookupGsc(args) })
      else if (name === 'lookup_work_plan') {
        const items = await listWorkPlan({ status: args.status || null, limit: 20 })
        results.push({
          name,
          result: items.map((i) => ({
            fingerprint: i.fingerprint,
            action_type: i.action_type,
            target: i.target,
            title: i.title,
            priority: i.priority,
            status: i.status,
            last_error: i.last_error,
          })),
        })
      } else {
        results.push({ name, result: { error: `unknown tool ${name}` } })
      }
    } catch (e) {
      results.push({ name, result: { error: e.message } })
    }
  }
  return results
}

function parseToolsFromMessage(message) {
  const tools = []
  const re = /\[\[tool:(\w+)\s+([^\]]+)\]\]/g
  let m
  while ((m = re.exec(message))) {
    const name = m[1]
    const args = {}
    for (const part of m[2].trim().split(/\s+/)) {
      const [k, ...rest] = part.split('=')
      if (k && rest.length) args[k] = rest.join('=')
    }
    tools.push({ name, args })
  }
  return tools
}

function parseAssistantPayload(text) {
  try {
    const json = extractJSON(text)
    if (json && typeof json.reply === 'string') {
      return {
        reply: json.reply.slice(0, 8000),
        suggested_actions: Array.isArray(json.suggested_actions)
          ? json.suggested_actions.slice(0, 5).map((a) => ({
              title: String(a.title || '').slice(0, 200),
              action_type: a.action_type || 'other',
              target: a.target ? String(a.target).slice(0, 120) : null,
              priority: ['P0', 'P1', 'P2'].includes(a.priority) ? a.priority : 'P2',
              why: a.why ? String(a.why).slice(0, 400) : null,
            }))
          : [],
      }
    }
  } catch {
    /* fall through */
  }
  return { reply: String(text || '').slice(0, 8000), suggested_actions: [] }
}

async function loadThreadMessages(threadId) {
  return supabaseRequest(
    `/agent_chat_messages?thread_id=eq.${threadId}&select=role,content,created_at&order=created_at.asc&limit=50`,
    { useServiceRole: true }
  )
}

export async function runAgentChat({ threadId = null, message, days = 28 } = {}) {
  const text = String(message || '').trim().slice(0, MAX_MESSAGE_CHARS)
  if (!text) throw new Error('message required')

  let thread
  if (threadId) {
    const rows = await supabaseRequest(
      `/agent_chat_threads?id=eq.${encodeURIComponent(threadId)}&select=*&limit=1`,
      { useServiceRole: true }
    )
    thread = rows?.[0]
    if (!thread) throw Object.assign(new Error('thread not found'), { status: 404 })
  } else {
    const title = text.slice(0, 80)
    const inserted = await supabaseRequest('/agent_chat_threads', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{ title }]),
    })
    thread = Array.isArray(inserted) ? inserted[0] : inserted
  }

  const history = threadId ? await loadThreadMessages(thread.id) : []
  const tools = parseToolsFromMessage(text)
  if (/\b(work\s*plan|queue|blocked|enqueued)\b/i.test(text) && !tools.some((t) => t.name === 'lookup_work_plan')) {
    tools.push({ name: 'lookup_work_plan', args: {} })
  }
  const brandMatch = text.match(/\b(?:brand|review)\s+[\"']?([a-z0-9-]{3,60})[\"']?/i)
  if (brandMatch && !tools.some((t) => t.name === 'lookup_brand' || t.name === 'lookup_content')) {
    tools.push({ name: 'lookup_brand', args: { slug: brandMatch[1].toLowerCase() } })
    tools.push({ name: 'lookup_content', args: { slug: brandMatch[1].toLowerCase() } })
  }

  const [snapshot, latestReport, toolResults] = await Promise.all([
    buildAdvisorSnapshot(days),
    supabaseRequest(
      '/advisor_reports?status=eq.complete&select=id,created_at,report&order=created_at.desc&limit=1',
      { useServiceRole: true }
    ).then((r) => r?.[0] || null),
    runLookups(tools),
  ])

  const slimSnapshot = {
    generated_at: snapshot.generated_at,
    period_days: snapshot.period_days,
    traffic: snapshot.traffic?.summary
      ? { summary: snapshot.traffic.summary, top_pages: (snapshot.traffic.top_pages || []).slice(0, 5) }
      : snapshot.traffic,
    search: snapshot.search?.error
      ? snapshot.search
      : {
          totals: snapshot.search?.totals,
          ctr_opportunities: (snapshot.search?.ctr_opportunities || []).slice(0, 5),
          striking_distance: (snapshot.search?.striking_distance || []).slice(0, 5),
          top_queries: (snapshot.search?.top_queries || []).slice(0, 5),
        },
    content: snapshot.content,
    opportunities: {
      hot_brands_without_review: (snapshot.opportunities?.hot_brands_without_review || []).slice(0, 8),
    },
    scraper: {
      top_by_velocity: (snapshot.scraper?.top_by_velocity || []).slice(0, 8),
      trend_counts_in_top20: snapshot.scraper?.trend_counts_in_top20,
    },
    outcomes: snapshot.outcomes,
  }

  const histLines = (history || [])
    .slice(-MAX_HISTORY)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n')

  const userPrompt = [
    `Snapshot (as of ${slimSnapshot.generated_at}):\n\`\`\`json\n${JSON.stringify(slimSnapshot)}\n\`\`\``,
    latestReport?.report
      ? `Latest advisor report (${latestReport.created_at}):\n\`\`\`json\n${JSON.stringify({
          summary: latestReport.report.summary,
          health_score: latestReport.report.health_score,
          suggestions: (latestReport.report.suggestions || []).slice(0, 8),
        })}\n\`\`\``
      : 'No advisor report stored yet.',
    toolResults.length
      ? `Tool results:\n\`\`\`json\n${JSON.stringify(toolResults)}\n\`\`\``
      : 'No extra tool results.',
    histLines ? `Recent thread:\n${histLines}` : '',
    `Operator question:\n${text}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const res = await callModel(CHAT_MODEL, SYSTEM_PROMPT, userPrompt, {
    maxTokens: 2500,
    effort: 'low',
    timeoutMs: 90000,
  })
  const parsed = parseAssistantPayload(res.text)

  // PostgREST PGRST102: every object in a bulk insert must share the same keys.
  await supabaseRequest('/agent_chat_messages', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify([
      {
        thread_id: thread.id,
        role: 'user',
        content: text,
        citations_json: null,
      },
      {
        thread_id: thread.id,
        role: 'assistant',
        content: parsed.reply,
        citations_json: {
          snapshot_at: slimSnapshot.generated_at,
          tools: toolResults.map((t) => t.name),
          suggested_actions: parsed.suggested_actions,
        },
      },
    ]),
  })

  await supabaseRequest(`/agent_chat_threads?id=eq.${thread.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ updated_at: new Date().toISOString() }),
  })

  return {
    thread_id: thread.id,
    reply: parsed.reply,
    suggested_actions: parsed.suggested_actions,
    snapshot_at: slimSnapshot.generated_at,
    model: res.resolvedModel || CHAT_MODEL,
  }
}

export async function listThreads(limit = 30) {
  return supabaseRequest(
    `/agent_chat_threads?select=id,title,created_at,updated_at&order=updated_at.desc&limit=${Math.min(limit, 50)}`,
    { useServiceRole: true }
  )
}

export async function getThread(threadId) {
  const [thread, messages] = await Promise.all([
    supabaseRequest(`/agent_chat_threads?id=eq.${encodeURIComponent(threadId)}&select=*&limit=1`, {
      useServiceRole: true,
    }),
    supabaseRequest(
      `/agent_chat_messages?thread_id=eq.${encodeURIComponent(threadId)}&select=id,role,content,citations_json,created_at&order=created_at.asc&limit=100`,
      { useServiceRole: true }
    ),
  ])
  if (!thread?.[0]) return null
  return { thread: thread[0], messages: messages || [] }
}

export { lookupContent, lookupBrand, lookupGsc }
