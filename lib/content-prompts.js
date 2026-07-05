const { ANTI_SLOP_PROMPT_BLOCK } = require('./content-lint')
/**
 * Topical map & topical content prompts (Pipeline B).
 * Canon: ai-brain seo-blog-generator. Synced toward v5.2 on 2026-07-05
 * (unified kill lists via lib/content-lint, AI disclosure via
 * lib/ai-disclosure, SC-008/032/033 in section/faq writers). NOT full
 * parity — Step 6.10/6.11 gates still pending. Diff against
 * ~/Documents/GitHub/ai-brain before claiming a version.
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
 * Claude Opus: full topical map structure (pillars -> clusters -> supporting).
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
      "page_role": "Root",
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
          "page_role": "Core",
          "macro_vector": "Single overarching context making this page semantically relevant",
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
              "page_role": "Outer",
              "macro_vector": "Single overarching context making this page semantically relevant",
              "brand_slug": "only when content_type is brand_review"
            }
          ]
        }
      ]
    }
  ]
}

Hard rules:
1) Include multiple pillars (at least 4): scam mechanics, prevention, recovery, comparisons, platform-specific fraud.
2) Keep bounded: 4-5 pillars, 3-4 clusters per pillar, 2-4 supporting per cluster.
3) Include brand_review supporting items for high-score brands (use exact slugs).
4) search_volume: integer 0-20000; keyword_difficulty: integer 0-100; business_value: integer 0-100.
5) Titles must be unique and specific.
6) macro_vector must describe the angle, not just the topic. Format: "[attribute] of [entity] in [qualifying context]"
7) page_role: pillar = Root, cluster = Core, supporting = Outer.
8) Return compact JSON with no markdown and no trailing commentary.`,

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

function sharedTopicalWritingRules({ currentYear }) {
  return `You are writing YMYL content for crypto scam safety. Output must be valid JSON only.

\u2550\u2550\u2550 KORAY SEMANTIC REQUIREMENTS (v4.0) \u2550\u2550\u2550
- DECLARATION-FIRST: Open every sentence with the fact, not a dependent clause.
- EAV TRIPLETS: Include Entity-Attribute-Value triplets per section.
- NUMERIC SPECIFICITY: "3 methods" not "several methods".
- 3-EXAMPLE RULE: For every plural noun, provide 3 concrete examples.
- DOMAIN VERBS: "targets", "exploits", "impersonates", "funnels", "deceives" — never "leverages", "harnesses", "delves"
- SALIENCE: Primary entity in subject position of opening sentences.
- CONTEXTUAL VECTORS: Each section must maintain its declared micro vector. Do not drift.
- TOPICAL BORDERS: Do not enter adjacent topics. Hand off with <=2 sentences + internal link signal.
- QUESTION NETWORK: Canonical question answered within first 150 words. Boolean questions resolved explicitly.
- KEYWORD PLACEMENT: The exact target keyword phrase MUST appear verbatim in the first 200 words of the article (in the summary or first section body). This is critical for on-page SEO — do not paraphrase, rearrange, or split the keyword.
- H3 SUBHEADINGS: Sections longer than 200 words or covering 3+ distinct sub-points MUST include H3 subheadings (### in markdown). Target at least 4-6 H3s across the full article for hierarchical depth. AI systems prefer deep heading structures.
- ENTITY-SPECIFIC H3s: When the article discusses named people, specific platforms, or distinct scam variants, each notable entity SHOULD get its own H3 subheading (e.g., "### The [Celebrity Name] Bitcoin Scam", "### How [Platform] Enables [Scam Type]"). This captures high-intent long-tail searches and regional traffic.

${ANTI_SLOP_PROMPT_BLOCK}
(Kill lists 1-2 live in lib/content-lint.js ANTI_SLOP_PROMPT_BLOCK - single source of truth, enforced deterministically at publish. Audit 2026-07-05, W4b.)

\u2550\u2550\u2550 ANTI-SLOP KILL LIST 3: CONTENT PATTERNS \u2550\u2550\u2550
- Significance inflation: every claim is "critical/essential/crucial" — reserve for justified claims
- Copula hiding: "serves as", "functions as" -> use "is" or show action directly
- Passive voice hiding the actor: "It was determined that" -> name who determined it
- Synonym cycling: do not rename the central entity per sentence
- Vague attributions: "Experts say" without naming them — name the expert or remove

\u2550\u2550\u2550 ANTI-SLOP KILL LIST 4: STRUCTURE \u2550\u2550\u2550
- False agency: "This article will show you..." -> start with the finding
- Stacked bullets with no prose (prose ratio target: 40-70%)
- 3+ consecutive single-sentence paragraphs without each earning isolation

\u2550\u2550\u2550 ANTI-SLOP KILL LIST 5: RHYTHM \u2550\u2550\u2550
- Parallel triplets: "X does A. Y does B. Z does C." across 3+ sentences — vary construction
- Metronomic endings: end sections on verdicts, actions, or provocations — not "This is why X matters"
- 3+ consecutive sentences under 8 words — merge one into the next

\u2550\u2550\u2550 {{VERIFY}} TAG SYSTEM \u2550\u2550\u2550
For claims that ARE included but require human confirmation before publish:
- {{VERIFY: specific stat or claim | named source document}}
- {{RESEARCH NEEDED: data gap | suggested source to check}}
- {{SOURCE NEEDED: claim without citation | where to find it}}
Never tag vaguely. Always name the specific document, page, or URL.

\u2550\u2550\u2550 TEMPORAL CLASSIFICATION \u2550\u2550\u2550
Every sourced claim must carry a temporal tag:
- ESTABLISHED: settled fact, published research, historical event
- RECENT: last 30 days, still developing. Hedge with "reports suggest", "early analysis indicates"
- PROJECTED: forward-looking estimate. Requires explicit attribution.

\u2550\u2550\u2550 SOCIAL PROOF TYPES (H11) \u2550\u2550\u2550
Include real voices beyond the author. Four categories:
1. Named expert quotes from verified interviews, podcasts, published articles.
2. Community perspectives: Reddit/forum insights with subreddit + upvote count (not username). Not for YMYL evidence.
3. Industry commentary: X/LinkedIn posts from notable figures with verification.
4. Study/report data: Named studies with methodology, sample size, publication date.
All social proof enters the Source Ledger first. Never fabricate quotes.

\u2550\u2550\u2550 VISUAL CONTENT PLACEHOLDERS (H12) \u2550\u2550\u2550
HARD REQUIREMENT — MINIMUM 3 visual placeholders per article. HARD FAIL if fewer than 3.
Include functional visual placeholders INLINE in section body text (not decorative stock photos):
- [CHART NEEDED: description | Alt: descriptive alt text]
- [IMAGE NEEDED: description | Alt: descriptive alt text]
- [SCREENSHOT NEEDED: description | Alt: descriptive alt text]
- [DIAGRAM NEEDED: description | Alt: descriptive alt text]
First visual placeholder MUST appear within the first 500 words.
Distribute at least 1 per 2 sections. Each placeholder must have unique, specific alt text.
Also output all placeholders in the "visual_placeholders" JSON array field.

\u2550\u2550\u2550 SCHEMA ENRICHMENT (H13) \u2550\u2550\u2550
Every article MUST return a schema_enrichment object with 11 fields that map to JSON-LD
structured data on the live page. Required for Google rich results, AI Overview citations,
and Google Fact Check Explorer inclusion. HARD FAIL if the schema_enrichment object is
missing or malformed.

about_slugs (array, 1-3 items):
  Primary topics the article is ABOUT. Short kebab-case slugs from the entity vocabulary.
  Examples: "celebrity-crypto-scam", "cryptocurrency-fraud", "deepfake", "pig-butchering-scam",
  "rug-pull", "recovery-room-scam", "ai-trading-bot-scam".

mention_slugs (array, 5+ items):
  EVERY named person, organization, government body, platform, product, or concept in the
  article body. Examples: people — "elon-musk", "kim-kardashian", "paul-pierce",
  "warren-buffett", "martin-lewis", "gary-gensler"; government — "sec", "ftc", "fca", "fbi";
  platforms — "meta", "youtube", "facebook", "tiktok", "binance". Use kebab-case slugs.
  Unknown entities are fine — the schema layer resolves known ones and skips unknowns.

speakable_selectors (array):
  CSS selectors for voice-assistant content. Default [".key-takeaways"]. Add ".tldr"
  or ".summary" if the article has those blocks.

citations (array of objects):
  One entry per item in sources, TYPED for schema.org. Shape:
  { name, url, type, publisher, datePublished }
  type \u2208 NewsArticle | ScholarlyArticle | Report | WebPage | GovernmentService
  FTC/SEC/FCA pages = Report; university studies = ScholarlyArticle; Reuters/CNBC/Courthouse
  News = NewsArticle; consumer.ftc.gov = Report; forum threads or blogs = WebPage.

dataset (object OR null):
  Populated ONLY when the article cites CryptoKiller first-party data. Shape:
  { name, description, url, datePublished, variableMeasured: [...] }
  Return null if no first-party data. NEVER fabricate a dataset.

item_list (array):
  Populated ONLY for listicle content (Top N, 7 Most, Best, Most Common). Shape:
  { name, description, entitySlug? }
  entitySlug links to a mention_slug when the list item IS a named entity.
  Return [] for non-listicle content.

how_to (object OR null):
  Populated when the article has a discrete step-by-step protocol. Shape:
  { name, description, totalTime, steps: [{ name, text }] }
  totalTime is ISO 8601 duration ("PT5M" = 5 minutes).
  Return null if no step-by-step section.

quotes (array):
  Every authority quote in the article \u2014 expert statements, study findings, regulator
  commentary. Shape: { text, speakerName, speakerSlug?, citationUrl?, publishedDate? }
  speakerSlug matches a mention_slug when the speaker is a known entity.
  Every expert_quote and study in social_proof should also appear here with source URL.

claims (array):
  HIGHEST-VALUE FIELD for scam-debunking content \u2014 unlocks Google Fact Check Explorer.
  One entry per FALSE claim the article debunks. Shape:
  { claimReviewed, ratingValue, ratingLabel, originator }
  ratingValue: 1 (False) through 5 (True). ratingLabel \u2208 "False" | "Mostly False" |
  "Misleading" | "Partly True" | "Mostly True" | "True".
  originator: who makes the false claim ("Unknown scam operators using deepfake video",
  "Fraudsters using cloned BBC pages").
  For any article that debunks specific false claims (celebrity endorsement scams, fake
  promises, bogus AI trading claims): claims MUST have 3+ entries. Return [] only when
  the article genuinely has no specific debunked claims to mark.

author_persona_id (string):
  Writer persona voicing this article. Accepted values (sync allowlist \u2014 any
  other value is silently dropped Replit-side):
  "webb"  \u2014 M. Webb, technical/threat-analysis/forensic voice (Krebs model).
            Use for: deepfakes, AI threats, technical scam mechanics, investigations.
  "ortiz" \u2014 D. Ortiz, investigative-storyteller/consumer-protection voice.
            Use for: victim recovery, reporting guides, FAQ-heavy pieces, how-tos.
  "nair"  \u2014 P. Nair, ad-intelligence/fraud-pattern voice.
            Use for: ad-network fraud patterns, short-form pattern documentation.
            NEVER for victim-facing recovery or emotional-support content.
  Pick the persona that fits the article's angle. Default to "webb" for threat analysis,
  "ortiz" for recovery/prevention/consumer advice. Never return empty.

alternative_headline (string):
  SERP-friendly headline variant, <= 60 characters. Maps to BlogPosting.alternativeHeadline.
  Example: headline "The Most Common Celebrities Used in Crypto Scams: 7 Faces Scammers
  Steal to Steal Your Money" \u2192 alternative_headline "7 Most Impersonated Celebrities
  in Crypto Scams (2026)". Never empty.

target_keyword (string):
  Primary target keyword, verbatim, lowercase. Must match the keyword used in the summary
  and first section body. Maps to BlogPosting.keywords. Never empty.

\u2550\u2550\u2550 VOICE CHECK TARGETS \u2550\u2550\u2550
- First paragraph sounds like a person talking (not a template)
- Contractions present in body copy (zero = too formal)
- Sentence length variety: shortest under 6 words, longest over 20
- Section endings land with verdicts/actions, not trail-offs
- Prose ratio: 40-70% (not all bullets)

E-E-A-T RULES:
- Use explicit safety actions and reporting channels when relevant.
- Respect audience segments: pre-scam searcher, mid-scam doubter, post-scam victim, concerned family.
- Use Safe Answer framing for contested claims: "Analysis indicates" not "X is definitely Y".
- Assume ${currentYear} context for freshness.`
}

function topicalArticleWriterPrompt({ topic, parentTopic, sourceLedger, icpData, platformIntelligence, publishedSlugs }) {
  const currentYear = new Date().getFullYear()
  const topicTitle = topic?.title || 'Untitled Topic'
  const topicKeyword = topic?.target_keyword || topicTitle
  const parentTitle = parentTopic?.title || ''
  const pageRole = topic?.page_role || 'Core'
  const macroVector = topic?.macro_vector || `${topicKeyword} in the context of crypto scam protection`

  // PLATFORM-STAT TOKEN PROTOCOL is embedded in persona.systemPrompt — see
  // writer-personas.js. The block below shows the writer the live snapshot
  // values (so it can reason about magnitudes for phrasing) but instructs
  // the writer to emit `{{platform_stat:KEY}}` tokens, NOT the literal
  // numbers, in body prose. The Replit renderer
  // (artifacts/crypto-review/src/lib/platformStatTokens.ts in cryptokiller#20)
  // substitutes tokens with current values on every page render.
  const pi = platformIntelligence || {}
  const platformBlock = pi.totalBrands ? `
\u2550\u2550\u2550 CRYPTOKILLER PLATFORM INTELLIGENCE (USE THIS — unique first-party data) \u2550\u2550\u2550
CryptoKiller has investigated {{platform_stat:total_brands_tracked}} scam brands across {{platform_stat:total_creatives_analyzed}} ad creatives in ${pi.totalGeos || 'multiple'} countries.

Each line below is annotated TOKEN (emit the literal {{platform_stat:KEY}} in your prose;
the renderer resolves it live) or LITERAL (static-context only — do not paraphrase as a token):

- Total scam brands tracked: {{platform_stat:total_brands_tracked}}              [TOKEN — current ≈ ${pi.totalBrands.toLocaleString()}]
- Total ad creatives analyzed: {{platform_stat:total_creatives_analyzed}}        [TOKEN — current ≈ ${pi.totalCreatives.toLocaleString()}]
- Countries with active crypto scam campaigns: ${pi.totalGeos || 'N/A'}                      [LITERAL — no aggregate token]
- Average scam score across all brands: {{platform_stat:avg_scam_score}}/100    [TOKEN — current ≈ ${pi.avgScamScore || 'N/A'}/100]
- Brands with celebrity impersonation: {{platform_stat:total_brands_with_celebrity_abuse}}  [TOKEN — current ≈ ${pi.celebrityAbuse || 'N/A'}]
- Most common velocity trend: {{platform_stat:top_velocity_trend}}              [TOKEN — current = ${pi.topVelocityTrend || 'N/A'}]
- Published reviews on cryptokiller.org: {{platform_stat:total_brands_reviewed}}            [TOKEN — live count from Replit's published reviews table]
${pi.recentBrands ? `- Recently detected (last 7 days): ${pi.recentBrands}` : ''}
${pi.topScamScore ? `- Highest threat score brand: {{platform_stat:top_scam_brand_name}} ({{platform_stat:top_scam_brand_score}}/100)  [TOKEN — current = ${pi.topScamScore.name} (${pi.topScamScore.score}/100)]` : ''}

MANDATE: Weave at least 2-3 of these tokens into the article body as concrete evidence.
This is your primary Information Gain source — no competing article has this data.
Frame as: "CryptoKiller's analysis of {{platform_stat:total_brands_tracked}} scam brands shows..." or "Across {{platform_stat:total_creatives_analyzed}} ad creatives we've ingested...".
EMIT THE TOKEN LITERAL — do NOT substitute "${pi.totalBrands.toLocaleString()}" or any snapshot value yourself; the renderer does that at request time.` : ''

  // Build published slugs block for real internal links
  const reviewSlugs = publishedSlugs?.reviews || []
  const contentSlugs = publishedSlugs?.content || []
  const slugsBlock = (reviewSlugs.length > 0 || contentSlugs.length > 0) ? `
\u2550\u2550\u2550 PUBLISHED CONTENT FOR INTERNAL LINKING (use real slugs) \u2550\u2550\u2550
${reviewSlugs.length > 0 ? `Reviews: ${reviewSlugs.slice(0, 30).map(s => `${s.name} -> /review/${s.slug}`).join(', ')}` : ''}
${contentSlugs.length > 0 ? `Blog articles: ${contentSlugs.slice(0, 20).map(s => `${s.title} -> /blog/${s.slug}`).join(', ')}` : ''}

MANDATE: Include at least 2 internal links using REAL slugs from above. Use descriptive anchor text.
In internal_links array: use the exact slug paths shown above as target_slug.` : ''

  // Phase 4 — content-type-specific guidance. Branches the writer prompt by
  // topic.content_type so blog posts, pages, and landing pages get format-
  // appropriate instructions instead of the same one-size-fits-all template.
  const contentType = topic?.content_type || 'guide'
  const contentTypeGuides = {
    blog_post: `
\u2550\u2550\u2550 CONTENT FORMAT: BLOG POST \u2550\u2550\u2550
This is a BLOG POST. Optimize for:
- Casual, journalistic voice — first-person plural ("we") is welcome where it matches the brand
- Strong narrative hook in the opening 2 sentences
- 1200-1800 words total, broken into 6-9 sections
- Frequent formatting variety (lists, callouts, blockquotes) — no walls of plain prose
- A clear timestamp / "as of [year]" framing somewhere in the first 200 words for freshness signaling
- Practical takeaways, not encyclopedia-style coverage`,
    listicle: `
\u2550\u2550\u2550 CONTENT FORMAT: LISTICLE \u2550\u2550\u2550
This is a LISTICLE. Each section is a numbered item:
- The H1 / title MUST contain the count ("7 Ways...", "5 Red Flags...")
- 5-12 items, each 100-200 words
- Each item has its own H2 with the item number
- Open each item with the punchline, then expand`,
    comparison: `
\u2550\u2550\u2550 CONTENT FORMAT: COMPARISON \u2550\u2550\u2550
This is a COMPARISON page. Required elements:
- One markdown table comparing the two/three options across 5+ rows of criteria
- Recommend a specific option for at least 2 named user-types
- Surface tradeoffs honestly — no winner-takes-all framing
- Cite sources for every claim about each option`,
    informational_page: `
\u2550\u2550\u2550 CONTENT FORMAT: INFORMATIONAL PAGE \u2550\u2550\u2550
This is a STATIC INFORMATIONAL PAGE (e.g., About, How It Works, Editorial Policy).
- Authoritative third-person voice — no "we recommend"
- 800-1500 words, dense and reference-quality
- 4-7 H2 sections; each heading is a noun phrase, not a question
- No urgency framing, no calls-to-action mid-body — this is a reference page
- Date stamp at the top; updated monthly is the goal
- FAQ optional — only include if 3+ genuinely common reader questions exist`,
    landing_page: `
\u2550\u2550\u2550 CONTENT FORMAT: LANDING PAGE \u2550\u2550\u2550
This is a LANDING PAGE aimed at one keyword with commercial intent.
- 600-1000 words — concise, conversion-oriented
- The hero section (first 150 words) MUST answer the search query directly
- One primary CTA repeated at top, middle, and end
- 3-5 H2 sections covering: what it is, why it matters, how it works, social proof, next step
- A short FAQ (3-5 questions) addressing the top objections to the CTA
- Avoid the encyclopedia tone — be direct and benefit-led`,
    pillar_page: `
\u2550\u2550\u2550 CONTENT FORMAT: PILLAR PAGE \u2550\u2550\u2550
This is a PILLAR PAGE — the canonical hub for an entire topic cluster.
- 2500-4000 words, 10-15 H2 sections covering every facet at high level
- Each H2 maps to a sub-topic (later cluster pages will cover each in depth)
- Heavy internal linking out to existing related pages — at least 5 internal links
- TOC at top
- Comprehensive but skimmable: heavy use of summary lists at section starts`,
    guide: `
\u2550\u2550\u2550 CONTENT FORMAT: GUIDE \u2550\u2550\u2550
This is a HOW-TO / GUIDE page.
- Numbered or sequenced steps where applicable
- Clear "What you'll need" or "Before you start" section near the top
- Concrete examples — fabricated examples must be marked as illustrative
- 1500-2500 words`,
  }
  // Default block (covers educational, prevention, recovery_guide, brand_review,
  // glossary — these continue to use the original generic guidance).
  const contentTypeBlock = contentTypeGuides[contentType] || ''

  const system = `${sharedTopicalWritingRules({ currentYear })}

\u2550\u2550\u2550 SEMANTIC PLAN FOR THIS PAGE \u2550\u2550\u2550
PAGE ROLE: ${pageRole} (Root = pillar, Core = cluster, Outer = supporting/long-tail)
MACRO CONTEXTUAL VECTOR: ${macroVector}
CENTRAL ENTITY: ${topicTitle}
CANONICAL QUESTION: The single query this page must answer definitively within the first 150 words.
TOPICAL BORDER (internal guidance — do NOT print this in the article): Stay within the macro vector. If you must reference an adjacent topic, do it through a contextual internal_links entry, never through a sentence like "This topic relates to..." or "This is part of the broader area of...". Such taxonomy phrasing is a hard fail.
ATTRIBUTE LOGIC:
  - Root attributes (must cover): fundamental facts every reader arriving at this page expects
  - Rare attributes (add if Source Ledger has them): distinguishing facts that add information gain
  - Excluded attributes (do not cover): content belonging to parent or sibling pages
${platformBlock}
${slugsBlock}
${contentTypeBlock}

Return JSON with this exact shape:
{
  "title": "SEO title <= 60 chars. Include the target keyword if it fits naturally within 55 chars (a brand suffix ' | CryptoKiller' will be appended on render — leave room for it). The title MUST stand on its own as a coherent phrase — never end mid-clause (e.g., do NOT end with 'How to' or 'Why').",
  "headline": "H1 headline. May be longer and more editorial than title. Should also contain the target keyword in natural prose where possible.",
  "meta_description": "meta description <= 155 chars",
  "central_entity": "Primary subject of this page",
  "macro_vector": "Overarching context that makes this page semantically relevant",
  "page_role": "${pageRole}",
  "summary": "2-3 sentences",
  "key_takeaways": ["Most important point (1 sentence)", "Second key point", "Third key point", "Fourth key point"],
  "sections": [
    {
      "heading": "H2 heading — use question format where natural (e.g., 'What Is X?' not 'What X Actually Is') for AI Overview extractability",
      "micro_vector": "Specific sub-context this section maintains",
      "body": "120-260 words with lightweight markdown formatting. Opens DIRECTLY with the answer in 40-60 words — declaration-first, concrete, fact-first. NEVER begin with 'This section [explains/walks through/defines/addresses/provides/details/covers]...' or any other meta-description of what the section is about — that is a hard fail. The reader is here for the answer, not a description of the section. USE formatting variety: markdown tables (| col | col |), unordered lists (- item), ordered lists (1. item), callout boxes ({{WARNING: text}} or {{TIP: text}}), blockquotes (> quote — attribution). Max 3 consecutive plain paragraphs before a formatting break."
    }
  ],
  "not_for_you": "80-120 words. Named scenarios where this content does NOT apply. MUST include at least one line a competitor would never publish. Mandatory. HARD FAIL if absent.",
  "faq": [
    { "question": "natural search query", "answer": "40-90 words standalone answer. Declaration-first. Explicitly resolves boolean questions." }
  ],
  "sources": [
    { "title": "source title", "url": "https://...", "type": "regulatory|government|news|technical|consumer_protection", "accessed_date": "YYYY-MM-DD" }
  ],
  "internal_links": [
    { "anchor_text": "descriptive anchor", "target_slug": "/review/slug-here or /blog/slug-here (REQUIRED — if you do not have a real slug from the Published Slugs block above, OMIT this entry; never emit '#' or 'TBD' or an empty string)", "context": "sentence where this link appears" }
  ],
  "author_name": "Author full name",
  "author_bio": "1-2 sentence bio describing the author's COVERAGE AREA / editorial beat at CryptoKiller. MUST NOT begin with the author's own name — the renderer prepends the name. Start with the role/beat (e.g., 'Covers crypto investment-fraud patterns and ad-network abuse for CryptoKiller.'). DO NOT fabricate verifiable-sounding personal credentials: no specific years of experience ('8 years'), no degrees, certifications, prior employers, named awards, or institutional affiliations — these are editorial personas, not verifiable individuals, and inventing such claims is an E-E-A-T fabrication risk on a YMYL site. Describe what the persona covers, not invented biography.",
  "verify_tags_count": "INTEGER — count {{VERIFY:...}} tags in body text. MUST be > 0 for articles with statistics.",
  "reddit_test_passed": "BOOLEAN — honestly evaluate: would a knowledgeable practitioner on r/cryptocurrency or r/Scams upvote this? True only if it contains specific, non-obvious info beyond Google top 10 results.",
  "information_gain_summary": "1-2 sentences: what unique data does this page offer that no competitor has? MUST reference CryptoKiller platform data if provided above.",
  "visual_placeholders": ["[CHART NEEDED: specific description | Alt: descriptive alt text]", "[IMAGE NEEDED: specific description | Alt: descriptive alt text]", "[DIAGRAM NEEDED: specific description | Alt: descriptive alt text]"],
  "social_proof": [{"type": "expert_quote|community|industry|study", "source": "named person, subreddit, or organization", "content": "exact quote or specific insight", "attribution": "interview/article/report title and date"}],
  "schema_enrichment": {
    "author_persona_id": "webb|ortiz|nair",
    "alternative_headline": "SERP-friendly headline variant <= 60 chars",
    "target_keyword": "verbatim lowercase target keyword",
    "about_slugs": ["1-3 kebab-case topic slugs"],
    "mention_slugs": ["5+ kebab-case entity slugs for every named person, org, platform"],
    "speakable_selectors": [".key-takeaways"],
    "citations": [{"name": "source title", "url": "https://...", "type": "NewsArticle|ScholarlyArticle|Report|WebPage|GovernmentService", "publisher": "publisher name", "datePublished": "YYYY-MM-DD"}],
    "dataset": {"name": "dataset name", "description": "1-2 sentences", "url": "https://...", "datePublished": "YYYY-MM-DD", "variableMeasured": ["var1", "var2"]},
    "item_list": [{"name": "item name", "description": "1 sentence", "entitySlug": "optional-slug"}],
    "how_to": {"name": "protocol name", "description": "1 sentence", "totalTime": "PT5M", "steps": [{"name": "step title", "text": "1-2 sentences"}]},
    "quotes": [{"text": "verbatim quote", "speakerName": "Full Name", "speakerSlug": "optional-slug", "citationUrl": "https://...", "publishedDate": "YYYY-MM-DD"}],
    "claims": [{"claimReviewed": "false claim text", "ratingValue": 1, "ratingLabel": "False|Mostly False|Misleading|Partly True|Mostly True|True", "originator": "who makes the false claim"}]
  }
}

HARD REQUIREMENTS (any violation = reject):
- key_takeaways array must contain 4-6 items
- visual_placeholders array must contain >= 3 items with SPECIFIC descriptions and alt text
- not_for_you block must be present and >= 80 words, must include 1 line a competitor would never publish
- At least 2 social_proof entries with named sources (not "Experts say" — name the expert or study)
- At least 1 social_proof of type "study" with named methodology/sample size
- verify_tags_count must be > 0 for any article containing statistics or numerical claims
- reddit_test_passed must be honestly self-evaluated
- internal_links must contain >= 2 items with real target_slug paths from the published slugs list
- sources must include at least 1 current-year (${currentYear}) source for semantic freshness
- information_gain_summary MUST reference CryptoKiller first-party data if platform intelligence was provided
- schema_enrichment MUST be present with all 11 fields populated (nullable fields may be null, but keys must exist)
- schema_enrichment.about_slugs MUST contain 1-3 slugs; mention_slugs MUST contain 5+ slugs; every named entity in the body must be a mention_slug
- schema_enrichment.citations MUST have one entry per sources array item (same count) with a valid schema.org type
- schema_enrichment.quotes MUST include every expert_quote and study entry from social_proof, with URL and date resolved
- schema_enrichment.claims MUST contain 3+ entries for any article that debunks specific false claims (celebrity endorsement scams, fake AI trading promises, bogus giveaways); [] only if genuinely no debunked claims
- schema_enrichment.author_persona_id MUST be one of "webb", "ortiz", "nair" (never empty — "krebs" is NOT a valid id; it is dropped by the sync allowlist)
- schema_enrichment.alternative_headline MUST be non-empty and <= 60 characters
- schema_enrichment.dataset: populate when article cites CryptoKiller platform data; set to null otherwise; NEVER fabricate
- schema_enrichment.how_to: populate when article has a numbered step-by-step protocol; set to null otherwise
- schema_enrichment.item_list: populate for listicle content (Top N, 7 Most, Best, Most Common); [] otherwise

Rules:
- 5-8 sections total. Each section has a micro_vector field.
- At least 3 of the H2 headings MUST use question format (e.g., "How Do Scammers Fabricate Profits?" not "The Technology Scammers Use"). This is critical for AI Overview extraction.
- TARGET KEYWORD ON-PAGE PLACEMENT (critical for SEO):
  * Include the target keyword in the SEO title field if it fits naturally within 55 chars.
  * Include it in the H1 / headline when it reads naturally.
  * Include it once in the meta_description.
  * Include it in the summary field, in natural prose.
  * Include it once in the first section body, in natural prose.
  * NATURAL PROSE means: as a real noun phrase that fits the sentence. NEVER force a verbatim concatenation that produces broken grammar (e.g., if the keyword is "romance scammer red flags", do NOT write "romance scammer red flags scams" — that is a hard fail). If the keyword is already a noun phrase, never append "scams" or "scam" or "fraud" after it.
  * Spelling/case-insensitive variants (e.g., "Romance Scammer Red Flags" in a heading) count as the keyword. Plurals are fine.
- H3 SUBHEADINGS: Sections longer than 200 words MUST include ### subheadings in the body text. Target 4-6 H3s total across the article for hierarchical depth. AI systems prefer deep heading structures.
- 4-8 FAQ items. Include one boolean question resolution and one canonical question resolution.
- not_for_you block is MANDATORY — HARD FAIL if absent.
- key_takeaways is MANDATORY — placed after intro, before first H2.
- Section body text: use double newlines (\\n\\n) between paragraphs. 3-4 sentences per paragraph max. Never write a 200+ word wall of text.
- Lightweight markdown IS allowed in section body fields: tables (| col |), lists (- item / 1. item), blockquotes (> quote), callout boxes ({{WARNING: text}} / {{TIP: text}}), ### subheadings. Do NOT use HTML tags — only markdown syntax.
- FORMATTING QUOTAS (mandatory): At least 1 comparison/data table across all sections. Sections with 3+ enumerated items MUST use a list. At least 1 {{WARNING:}} or {{TIP:}} callout box. At least 1 blockquote with expert attribution. No more than 3 consecutive plain-text paragraphs without a formatting element.
- All sourced claims must trace to the Source Ledger. Never invent URLs.
- GLOBAL FORBIDDEN PATTERNS (any occurrence is a hard fail — these are the most common quality-killing tells):
  * Section openers describing the section itself: "This section explains/walks through/defines/addresses/provides/details/covers..." → write the actual answer instead.
  * Topic-tag taglines: "This topic relates to the broader area of...", "This is part of the broader topic of...", "This falls under the category of..." → never print taxonomy or hierarchy metadata in the body.
  * Awkward keyword concatenations like "[keyword] scams" when the keyword already contains "scam" — produces broken phrases like "romance scammer red flags scams". Use the keyword as a coherent noun phrase only.
  * Section-end summaries that restate what the section just said ("In summary, ...", "To recap, ...") — Google's helpful-content classifier penalises these.
  * Empty placeholder hyperlinks. Every internal_links entry MUST have a real target_slug. If you do not have a real slug, omit the entry entirely — never emit "#" or "TBD".
  * Author bylines that repeat the author's name twice (e.g., "P. Nair — P. Nair investigates..."). The author_bio field must NOT begin with the author's own name; it should be a 1-2 sentence credentials description that reads naturally after "{Name} — ".
- INTRO/SUMMARY ECHO (hard fail): The first section body must NOT repeat the summary verbatim or near-verbatim. The summary is rendered above the article body; the first section opens with new, additive content.`

  const user = `Generate a topical article.

SEMANTIC PLAN:
- Central Entity: ${topicTitle}
- Page Role: ${pageRole}
- Macro Contextual Vector: ${macroVector}
- Primary Keyword: ${topicKeyword}
${parentTitle ? `- Parent pillar/cluster: ${parentTitle}` : ''}

TOPIC DETAILS:
${JSON.stringify(topic || {}, null, 2)}

PARENT TOPIC:
${JSON.stringify(parentTopic || {}, null, 2)}

SOURCE LEDGER:
${(sourceLedger || [])
  .map((s, i) => `${i + 1}. [${s.type}] ${s.title} \u2014 ${s.url}`)
  .join('\n')}

ICP DATA (truncated):
${JSON.stringify(icpData || {}, null, 2).slice(0, 4000)}

Write for:
1. Ranking + AI extractability + victim safety
2. Topical border compliance — do not drift outside the macro vector
3. Every section maintains its micro vector
4. Canonical question answered within 150 words
5. Boolean questions explicitly resolved in FAQ
6. not_for_you block present — REQUIRED
7. key_takeaways array with 4-6 bullet points — REQUIRED
8. At least 2-3 CryptoKiller platform statistics woven into body sections
9. At least 2 internal links using real published slugs`

  return { system, user }
}

module.exports = {
  topicalMapKeywordResearchPrompt,
  topicalMapGeneratorPrompt,
  topicalArticleWriterPrompt,
  sharedTopicalWritingRules,
  computeTopicPriorityScore,
  normalizeVolume,
}
