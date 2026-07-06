/**
 * lib/topical-map/stages.js — Topical Map v2 staged pipeline engine.
 *
 * Canon: ai-brain topical-map-creation v4.3 (Koray). Replaces the
 * single-shot generator (audit findings G1-G9, plan doc
 * topical-map-v2-revision-plan.md).
 *
 * Each stage is one bounded invocation; run state lives in
 * topical_map_runs (config / artifacts / stage_log). Checkpoints pause the
 * run as 'awaiting_approval' — the dashboard approves to continue.
 *
 * HONESTY: no fabrication fallback. Metrics come from DataForSEO or the
 * node is labeled 'unverified' and demoted in priority. A failed stage
 * leaves the run resumable — never a silently fake map.
 *
 * supaFetch is dependency-injected by the API routes (lib/supabase.js is
 * ESM; this module is CJS like the rest of lib/).
 */

const { readFileSync } = require('fs')
const path = require('path')

const { callModel, extractJSON } = require('../ai-models')
const { computeTopicPriorityScore } = require('../content-prompts')
const { isKeywordDataAvailable, fetchKeywordOverview } = require('../keyword-data')
const {
  fetchKeywordSuggestions,
  fetchRelatedKeywords,
  fetchRankedKeywords,
  fetchSerpsBatch,
} = require('./dataforseo')
const { clusterBySerpOverlap, summarizeClusters, scoreAioRisk } = require('./clustering')
const { foundationPrompt, skeletonPrompt, pillarStructurePrompt } = require('./prompts')

// ── Stage registry ──────────────────────────────────────────────────────
const STAGES = [
  { key: 'foundation', label: 'Foundation (5 Core Components)' },
  { key: 'expansion', label: 'Keyword expansion (DataForSEO)' },
  { key: 'metrics', label: 'Metric grounding' },
  { key: 'serp_clustering', label: 'SERP clustering + AIO risk', checkpointAfter: 'pool_review' },
  { key: 'competitor_gap', label: 'Competitor gap' },
  { key: 'structure', label: 'Map structuring (LLM on real clusters)' },
  { key: 'linking', label: 'Link graph + publication waves' },
  { key: 'qa', label: 'QA gates (cannibalization, dedup)', checkpointAfter: 'qa_review' },
  { key: 'save', label: 'Save map + topics' },
]

const DEFAULT_CONFIG = {
  poolCap: 600,
  serpTopK: 80,
  seedTermCap: 10,
  competitorDomains: [],
  locationName: 'United States',
  languageCode: 'en',
  waveSize: 10,
  structureModel: 'claude-opus',
  pillarModel: 'claude-sonnet',
}

function getConfig(run) {
  return { ...DEFAULT_CONFIG, ...(run.config || {}) }
}

function stageIndex(key) {
  return STAGES.findIndex((s) => s.key === key)
}

// ── Helpers ─────────────────────────────────────────────────────────────

function slugify(text) {
  return (
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 180) || 'topic'
  )
}

function tokenize(s) {
  return new Set(
    String(s || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2)
  )
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter += 1
  return inter / (a.size + b.size - inter)
}

const INTENT_BUSINESS_VALUE = {
  transactional: 90,
  commercial: 85,
  navigational: 40,
  informational: 60,
  generative: 55,
}

async function llmJson({ model, fallbackModel, system, user, maxTokens = 8192, timeoutMs = 90000 }) {
  const attempts = [model, fallbackModel].filter(Boolean)
  let lastErr = null
  for (const m of attempts) {
    try {
      const res = await callModel(m, system, user, { maxTokens, timeoutMs })
      return { data: extractJSON(res.text), model: res.resolvedModel || m }
    } catch (e) {
      lastErr = e
      console.warn(`[tm-v2] LLM attempt failed (${m}): ${e?.message || e}`)
    }
  }
  throw lastErr || new Error('LLM call failed')
}

