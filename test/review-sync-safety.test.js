const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  isUnsafeLandingUrl,
  isSafeFacebookPostUrl,
  safeAdCta,
  shapeRecentAdForSync,
  shapedAdHasUnsafeUrl,
  stripStructuredDupesFromArticle,
  sanitizeItemReviewedUrl,
  pickBrandOrigin,
  countPlainWords,
  composeSeoFields,
  SEO_TITLE_MAX,
  META_DESCRIPTION_MAX,
} = require('../lib/review-sync-safety')

test('isUnsafeLandingUrl flags Meta click trackers with token_fb/fbclid', () => {
  assert.equal(
    isUnsafeLandingUrl(
      'https://cleverlogicty.pro/click?key=abc&token_fb=EAA&fbclid=IwZ&pixel_fb=1',
    ),
    true,
  )
  assert.equal(
    isUnsafeLandingUrl(
      'https://sharpminddump.info/click?ad_id=1&token_fb=x',
    ),
    true,
  )
})

test('isUnsafeLandingUrl allows Facebook posts and Ad Library', () => {
  assert.equal(
    isSafeFacebookPostUrl('https://www.facebook.com/100063654715787/posts/24850267551337102/'),
    true,
  )
  assert.equal(
    isUnsafeLandingUrl('https://www.facebook.com/100063654715787/posts/24850267551337102/'),
    false,
  )
  assert.equal(
    isSafeFacebookPostUrl('https://www.facebook.com/ads/library/?q=Peak%20Luxentria'),
    true,
  )
})

test('safeAdCta prefers Facebook post_url over Ad Library', () => {
  const post = 'https://www.facebook.com/foo/posts/123'
  const cta = safeAdCta({ post_url: post, brandName: 'Peak Luxentria' })
  assert.equal(cta.cta_url, post)
  assert.equal(cta.cta_label, 'View Facebook post')
  assert.equal(cta.cta_rel, 'nofollow noopener')
})

test('safeAdCta falls back to Meta Ad Library when post_url missing', () => {
  const cta = safeAdCta({ post_url: null, brandName: 'Peak Luxentria' })
  assert.match(cta.cta_url, /facebook\.com\/ads\/library/)
  assert.match(cta.cta_url, /Peak%20Luxentria/)
  assert.equal(cta.cta_label, 'View in Meta Ad Library')
})

test('safeAdCta rejects unsafe post_url lookalikes', () => {
  const cta = safeAdCta({
    post_url: 'https://evil.example/click?token_fb=x',
    brandName: 'Peak Luxentria',
  })
  assert.match(cta.cta_url, /ads\/library/)
})

test('shapeRecentAdForSync never includes link_url and never ships unsafe CTAs', () => {
  const shaped = shapeRecentAdForSync(
    {
      id: 'abc',
      offer_name: 'Peak Luxentria',
      geo: 'AU',
      main_text: 'hello',
      link_url: 'https://cleverlogicty.pro/click?token_fb=EAA&fbclid=x',
      post_url: 'https://www.facebook.com/x/posts/1',
    },
    { brandName: 'Peak Luxentria' },
  )
  assert.equal('link_url' in shaped, false)
  assert.equal(shaped.link_domain, 'cleverlogicty.pro')
  assert.equal(shaped.cta_url, 'https://www.facebook.com/x/posts/1')
  assert.equal(shapedAdHasUnsafeUrl(shaped), false)
})

test('shapedAdHasUnsafeUrl detects a leaked funnel URL', () => {
  assert.equal(
    shapedAdHasUnsafeUrl({
      cta_url: 'https://sharpminddump.info/click?token_fb=1',
    }),
    true,
  )
})

test('stripStructuredDupesFromArticle removes key-takeaways and faq-section wrappers', () => {
  const html = `
<p>Intro paras about the brand.</p>
<div class="key-takeaways"><section class="key-takeaways"><h3>⚠️ Key Takeaways</h3><ul><li>One</li></ul></section></div>
<p>More body.</p>
<div class="faq-section"><h2>📖 Frequently Asked Questions</h2><h3>Q?</h3><p>A</p></div>
<p>Footer note.</p>`
  const stripped = stripStructuredDupesFromArticle(html, { hasKeyTakeaways: true, hasFaq: true })
  assert.equal(/key-takeaways/i.test(stripped), false)
  assert.equal(/faq-section/i.test(stripped), false)
  assert.equal(/Frequently Asked Questions/i.test(stripped), false)
  assert.match(stripped, /Intro paras/)
  assert.match(stripped, /Footer note/)
})

