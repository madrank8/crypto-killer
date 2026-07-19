'use strict'

// Node Function taxonomy (topical-map-creation v4.4, references/site-type-playbooks.md §1C).
// Orthogonal to Node Type (Quality/Trending/Standard). A page has exactly one
// Node Function describing the role it plays in the authority graph:
//   authority     — top-of-graph hubs that define the topic (pillars, hubs)
//   reinforcement — corroborate/deepen authority nodes (FAQ, glossary, methodology, stats)
//   retrieval     — built to be cited/extracted by AI (answer capsules, definitions, frameworks)
//   entity        — reinforce a named entity (about, product, author, brand pages)
//   commercial    — convert (money pages, best-of, comparison, lead-gen)
//
// First-pass heuristic from the signals a topic already carries; recorded so the
// map's function MIX can be sanity-checked against the site-type playbook
// (e.g. not 90% commercial, not zero retrieval). Precedence is deliberate:
// entity > commercial > authority > retrieval > reinforcement.
const NODE_FUNCTIONS = Object.freeze(['authority', 'reinforcement', 'retrieval', 'entity', 'commercial'])

function classifyNodeFunction({ content_type, content_role, search_intent, node_type, topic_type } = {}) {
  // Entity: a page that reinforces a named entity. In this domain, brand reviews.
  if (content_type === 'brand_review') return 'entity'
  // Commercial: converts — money role or buyer-stage intent.
  if (content_role === 'money' || search_intent === 'commercial' || search_intent === 'transactional') return 'commercial'
  // Authority: top-of-graph hubs.
  if (content_role === 'pillar' || topic_type === 'pillar') return 'authority'
  // Retrieval: definition/answer pages built to be cited/extracted. `glossary`
  // is the per-row content_type signal that actually reaches here — it lands on
  // supporting/cluster rows, never on pillars, so the authority check above does
  // not shadow it. (`node_type === 'quality'` currently only tags pillar rows,
  // which resolve to authority first; the check is kept so retrieval still fires
  // correctly if quality ever propagates to non-pillar rows.)
  if (content_type === 'glossary' || node_type === 'quality') return 'retrieval'
  // Reinforcement: everything else that corroborates (trust builders, supporting spokes).
  return 'reinforcement'
}

module.exports = { NODE_FUNCTIONS, classifyNodeFunction }