// ── Stage 0: foundation ─────────────────────────────────────────────────
async function stageFoundation(run, { supaFetch }) {
  let icpSummary = ''
  try {
    const icpRaw = readFileSync(path.join(process.cwd(), 'data', 'icp.json'), 'utf8')
    const icpJson = JSON.parse(icpRaw)
    icpSummary = icpJson?.sections?.audience_description?.summary || ''
  } catch {
    /* ICP optional */
  }

  const [brands, publishedContent, publishedReviews] = await Promise.all([
    supaFetch('/scam_brands?select=id,slug,name,scam_score&order=scam_score.desc&limit=100'),
    supaFetch('/content?status=eq.published&select=title,slug'),
    supaFetch('/reviews?status=eq.published&select=id,slug,brand_id'),
  ])

  const brandList = (Array.isArray(brands) ? brands : []).map((b) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
    scam_score: b.scam_score,
  }))

  const prompt = foundationPrompt({
    seedKeyword: run.seed_keyword,
    icpSummary,
    brandNames: brandList.map((b) => b.name),
    publishedTitles: (publishedContent || []).map((c) => c.title).filter(Boolean),
  })
  const { data, model } = await llmJson({
    model: 'claude-sonnet',
    fallbackModel: 'claude-haiku',
    system: prompt.system,
    user: prompt.user,
    maxTokens: 2000,
    timeoutMs: 60000,
  })

  if (!Array.isArray(data?.seed_terms) || data.seed_terms.length === 0) {
    throw new Error('Foundation stage returned no seed_terms')
  }

  return {
    artifacts: {
      foundation: {
        ...data,
        model,
        icp_summary: icpSummary.slice(0, 500),
        brand_list: brandList,
        existing: {
          content: (publishedContent || []).map((c) => ({ title: c.title, slug: c.slug })),
          review_slugs: (publishedReviews || []).map((r) => r.slug).filter(Boolean),
          reviews_by_brand: Object.fromEntries(
            (publishedReviews || []).filter((r) => r.brand_id).map((r) => [r.brand_id, r.id])
          ),
        },
      },
    },
    summary: `${data.seed_terms.length} seed terms, ${brandList.length} brands loaded`,
  }
}

// ── Stage 1: expansion ──────────────────────────────────────────────────
async function stageExpansion(run) {
  if (!isKeywordDataAvailable()) {
    throw new Error('DATAFORSEO_LOGIN/PASSWORD not configured — v2 pipeline requires real keyword data (no fabrication fallback).')
  }
  const cfg = getConfig(run)
  const foundation = run.artifacts?.foundation
  if (!foundation) throw new Error('Missing foundation artifact — run foundation stage first')

  const seeds = [
    String(run.seed_keyword).toLowerCase().trim(),
    ...(foundation.seed_terms || []).map((s) => String(s).toLowerCase().trim()),
  ]
    .filter(Boolean)
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .slice(0, cfg.seedTermCap)

  const pool = new Map() // keyword → entry
  const addEntry = (item, method) => {
    if (!item?.keyword) return
    const existing = pool.get(item.keyword)
    if (existing) {
      // merge: keep non-null metrics
      for (const f of ['search_volume', 'keyword_difficulty', 'cpc', 'search_intent', 'volume_trend_yearly']) {
        if (existing[f] == null && item[f] != null) existing[f] = item[f]
      }
      return
    }
    pool.set(item.keyword, { ...item, method })
  }

  const perSeedLimit = Math.max(50, Math.floor((cfg.poolCap * 1.5) / seeds.length))
  for (const seed of seeds) {
    const [sugg, rel] = await Promise.all([
      fetchKeywordSuggestions(seed, { locationName: cfg.locationName, languageCode: cfg.languageCode, limit: perSeedLimit }),
      fetchRelatedKeywords(seed, { locationName: cfg.locationName, languageCode: cfg.languageCode, limit: 60 }),
    ])
    sugg.forEach((i) => addEntry(i, 'suggestion'))
    rel.forEach((i) => addEntry(i, 'related'))
    addEntry({ keyword: seed }, 'seed')
  }

  // Brand insertion (canon method 8.2 token insertion applied to brand entities)
  for (const b of (foundation.brand_list || []).slice(0, 25)) {
    const name = String(b.name || '').toLowerCase().trim()
    if (!name) continue
    addEntry({ keyword: `${name} scam` }, 'brand-insertion')
    addEntry({ keyword: `${name} review` }, 'brand-insertion')
  }

  // Cap pool: keep seeds + brand terms + highest-volume rest
  let entries = [...pool.values()]
  if (entries.length > cfg.poolCap) {
    const keep = entries.filter((e) => e.method === 'seed' || e.method === 'brand-insertion')
    const rest = entries
      .filter((e) => e.method !== 'seed' && e.method !== 'brand-insertion')
      .sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0))
    entries = [...keep, ...rest].slice(0, cfg.poolCap)
  }

  return {
    artifacts: { pool: entries },
    summary: `${entries.length} candidate keywords from ${seeds.length} seeds (+brand insertion)`,
  }
}

