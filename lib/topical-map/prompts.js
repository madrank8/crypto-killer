/**
 * lib/topical-map/prompts.js — LLM prompts for the v2 staged pipeline.
 * Canon: ai-brain topical-map-creation v4.3 (Koray semantic SEO).
 *
 * Honesty rules baked in: the structuring model NEVER invents metrics.
 * It receives real DataForSEO-clustered keywords and arranges them; every
 * node's target_keyword must come from the provided pool.
 */

/**
 * Stage 0 — 5 Core Components + seed term set.
 */
function foundationPrompt({ seedKeyword, icpSummary, brandNames, publishedTitles }) {
  return {
    system: `You are a semantic SEO strategist applying Koray Tugberk Gubur's topical authority methodology for Crypto Killer (cryptokiller.org), an evidence-backed crypto scam protection site with SpyOwl ad-forensics data (87k+ tracked scam ad creatives).
Output a single valid JSON object. No markdown fences, no commentary.`,
    user: `SEED TOPIC: "${seedKeyword}"

AUDIENCE (ICP summary):
${icpSummary || 'Crypto scam searchers verifying brands before depositing; victims and families post-loss.'}

TOP SCAM BRANDS TRACKED (context): ${(brandNames || []).slice(0, 30).join(', ') || '(none)'}
ALREADY PUBLISHED (avoid re-planning these): ${(publishedTitles || []).slice(0, 40).join(' | ') || '(none)'}

Define the topical map foundation. Return JSON:
{
  "source_context": "1-2 sentences: site identity, forensic moat, monetization",
  "central_entity": "the single entity this map revolves around",
  "central_search_intent": "one composite intent sentence",
  "core_sections": ["3-6 sub-section names where monetization/signals concentrate"],
  "outer_sections": ["2-4 supporting sub-section names that transfer authority inward"],
  "seed_terms": ["8-14 short seed phrases for keyword expansion — mix of head terms, question stems, and commercial modifiers around the seed topic; each 1-4 words + no duplicates"]
}

Rules:
- seed_terms drive real keyword-API expansion — make them query-like ("pig butchering scam", "recover crypto", "fake crypto exchange"), not labels.
- Do not invent metrics. Do not include brand names in seed_terms (brands are expanded separately).`,
  }
}

/**
 * Stage 5a — pillar skeleton: assign every cluster to a pillar.
 */
function skeletonPrompt({ foundation, clusterSummaries }) {
  const clustersBlock = clusterSummaries
    .map(
      (c) =>
        `- key:${c.cluster_key} | head:"${c.head_keyword}" | vol:${c.total_volume} | intent:${c.dominant_intent} | aio:${c.aio_risk} | kws:${c.keywords.length}${
          c.authority ? ` | serp_min_dr:${c.authority.dr_min} (lower = easier to win)` : ''
        }`
    )
    .join('\n')

  return {
    system: `You are a semantic SEO strategist (Koray topical authority method). Output valid JSON only. No markdown.`,
    user: `FOUNDATION:
${JSON.stringify(foundation, null, 2)}

SERP-CLUSTERED KEYWORD GROUPS (real DataForSEO data — one cluster ≈ one page or one branch):
${clustersBlock}

Design the pillar skeleton. Assign EVERY cluster_key to exactly one pillar. Return JSON:
{
  "pillars": [
    {
      "title": "pillar page working title",
      "section": "core|outer",
      "node_type": "quality|trending|standard",
      "cluster_keys": ["keys of clusters that belong under this pillar"],
      "rationale": "1 sentence"
    }
  ]
}

Rules:
- 4-8 pillars. Core sections from the foundation get pillars first; outer sections support them.
- Mark 2-4 pillars as node_type "quality" (Quality Nodes: highest strategic value, become fan-out roots).
- Mark at most 1-2 as "trending" only if genuinely time-sensitive.
- Every cluster_key must appear exactly once across all pillars. Do not drop or invent keys.`,
  }
}