test('stripStructuredDupesFromArticle removes styled FAQ heading chunk', () => {
  const html = `<h2>Evidence</h2><p>x</p>
<h2 style="color:red"><span>📖</span>Frequently Asked Questions</h2>
<h3>Is it a scam?</h3><p>Maybe.</p>
<h2>Sources</h2><p>y</p>`
  const stripped = stripStructuredDupesFromArticle(html, { hasKeyTakeaways: false, hasFaq: true })
  assert.equal(/Frequently Asked Questions/i.test(stripped), false)
  assert.match(stripped, /Evidence/)
  assert.match(stripped, /Sources/)
})

test('sanitizeItemReviewedUrl rejects Trustpilot and prefers brand origin', () => {
  assert.equal(
    sanitizeItemReviewedUrl('https://www.trustpilot.com/review/peak-luxentria.com', {
      brandOrigin: 'https://peak-luxentria.com/home',
    }),
    'https://peak-luxentria.com/',
  )
  assert.equal(
    sanitizeItemReviewedUrl('https://www.trustpilot.com/review/peak-luxentria.com', {}),
    null,
  )
})

test('sanitizeItemReviewedUrl rejects unsafe click landers', () => {
  assert.equal(
    sanitizeItemReviewedUrl('https://peak-luxentria.com/click?token_fb=1'),
    null,
  )
})

test('pickBrandOrigin skips click trackers', () => {
  assert.equal(
    pickBrandOrigin([
      'https://cleverlogicty.pro/click?token_fb=1',
      'https://peak-luxentria.com/welcome',
    ]),
    'https://peak-luxentria.com/',
  )
})

test('composeSeoFields truncates mid-sentence titles and meta at word boundaries', () => {
  const longHeadline =
    'Peak Luxentria Under the Microscope: What Australian Investors Should Know in 2026'
  const longMeta =
    "Peak Luxentria scores 11/100 on Crypto Killer's threat index. Our 2026 surveillance review examines ad patterns, celebrity impersonation signals, and Australian targeting evidence."
  const { seo_title, title, meta_description } = composeSeoFields({
    title: longHeadline,
    meta: longMeta,
  })
  assert.ok(seo_title.length <= SEO_TITLE_MAX)
  assert.equal(title, seo_title)
  assert.ok(meta_description.length <= META_DESCRIPTION_MAX)
  assert.equal(/Australia…$|Australian$/.test(meta_description) || meta_description.endsWith('signals'), true)
  // Must not end mid-word with a hard ellipsis from slice
  assert.equal(meta_description.includes('Australia…'), false)
})

test('countPlainWords strips tags', () => {
  assert.equal(countPlainWords('<p>One two</p><h2>Three</h2>'), 3)
})

test('Peak-like fixture: strip dupes then word_count drops and SEO fields stay safe', () => {
  const body = Array.from({ length: 80 }, (_, i) => `<p>Evidence paragraph ${i} about Peak Luxentria ads.</p>`).join('\n')
  const html = `${body}
<div class="key-takeaways"><h3>Key Takeaways</h3><ul><li>${'word '.repeat(40)}</li></ul></div>
<h2><span>FAQ</span> Frequently Asked Questions</h2>
<p>${'answer '.repeat(40)}</p>
<h2>Sources</h2><p>FCA warning.</p>`
  const stripped = stripStructuredDupesFromArticle(html, { hasKeyTakeaways: true, hasFaq: true })
  assert.equal(/Key Takeaways/i.test(stripped), false)
  assert.equal(/Frequently Asked Questions/i.test(stripped), false)
  assert.match(stripped, /Evidence paragraph 0/)
  assert.match(stripped, /Sources/)
  const before = countPlainWords(html)
  const after = countPlainWords(stripped)
  assert.ok(after < before, `expected post-strip words ${after} < pre-strip ${before}`)
  const seo = composeSeoFields({
    title: 'Peak Luxentria Review [2026]: Celebrity Ads and Investor Risk Signals Across Australia',
    meta: 'Peak Luxentria investigation covers celebrity impersonation, Meta ad velocity, and investor risk signals across Australia targeting patterns.',
  })
  assert.ok(seo.seo_title.length <= SEO_TITLE_MAX)
  assert.ok(seo.meta_description.length <= META_DESCRIPTION_MAX)
  assert.equal(seo.meta_description.includes('Australia…'), false)
})