// ── Stage 2: metrics ────────────────────────────────────────────────────
async function stageMetrics(run) {
  const cfg = getConfig(run)
  const pool = run.artifacts?.pool || []
  if (pool.length === 0) throw new Error('Empty keyword pool')

  const missing = pool.filter((e) => e.search_volume == null).map((e) => e.keyword)
  let grounded = 0
  if (missing.length > 0) {
    const metrics = await fetchKeywordOverview(missing, {
      locationName: cfg.locationName,
      languageCode: cfg.languageCode,
    })
    for (const e of pool) {
      const m = metrics.get(e.keyword)
      if (!m) continue
      if (m.search_volume !== null) e.search_volume = m.search_volume
      if (m.keyword_difficulty !== null) e.keyword_difficulty = m.keyword_difficulty
      if (m.cpc !== null) e.cpc = m.cpc
      if (m.main_intent) e.search_intent = m.main_intent
      if (m.volume_trend_yearly !== null) e.volume_trend_yearly = m.volume_trend_yearly
      grounded += 1
    }
  }
  for (const e of pool) {
    e.keyword_data_source = e.search_volume != null || e.keyword_difficulty != null ? 'dataforseo' : 'unverified'
  }
  const withData = pool.filter((e) => e.keyword_data_source === 'dataforseo').length

  return {
    artifacts: { pool },
    summary: `${withData}/${pool.length} keywords with real metrics (${grounded} grounded this stage)`,
  }
}

// ── Stage 3: SERP clustering ────────────────────────────────────────────
async function stageSerpClustering(run) {
  const cfg = getConfig(run)
  const pool = run.artifacts?.pool || []
  const poolByKeyword = new Map(pool.map((e) => [e.keyword, e]))

  const topK = [...pool]
    .sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0))
    .slice(0, cfg.serpTopK)
    .map((e) => e.keyword)
  if (!topK.includes(String(run.seed_keyword).toLowerCase().trim())) {
    topK.push(String(run.seed_keyword).toLowerCase().trim())
  }

  const serpByKeyword = await fetchSerpsBatch(
    topK,
    { locationName: cfg.locationName, languageCode: cfg.languageCode },
    6
  )
  if (serpByKeyword.size === 0) {
    throw new Error('No SERP data returned — check DataForSEO balance/quota, then resume this stage.')
  }

  const clusters = clusterBySerpOverlap(serpByKeyword)
  const summaries = summarizeClusters(clusters, poolByKeyword, serpByKeyword)

  // Attach non-SERP'd keywords to clusters by token overlap; leftovers → unclustered
  const clusterTokens = summaries.map((c) => ({ c, tokens: tokenize(c.head_keyword) }))
  const clustered = new Set(summaries.flatMap((c) => c.keywords.map((k) => k.keyword)))
  const unclustered = []
  for (const e of pool) {
    if (clustered.has(e.keyword)) continue
    const tokens = tokenize(e.keyword)
    let best = null
    let bestScore = 0
    for (const { c, tokens: ct } of clusterTokens) {
      const score = jaccard(tokens, ct)
      if (score > bestScore) {
        bestScore = score
        best = c
      }
    }
    if (best && bestScore >= 0.34) {
      best.keywords.push({
        keyword: e.keyword,
        search_volume: e.search_volume,
        keyword_difficulty: e.keyword_difficulty,
        search_intent: e.search_intent,
      })
      best.total_volume += e.search_volume || 0
    } else {
      unclustered.push(e.keyword)
    }
  }

  // Per-keyword serp features for AIO risk of individual nodes later
  const serpMeta = {}
  for (const [kw, s] of serpByKeyword.entries()) {
    serpMeta[kw] = { features: s.features, paa: s.paa }
  }

  return {
    artifacts: { clusters: summaries, unclustered, serp_meta: serpMeta },
    summary: `${summaries.length} SERP clusters from ${serpByKeyword.size} SERPs; ${unclustered.length} unclustered`,
  }
}

