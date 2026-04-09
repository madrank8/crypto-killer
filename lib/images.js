/**
 * Image Pipeline: Unsplash → TinyPNG → Supabase Storage
 *
 * Fetches topic-based crypto/scam imagery from Unsplash,
 * compresses via TinyPNG, uploads to Supabase Storage,
 * and returns public URLs with attribution.
 */

import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY } from '@/lib/supabase';

const UNSPLASH_API = 'https://api.unsplash.com';
const TINYPNG_API = 'https://api.tinify.com/shrink';
const STORAGE_BUCKET = 'visuals';

// ─── Topic-based search queries (generic crypto/scam imagery) ───
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
  if (!key) throw new Error('Missing TINYPNG_API_KEY env var');

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
 * Pick a random query from a list, optionally seeded by a string for consistency.
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
 * Full pipeline: Search → Pick best → Compress → Upload → Return URL + credit.
 *
 * @param {Object} options
 * @param {'hero'|'content'} options.type - Image purpose
 * @param {string} [options.seed] - Seed string for consistent query selection (e.g. brand slug)
 * @param {string} [options.customQuery] - Override the search query
 * @param {string} [options.filename] - Custom filename (without extension)
 * @returns {Promise<{url, alt, credit, creditUrl, originalSize, compressedSize}>}
 */
async function generateImage({ type = 'hero', seed = '', customQuery = '', filename = '' } = {}) {
  const queries = type === 'hero' ? HERO_QUERIES : CONTENT_QUERIES;
  const query = customQuery || pickQuery(queries, seed);

  // 1. Search Unsplash
  const photos = await searchUnsplash(query, {
    count: 5,
    orientation: type === 'hero' ? 'landscape' : 'landscape',
  });

  if (!photos.length) throw new Error(`No Unsplash results for: ${query}`);

  // Pick the first (most relevant) result
  const photo = photos[0];

  // 2. Track download (Unsplash ToS)
  trackUnsplashDownload(photo.downloadUrl);

  // 3. Compress via TinyPNG
  const compressed = await compressWithTinyPNG(photo.url);

  // 4. Upload to Supabase Storage
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
  };
}

/**
 * Generate a full image set for a review/post:
 * 1 hero image + 1-2 content images.
 *
 * @param {string} slug - Used for consistent filenames and query seeding
 * @param {Object} [options]
 * @param {number} [options.contentCount=1] - Number of content images (1-2)
 * @returns {Promise<{hero, contentImages[]}>}
 */
async function generateImageSet(slug, { contentCount = 1 } = {}) {
  const errors = [];

  // Generate hero image
  let hero = null;
  try {
    hero = await generateImage({
      type: 'hero',
      seed: slug,
      filename: `hero-${slug}`,
    });
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
      const img = await generateImage({
        type: 'content',
        seed: `${slug}-${i}`,
        filename: `content-${slug}-${i}`,
      });
      contentImages.push({
        ...img,
        placement: placements[i] || `section-${i}`,
      });
    } catch (e) {
      errors.push(`Content ${i}: ${e.message}`);
      console.error(`[images] Content image ${i} failed:`, e.message);
    }
  }

  return { hero, contentImages, errors };
}

export {
  searchUnsplash,
  trackUnsplashDownload,
  compressWithTinyPNG,
  uploadToSupabase,
  generateImage,
  generateImageSet,
  HERO_QUERIES,
  CONTENT_QUERIES,
};
