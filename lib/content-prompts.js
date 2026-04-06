/**
 * Topical map & topical content prompts (Pipeline B).
 */

/**
 * Priority score for topics: volume + KD ease + business value.
 * Formula: (normalize(volume, 0, 20000) * 40) + ((100 - kd) * 0.3) + (business_value * 0.3)
 */
function normalizeVolume(volume, min = 0, max = 20000) {
  const v = Math.max(min, Math.min(max, Number(volume) || 0))
  return (v - min) / (max - min || 1)
}

function computeTopicPriorityScore({ search_volume = 0, keyword_difficulty = 0, business_value = 50 }) {
  const nv = normalizeVolume(search_volume)
  const kd = Math.min(100, Math.max(0, Number(keyword_difficulty) || 0))
  const bv = Math.min(100, Math.max(0, Number(business_value) || 0))
  return Math.round(nv * 40 + (100 - kd) * 0.3 + bv * 0.3)
}

/**
 * Gemini (search grounding): keyword / SERP context for the topical map.
 */
function topicalMapKeywordResearchPrompt({ nicheDescription, icpSummary }) {
  return {
    system: `You are an SEO and search-intent researcher for Crypto Killer, a cryptocurrency scam investigation platform.
Use Google Search when available to ground estimates in real SERPs and public guidance (regulators, consumer protection).
Output a single JSON object only. No markdown fences. No text before or after the JSON.`,
    user: `Research keyword clusters and intent for topical authority content in this niche.

NICHE / STRATEGY:
${nicheDescription || 'Crypto investment fraud education, scam prevention, and recovery guidance for retail investors.'}

AUDIENCE / ICP (summary):
${icpSummary || ''}

Return JSON with this shape:
{
  "market_notes": ["string", "..."],
  "head_term_clusters": [
    {
      "seed": "primary keyword phrase",
      "intent": "informational|commercial|transactional|navigational",
      "estimated_volume_band": "low|medium|high",
      "difficulty_band": "low|medium|high",
      "notes": "1-3 sentences grounded in what you found"
    }
  ],
  "competitor_content_patterns": ["what top-ranking pages tend to cover"],
  "risk_and_compliance_notes": ["YMYL cautions for money loss, legal, mental health"]
}

Rules:
- Do not invent specific numeric search volumes unless you can ground them; prefer bands.
- Prefer realistic UK/US/AU/CA angles where relevant.
`,
  }
}

/**
 * Claude Opus: full topical map structure (pillars → clusters → supporting).
 */
function topicalMapGeneratorPrompt({
  nicheDescription,
  icpJson,
  publishedReviewSlugs,
  topScamBrands,
  keywordResearchJson,
}) {
  const reviewsList = (publishedReviewSlugs || []).slice(0, 500).join(', ') || '(none)'
  const brandsBlock = (topScamBrands || [])
    .slice(0, 100)
    .map((b) => `- ${b.name} | slug:${b.slug} | scam_score:${b.scam_score}`)
    .join('\n')

  return {
    system: `You are a principal SEO strategist for Crypto Killer (crypto scam investigations).
You design a semantic topical map: pillars, clusters, and supporting pages, including brand-review nodes tied to real brand slugs.

OUTPUT: Valid JSON only. No markdown. No commentary.

The JSON MUST match this shape:
{
  "pillars": [
    {
      "title": "string",
      "target_keyword": "string",
      "search_volume": 0,
      "keyword_difficulty": 0,
      "business_value": 50,
      "content_type": "pillar_page",
      "description": "string",
      "secondary_keywords": ["..."],
      "clusters": [
        {
          "title": "string",
          "target_keyword": "string",
          "search_volume": 0,
          "keyword_difficulty": 0,
          "business_value": 50,
          "content_type": "educational|guide|comparison|recovery_guide|prevention|listicle|glossary",
          "description": "string",
          "secondary_keywords": ["..."],
          "supporting": [
            {
              "title": "string",
              "target_keyword": "string",
              "search_volume": 0,
              "keyword_difficulty": 0,
              "business_value": 50,
              "content_type": "educational|guide|comparison|recovery_guide|prevention|listicle|glossary|brand_review",
              "description": "string",
              "secondary_keywords": ["..."],
              "brand_slug": "only when content_type is brand_review — must match provided scam_brands.slug"
            }
          ]
        }
      ]
    }
  ]
}

Hard rules:
1) Include multiple pillars (at least 4) spanning: scam mechanics, prevention, recovery, comparisons, and platform-specific fraud signals.
2) Every cluster must have at least 2 supporting items unless impossible; prefer 3–8 supporting items.
3) Include brand_review supporting items for many of the supplied high-score brands (use their exact slugs).
4) If a brand already has a published review slug listed below, still include a brand_review node for that brand (we will link it server-side).
5) search_volume must be an integer 0–20000; keyword_difficulty integer 0–100; business_value integer 0–100.
6) Titles must be unique and specific; avoid duplicate near-identical titles.
7) Do not claim you measured volumes from private tools; treat volumes as planning estimates.
8) Slugs are NOT required in output; the system will derive slugs from titles and brand_slug.

Priority score (for your awareness — the app recomputes): (normalize(volume,0,20000)*40)+((100-kd)*0.3)+(business_value*0.3).`,

    user: `NICHE DESCRIPTION:
${nicheDescription || 'Crypto scam topical authority: education + investigations + recovery + prevention.'}

KEYWORD RESEARCH (JSON):
${JSON.stringify(keywordResearchJson || {}, null, 2)}

ICP DATA (JSON):
${typeof icpJson === 'string' ? icpJson : JSON.stringify(icpJson || {}, null, 2)}

PUBLISHED REVIEW SLUGS (sample):
${reviewsList}

TOP SCAM BRANDS (use these slugs for brand_review nodes):
${brandsBlock || '(none)'}

Generate the topical map JSON now.`,
  }
}

module.exports = {
  topicalMapKeywordResearchPrompt,
  topicalMapGeneratorPrompt,
  computeTopicPriorityScore,
  normalizeVolume,
}