// ── Stage 4: competitor gap ─────────────────────────────────────────────
async function stageCompetitorGap(run) {
  const cfg = getConfig(run)
  const domains = (cfg.competitorDomains || []).slice(0, 4)
  if (domains.length === 0) {
    return { artifacts: {}, summary: 'Skipped — no competitor domains configured' }
  }
  const pool = run.artifacts?.pool || []
  const clusters = run.artifacts?.clusters || []
  const known = new Set(pool.map((e) => e.keyword))
  const seedTokens = tokenize(
    [run.seed_keyword, ...(run.artifacts?.foundation?.seed_terms || [])].join(' ')
  )

  let added = 0
  for (const domain of domains) {
    const items = await fetchRankedKeywords(domain, {
      locationName: cfg.locationName,
      languageCode: cfg.languageCode,
      limit: 150,
    })
    for (const item of items) {
      if (known.has(item.keyword)) continue
      const tokens = tokenize(item.keyword)
      let overlap = 0
      for (const t of tokens) if (seedTokens.has(t)) overlap += 1
      if (overlap === 0) continue // relevance filter
      known.add(item.keyword)
      pool.push({ ...item, method: 'competitor-gap', keyword_data_source: item.search_volume != null ? 'dataforseo' : 'unverified' })
      // token-attach to a cluster
      const clusterTokens = clusters.map((c) => ({ c, tokens: tokenize(c.head_keyword) }))
      let best = null
      let bestScore = 0
      for (const { c, tokens: ct } of clusterTokens) {
        const score = jaccard(tokens, ct)
        if (score > bestScore) {
          bestScore = score
          best = c
        }
      }
      if (best && bestScore >= 0.34) {
        best.keywords.push({
          keyword: item.keyword,
          search_volume: item.search_volume,
          keyword_difficulty: item.keyword_difficulty,
          search_intent: item.search_intent,
        })
      }
      added += 1
    }
  }

  return {
    artifacts: { pool, clusters },
    summary: `${added} gap keywords merged from ${domains.length} competitor domains`,
  }
}

// ── Stage 5: structure ──────────────────────────────────────────────────
async function stageStructure(run) {
  const cfg = getConfig(run)
  const foundation = run.artifacts?.foundation
  const clusters = (run.artifacts?.clusters || []).slice(0, 60)
  if (!foundation || clusters.length === 0) throw new Error('Missing foundation/clusters artifacts')

  // 5a: skeleton
  const sk = skeletonPrompt({ foundation, clusterSummaries: clusters })
  const { data: skeleton, model: skeletonModel } = await llmJson({
    model: cfg.structureModel,
    fallbackModel: 'claude-sonnet',
    system: sk.system,
    user: sk.user,
    maxTokens: 4096,
    timeoutMs: 90000,
  })
  const pillarsPlan = Array.isArray(skeleton?.pillars) ? skeleton.pillars : []
  if (pillarsPlan.length === 0) throw new Error('Skeleton returned no pillars')

  const clusterByKey = new Map(clusters.map((c) => [c.cluster_key, c]))
  const poolKeywords = new Set((run.artifacts?.pool || []).map((e) => e.keyword))

  // 5b: per-pillar structuring
  const structured = []
  for (const plan of pillarsPlan) {
    const assigned = (plan.cluster_keys || []).map((k) => clusterByKey.get(k)).filter(Boolean)
    if (assigned.length === 0) continue
    const pp = pillarStructurePrompt({
      foundation,
      pillar: plan,
      clusters: assigned,
      brandList: foundation.brand_list,
    })
    let branch
    try {
      const { data } = await llmJson({
        model: cfg.pillarModel,
        fallbackModel: cfg.structureModel,
        system: pp.system,
        user: pp.user,
        maxTokens: 8192,
        timeoutMs: 120000,
      })
      branch = data
    } catch (e) {
      console.warn(`[tm-v2] pillar structuring failed for "${plan.title}": ${e?.message || e}`)
      continue
    }
    if (!branch?.pillar) continue

    // Validate: target keywords must exist in pool (honesty rule)
    const validateNode = (node) => {
      const kw = String(node?.target_keyword || '').toLowerCase().trim()
      node.target_keyword = kw
      node.keyword_verified = poolKeywords.has(kw)
      return node
    }
    validateNode(branch.pillar)
    for (const c of branch.clusters || []) {
      validateNode(c)
      for (const s of c.supporting || []) validateNode(s)
    }

    structured.push({
      section: plan.section === 'outer' ? 'outer' : 'core',
      node_type: ['quality', 'trending'].includes(plan.node_type) ? plan.node_type : 'standard',
      ...branch,
    })
  }

  if (structured.length === 0) throw new Error('No pillar branches were structured successfully — resume to retry.')

  return {
    artifacts: { structure: { pillars: structured, skeleton_model: skeletonModel } },
    summary: `${structured.length} pillars structured from ${clusters.length} clusters`,
  }
}

