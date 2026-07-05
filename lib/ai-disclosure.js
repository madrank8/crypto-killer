/**
 * AI Disclosure builder — ai-brain canon seo-blog-generator Step 6.8
 * ("MANDATORY for every article — no skip condition"), L2 taxonomy:
 * AI-drafted, human-edited. Audit 2026-07-05 (W4c).
 *
 * DETERMINISTIC by design — the disclosure is a factual statement about the
 * production process, not creative copy, so no model call and no way for a
 * writer stage to omit or hallucinate it. Closes Google's E-E-A-T "How"
 * signal gap (using-gen-ai-content guidance).
 *
 * Rendering is Replit-side ("How this was created" block near the byline);
 * until that ships, the text still travels in the sync payload so the
 * renderer change is a pure template addition.
 */

/**
 * @param {object} opts
 * @param {'review'|'article'} opts.kind
 * @param {string} [opts.model] - resolved writer model id
 * @param {string} [opts.personaName] - editorial persona shown in the byline
 * @param {string} [opts.dateISO] - production date (YYYY-MM-DD)
 * @param {boolean} [opts.hasAdEvidence] - review carries scraped ad creatives
 * @param {boolean} [opts.regulatorChecked] - FCA/SEC lookups ran
 * @returns {string} plain-text disclosure (renderer wraps/styles it)
 */
function buildAiDisclosure({
  kind = 'article',
  model = 'AI language models',
  personaName = null,
  dateISO = new Date().toISOString().slice(0, 10),
  hasAdEvidence = false,
  regulatorChecked = false,
} = {}) {
  const modelLabel = String(model).replace(/-\d{8,}$/, '') // strip date pins

  if (kind === 'review') {
    return [
      `How this investigation was created: This review was drafted with AI assistance (${modelLabel}) on ${dateISO}, working from CryptoKiller's proprietary ad-surveillance dataset — the ad creatives, targeting countries, celebrity-impersonation records, and campaign-velocity figures cited on this page are measured platform data, not AI output.`,
      regulatorChecked
        ? 'Regulatory statements were cross-checked against the UK FCA register/Warning List and SEC EDGAR public databases at generation time.'
        : null,
      hasAdEvidence
        ? 'The advertisement screenshots shown are unmodified captures from our surveillance system.'
        : null,
      `Every source URL is machine-verified before publication, and the draft passes an automated quality audit${personaName ? ` plus editorial review under the ${personaName} byline` : ' plus editorial review'} before going live. Report errors to corrections@cryptokiller.org.`,
    ]
      .filter(Boolean)
      .join(' ')
  }

  return [
    `How this article was created: This guide was drafted with AI assistance (${modelLabel}) on ${dateISO}${personaName ? ` and edited under the ${personaName} byline` : ''}.`,
    'Statistics attributed to CryptoKiller come from our ad-surveillance platform (measured data, not AI output); external claims cite their sources inline.',
    'Source URLs are machine-verified before publication and the draft must pass an automated quality audit before going live. Report errors to corrections@cryptokiller.org.',
  ].join(' ')
}

module.exports = { buildAiDisclosure }
