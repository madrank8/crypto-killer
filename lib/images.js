/**
 * Image Pipeline: Midjourney → TinyPNG → Supabase Storage
 *
 * Generates high-quality Midjourney images via APIFrame,
 * compresses via TinyPNG, uploads to Supabase Storage,
 * and returns public URLs.
 *
 * Fallback chain: Midjourney → Unsplash (if MJ fails or no API key)
 */

import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY } from '@/lib/supabase';
import { generateMidjourneyImage, APIFRAME_API_KEY } from '@/lib/midjourney';

const UNSPLASH_API = 'https://api.unsplash.com';
const TINYPNG_API = 'https://api.tinify.com/shrink';
const STORAGE_BUCKET = 'visuals';

// ─── Midjourney-style art prompts (replaces old Unsplash search queries) ───
const HERO_PROMPTS = [
  'dramatic cryptocurrency trading desk with holographic charts, dark moody atmosphere, cinematic lighting, ultra detailed digital art',
  'abstract blockchain network visualization with glowing nodes and connections, dark blue and gold theme, cinematic lighting',
  'futuristic cybersecurity control room with warning screens, red alert lights, dark atmosphere, photorealistic',
  'digital shield protecting against cyber threats, glowing neon edges, dark background, dramatic lighting, 3D render',
  'mysterious hacker silhouette behind multiple screens showing crypto data, dark moody, cinematic teal and orange',
  'golden bitcoin melting into digital fragments, dark void background, dramatic lighting, hyper detailed photography',
  'person examining suspicious crypto investment on screen, film noir style, dramatic shadows, moody atmosphere',
  'shattered glass with cryptocurrency symbols falling through, dark background, dramatic lighting, cinematic composition',
  'dystopian cityscape with blockchain data streams in the sky, cyberpunk aesthetic, neon blue and purple',
  'magnifying glass over suspicious financial data on screen, detective investigation theme, moody dark lighting',
];

const CONTENT_PROMPTS = [
  'close up of a digital lock with glowing code streams, cybersecurity theme, dark background, cinematic lighting',
  'person analyzing data charts on multiple monitors, dark office, blue glow from screens, photorealistic',
  'warning sign with digital glitch effect, red and dark theme, dramatic lighting, 3D render',
  'forensic investigator examining digital evidence on screen, dark moody atmosphere, film noir style',
  'money dissolving into digital particles, dark void background, dramatic golden lighting, hyper detailed',
  'surveillance camera network with digital overlay, dark monitoring room, dystopian atmosphere',
  'shield icon with blockchain verification marks, glowing neon on dark background, minimalist 3D render',
  'courtroom gavel with digital overlay effects, justice theme, dark dramatic lighting, cinematic',
  'tangled web of financial connections visualized as glowing network, dark background, data visualization art',
  'person receiving suspicious message on phone, close up, worried expression, moody dark lighting',
];


// ─── Unsplash queries (FALLBACK ONLY when Midjourney is unavailable) ───
const HERO_QUERIES = [
  'cryptocurrency warning',
  'bitcoin security',
  'cyber fraud',
  'digital scam protection',
  'online fraud warning',
  'cryptocurrency dark',
  'blockchain security',
  'financial scam',
  'phishing cyber',
  'crypto trading risk',
];

const CONTENT_QUERIES = [
  'cybersecurity protection',
  'digital security lock',
  'hacker dark web',
  'financial protection shield',
  'warning sign danger',
  'detective investigation',
  'money laundering',
  'identity theft protection',
  'computer security code',
  'surveillance monitoring',
];


/**
 * Search Unsplash for images matching a query.
 * Used as a FALLBACK when Midjourney is unavailable.
 * Returns array of { id, url, alt, credit, downloadUrl, width, height }
 */
async function searchUnsplash(query, { count = 5, orientation = 'landscape' } = {}) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) throw new Error('Missing UNSPLASH_ACCESS_KEY env var');

  const params = new URLSearchParams({
    query,
    per_page: String(count),
    orientation,
    content_filter: 'high', // safe content only
  });

  const res = await fetch(`${UNSPLASH_API}/search/photos?${params}`, {
    headers: { Authorization: `Client-ID ${key}` },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Unsplash API ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.results || []).map(photo => ({
    id: photo.id,
    url: photo.urls?.regular || photo.urls?.small, // 1080px wide
    smallUrl: photo.urls?.small, // 400px wide
    alt: photo.alt_description || photo.description || query,
    credit: `Photo by ${photo.user?.name || 'Unknown'} on Unsplash`,
    creditUrl: photo.user?.links?.html || 'https://unsplash.com',
    downloadUrl: photo.links?.download_location, // for Unsplash ToS tracking
    width: photo.width,
    height: photo.height,
  }));
}

