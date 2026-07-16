'use strict'

const { tokenize, jaccard } = require('./text-utils')

// Cannibalization / dedup checks, extracted verbatim from stages.js stageQa so
// they can be unit-tested and reused. Given the flattened map nodes and the
// "already exists" context (built from the DB by the caller), produce the
// report and stamp node._qa_flags. Pure w.r.t. its inputs (no DB, no I/O).
//
// Plan 3c will call this on the CLUSTERED POOL before the map is built (skill
// Phase 5 before Phase 6); today stageQa calls it on the built structure.
function buildCannibalizationReport(allNodes, { existingKeywords, existingSlugs, existingTitleTokens }) {
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
      // Collision with live content — intentional expansions are exempt
      // when they declare the page they extend (site-aware generation)
      if (existingKeywords.has(kw) && existingKeywords.get(kw) !== node.expands_slug) {
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
    // Zero-demand disposition (canon 5.3) — traffic_potential counts as demand
    const vol = node._metrics?.search_volume
    const tp = node._metrics?.traffic_potential
    if ((vol == null || vol === 0) && !(tp > 0) && node.content_type !== 'brand_review' && node.content_type !== 'pillar_page') {
      flag(node, 'zero_demand', 'No measurable volume or traffic potential — micro-context candidate (merge into parent unless strategic)')
    }
    // Unverified keyword (honesty)
    if (node._metrics?.keyword_data_source === 'llm-estimated') {
      flag(node, 'unverified_keyword', 'target_keyword not found in DataForSEO pool — metrics unverified, priority demoted')
    }
  }

  report.total_nodes = allNodes.length
  report.clean_nodes = allNodes.filter((n) => !(n._qa_flags || []).length).length
  return report
}

module.exports = { buildCannibalizationReport }
