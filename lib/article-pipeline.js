/**
 * Article Pipeline — orchestrator for the multi-stage article writer.
 *
 * Replaces the monolithic single-Opus-call writer in fill/route.js with
 * a 4-stage pipeline that runs the section writers in parallel:
 *
 *   Stage A: Skeleton  (Haiku, 1 call)        ~10s
 *   Stage B: Sections  (Opus×N parallel,
 *                        Sonnet retry,
 *                        deterministic fallback per section)  ~60s
 *   Stage C: FAQ       (Haiku, 1 call)        ~12s
 *   Stage D: Aux       (Haiku, 1 call)        ~15s
 *
 * Stage A runs first because section writers benefit from knowing the
 * skeleton's summary (for keyword placement coordination). Stages B is the
 * parallel-fanout step. Stages C and D run after B because they consume
 * the section bodies.
 *
 * Total wall time: ~75-90s typical (vs 120-200s monolithic).
 *
 * Diagnostic capture: every attempt by every stage is recorded in
 * pipelineStages[]. The orchestrator returns this so the route can
 * persist it to ai_audit.pipeline_stages — backwards-compatible with
 * the existing ai_audit.writer_attempts diagnostic from commit 8b5c1cc.
 */

const { writeSkeleton } = require('./skeleton-writer')
const { writeSection } = require('./section-writer')
const { writeFaq } = require('./faq-writer')
const { writeAux } = require('./aux-writer')

/**
 * Run the article writer pipeline.
 *
 * @param {object} args
 * @param {object} args.topic - Topic row
 * @param {object} args.parentTopic - Parent topic row (optional)
 * @param {Array} args.sections - Outline sections [{heading, description, key_points, target_word_count}]
 * @param {Array} args.faq - Outline faqs [{question, answer_hint}]
 * @param {Array} args.sourceLedger - Sources from outline phase
 * @param {object} args.persona - Selected persona (from writer-personas.js)
 * @param {object} args.publishedSlugs - { reviews: [], content: [] } for internal links
 * @param {object} args.platformIntelligence - Platform aggregate stats (optional)
 * @param {function} args.onProgress - (event) => void; SSE-style progress events
 * @returns {Promise<{article, pipelineStages, anyDeterministicFallback, allOk}>}
 */