// ── Stage 6: linking + sequencing ───────────────────────────────────────
async function stageLinking(run) {
  const cfg = getConfig(run)
  const structure = run.artifacts?.structure
  const pool = new Map((run.artifacts?.pool || []).map((e) => [e.keyword, e]))
  const serpMeta = run.artifacts?.serp_meta || {}
  if (!structure) throw new Error('Missing structure artifact')

  const flat = [] // { node, depth, parentSlug, pillarSlug, section, node_type }
  for (const branch of structure.pillars) {
    const pSlug = slugify(branch.pillar.slug_hint || branch.pillar.title)
    branch.pillar._slug = pSlug
    flat.push({ node: branch.pillar, depth: 0, parentSlug: null, pillarSlug: pSlug, section: branch.section, node_type: branch.node_type })
    for (const c of branch.clusters || []) {
      const cSlug = slugify(c.slug_hint || c.title)
      c._slug = cSlug
      flat.push({ node: c, depth: 1, parentSlug: pSlug, pillarSlug: pSlug, section: branch.section, node_type: 'standard' })
      for (const s of c.supporting || []) {
        const sSlug = slugify(s.slug_hint || s.title)
        s._slug = sSlug
        flat.push({ node: s, depth: 2, parentSlug: cSlug, pillarSlug: pSlug, section: branch.section, node_type: 'standard' })
      }
    }
  }

  // Enrich each node: metrics from pool, AIO risk, priority, links, dependencies
  const byParent = new Map()
  for (const f of flat) {
    const key = f.parentSlug || 'root'
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push(f)
  }

  for (const f of flat) {
    const n = f.node
    const m = pool.get(n.target_keyword) || {}
    n._metrics = {
      search_volume: m.search_volume ?? null,
      keyword_difficulty: m.keyword_difficulty ?? null,
      cpc: m.cpc ?? null,
      search_intent: m.search_intent ?? null,
      volume_trend_yearly: m.volume_trend_yearly ?? null,
      keyword_data_source: n.keyword_verified ? (m.keyword_data_source || 'dataforseo') : 'llm-estimated',
    }
    const serp = serpMeta[n.target_keyword] || null
    n._serp_features = serp?.features || []
    n._paa = serp?.paa || []
    n._aio_risk = scoreAioRisk(serp ? { features: serp.features } : null, n._metrics.search_intent)

    let businessValue =
      n.content_type === 'brand_review'
        ? 90
        : INTENT_BUSINESS_VALUE[n._metrics.search_intent] || 60
    if (f.node_type === 'quality') businessValue = Math.min(100, businessValue + 10)
    n._priority = computeTopicPriorityScore({
      search_volume: n._metrics.search_volume || 0,
      keyword_difficulty: n._metrics.keyword_difficulty ?? 50,
      business_value: businessValue,
    })
    // Unverified metrics rank last (honesty demotion)
    if (n._metrics.keyword_data_source !== 'dataforseo') n._priority = Math.max(0, n._priority - 40)
    n._business_value = businessValue

    // Internal links: Root → Seed → Node flow
    const children = (byParent.get(f.node._slug ?? '') || []).map((x) => x.node._slug)
    const links = []
    if (f.parentSlug) links.push(f.parentSlug)
    links.push(...(byParent.get(n._slug) || []).map((x) => x.node._slug))
    // top-2 siblings by priority (computed after loop for accuracy → approximate with volume here)
    const siblings = (byParent.get(f.parentSlug || 'root') || [])
      .filter((x) => x.node._slug !== n._slug)
      .sort((a, b) => (b.node._metrics?.search_volume || 0) - (a.node._metrics?.search_volume || 0))
      .slice(0, 2)
      .map((x) => x.node._slug)
    n._internal_links_to = [...new Set([...links, ...siblings])].filter(Boolean)
    n._dependencies = f.parentSlug ? [f.parentSlug] : []
    void children
  }

  // Publication waves: quality-node branches first, then priority desc; parent wave <= child wave
  const ordered = [...flat].sort((a, b) => {
    const q = (b.node_type === 'quality') - (a.node_type === 'quality')
    if (q !== 0) return q
    return (b.node._priority || 0) - (a.node._priority || 0)
  })
  const waveBySlug = new Map()
  ordered.forEach((f, i) => {
    let wave = Math.floor(i / cfg.waveSize) + 1
    const parentWave = f.parentSlug ? waveBySlug.get(f.parentSlug) : null
    if (parentWave && wave < parentWave) wave = parentWave
    waveBySlug.set(f.node._slug, wave)
    f.node._wave = wave
  })

  return {
    artifacts: { structure },
    summary: `${flat.length} nodes linked; ${Math.max(...flat.map((f) => f.node._wave || 1))} publication waves`,
  }
}

