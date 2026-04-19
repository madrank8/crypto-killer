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

// ─── Midjourney prompts — editorial photography style, NOT AI art ───
// Goal: look like real photojournalism / stock photography, never "AI generated"
const HERO_PROMPTS = [
  'overhead shot of a person at a messy desk with laptop open showing financial charts, coffee cup, scattered papers and sticky notes, natural window light, editorial photography, Canon EOS R5, 35mm lens',
  'close-up of hands typing on a laptop keyboard in a dimly lit room, screen reflecting on the person face, shallow depth of field, natural ambient light, documentary photography style',
  'person sitting alone at a kitchen table late at night staring at phone screen with worried expression, single overhead lamp lighting, photojournalistic style, Fuji X-T4, 23mm f1.4',
  'office worker at standing desk with dual monitors showing trading charts, modern open-plan office with other workers blurred in background, natural daylight from large windows, editorial style',
  'close-up of a smartphone screen showing a suspicious text message, person thumb hovering over the screen, blurred coffee shop background with bokeh, natural light, 85mm portrait lens',
  'journalist workspace with notepad, pen, open laptop and printed documents spread across wooden desk, warm desk lamp light, top-down flat lay, lifestyle photography',
  'person on park bench looking at tablet with concerned expression, autumn leaves on ground, overcast natural light, candid street photography style, 50mm lens',
  'stack of printed financial documents with highlighted sections next to an open laptop, reading glasses resting on papers, shallow depth of field, natural side light from window',
  'two people having a serious conversation across a cafe table, one showing the other something on phone screen, natural window light, candid moment, 35mm documentary style',
  'night scene of person in home office illuminated only by computer monitor glow, back to camera, silhouette against bright screen, real ambient light only, photojournalistic',
];

const CONTENT_PROMPTS = [
  'close-up of a padlock on a metal chain-link fence, shallow depth of field with blurred urban background, golden hour side light, Nikon Z6, 85mm',
  'person scrolling through social media feed on phone at coffee shop, over-the-shoulder perspective, warm indoor ambient light, candid lifestyle photography',
  'close-up of printed bank statement with pen marks and circles around certain transactions, shallow depth of field, natural desk light',
  'security camera mounted on exterior brick wall of building, slightly low angle, overcast sky, urban documentary photography style',
  'lawyer or professional reviewing documents at conference table, manila folders and laptop visible, corporate office natural light, editorial portrait style',
  'close-up of someone hands holding a credit card near a laptop, hesitant posture, kitchen table setting, soft natural light from nearby window',
  'old smartphone with cracked screen lying on a desk next to a notebook with handwritten notes, flat lay perspective, natural overhead light',
  'courtroom interior, empty wooden bench and judge chair, diffused light through high windows, architectural documentary photography',
  'person walking through financial district with tall buildings, motion blur on the person while buildings stay sharp, street photography, 24mm wide angle',
  'close-up of a browser address bar showing a URL on a computer monitor, finger pointing at screen, shallow depth of field, office ambient lighting',
];


// ─── Unsplash queries — specific, photographable scenes ───
const HERO_QUERIES = [
  'person laptop night worried',
  'office desk computer work',
  'smartphone notification hand',
  'financial documents desk',
  'person reading phone concern',
  'home office late night',
  'laptop coffee table working',
  'business meeting serious',
  'computer screen dark room',
  'journalist desk notepad laptop',
];