async function runArticlePipeline({
  topic,
  parentTopic,
  sections,
  faq,
  sourceLedger,
  persona,
  publishedSlugs,
  platformIntelligence,
  onProgress = () => {},
}) {
  const pipelineStages = []
  const targetKeyword = topic?.target_keyword || topic?.title || ''
  const sectionHeadings = sections.map((s) => s.heading)
  const currentYear = new Date().getFullYear()

  // ── Stage A: Skeleton ─────────────────────────────────────────────────
  onProgress({
    step: 'pipeline_skeleton',
    progress: 22,
    message: `Writing article skeleton (title, summary, key takeaways)...`,
  })

  const skeleton = await writeSkeleton({
    topic, parentTopic, sectionHeadings, targetKeyword,
    persona, currentYear,
  })
  pipelineStages.push(...(skeleton.attempts || []))

  if (skeleton.deterministicFallback) {
    onProgress({
      step: 'pipeline_skeleton_fallback',
      progress: 25,
      message: 'Skeleton stage hit deterministic fallback — continuing with synthesized metadata.',
    })
  }

  // ── Stage B: Sections (parallel) ──────────────────────────────────────
  onProgress({
    step: 'pipeline_sections_start',
    progress: 30,
    message: `Writing ${sections.length} sections in parallel (Opus primary, Sonnet retry)...`,
    section_count: sections.length,
  })

  // Track per-section completion for SSE progress reporting
  let sectionsCompleted = 0
  const reportSectionDone = (idx, ok, deterministicFallback) => {
    sectionsCompleted++
    const pct = 30 + Math.round((sectionsCompleted / sections.length) * 35) // 30 → 65
    onProgress({
      step: 'pipeline_section_done',
      progress: pct,
      message: `Section ${sectionsCompleted}/${sections.length} done${deterministicFallback ? ' (deterministic fallback)' : ''}`,
      section_index: idx,
      ok,
      deterministicFallback,
    })
  }

  // Run all section writers concurrently. Each writeSection() never throws —
  // it always resolves with {ok, attempts, ...}, so Promise.all is safe.
  const sectionResults = await Promise.all(
    sections.map(async (section, sectionIndex) => {
      // Note: priorSectionExcerpt is intentionally not threaded here — true
      // continuity would require sequential writing, defeating the parallel
      // speedup. Acceptable trade because each section already has a
      // self-contained scope (heading + description + key_points), and
      // the persona voice is uniform across sections. If continuity becomes
      // a quality issue, a v2 can do a serial polish pass after Stage B.
      const result = await writeSection({
        section,
        sectionIndex,
        persona,
        targetKeyword,
        // Only the first section enforces verbatim keyword placement —
        // mirrors the article-level "keyword in first 200 words" rule from
        // sharedTopicalWritingRules. The skeleton's summary also has the
        // keyword, providing redundancy.
        requireKeywordInBody: sectionIndex === 0,
        topicTitle: topic?.title,
      })
      pipelineStages.push(...(result.attempts || []))
      reportSectionDone(sectionIndex, result.ok, result.deterministicFallback)
      return result
    })
  )

  const sectionDeterministicCount = sectionResults.filter((r) => r.deterministicFallback).length
  if (sectionDeterministicCount > 0) {
    onProgress({
      step: 'pipeline_sections_partial',
      progress: 65,
      message: `${sectionDeterministicCount}/${sections.length} sections used deterministic fallback. Article still shippable; publish quality gate will validate.`,
      deterministic_section_count: sectionDeterministicCount,
    })
  }

  const writtenSections = sectionResults.map((r, i) => ({
    heading: r.heading || sections[i].heading,
    body: r.body,
  }))

  // ── Stage C + D: FAQ and Aux (parallel — both consume sections) ───────
  onProgress({
    step: 'pipeline_faq_aux_start',
    progress: 67,
    message: 'Writing FAQ answers and auxiliary fields in parallel...',
  })

  const [faqResult, auxResult] = await Promise.all([
    writeFaq({
      topic,
      faqs: faq,
      sectionHeadings,
      targetKeyword,
      persona,
    }),
    writeAux({
      topic,
      persona,
      sections: writtenSections,
      faq, // pass outline faq; aux is informed by it but doesn't rewrite it
      summary: skeleton.summary,
      sourceLedger,
      publishedSlugs,
      platformIntelligence,
      currentYear,
    }),
  ])
  pipelineStages.push(...(faqResult.attempts || []))
  pipelineStages.push(...(auxResult.attempts || []))

  // ── Stitch ─────────────────────────────────────────────────────────────
  // Determine writerModelUsed for the saved row's ai_model column. This
  // is a single string for backwards compat with the publish gate; we use
  // 'deterministic-fallback' if any required component (skeleton or
  // sections OR aux) all fell back, otherwise the dominant model for sections.
  const allSectionsFellBack = sectionDeterministicCount === sections.length
  const skeletonFellBack = !!skeleton.deterministicFallback
  const auxFellBack = !!auxResult.deterministicFallback
  const overallDeterministic = allSectionsFellBack && skeletonFellBack && auxFellBack

  const sectionModelCounts = sectionResults.reduce((acc, r) => {
    const lastSuccessfulAttempt = (r.attempts || []).filter((a) => a.ok).slice(-1)[0]
    const m = lastSuccessfulAttempt?.modelKey || 'unknown'
    acc[m] = (acc[m] || 0) + 1
    return acc
  }, {})
  const dominantSectionModel = Object.entries(sectionModelCounts)
    .sort(([, a], [, b]) => b - a)[0]?.[0] || 'unknown'
  const writerModelUsed = overallDeterministic
    ? 'deterministic-fallback'
    : dominantSectionModel

  // Check for any deterministic fallback across stages — useful for diagnostics
  // but does NOT make the article unpublishable on its own. The publish gate
  // separately inspects section bodies for skeleton-opener / taxonomy-trailer
  // patterns, which the deterministic-section fallback won't trigger because
  // it builds bodies from the outline brief.
  const anyDeterministicFallback = (
    skeletonFellBack ||
    sectionDeterministicCount > 0 ||
    !!faqResult.deterministicFallback ||
    auxFellBack
  )

  const article = {
    title: skeleton.title,
    headline: skeleton.headline,
    meta_description: skeleton.meta_description,
    summary: skeleton.summary,
    key_takeaways: skeleton.key_takeaways || [],
    sections: writtenSections,
    faq: faqResult.faq || [],
    not_for_you: auxResult.not_for_you,
    social_proof: auxResult.social_proof || [],
    visual_placeholders: auxResult.visual_placeholders || [],
    internal_links: auxResult.internal_links || [],
    schema_enrichment: auxResult.schema_enrichment || null,
    information_gain_summary: auxResult.information_gain_summary,
    author_bio: auxResult.author_bio,
    author_name: persona?.name,
    verify_tags_count: auxResult.verify_tags_count || 0,
    reddit_test_passed: auxResult.reddit_test_passed || false,
    sources: sourceLedger || [],
  }

  onProgress({
    step: 'pipeline_done',
    progress: 75,
    message: `Article pipeline complete. ${pipelineStages.filter((s) => s.ok).length}/${pipelineStages.length} stage attempts succeeded.`,
    deterministic_section_count: sectionDeterministicCount,
    writer_model_used: writerModelUsed,
  })

  return {
    article,
    pipelineStages,
    anyDeterministicFallback,
    overallDeterministic,
    sectionDeterministicCount,
    writerModelUsed,
  }
}

module.exports = { runArticlePipeline }
