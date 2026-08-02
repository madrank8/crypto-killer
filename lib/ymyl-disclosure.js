/**
 * The single source of the YMYL risk / not-financial-advice disclosure.
 *
 * `missing_risk_or_ftc_disclosure` is a hard-fail check: the auditor blocks any
 * financial page that makes a recommendation or material claim without risk
 * framing and a not-financial-advice statement. The review pipeline has always
 * appended such a block (see `app/api/admin/reviews/generate/route.js`), but the
 * blog pipeline never did, so blog drafts reach the publish gate vetoed on a
 * problem that is entirely mechanical to fix.
 *
 * Keeping the text here rather than inline at the two write sites means a drift
 * in wording cannot make the detector stop recognising our own block and append
 * a second copy.
 *
 * Wording constraints, both from the auditor prompt:
 *   - must carry BOTH risk framing and an explicit not-financial-advice line,
 *     since either alone still trips the check;
 *   - must NOT name a specific chargeback window in days. Dispute windows vary
 *     by bank and card network, and stating one invites the
 *     `fabricated_source_or_stat` veto.
 */

const DISCLOSURE_HEADING = 'Risk Disclosure and Editorial Independence'

const DISCLOSURE_PARAGRAPHS = [
  'This article is published for general information and harm-reduction purposes only. It is not financial, investment, legal, or tax advice, and nothing in it is a recommendation to buy, sell, or hold any asset. Crypto-asset trading carries a high risk of total loss, and money sent to a fraudulent operator is frequently unrecoverable. Verify any platform independently with your national financial regulator before depositing funds, and consult a licensed professional about your own circumstances.',
  'CryptoKiller is an independent scam-intelligence publication. Some links on this site are affiliate links that may earn us a commission at no additional cost to you; commercial relationships never influence our verdicts or risk ratings. If you believe you have been defrauded, report it to your national financial regulator and to law enforcement (in the United States, ReportFraud.ftc.gov and IC3.gov).',
]

/**
 * Plain-text body for a `sections[]` entry.
 *
 * Section bodies are written as prose, not markup: the SSR fallback in
 * `prerender.ts` HTML-escapes them, while the client `BlogPostPage` injects them
 * as HTML. Plain text is the only form that renders correctly through both.
 */
const DISCLOSURE_TEXT = DISCLOSURE_PARAGRAPHS.join('\n\n')

/**
 * HTML block for `full_article`, which is what server-rendered pages and
 * crawlers actually read (`prerender.ts` prefers `fullArticle` and only falls
 * back to `sections`). The `risk-disclosure` class doubles as the marker
 * `hasRiskDisclosure` recognises.
 */
const DISCLOSURE_HTML = [
  '<div class="risk-disclosure">',
  `<h2>${DISCLOSURE_HEADING}</h2>`,
  ...DISCLOSURE_PARAGRAPHS.map((p) => `<p>${p}</p>`),
  '</div>',
].join('\n')

/**
 * Phrases that mean a disclosure of this kind is already on the page. Written to
 * be generous: a missed detection appends a near-duplicate disclosure to a live
 * article, which is worse than leaving a veto for the operator to read, and the
 * remediation flow is explicitly allowed to report what it could not fix.
 */
const PRESENT_SIGNALS = [
  /class\s*=\s*["'][^"']*risk-disclosure/i,
  /not\s+(?:financial|investment|legal|tax)\s+advice/i,
  // The negation is sometimes carried by the subject rather than the verb:
  // "nothing in this article is financial advice" says the same thing without
  // ever placing "not" next to "advice".
  /(?:nothing|none\s+of\s+(?:this|it))\b[^.!?]{0,80}?(?:financial|investment|legal|tax)\s+advice/i,
  /does\s+not\s+constitute\s+(?:financial|investment|legal|tax|professional)/i,
  /should\s+not\s+be\s+(?:considered|construed\s+as)\s+(?:financial|investment|legal|tax)/i,
  /informational\s+purposes\s+only/i,
  /information(?:al)?\s+and\s+harm-reduction\s+purposes\s+only/i,
]

/**
 * @param {...(string|null|undefined)} candidates - HTML or prose to inspect
 * @returns {boolean} true when any candidate already carries a risk /
 *   not-financial-advice disclosure
 */
function hasRiskDisclosure(...candidates) {
  return candidates.some((candidate) => {
    if (typeof candidate !== 'string' || !candidate.trim()) return false
    return PRESENT_SIGNALS.some((re) => re.test(candidate))
  })
}

/**
 * Insert the disclosure into a `full_article` HTML string.
 *
 * `buildArticleHtml` always ends with the author-bio block, so the disclosure
 * goes immediately before it to keep the byline last, matching every other
 * article on the site. Articles without that block (legacy rows, hand-edited
 * drafts) get the disclosure appended.
 *
 * @param {string} html
 * @returns {string}
 */
function appendDisclosureToHtml(html) {
  const body = typeof html === 'string' ? html : ''
  const authorBioIndex = body.search(/<div\s+class\s*=\s*["'][^"']*author-bio/i)
  if (authorBioIndex === -1) {
    return body.trimEnd() ? `${body.trimEnd()}\n\n${DISCLOSURE_HTML}` : DISCLOSURE_HTML
  }
  const before = body.slice(0, authorBioIndex).trimEnd()
  const after = body.slice(authorBioIndex)
  return `${before}\n\n${DISCLOSURE_HTML}\n\n${after}`
}

/**
 * Append the disclosure as a final `sections[]` entry.
 *
 * @param {Array<{heading?: string, body?: string}>} sections
 * @returns {Array<{heading: string, body: string}>}
 */
function appendDisclosureToSections(sections) {
  const list = Array.isArray(sections) ? sections : []
  return [...list, { heading: DISCLOSURE_HEADING, body: DISCLOSURE_TEXT }]
}

export {
  DISCLOSURE_HEADING,
  DISCLOSURE_TEXT,
  DISCLOSURE_HTML,
  hasRiskDisclosure,
  appendDisclosureToHtml,
  appendDisclosureToSections,
}