const CONTENT_QUERIES = [
  'padlock fence security',
  'phone social media scroll',
  'bank statement documents',
  'security camera building',
  'lawyer office documents',
  'credit card online shopping',
  'old phone desk notes',
  'courtroom empty interior',
  'financial district walking',
  'computer screen close up',
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
  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL');

  const path = `${STORAGE_BUCKET}/${filename}`;
  const url = `${SUPABASE_URL}/storage/v1/object/${path}`;

  // Try service role key first, fall back to anon key if it fails (e.g. corrupted key)
  const keysToTry = [SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY].filter(Boolean);
  if (keysToTry.length === 0) throw new Error('Missing Supabase auth keys');

  let lastError = null;
  for (const key of keysToTry) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': contentType,
          'x-upsert': 'true',
        },
        body: buffer,
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        return `${SUPABASE_URL}/storage/v1/object/public/${path}`;
      }

      const text = await res.text().catch(() => '');
      lastError = `Supabase upload ${res.status}: ${text.slice(0, 200)}`;

      // If auth error, try next key
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        console.warn(`[images] Upload auth failed with key, trying next: ${lastError}`);
        continue;
      }
      // Other errors — don't retry
      throw new Error(lastError);
    } catch (err) {
      if (err.message?.startsWith('Supabase upload')) throw err;
      lastError = err.message;
    }
  }

  throw new Error(`Supabase upload failed: ${lastError}`);
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
async function generateImage({ type = 'hero', seed = '', customQuery = '', filename = '', onProgress, maxMjWaitMs, maxMjRetries } = {}) {
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
        ...(maxMjWaitMs ? { maxWaitMs: maxMjWaitMs } : {}),
        ...(maxMjRetries != null ? { maxRetries: maxMjRetries } : {}),
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
  // Use customQuery if it's a short Unsplash-style query (under 60 chars).
  // Reject long MJ-style prompts (they return zero Unsplash results).
  const query = (customQuery && customQuery.length < 60)
    ? customQuery
    : pickQuery(queries, seed);

  console.log(`[images] Unsplash for ${type}: "${query}"${customQuery && customQuery.length >= 60 ? ' (rejected long MJ prompt, using fallback)' : ''}`)

  // Search Unsplash
  let photos;
  try {
    photos = await searchUnsplash(query, {
      count: 5,
      orientation: 'landscape',
    });
  } catch (searchErr) {
    console.error(`[images] Unsplash search failed: ${searchErr.message}`)
    throw searchErr;
  }

  if (!photos.length) {
    console.error(`[images] Unsplash returned 0 results for: "${query}"`)
    throw new Error(`No Unsplash results for: ${query}`);
  }

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
async function generateImageSet(slug, { contentCount = 1, onProgress, maxMjWaitMs, maxMjRetries } = {}) {
  const errors = [];

  // Generate hero image
  let hero = null;
  try {
    if (onProgress) onProgress('hero', 'starting', 0);
    hero = await generateImage({
      type: 'hero',
      seed: slug,
      filename: `hero-${slug}`,
      maxMjWaitMs,
      maxMjRetries,
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
        maxMjWaitMs,
        maxMjRetries,
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
async function generateImageQueries(article, aiHelpers, { forceUnsplash = false } = {}) {
  const { callModel, extractJSON } = aiHelpers || {}
  if (!callModel || !extractJSON) {
    return {
      heroQuery: pickQuery(HERO_QUERIES, article?.slug || ''),
      sectionQueries: CONTENT_QUERIES.slice(0, 3),
      queryType: 'unsplash',
    }
  }

  const sectionHeadings = (article.sections || [])
    .map(s => s.heading || '')
    .filter(Boolean)
    .join(', ')

  const useMJ = !!APIFRAME_API_KEY && !forceUnsplash;

  const system = useMJ
    ? `You generate Midjourney prompts that look like REAL editorial photography — NOT AI art.
Return ONLY valid JSON — no markdown fences.
{
  "hero_query": "A Midjourney prompt styled as real photojournalism",
  "section_queries": ["prompt for section 1", "prompt for section 2", ...]
}
Rules:
- Every prompt MUST look like a photo a real photographer took. Think Reuters, Bloomberg, or NYT editorial photography.
- ALWAYS include a real camera reference (Canon EOS R5, Nikon Z6, Fuji X-T4, Sony A7IV) and a real lens (35mm, 50mm, 85mm).
- Use NATURAL lighting only: window light, desk lamp, ambient, overcast sky, golden hour. NEVER "cinematic lighting" or "dramatic lighting".
- Show real-world scenes: people at desks, hands on keyboards, phones in hands, documents on tables, office interiors, courtrooms, city streets.
- NEVER use: holographic, glowing, neon, cyberpunk, 3D render, digital art, ultra detailed, hyper realistic, cinematic, futuristic, dystopian, abstract visualization.
- Include imperfections: messy desk, wrinkled shirt, coffee stain, worn furniture.
- Avoid banned words: scam, fraud, hack, attack, kill, death, weapon, gun, blood, violence, drug, nude.
- Return exactly ${Math.min(sectionHeadings.split(',').length, 5)} section queries.`
    : `You are an expert photo editor choosing images for a professional investigative article about online risks.
Return ONLY valid JSON — no markdown fences.
{
  "hero_query": "Unsplash search query for the hero image",
  "section_queries": ["query for section 1", "query for section 2", ...]
}

CRITICAL RULES FOR HIGH-QUALITY UNSPLASH RESULTS:
- Each query must be 3-6 words that describe a REAL photographed scene.
- Think like a magazine photo editor: what dramatic, emotional, or striking real-world photo would grab a reader?
- HERO image must be visually STRIKING — think editorial covers. Use emotive, specific scenes.
- NEVER use tech jargon or abstract concepts: "cybersecurity", "blockchain", "digital protection", "cryptocurrency" — these return ugly stock graphics.
- ALWAYS use concrete, physical, emotional terms that real photographers shoot.

GREAT hero queries (dramatic, editorial):
- "stressed man laptop dark room" — moody, editorial feel
- "empty wallet table despair" — emotional, tells a story
- "detective investigation desk files" — journalistic, intriguing
- "shattered phone screen close up" — striking, tactile
- "person shadow alley night" — atmospheric, noir
- "gavel courtroom dramatic light" — powerful, authoritative
- "red warning light industrial" — urgent, attention-grabbing
- "hands typing keyboard urgent" — tension, immediacy

GREAT section queries (specific to topic):
- "fingerprint scanner security" — for identity/verification sections
- "tangled cables mess" — for "how it works" complexity sections
- "handshake business meeting" — for trust/relationship sections
- "map pins travel planning" — for geographic/targeting sections
- "newspaper headlines stack" — for news/evidence sections
- "lock chain door" — for protection/safety sections

BAD queries (too abstract, return ugly results):
- "crypto fraud warning" ❌
- "digital scam protection" ❌
- "online security risk" ❌
- "financial technology" ❌

Each query should feel like you're describing a real photograph you've seen in a magazine.
Return exactly ${Math.min(sectionHeadings.split(',').length, 5)} section queries.`

  const user = `Article: "${article.title || article.headline || ''}"
Topic: ${article.target_keyword || 'online safety'}
Summary: ${(article.summary || '').slice(0, 200)}
Sections: ${sectionHeadings}

Generate ${useMJ ? 'Midjourney prompts' : 'Unsplash search queries'} — each one must be specific to the article content above, not generic.`

  try {
    const result = await callModel('claude-haiku', system, user, { timeoutMs: 15000 })
    const parsed = extractJSON(result.text)
    if (parsed?.hero_query && Array.isArray(parsed?.section_queries)) {
      return {
        heroQuery: parsed.hero_query,
        sectionQueries: parsed.section_queries,
        queryType: useMJ ? 'midjourney' : 'unsplash',
      }
    }
  } catch (err) {
    console.error('[images] AI query generation failed:', err.message)
  }

  // Fallback
  return {
    heroQuery: pickQuery(HERO_QUERIES, article?.slug || ''),
    sectionQueries: CONTENT_QUERIES.slice(0, 3),
    queryType: 'unsplash',
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
async function generateArticleImages(slug, article, { contentCount = 2, aiHelpers, onProgress, maxMjWaitMs, maxMjRetries } = {}) {
  const errors = []

  // Step 1: Generate context-aware prompts
  // When MJ is being skipped (maxMjWaitMs <= 1), force Unsplash-style queries
  const skipMJ = maxMjWaitMs != null && maxMjWaitMs <= 1
  let queries = { heroQuery: '', sectionQueries: [], queryType: 'unsplash' }
  try {
    queries = await generateImageQueries(article, aiHelpers, { forceUnsplash: skipMJ })
    console.log(`[images] AI ${queries.queryType} queries → hero: "${queries.heroQuery.slice(0, 60)}...", ${queries.sectionQueries.length} sections`)
  } catch (err) {
    console.error('[images] Prompt generation failed, using fallback:', err.message)
    queries = {
      heroQuery: pickQuery(HERO_QUERIES, slug),
      sectionQueries: CONTENT_QUERIES.slice(0, contentCount),
      queryType: 'unsplash',
    }
  }

  // Step 2: Generate ALL images in parallel (hero + content)
  // This is critical for Midjourney which takes 60-120s per image —
  // sequential would exceed the 300s function timeout.
  const clampedCount = Math.min(Math.max(contentCount, 0), 3)

  const heroPromise = generateImage({
    type: 'hero',
    seed: slug,
    customQuery: queries.heroQuery,
    filename: `hero-${slug}`,
    maxMjWaitMs,
    maxMjRetries,
    onProgress: onProgress ? (status, elapsed) => onProgress('hero', status, elapsed) : undefined,
  }).catch(async (e) => {
    errors.push(`Hero: ${e.message}`)
    console.error('[images] Hero generation failed:', e.message)
    // Retry with fallback generic prompt (skip MJ on retry — go straight to Unsplash)
    try {
      return await generateImage({ type: 'hero', seed: slug, filename: `hero-${slug}`, maxMjWaitMs: 1, maxMjRetries: 0 })
    } catch (retryErr) {
      errors.push(`Hero retry: ${retryErr.message}`)
      return null
    }
  })

  const contentPromises = Array.from({ length: clampedCount }, (_, i) => {
    const sectionQuery = queries.sectionQueries[i] || ''
    return generateImage({
      type: 'content',
      seed: `${slug}-${i}`,
      customQuery: sectionQuery,
      filename: `content-${slug}-${i}`,
      maxMjWaitMs,
      maxMjRetries,
      onProgress: onProgress ? (status, elapsed) => onProgress(`content-${i}`, status, elapsed) : undefined,
    }).then(img => ({
      ...img,
      placement: `section-${i + 1}`,
      sectionIndex: i,
    })).catch(e => {
      errors.push(`Content ${i}: ${e.message}`)
      console.error(`[images] Content image ${i} failed:`, e.message)
      return null
    })
  })

  console.log(`[images] Generating ${1 + clampedCount} images in parallel...`)
  const [hero, ...contentResults] = await Promise.all([heroPromise, ...contentPromises])
  const contentImages = contentResults.filter(Boolean)
  console.log(`[images] Done: hero=${!!hero}, content=${contentImages.length}, errors=${errors.length}`)

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