/**
 * Stage 5b — structure one pillar branch from its assigned clusters.
 */
function pillarStructurePrompt({ foundation, pillar, clusters, brandList }) {
  const clustersBlock = clusters
    .map(
      (c) => `CLUSTER ${c.cluster_key} (intent:${c.dominant_intent}, aio:${c.aio_risk}, features:${(c.serp_features || []).slice(0, 6).join(',')})
keywords: ${c.keywords.map((k) => `"${k.keyword}"(vol:${k.search_volume ?? '?'},kd:${k.keyword_difficulty ?? '?'})`).join(', ')}
PAA: ${(c.paa_questions || []).slice(0, 5).join(' | ') || '(none)'}`
    )
    .join('\n\n')

  const brandsBlock = (brandList || [])
    .slice(0, 60)
    .map((b) => `- ${b.name} | slug:${b.slug} | scam_score:${b.scam_score}`)
    .join('\n')

  return {
    system: `You are a semantic SEO strategist (Koray topical authority method) for Crypto Killer.
You arrange REAL keyword clusters into a pillar → cluster-page → supporting-page branch.
Output valid JSON only. No markdown, no commentary.

HARD RULES:
1) Every page's target_keyword MUST be copied verbatim from the provided cluster keywords. Never invent keywords.
2) One SERP cluster = one page (same SERP = same intent = one page). Only split a cluster if its keywords clearly serve different journey stages — and say why in "notes".
3) secondary_keywords = the remaining keywords of that page's cluster.
4) macro_vector format: "[attribute] of [entity] in [qualifying context]" — the angle, not the topic.
5) format_code: one of DEF (definition/what-is), HOWTO, LIST, COMP (comparison), REVIEW, GUIDE, NEWS, GLOSSARY, TOOL.
6) Attach brand_review supporting nodes (content_type "brand_review", exact brand_slug from the list) where a cluster is about a specific scam brand or where a Quality Node needs evidence children. Do not force them elsewhere.
7) Titles unique and specific. Slug_hint: lowercase-hyphenated, hierarchical, no word repetition with the pillar slug.
8) Do NOT create near-duplicate pages: distinct intent, distinct deliverable, non-substitutable (Google scaled-content-abuse guardrail). Fewer, deeper pages when in doubt.`,
    user: `FOUNDATION: ${JSON.stringify({
      central_entity: foundation.central_entity,
      central_search_intent: foundation.central_search_intent,
    })}

PILLAR: "${pillar.title}" (section:${pillar.section}, node_type:${pillar.node_type})

ASSIGNED CLUSTERS (real data):
${clustersBlock}

SCAM BRANDS (for brand_review nodes only — exact slugs):
${brandsBlock || '(none)'}

Return JSON:
{
  "pillar": {
    "title": "string", "target_keyword": "from a cluster (the head/broadest)", "slug_hint": "string",
    "description": "1 sentence", "macro_vector": "string", "format_code": "GUIDE",
    "content_type": "pillar_page", "cluster_key": "its cluster key or null",
    "secondary_keywords": ["..."]
  },
  "clusters": [
    {
      "title": "string", "target_keyword": "verbatim from cluster", "slug_hint": "string",
      "cluster_key": "string", "content_type": "educational|guide|comparison|recovery_guide|prevention|listicle|glossary",
      "description": "1 sentence", "macro_vector": "string", "format_code": "string",
      "secondary_keywords": ["..."], "notes": "optional",
      "supporting": [
        {
          "title": "string", "target_keyword": "verbatim from cluster", "slug_hint": "string",
          "cluster_key": "string", "content_type": "educational|guide|comparison|recovery_guide|prevention|listicle|glossary|brand_review",
          "description": "1 sentence", "macro_vector": "string", "format_code": "string",
          "secondary_keywords": ["..."], "brand_slug": "only for brand_review"
        }
      ]
    }
  ]
}`,
  }
}

module.exports = { foundationPrompt, skeletonPrompt, pillarStructurePrompt }