/**
 * Trigger Unsplash download event (required by Unsplash API ToS).
 * Fire-and-forget — don't block on this.
 */
async function trackUnsplashDownload(downloadUrl) {
  if (!downloadUrl) return;
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return;
  try {
    await fetch(downloadUrl, {
      headers: { Authorization: `Client-ID ${key}` },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Non-critical — best effort
  }
}

/**
 * Compress an image via TinyPNG.
 * Accepts a URL or a Buffer. Returns the compressed image as a Buffer.
 */
async function compressWithTinyPNG(imageSource) {
  const key = process.env.TINYPNG_API_KEY;
  if (!key) {
    // If no TinyPNG key, skip compression — download raw image
    console.warn('[images] No TINYPNG_API_KEY — skipping compression');
    if (typeof imageSource === 'string') {
      const res = await fetch(imageSource, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`Image download failed: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get('content-type') || 'image/jpeg';
      return { buffer, size: buffer.length, originalSize: buffer.length, ratio: 1, type: contentType };
    }
    return { buffer: imageSource, size: imageSource.length, originalSize: imageSource.length, ratio: 1, type: 'image/jpeg' };
  }

  const auth = Buffer.from(`api:${key}`).toString('base64');
  let body;
  let headers = { Authorization: `Basic ${auth}` };

  if (typeof imageSource === 'string') {
    // URL-based compression — TinyPNG fetches the image itself
    body = JSON.stringify({ source: { url: imageSource } });
    headers['Content-Type'] = 'application/json';
  } else {
    // Buffer-based compression
    body = imageSource;
    headers['Content-Type'] = 'application/octet-stream';
  }

  const res = await fetch(TINYPNG_API, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`TinyPNG API ${res.status}: ${text.slice(0, 200)}`);
  }

  const result = await res.json();
  const outputUrl = result.output?.url;
  if (!outputUrl) throw new Error('TinyPNG returned no output URL');

  // Download the compressed image
  const compressed = await fetch(outputUrl, { signal: AbortSignal.timeout(15000) });
  if (!compressed.ok) throw new Error(`TinyPNG download failed: ${compressed.status}`);

  const buffer = Buffer.from(await compressed.arrayBuffer());
  return {
    buffer,
    size: result.output?.size || buffer.length,
    originalSize: result.input?.size || 0,
    ratio: result.output?.ratio || 1,
    type: result.output?.type || 'image/jpeg',
  };
}

/**
 * Upload a compressed image buffer to Supabase Storage.
 * Returns the public URL.
 */
async function uploadToSupabase(buffer, filename, contentType = 'image/jpeg') {
  const writeKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !writeKey) throw new Error('Missing Supabase config');

  const path = `${STORAGE_BUCKET}/${filename}`;
  const url = `${SUPABASE_URL}/storage/v1/object/${path}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${writeKey}`,
      'Content-Type': contentType,
      'x-upsert': 'true', // overwrite if exists
    },
    body: buffer,
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase upload failed ${res.status}: ${text.slice(0, 200)}`);
  }

  // Return the public URL
  return `${SUPABASE_URL}/storage/v1/object/public/${path}`;
}

/**
 * Pick a random prompt from a list, optionally seeded by a string for consistency.
 */
function pickQuery(queries, seed = '') {
  if (seed) {
    // Simple hash to get consistent results for the same seed
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
    }
    return queries[Math.abs(hash) % queries.length];
  }
  return queries[Math.floor(Math.random() * queries.length)];
}

/**
 * Generate an image via Midjourney (primary) or Unsplash (fallback).
 *
 * Full pipeline: Midjourney → Compress → Upload → Return URL.
 * If Midjourney fails or is unconfigured, falls back to Unsplash.
 *
 * @param {Object} options
 * @param {'hero'|'content'} options.type - Image purpose
 * @param {string} [options.seed] - Seed string for consistent prompt selection
 * @param {string} [options.customQuery] - Override the prompt/query
 * @param {string} [options.filename] - Custom filename (without extension)
 * @param {Function} [options.onProgress] - Progress callback for MJ polling
 * @returns {Promise<{url, alt, credit, creditUrl, originalSize, compressedSize, source}>}
 */
async function generateImage({ type = 'hero', seed = '', customQuery = '', filename = '', onProgress } = {}) {
  const useMidjourney = !!APIFRAME_API_KEY;

  // ═══════════════════════════════════════════════════════
  // PRIMARY: Midjourney via APIFrame
  // ═══════════════════════════════════════════════════════
  if (useMidjourney) {
    const prompts = type === 'hero' ? HERO_PROMPTS : CONTENT_PROMPTS;
    const prompt = customQuery || pickQuery(prompts, seed);

    try {
      console.log(`[images] Generating ${type} via Midjourney: "${prompt.slice(0, 80)}..."`)

      const mjResult = await generateMidjourneyImage(prompt, {
        aspectRatio: type === 'hero' ? '16:9' : '3:2',
        mode: 'fast',
        onProgress: onProgress || ((status, elapsed) => {
          console.log(`[images] MJ ${type}: ${status} (${elapsed}s)`)
        }),
      });

      // Compress the MJ image (they're often 2-5MB)
      let compressed;
      try {
        compressed = await compressWithTinyPNG(mjResult.url);
      } catch (compErr) {
        // If compression fails, download raw
        console.warn('[images] Compression failed, using raw MJ image:', compErr.message);
        const rawRes = await fetch(mjResult.url, { signal: AbortSignal.timeout(30000) });
        if (!rawRes.ok) throw new Error(`MJ image download failed: ${rawRes.status}`);
        const rawBuf = Buffer.from(await rawRes.arrayBuffer());
        compressed = { buffer: rawBuf, size: rawBuf.length, originalSize: rawBuf.length, ratio: 1, type: 'image/png' };
      }

      // Upload to Supabase
      const ext = compressed.type.includes('png') ? 'png' : 'jpg';
      const fname = filename || `${type}-mj-${Date.now()}`;
      const publicUrl = await uploadToSupabase(
        compressed.buffer,
        `${fname}.${ext}`,
        compressed.type
      );

      return {
        url: publicUrl,
        alt: prompt.slice(0, 120),
        credit: 'Generated by Midjourney',
        creditUrl: 'https://www.midjourney.com',
        midjourneyTaskId: mjResult.taskId,
        query: prompt,
        originalSize: compressed.originalSize,
        compressedSize: compressed.size,
        compressionRatio: compressed.ratio,
        source: 'midjourney',
      };

    } catch (mjErr) {
      console.error(`[images] Midjourney ${type} failed, trying Unsplash fallback:`, mjErr.message);
      // Fall through to Unsplash
    }
  }

  // ═══════════════════════════════════════════════════════
  // FALLBACK: Unsplash
  // ═══════════════════════════════════════════════════════
  const queries = type === 'hero' ? HERO_QUERIES : CONTENT_QUERIES;
  const query = customQuery || pickQuery(queries, seed);

  // Search Unsplash
  const photos = await searchUnsplash(query, {
    count: 5,
    orientation: 'landscape',
  });

  if (!photos.length) throw new Error(`No Unsplash results for: ${query}`);

  // Pick the first (most relevant) result
  const photo = photos[0];

  // Track download (Unsplash ToS)
  trackUnsplashDownload(photo.downloadUrl);

  // Compress via TinyPNG
  const compressed = await compressWithTinyPNG(photo.url);

  // Upload to Supabase Storage
  const ext = compressed.type.includes('png') ? 'png' : 'jpg';
  const fname = filename || `${type}-${photo.id}-${Date.now()}`;
  const publicUrl = await uploadToSupabase(
    compressed.buffer,
    `${fname}.${ext}`,
    compressed.type
  );

  return {
    url: publicUrl,
    alt: photo.alt,
    credit: photo.credit,
    creditUrl: photo.creditUrl,
    unsplashId: photo.id,
    query,
    originalSize: compressed.originalSize,
    compressedSize: compressed.size,
    compressionRatio: compressed.ratio,
    source: 'unsplash',
  };
}

/**
 * Generate a full image set for a review/post:
 * 1 hero image + 1-2 content images.
 *
 * @param {string} slug - Used for consistent filenames and query seeding
 * @param {Object} [options]
 * @param {number} [options.contentCount=1] - Number of content images (1-2)
 * @param {Function} [options.onProgress] - Progress callback: (step, status, elapsed) => void
 * @returns {Promise<{hero, contentImages[], errors[]}>}
 */
async function generateImageSet(slug, { contentCount = 1, onProgress } = {}) {
  const errors = [];

  // Generate hero image
  let hero = null;
  try {
    if (onProgress) onProgress('hero', 'starting', 0);
    hero = await generateImage({
      type: 'hero',
      seed: slug,
      filename: `hero-${slug}`,
      onProgress: onProgress ? (status, elapsed) => onProgress('hero', status, elapsed) : undefined,
    });
    if (onProgress) onProgress('hero', 'complete', 0);
  } catch (e) {
    errors.push(`Hero: ${e.message}`);
    console.error('[images] Hero generation failed:', e.message);
  }

  // Generate content images
  const contentImages = [];
  const placements = ['section-1', 'section-2'];
  const clampedCount = Math.min(Math.max(contentCount, 0), 2);

  for (let i = 0; i < clampedCount; i++) {
    try {
      if (onProgress) onProgress(`content-${i}`, 'starting', 0);
      const img = await generateImage({
        type: 'content',
        seed: `${slug}-${i}`,
        filename: `content-${slug}-${i}`,
        onProgress: onProgress ? (status, elapsed) => onProgress(`content-${i}`, status, elapsed) : undefined,
      });
      contentImages.push({
        ...img,
        placement: placements[i] || `section-${i}`,
      });
      if (onProgress) onProgress(`content-${i}`, 'complete', 0);
    } catch (e) {
      errors.push(`Content ${i}: ${e.message}`);
      console.error(`[images] Content image ${i} failed:`, e.message);
    }
  }

  return { hero, contentImages, errors };
}

/**
 * Generate context-aware Midjourney prompts from article content.
 * Uses AI to create visually rich MJ prompts instead of Unsplash search queries.
 *
 * @param {Object} article - Structured article data (title, sections, keyword, summary)
 * @param {Object} aiHelpers - { callModel, extractJSON } from ai-models
 * @returns {Promise<{ heroQuery: string, sectionQueries: string[] }>}
 */
async function generateImageQueries(article, aiHelpers) {
  const { callModel, extractJSON } = aiHelpers || {}
  if (!callModel || !extractJSON) {
    // Fallback to generic prompts if no AI helpers
    const useMJ = !!APIFRAME_API_KEY;
    return {
      heroQuery: pickQuery(useMJ ? HERO_PROMPTS : HERO_QUERIES, article?.slug || ''),
      sectionQueries: (useMJ ? CONTENT_PROMPTS : CONTENT_QUERIES).slice(0, 3),
    }
  }

  const sectionHeadings = (article.sections || [])
    .map(s => s.heading || '')
    .filter(Boolean)
    .join(', ')

  const useMJ = !!APIFRAME_API_KEY;

  // Different system prompts depending on whether we're using MJ or Unsplash
  const system = useMJ
    ? `You generate stunning Midjourney art prompts for a crypto/scam safety article.
Return ONLY valid JSON — no markdown fences.
{
  "hero_query": "A full Midjourney prompt for the hero image (cinematic, dramatic, detailed)",
  "section_queries": ["MJ prompt for section 1", "MJ prompt for section 2", ...]
}
Rules:
- Prompts should be HIGHLY VISUAL and CINEMATIC — think movie poster quality.
- Include style descriptors: lighting, mood, composition, camera angle.
- Use themes: dark moody atmosphere, neon accents, cyberpunk elements, dramatic lighting.
- Avoid banned words: scam, fraud, hack, attack, kill, death, weapon, gun, blood, violence, drug, nude.
- Use safe alternatives: scheme, risk, breach, incident, end, tool, etc.
- Hero should capture the article's core drama/tension visually.
- Each section prompt should match that section's specific theme.
- Good MJ prompt example: "close up of worried person looking at crypto trading screen showing losses, dark moody office, blue monitor glow, cinematic lighting, photorealistic, shallow depth of field"
- Return exactly ${Math.min(sectionHeadings.split(',').length, 5)} section queries.`
    : `You generate precise Unsplash search queries for a crypto/scam safety article.
Return ONLY valid JSON — no markdown fences.
{
  "hero_query": "2-4 word Unsplash search for the article hero image",
  "section_queries": ["query for section 1", "query for section 2", ...]
}
Rules:
- Queries must return REAL PHOTOS on Unsplash (not illustrations).
- Be specific and visual: "person looking at laptop screen" not "online fraud".
- Avoid abstract concepts. Think about what a photographer would capture.
- Hero should evoke the article's core emotion/scene.
- Each section query should match that section's specific topic.
- Never use words that return zero results: "scam dashboard", "fake profits", "crypto fraud".
- Good examples: "trading screen dark room", "person worried phone", "lock security close up", "warning sign red", "money transfer mobile", "detective magnifying glass", "courtroom gavel", "police investigation".
- Return exactly ${Math.min(sectionHeadings.split(',').length, 5)} section queries.`

  const user = `Article: ${article.title || article.headline || ''}
Keyword: ${article.target_keyword || ''}
Summary: ${article.summary || ''}
Sections: ${sectionHeadings}

Generate ${useMJ ? 'Midjourney art prompts' : 'Unsplash queries'}.`

  try {
    const result = await callModel('claude-haiku', system, user, { timeoutMs: 15000 })
    const parsed = extractJSON(result.text)
    if (parsed?.hero_query && Array.isArray(parsed?.section_queries)) {
      return {
        heroQuery: parsed.hero_query,
        sectionQueries: parsed.section_queries,
      }
    }
  } catch (err) {
    console.error('[images] AI query generation failed:', err.message)
  }

  // Fallback
  return {
    heroQuery: pickQuery(useMJ ? HERO_PROMPTS : HERO_QUERIES, article?.slug || ''),
    sectionQueries: (useMJ ? CONTENT_PROMPTS : CONTENT_QUERIES).slice(0, 3),
  }
}

/**
 * Generate a full, context-aware image set for an article:
 * 1 hero + up to 3 section images, all tailored to article content.
 *
 * Pipeline: AI prompt generation → Midjourney (or Unsplash fallback) → compression → Supabase upload
 *
 * @param {string} slug - Article slug for filenames
 * @param {Object} article - Full article data { title, summary, sections, target_keyword }
 * @param {Object} [options]
 * @param {number} [options.contentCount=2] - Number of section images (1-3)
 * @param {Object} [options.aiHelpers] - { callModel, extractJSON } for query generation
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<{hero, contentImages[], queries, errors[]}>}
 */
async function generateArticleImages(slug, article, { contentCount = 2, aiHelpers, onProgress } = {}) {
  const errors = []

  // Step 1: Generate context-aware prompts
  let queries = { heroQuery: '', sectionQueries: [] }
  try {
    queries = await generateImageQueries(article, aiHelpers)
    const source = APIFRAME_API_KEY ? 'Midjourney' : 'Unsplash';
    console.log(`[images] AI ${source} prompts → hero: "${queries.heroQuery.slice(0, 60)}...", ${queries.sectionQueries.length} sections`)
  } catch (err) {
    console.error('[images] Prompt generation failed, using fallback:', err.message)
    const useMJ = !!APIFRAME_API_KEY;
    queries = {
      heroQuery: pickQuery(useMJ ? HERO_PROMPTS : HERO_QUERIES, slug),
      sectionQueries: (useMJ ? CONTENT_PROMPTS : CONTENT_QUERIES).slice(0, contentCount),
    }
  }

  // Step 2: Generate hero image
  let hero = null
  try {
    if (onProgress) onProgress('hero', 'starting', 0);
    hero = await generateImage({
      type: 'hero',
      seed: slug,
      customQuery: queries.heroQuery,
      filename: `hero-${slug}`,
      onProgress: onProgress ? (status, elapsed) => onProgress('hero', status, elapsed) : undefined,
    })
  } catch (e) {
    errors.push(`Hero: ${e.message}`)
    console.error('[images] Hero generation failed:', e.message)
    // Retry with fallback generic prompt
    try {
      hero = await generateImage({
        type: 'hero',
        seed: slug,
        filename: `hero-${slug}`,
      })
    } catch (retryErr) {
      errors.push(`Hero retry: ${retryErr.message}`)
    }
  }

  // Step 3: Generate section images with context-aware prompts
  const contentImages = []
  const clampedCount = Math.min(Math.max(contentCount, 0), 3)

  for (let i = 0; i < clampedCount; i++) {
    const sectionQuery = queries.sectionQueries[i] || ''
    try {
      if (onProgress) onProgress(`content-${i}`, 'starting', 0);
      const img = await generateImage({
        type: 'content',
        seed: `${slug}-${i}`,
        customQuery: sectionQuery,
        filename: `content-${slug}-${i}`,
        onProgress: onProgress ? (status, elapsed) => onProgress(`content-${i}`, status, elapsed) : undefined,
      })
      contentImages.push({
        ...img,
        placement: `section-${i + 1}`,
        sectionIndex: i,
      })
    } catch (e) {
      errors.push(`Content ${i}: ${e.message}`)
      console.error(`[images] Content image ${i} failed:`, e.message)
    }
  }

  return { hero, contentImages, queries, errors }
}

/**
 * Strip previously injected images from article HTML.
 * Removes <figure> elements with classes article-hero-image and article-content-image.
 * Call this before re-injecting new images to avoid duplicates.
 *
 * @param {string} html - The full_article HTML string
 * @returns {string} HTML with injected images removed
 */
function stripInjectedImages(html) {
  if (!html) return html
  return html
    .replace(/<figure class="article-hero-image">[\s\S]*?<\/figure>\s*/g, '')
    .replace(/\s*<figure class="article-content-image">[\s\S]*?<\/figure>/g, '')
}

/**
 * Inject hero + content images into article HTML as <figure> elements.
 *
 * - Hero image: inserted as the first element (before everything else)
 * - Content images: inserted after the <h2> section matching their sectionIndex/placement
 *   (e.g., placement "section-1" → after the 2nd <h2> block, "section-2" → after the 3rd)
 *
 * This ensures images appear inline in the article body, not just in sidebar metadata.
 *
 * @param {string} html - The full_article HTML string
 * @param {Object} options
 * @param {Object} [options.hero] - { url, alt, credit }
 * @param {Array}  [options.contentImages] - [{ url, alt, credit, creditUrl, placement, sectionIndex }]
 * @returns {string} HTML with images injected
 */
function injectImagesIntoHtml(html, { hero, contentImages = [] } = {}) {
  if (!html) return html

  // Strip any previously injected images first (idempotent)
  let result = stripInjectedImages(html)

  // ── Inject hero image at the top ──
  if (hero?.url) {
    const heroFigure = `<figure class="article-hero-image">
<img src="${hero.url}" alt="${hero.alt || 'Article hero image'}" loading="eager" />
${hero.credit ? `<figcaption>Image: ${hero.credit}</figcaption>` : ''}
</figure>\n\n`

    // Insert before the first element
    result = heroFigure + result
  }

  // ── Inject content images after their target sections ──
  if (contentImages.length > 0) {
    // Split HTML on <h2> boundaries to identify sections
    // We'll find all <h2> positions and insert images after the section content
    const h2Regex = /<h2[^>]*>/gi
    const h2Positions = []
    let match
    while ((match = h2Regex.exec(result)) !== null) {
      h2Positions.push(match.index)
    }

    // Process images in reverse order (so indices don't shift)
    const sortedImages = [...contentImages]
      .map(img => {
        // Parse section index from placement like "section-1" or use sectionIndex
        const idx = typeof img.sectionIndex === 'number'
          ? img.sectionIndex
          : parseInt(String(img.placement || '').replace('section-', ''), 10) - 1
        return { ...img, parsedIdx: isNaN(idx) ? 0 : idx }
      })
      .sort((a, b) => b.parsedIdx - a.parsedIdx) // reverse order

    for (const img of sortedImages) {
      if (!img.url) continue

      const targetH2Idx = img.parsedIdx
      // The image goes after the section that starts at h2Positions[targetH2Idx]
      // We find the end of that section = start of the next <h2>, or end of HTML
      const sectionStart = h2Positions[targetH2Idx]
      if (sectionStart === undefined) continue

      const sectionEnd = h2Positions[targetH2Idx + 1] || result.length

      const creditHtml = img.credit
        ? `<figcaption>${img.credit}${img.creditUrl ? ` — <a href="${img.creditUrl}" target="_blank" rel="noopener noreferrer">source</a>` : ''}</figcaption>`
        : ''

      const imgFigure = `\n<figure class="article-content-image">
<img src="${img.url}" alt="${img.alt || 'Article image'}" loading="lazy" />
${creditHtml}
</figure>\n`

      // Insert right before the next section (or end of HTML)
      result = result.slice(0, sectionEnd) + imgFigure + result.slice(sectionEnd)
    }
  }

  return result
}

export {
  searchUnsplash,
  trackUnsplashDownload,
  compressWithTinyPNG,
  uploadToSupabase,
  generateImage,
  generateImageSet,
  generateArticleImages,
  generateImageQueries,
  injectImagesIntoHtml,
  stripInjectedImages,
  HERO_PROMPTS,
  HERO_QUERIES,
  CONTENT_PROMPTS,
  CONTENT_QUERIES,
};