// ── Stage 7: QA gates ───────────────────────────────────────────────────
async function stageQa(run, { supaFetch }) {
  const structure = run.artifacts?.structure
  if (!structure) throw new Error('Missing structure artifact')

  const [existingTopics, existingContent, existingReviews] = await Promise.all([
    supaFetch('/topics?select=slug,title,target_keyword,map_id&limit=2000'),
    supaFetch('/content?select=slug,title&limit=1000'),
    supaFetch('/reviews?select=slug&limit=1000'),
  ])

  const existingKeywords = new Map()
  for (const t of existingTopics || []) {
    if (t.target_keyword) existingKeywords.set(String(t.target_keyword).toLowerCase(), t.slug)
  }
  const existingSlugs = new Set([
    ...(existingTopics || []).map((t) => t.slug),
    ...(existingContent || []).map((c) => c.slug),
    ...(existingReviews || []).map((r) => r.slug),
  ].filter(Boolean))
  const existingTitleTokens = [
    ...(existingTopics || []).map((t) => ({ title: t.title, tokens: tokenize(t.title) })),
    ...(existingContent || []).map((c) => ({ title: c.title, tokens: tokenize(c.title) })),
  ]

  const allNodes = []
  for (const branch of structure.pillars) {
    allNodes.push(branch.pillar)
    for (const c of branch.clusters || []) {
      allNodes.push(c)
      for (const s of c.supporting || []) allNodes.push(s)
    }
  }

  const seenKeywords = new Map()
  const report = { flags: [], counts: {} }
  const flag = (node, type, detail) => {
    node._qa_flags = node._qa_flags || []
    node._qa_flags.push({ type, detail })
    report.flags.push({ slug: node._slug, title: node.title, type, detail })
    report.counts[type] = (report.counts[type] || 0) + 1
  }

  for (const node of allNodes) {
    const kw = node.target_keyword
    // Intra-map duplicate keyword (canon 5.1/5.2)
    if (kw) {
      if (seenKeywords.has(kw)) {
        flag(node, 'intra_map_duplicate', `Same target_keyword as "${seenKeywords.get(kw)}" — merge or differentiate intent`)
      } else {
        seenKeywords.set(kw, node.title)
      }
      // Collision with live content
      if (existingKeywords.has(kw)) {
        flag(node, 'keyword_collision', `Existing topic "${existingKeywords.get(kw)}" already targets this keyword`)
      }
    }
    // Slug collision
    if (node._slug && existingSlugs.has(node._slug)) {
      flag(node, 'slug_collision', `Slug "${node._slug}" already exists (topic/content/review)`)
    }
    // Title similarity vs live content (canon 5.1)
    const tokens = tokenize(node.title)
    for (const et of existingTitleTokens) {
      if (jaccard(tokens, et.tokens) >= 0.7) {
        flag(node, 'title_similarity', `~duplicate of existing "${et.title}"`)
        break
      }
    }
    // Zero-demand disposition (canon 5.3)
    const vol = node._metrics?.search_volume
    if ((vol == null || vol === 0) && node.content_type !== 'brand_review' && node.content_type !== 'pillar_page') {
      flag(node, 'zero_demand', 'No measurable volume — micro-context candidate (merge into parent unless strategic)')
    }
    // Unverified keyword (honesty)
    if (node._metrics?.keyword_data_source === 'llm-estimated') {
      flag(node, 'unverified_keyword', 'target_keyword not found in DataForSEO pool — metrics unverified, priority demoted')
    }
  }

  report.total_nodes = allNodes.length
  report.clean_nodes = allNodes.filter((n) => !(n._qa_flags || []).length).length

  return {
    artifacts: { structure, qa_report: report },
    summary: `${report.clean_nodes}/${report.total_nodes} nodes clean; flags: ${JSON.stringify(report.counts)}`,
  }
}

// ── Stage 8: save ───────────────────────────────────────────────────────
async function stageSave(run, { supaFetch }) {
  const structure = run.artifacts?.structure
  const foundation = run.artifacts?.foundation
  if (!structure || !foundation) throw new Error('Missing artifacts for save')

  const nowIso = new Date().toISOString()
  const mapName = `Topical Map v2: ${run.seed_keyword} (${nowIso.slice(0, 10)})`

  const mapInsert = await supaFetch('/topical_maps?select=id', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      name: mapName,
      description: `Staged-pipeline topical map for "${run.seed_keyword}" (v2 engine, DataForSEO-grounded).`,
      status: 'active',
      seed_keyword: run.seed_keyword,
      run_id: run.id,
      core_components: {
        source_context: foundation.source_context,
        central_entity: foundation.central_entity,
        central_search_intent: foundation.central_search_intent,
        core_sections: foundation.core_sections,
        outer_sections: foundation.outer_sections,
      },
      stats: { generated_by: 'topical-map-v2', engine: 'staged-pipeline' },
    }),
  })
  const mapRow = Array.isArray(mapInsert) ? mapInsert[0] : mapInsert
  const mapId = mapRow?.id
  if (!mapId) throw new Error('Failed to create topical_maps row')

  const brandBySlug = new Map((foundation.brand_list || []).map((b) => [b.slug, b]))
  const reviewsByBrand = foundation.existing?.reviews_by_brand || {}
  const usedSlugs = new Set()

  const uniqueSlug = (base) => {
    let s = slugify(base)
    let i = 2
    while (usedSlugs.has(s)) s = `${slugify(base)}-${i++}`
    usedSlugs.add(s)
    return s
  }

  const insertTopic = async (node, { parentId, topicType, section, nodeType, sortOrder }) => {
    let brandId = null
    let reviewId = null
    let contentStatus = 'planned'
    if (node.content_type === 'brand_review' && node.brand_slug) {
      const b = brandBySlug.get(node.brand_slug)
      if (b) {
        brandId = b.id
        const rev = reviewsByBrand[b.id]
        if (rev) {
          reviewId = rev
          contentStatus = 'published'
        }
      }
    }
    const row = {
      map_id: mapId,
      parent_id: parentId,
      topic_type: topicType,
      content_type: node.content_type || 'educational',
      title: node.title,
      slug: uniqueSlug(node._slug || node.slug_hint || node.title),
      description: node.description || null,
      target_keyword: node.target_keyword || null,
      secondary_keywords: node.secondary_keywords || [],
      search_volume: node._metrics?.search_volume ?? 0,
      keyword_difficulty: node._metrics?.keyword_difficulty ?? 0,
      business_value: node._business_value ?? 50,
      priority_score: node._priority ?? 0,
      content_status: contentStatus,
      brand_id: brandId,
      review_id: reviewId,
      dependencies: node._dependencies || [],
      internal_links_to: node._internal_links_to || [],
      sort_order: sortOrder,
      notes: node.notes || null,
      updated_at: nowIso,
      // v2 columns
      section,
      search_intent: node._metrics?.search_intent || null,
      cpc: node._metrics?.cpc ?? null,
      volume_trend_yearly: node._metrics?.volume_trend_yearly ?? null,
      keyword_data_source: node._metrics?.keyword_data_source || 'unverified',
      page_role: topicType === 'pillar' ? 'Root' : topicType === 'cluster' ? 'Core' : 'Outer',
      macro_vector: node.macro_vector || null,
      node_type: nodeType,
      format_code: node.format_code || null,
      aio_risk: node._aio_risk || null,
      fan_out_tag: nodeType === 'quality' ? slugify(node.title) : node._fan_out_tag || null,
      serp_features: node._serp_features || [],
      paa_questions: node._paa || [],
      cluster_key: node.cluster_key || null,
      publication_wave: node._wave ?? null,
      qa_flags: node._qa_flags || [],
    }
    const inserted = await supaFetch('/topics?select=id', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row),
    })
    const item = Array.isArray(inserted) ? inserted[0] : inserted
    return item?.id || null
  }

  let topicCount = 0
  let pi = 0
  for (const branch of structure.pillars) {
    const fanOut = branch.node_type === 'quality' ? slugify(branch.pillar.title) : null
    const pillarId = await insertTopic(branch.pillar, {
      parentId: null,
      topicType: 'pillar',
      section: branch.section,
      nodeType: branch.node_type,
      sortOrder: pi++,
    })
    topicCount += 1
    let ci = 0
    for (const c of branch.clusters || []) {
      c._fan_out_tag = fanOut
      const clusterId = await insertTopic(c, {
        parentId: pillarId,
        topicType: 'cluster',
        section: branch.section,
        nodeType: 'standard',
        sortOrder: ci++,
      })
      topicCount += 1
      let si = 0
      for (const s of c.supporting || []) {
        s._fan_out_tag = fanOut
        await insertTopic(s, {
          parentId: clusterId,
          topicType: s.content_type === 'brand_review' ? 'brand_review' : 'supporting',
          section: branch.section,
          nodeType: 'standard',
          sortOrder: si++,
        })
        topicCount += 1
      }
    }
  }

  await supaFetch(`/topical_maps?id=eq.${mapId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      stats: {
        topic_count: topicCount,
        pillar_count: structure.pillars.length,
        generated_at: nowIso,
        engine: 'topical-map-v2',
        qa_counts: run.artifacts?.qa_report?.counts || {},
      },
      updated_at: nowIso,
    }),
  })

  return {
    artifacts: { save: { map_id: mapId, map_name: mapName, topic_count: topicCount } },
    summary: `Saved map ${mapId} with ${topicCount} topics`,
    mapId,
  }
}

const STAGE_FNS = {
  foundation: stageFoundation,
  expansion: stageExpansion,
  metrics: stageMetrics,
  serp_clustering: stageSerpClustering,
  competitor_gap: stageCompetitorGap,
  structure: stageStructure,
  linking: stageLinking,
  qa: stageQa,
  save: stageSave,
}

/**
 * Execute the run's current stage. Returns the patch to persist.
 */
async function executeCurrentStage(run, deps) {
  const idx = stageIndex(run.current_stage)
  if (idx === -1) throw new Error(`Unknown stage: ${run.current_stage}`)
  const stage = STAGES[idx]
  const fn = STAGE_FNS[stage.key]
  const started = Date.now()

  const result = await fn(run, deps)

  const isLast = idx === STAGES.length - 1
  const nextStage = isLast ? stage.key : STAGES[idx + 1].key
  const status = isLast ? 'completed' : stage.checkpointAfter ? 'awaiting_approval' : 'running'

  const logEntry = {
    stage: stage.key,
    ok: true,
    ms: Date.now() - started,
    summary: result.summary || '',
    at: new Date().toISOString(),
  }

  return {
    artifacts: { ...(run.artifacts || {}), ...(result.artifacts || {}) },
    current_stage: nextStage,
    status,
    map_id: result.mapId || run.map_id || null,
    logEntry,
    checkpoint: !isLast && stage.checkpointAfter ? stage.checkpointAfter : null,
    done: isLast,
  }
}

module.exports = { STAGES, DEFAULT_CONFIG, executeCurrentStage, stageIndex }
