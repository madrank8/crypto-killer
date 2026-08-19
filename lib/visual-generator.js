/**
 * Visual Generator — Phase 4 Pipeline Module
 *
 * Parses visual placeholders from AI-generated content and replaces them
 * with actual rendered visuals:
 *   [CHART NEEDED: description | Alt: alt text]      → Chart.js chart via QuickChart.io
 *   [DIAGRAM NEEDED: description | Alt: alt text]     → Mermaid diagram via mermaid.ink
 *   [IMAGE NEEDED: description | Alt: alt text]       → AI image via Imagen (→ DALL-E 3 → Unsplash fallback)
 *   [SCREENSHOT NEEDED: description | Alt: alt text]  → AI image via Imagen (→ DALL-E 3 → Unsplash fallback)
 *
 * Generated images are uploaded to Supabase Storage for persistence.
 * Returns updated HTML with <figure> elements + visual metadata array.
 *
 * NOTE: Midjourney (APIFrame) was removed from the inline-image path because
 * its polling loop blew past the 60s Vercel Hobby function limit (matching
 * the fix already applied in lib/images.js for hero/section images).
 */

import { generateImagenImage, GOOGLE_AI_API_KEY } from '@/lib/imagen'
import { uploadToSupabase } from '@/lib/images'
import { tagAiGeneratedImage } from '@/lib/image-provenance'
import {
  reviveFailedVisualPlaceholders,
  stripFailedVisualPlaceholders,
  unwrapVisualPending,
} from '@/lib/visual-placeholders'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY

// ─── Placeholder Parsing ───

// Matches CHART, DIAGRAM, IMAGE, and SCREENSHOT placeholders
const PLACEHOLDER_REGEX = /\[(CHART|DIAGRAM|IMAGE|SCREENSHOT)(?:\s+NEEDED)?:\s*([^\]|]+?)(?:\s*\|\s*Alt:\s*([^\]]+?))?\]/gi
/**
 * Extract all visual placeholders from content (HTML or plain text).
 * Returns array of { type, description, altText, fullMatch, index }
 */
function parseVisualPlaceholders(content) {
  if (!content || typeof content !== 'string') return []

  const placeholders = []
  let match

  // Reset regex state
  PLACEHOLDER_REGEX.lastIndex = 0

  while ((match = PLACEHOLDER_REGEX.exec(content)) !== null) {
    // Normalize SCREENSHOT → IMAGE for processing
    const rawType = match[1].toUpperCase()
    const type = rawType === 'SCREENSHOT' ? 'IMAGE' : rawType

    placeholders.push({
      type,                                    // CHART | DIAGRAM | IMAGE
      originalType: rawType,                   // Preserve original for metadata
      description: match[2].trim(),
      altText: match[3]?.trim() || match[2].trim(),
      fullMatch: match[0],
      index: match.index,
    })
  }

  return placeholders
}

// ─── {{VERIFY}} Tag Stripping ───

/**
 * Strip {{VERIFY: ...}}, {{RESEARCH NEEDED: ...}}, {{SOURCE NEEDED: ...}} tags
 * from final HTML output. These are writer artifacts, not for public display.
 */
function stripVerifyTags(html) {
  if (!html || typeof html !== 'string') return html
  return html
    .replace(/\{\{VERIFY:\s*[^}]*\}\}/gi, '')
    .replace(/\{\{RESEARCH NEEDED:\s*[^}]*\}\}/gi, '')
    .replace(/\{\{SOURCE NEEDED:\s*[^}]*\}\}/gi, '')
    // Audit 2026-07-05 (A9): the old catch-all DELETED inline
    // {{WARNING: …}}/{{TIP: …}} callouts together with their safety text
    // (bodyToHtml only renders callouts occupying a whole block; inline
    // occurrences fell through to here). Content-bearing tags now keep
    // their inner text; only the tag chrome is stripped.
    .replace(/\{\{(?:WARNING|TIP|NOTE|CALLOUT|IMPORTANT):\s*([^}]*)\}\}/gi, '$1')
    // Editor-artifact spans from applyInlineFormatting's two-part VERIFY /
    // RESEARCH / SOURCE conversions — strip the wrapper AND the bracketed
    // marker text (the spans carry data-verify/title attributes).
    .replace(/<span class="(?:verify|research|source)-tag"[^>]*>\[[^\]<]*\]<\/span>/gi, '')
    .replace(/\{\{[A-Z_ ]+:\s*[^}]*\}\}/g, '') // Catch-all for any remaining double-brace tags
    .replace(/\n{3,}/g, '\n\n') // Clean up excess blank lines left behind
    .trim()
}

// ─── Chart Generation (QuickChart.io POST API) ───

/**
 * Use AI to convert a natural-language chart description into a Chart.js config,
 * then render it via QuickChart.io POST API and return the image URL.
 */
async function generateChart(description, altText, options = {}) {
  const { callModel, extractJSON } = options.aiHelpers || {}
  if (!callModel) throw new Error('callModel helper required for chart generation')

  const systemPrompt = `You are a data visualization expert. Given a chart description, generate a complete Chart.js v4 configuration object that will render a clear, professional chart.

RULES:
- Output ONLY valid JSON — a single Chart.js config object with { type, data, options }
- Use these exact colors (dark theme): backgrounds ["rgba(99,102,241,0.7)","rgba(244,63,94,0.7)","rgba(34,197,94,0.7)","rgba(251,191,36,0.7)","rgba(139,92,246,0.7)","rgba(236,72,153,0.7)"], borders same but 1.0 alpha
- Use realistic but representative sample data that matches the description
- Set options.plugins.legend.labels.color = "#e2e8f0"
- Set scale ticks/grid colors: ticks.color = "#94a3b8", grid.color = "rgba(148,163,184,0.15)"
- Set options.plugins.title with text matching the description, color "#f1f5f9", font.size 16
- Chart types allowed: bar, line, doughnut, pie, radar, polarArea, scatter
- Keep data arrays between 4-8 items for readability
- NO JavaScript functions — pure JSON only (no callbacks, no custom tick formatters)
- Keep the config COMPACT — minimize whitespace, use short labels (max 3 words per label)`

  const userPrompt = `Generate a Chart.js config for: "${description}"`
  try {
    console.log(`[Visual] Generating chart: "${description.slice(0, 80)}..."`)

    const res = await callModel('claude-haiku', systemPrompt, userPrompt, {
      maxTokens: 2048,
      timeoutMs: 25000,
    })

    const chartConfig = extractJSON(res.text)
    console.log(`[Visual] Chart config parsed, type: ${chartConfig.type}`)

    // Use QuickChart.io POST API (avoids URL length limits)
    const postRes = await fetch('https://quickchart.io/chart/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chart: chartConfig,
        width: 700,
        height: 420,
        backgroundColor: 'rgb(15,23,42)',
        format: 'png',
        devicePixelRatio: 2,
      }),
    })

    if (!postRes.ok) {
      const errText = await postRes.text()
      throw new Error(`QuickChart POST API ${postRes.status}: ${errText.slice(0, 200)}`)
    }
    const postData = await postRes.json()
    const chartUrl = postData.url
    if (!chartUrl) throw new Error('QuickChart returned no URL in response')

    console.log(`[Visual] Chart rendered: ${chartUrl}`)

    return {
      type: 'CHART',
      url: chartUrl,
      altText,
      config: chartConfig,
    }
  } catch (err) {
    console.error(`[Visual] Chart generation FAILED for "${description.slice(0, 60)}": ${err.message}`)
    return null
  }
}

// ─── Diagram Generation (mermaid.ink) ───

/**
 * Use AI to convert a natural-language diagram description into Mermaid syntax,
 * then render it via mermaid.ink PNG endpoint and return the image URL.
 */
async function generateDiagram(description, altText, options = {}) {
  const { callModel } = options.aiHelpers || {}
  if (!callModel) throw new Error('callModel helper required for diagram generation')
  const systemPrompt = `You are a diagramming expert. Given a description, generate valid Mermaid.js diagram syntax.

RULES:
- Output ONLY the raw Mermaid syntax — no markdown fences, no explanation, no preamble
- Supported diagram types: flowchart (TD/LR), sequenceDiagram, classDiagram, stateDiagram-v2, pie, timeline, mindmap
- Choose the most appropriate type for the description
- Use clear, concise node labels (max 5 words each)
- Keep diagrams between 5-8 nodes for readability — NEVER more than 8 nodes
- If a process has many steps, group related steps into single nodes instead of listing each separately
- Use subgraph blocks for grouping when appropriate
- For flowcharts, ALWAYS use LR (left-to-right) direction — this produces wider, more readable diagrams that fit well on web pages. NEVER use TD (top-down) as it creates extremely tall narrow diagrams
- Escape special chars in labels with quotes: A["Label with (parens)"]
- NEVER use semicolons at end of lines
- NEVER use special characters like &, <, > in labels — spell them out
- Keep labels simple — avoid colons, pipes, brackets inside node text
- Do NOT include any %%{init} directive — I will add it myself`

  const userPrompt = `Generate a Mermaid diagram for: "${description}"`

  try {
    console.log(`[Visual] Generating diagram: "${description.slice(0, 80)}..."`)

    const res = await callModel('claude-haiku', systemPrompt, userPrompt, {
      maxTokens: 1500,
      timeoutMs: 20000,
    })
    // Extract just the mermaid code (strip any markdown fences the model might add)
    let mermaidCode = res.text.trim()
    mermaidCode = mermaidCode.replace(/^```(?:mermaid)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()

    // Remove any existing init directives (we add our own)
    mermaidCode = mermaidCode.replace(/%%\{init:.*?\}%%\s*\n?/gi, '').trim()

    // Add dark theme init
    mermaidCode = `%%{init: {'theme': 'dark'}}%%\n${mermaidCode}`

    console.log(`[Visual] Mermaid code generated (${mermaidCode.length} chars)`)

    // Use base64url encoding + PNG endpoint (SVGs contain foreignObject which breaks <img> tags)
    const base64 = Buffer.from(mermaidCode, 'utf-8').toString('base64url')
    const imgUrl = `https://mermaid.ink/img/${base64}`

    // Skip HEAD verification — mermaid.ink renders on-demand and HEAD is unreliable
    console.log(`[Visual] Diagram URL built (PNG): ${imgUrl.slice(0, 80)}...`)

    return {
      type: 'DIAGRAM',
      url: imgUrl,
      altText,
      mermaidCode,
    }
  } catch (err) {
    console.error(`[Visual] Diagram generation FAILED for "${description.slice(0, 60)}": ${err.message}`)
    return null
  }
}

// ─── Image Generation (DALL-E 3) ───

/**
 * Sanitize a visual description to avoid DALL-E content moderation triggers.
 * Uses root-word matching (without trailing \b) to catch variations like
 * scam/scams/scammer/scammed, hack/hacker/hacking, etc.
 */
const SANITIZE_PATTERNS = [
  [/deepfakes?/gi, 'AI-generated media'],
  [/scam\w*/gi, 'online scheme'],
  [/fraud\w*/gi, 'digital risk'],
  [/fake[sd]?\b/gi, 'simulated'],
  [/theft/gi, 'loss'],
  [/steal\w*/gi, 'taking'],
  [/stole[n]?\b/gi, 'compromised'],
  [/hack\w*/gi, 'security breach'],
  [/attack\w*/gi, 'security incident'],
  [/victim\w*/gi, 'affected person'],
  [/exploit\w*/gi, 'vulnerability'],
  [/malicious\w*/gi, 'suspicious'],
  [/phishing/gi, 'social engineering'],
  [/criminal\w*/gi, 'bad actor'],
  [/illegal\w*/gi, 'unauthorized'],
  [/celebrit\w*/gi, 'public figure'],
  [/endorsement\w*/gi, 'promotion'],
  [/counterfeit\w*/gi, 'replica'],
  [/launder\w*/gi, 'funds transfer'],
  [/ransomware/gi, 'security threat'],  [/ponzi/gi, 'investment scheme'],
  [/rug\s*pull\w*/gi, 'exit event'],
  [/impersonat\w*/gi, 'identity mimicry'],
  [/manipulat\w*/gi, 'influence'],
  [/deceiv\w*/gi, 'misleading'],
  [/decepti\w*/gi, 'misleading'],
  [/blackmail\w*/gi, 'coercion'],
  [/extort\w*/gi, 'coercion'],
  [/money\s*mule/gi, 'funds courier'],
  // Additional patterns that still trigger content policy
  [/screenshot\w*/gi, 'example visual'],
  [/red\s*flag\w*/gi, 'warning indicator'],
  [/\bads?\b/gi, 'promotion'],
  [/collage/gi, 'collection'],
  [/countdown\s*timer\w*/gi, 'urgency element'],
  [/lur\w*/gi, 'attract'],
  [/trap\w*/gi, 'scheme'],
  [/predator\w*/gi, 'bad actor'],
  [/suicid\w*/gi, 'crisis'],
  [/kill\w*/gi, 'eliminate'],
  [/die[sd]?\b/gi, 'end'],
  [/death\w*/gi, 'loss'],
  [/weapon\w*/gi, 'tool'],
  [/gun\w*/gi, 'device'],
  [/bomb\w*/gi, 'threat'],
  [/terror\w*/gi, 'threat'],
  [/drug\w*/gi, 'substance'],
  [/narcotic\w*/gi, 'substance'],
  [/porn\w*/gi, 'content'],
  [/nude\w*/gi, 'content'],  [/sex\w*/gi, 'content'],
  [/violen\w*/gi, 'conflict'],
  [/blood\w*/gi, 'fluid'],
  [/torture\w*/gi, 'harm'],
  [/abuse\w*/gi, 'mistreatment'],
  [/kidnap\w*/gi, 'capture'],
  [/hostage\w*/gi, 'captive'],
  [/slave\w*/gi, 'forced labor'],
  [/traffick\w*/gi, 'smuggling'],
]

function sanitizeForDalle(description) {
  let sanitized = description
  for (const [pattern, replacement] of SANITIZE_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement)
  }
  // Collapse multiple spaces from replacements
  sanitized = sanitized.replace(/\s{2,}/g, ' ').trim()
  return sanitized
}

/**
 * Generate an image using Google Imagen (primary), DALL-E 3 (fallback),
 * and finally Unsplash (last resort). Imagen replaces the old Midjourney
 * path because MJ polling exceeded the 60s Hobby function limit.
 *
 * When `imagenOnly` is true, DALL-E and Unsplash are skipped and the call
 * returns null on Imagen failure (the caller decides what to do).
 */
async function generateImage(description, altText, { imagenOnly = false } = {}) {
  // ─── PRIMARY: Google Imagen (~5-15s per image) ───
  if (GOOGLE_AI_API_KEY) {
    try {
      console.log(`[Visual] Imagen: "${description.slice(0, 100)}..."`)

      const imagenResult = await generateImagenImage(description, {
        aspectRatio: '16:9',
      })

      // Embed AI-provenance metadata (IPTC trainedAlgorithmicMedia) before
      // upload. (Audit: AI-disclosure pipeline.)
      const taggedBuffer = tagAiGeneratedImage(imagenResult.buffer, {
        mimeType: imagenResult.mimeType,
        creatorTool: `Google Imagen (${process.env.IMAGEN_MODEL || 'imagen-4.0-generate-001'})`,
        credit: 'AI-generated illustration (Google Imagen)',
      })

      const publicUrl = await uploadToSupabase(
        taggedBuffer,
        `inline-imagen-${Date.now()}.png`,
        imagenResult.mimeType || 'image/png',
      )

      console.log('[Visual] Imagen image OK')

      return {
        type: 'IMAGE',
        url: publicUrl,
        altText,
        width: imagenResult.width || 1536,
        height: imagenResult.height || 864,
        tempUrl: false,
        source: 'imagen',
      }
    } catch (imagenErr) {
      console.error(`[Visual] Imagen FAILED: ${imagenErr.message}`)
      if (imagenOnly) return null
      console.error('[Visual] — falling back to DALL-E')
    }
  } else if (imagenOnly) {
    console.error('[Visual] imagenOnly set but GOOGLE_AI_API_KEY is missing')
    return null
  }

  // ─── FALLBACK: DALL-E 3 ───
  if (!OPENAI_API_KEY) {
    console.error('[Visual] DALL-E skip: no OPENAI_API_KEY')
    // Last resort: Unsplash
    try {
      return await generateImageUnsplashFallback(description, altText)
    } catch (e) {
      console.error('[Visual] Unsplash fallback also failed:', e.message)
      return null
    }
  }
  const sanitized = sanitizeForDalle(description)

  const dallePrompt = `Professional educational infographic illustration. Topic: ${sanitized}. Style: modern, clean, dark theme (navy blue background #0f172a), flat design with subtle gradients, abstract conceptual illustration, no text overlays, no watermarks, no faces, no logos. Color accents: indigo (#6366f1), emerald (#22c55e), amber (#f59e0b) on dark background. Safe for all audiences.`

  try {
    console.log(`[Visual] DALL-E sanitized: "${sanitized.slice(0, 100)}"`)

    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: dallePrompt,
        n: 1,
        size: '1792x1024',
        quality: 'standard',
        style: 'vivid',
      }),
      signal: AbortSignal.timeout(60000),
    })

    if (!res.ok) {
      const errBody = await res.text()
      console.error(`[Visual] DALL-E HTTP ${res.status}`)
      console.error(`[Visual] DALL-E err: ${errBody.slice(0, 200)}`)
      // Content-policy rejection OR rate limit → retry with ultra-safe generic prompt
      if (res.status === 400 || res.status === 429) {
        if (res.status === 429) {
          console.log('[Visual] DALL-E 429 rate limit — waiting 5s before safe retry...')
          await new Promise(r => setTimeout(r, 5000))
        }
        console.log(`[Visual] DALL-E ${res.status} — retrying safe prompt...`)
        return await generateImageSafeRetry(altText)
      }

      throw new Error(`DALL-E API ${res.status}`)
    }

    const data = await res.json()
    const imageUrl = data.data?.[0]?.url
    if (!imageUrl) throw new Error('No image URL in DALL-E response')

    console.log('[Visual] DALL-E image OK')

    return {
      type: 'IMAGE',
      url: imageUrl,
      altText,
      width: 1792,
      height: 1024,
      tempUrl: true, // DALL-E URLs expire — must upload to storage
      source: 'dalle',
    }
  } catch (err) {
    console.error(`[Visual] DALL-E FAILED: ${err.message}`)
    // Try safe retry first
    try {
      console.log('[Visual] DALL-E error fallback — attempting safe retry...')
      return await generateImageSafeRetry(altText)
    } catch (retryErr) {
      console.error(`[Visual] DALL-E fallback also failed: ${retryErr.message}`)
    }
    // Last-ditch: try Unsplash stock image
    try {
      console.log('[Visual] DALL-E fully failed — attempting Unsplash fallback...')
      return await generateImageUnsplashFallback(description, altText)
    } catch (unsplashErr) {
      console.error(`[Visual] Unsplash fallback also failed: ${unsplashErr.message}`)
      return null
    }
  }
}

/**
 * Retry DALL-E with an ultra-safe generic prompt when content policy rejects the original.
 * Produces a generic "digital finance security" illustration that fits any crypto article.
 */
async function generateImageSafeRetry(altText) {
  const safePrompt = `Professional educational infographic illustration about digital finance and online safety. Abstract conceptual design with shield icons, lock symbols, and network connection nodes. Dark navy blue background (#0f172a), flat modern design with subtle gradients, no text overlays, no watermarks, no faces, no logos, no real people. Color accents: indigo (#6366f1), emerald (#22c55e), amber (#f59e0b) on dark background. Safe for all audiences.`

  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: safePrompt,
        n: 1,
        size: '1792x1024',
        quality: 'standard',
        style: 'vivid',
      }),      signal: AbortSignal.timeout(60000),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Safe retry ${res.status}: ${errText.slice(0, 150)}`)
    }

    const data = await res.json()
    const imageUrl = data.data?.[0]?.url
    if (!imageUrl) throw new Error('No URL in safe retry response')

    console.log('[Visual] DALL-E safe retry OK')

    return {
      type: 'IMAGE',
      url: imageUrl,
      altText,
      width: 1792,
      height: 1024,
      tempUrl: true,
    }
  } catch (err) {
    console.error(`[Visual] DALL-E safe retry FAILED: ${err.message}`)
    return null
  }
}

/**
 * Fallback image generation via Unsplash when DALL-E is unavailable or rejected.
 * Extracts 2-3 visual keywords from the placeholder description and searches Unsplash.
 * Images are compressed via TinyPNG before upload.
 */
async function generateImageUnsplashFallback(description, altText) {
  const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY
  const TINYPNG_KEY = process.env.TINYPNG_API_KEY
  if (!UNSPLASH_KEY) {
    throw new Error('No UNSPLASH_ACCESS_KEY for fallback')
  }

  // Extract visual keywords from description — strip scam/fraud terms, keep visual concepts
  const visualTerms = description
    .replace(/scam|fraud|fake|illegal|criminal|theft|steal|hack|exploit|victim|attack/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 3)
    .slice(0, 4)
    .join(' ')

  const query = visualTerms || 'technology security digital'

  const params = new URLSearchParams({
    query,
    per_page: '3',
    orientation: 'landscape',
    content_filter: 'high',
  })

  const res = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
    headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` },
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) throw new Error(`Unsplash ${res.status}`)

  const data = await res.json()
  const photo = data.results?.[0]
  if (!photo) throw new Error('No Unsplash results')

  let imageUrl = photo.urls?.regular || photo.urls?.small

  // Compress via TinyPNG if available
  if (TINYPNG_KEY && imageUrl) {
    try {
      const auth = Buffer.from(`api:${TINYPNG_KEY}`).toString('base64')
      const tinyRes = await fetch('https://api.tinify.com/shrink', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ source: { url: imageUrl } }),
        signal: AbortSignal.timeout(30000),
      })
      if (tinyRes.ok) {
        const tinyData = await tinyRes.json()
        if (tinyData.output?.url) imageUrl = tinyData.output.url
      }
    } catch {
      // Non-fatal — use uncompressed URL
    }
  }

  // Track download (Unsplash ToS)
  if (photo.links?.download_location) {
    fetch(photo.links.download_location, {
      headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` },
    }).catch(() => {})
  }

  console.log(`[Visual] Unsplash fallback OK: "${query}" → ${photo.id}`)

  return {
    type: 'IMAGE',
    url: imageUrl,
    altText: altText || photo.alt_description || description,
    width: photo.width || 1080,
    height: photo.height || 720,
    tempUrl: true, // Needs upload to Supabase for persistence
    credit: `Photo by ${photo.user?.name || 'Unknown'} on Unsplash`,
    creditUrl: photo.user?.links?.html || 'https://unsplash.com',
  }
}

// ─── Supabase Storage Upload ───
/**
 * Download an image from a URL and upload it to Supabase Storage.
 * Returns the public URL.
 */
async function uploadToSupabaseStorage(imageUrl, storagePath) {
  if (!SUPABASE_URL) {
    console.error('[Visual] Supabase Storage: missing SUPABASE_URL, using original URL')
    return imageUrl
  }

  try {
    console.log(`[Visual] Uploading to Supabase Storage: ${storagePath}`)

    // Download the image
    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) })
    if (!imgRes.ok) throw new Error(`Failed to download image: ${imgRes.status}`)

    const contentType = imgRes.headers.get('content-type') || 'image/png'
    const buffer = await imgRes.arrayBuffer()

    console.log(`[Visual] Downloaded ${(buffer.byteLength / 1024).toFixed(0)}KB, uploading...`)

    // Upload to Supabase Storage — try service key first, fall back to anon key
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/visuals/${storagePath}`
    const keysToTry = [SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY].filter(Boolean)

    let uploaded = false
    for (const key of keysToTry) {
      try {
        const uploadRes = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': contentType,
            'x-upsert': 'true',
          },
          body: buffer,
          signal: AbortSignal.timeout(30000),
        })

        if (uploadRes.ok) {
          uploaded = true
          break
        }

        const errText = await uploadRes.text()

        // Auth error — try next key
        if (uploadRes.status === 400 || uploadRes.status === 401 || uploadRes.status === 403) {
          console.warn(`[Visual] Upload auth failed (${uploadRes.status}), trying next key...`)
          continue
        }

        // Bucket not found — create it and retry with same key
        if (errText.includes('Bucket not found') || errText.includes('not found')) {
          console.log('[Visual] Bucket not found, creating...')
          await createStorageBucket()
          const retryRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${key}`,
              'Content-Type': contentType,
              'x-upsert': 'true',
            },
            body: buffer,
          })
          if (retryRes.ok) {
            uploaded = true
            break
          }
        }

        throw new Error(`Upload failed (${uploadRes.status}): ${errText.slice(0, 200)}`)
      } catch (keyErr) {
        if (keyErr.message.includes('Upload failed')) throw keyErr
        console.warn(`[Visual] Key attempt failed: ${keyErr.message}`)
      }
    }

    if (!uploaded) {
      throw new Error('All upload keys failed')
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/visuals/${storagePath}`
    console.log(`[Visual] Uploaded successfully: ${publicUrl}`)
    return publicUrl
  } catch (err) {
    console.error(`[Visual] Supabase Storage upload FAILED: ${err.message}`)
    return imageUrl // Fall back to original URL
  }
}

/**
 * Create the 'visuals' storage bucket if it doesn't exist.
 */
async function createStorageBucket() {
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: 'visuals',
        name: 'visuals',
        public: true,
        file_size_limit: 10485760, // 10MB
        allowed_mime_types: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
      }),
    })
    if (res.ok) {
      console.log('[Visual] Storage bucket "visuals" created')
    } else {
      const errText = await res.text()
      console.error(`[Visual] Bucket creation response: ${errText.slice(0, 200)}`)
    }
  } catch (err) {
    console.error(`[Visual] Failed to create storage bucket: ${err.message}`)
  }
}

// ─── HTML Replacement ───

/**
 * Build a <figure> HTML block for an embedded visual.
 * All visual types (CHART, DIAGRAM, IMAGE) use <img> tags with PNG sources.
 */
function buildVisualHtml(visual) {
  if (!visual || !visual.url) return ''

  const isDiagram = visual.type === 'DIAGRAM'
  const isChart = visual.type === 'CHART'

  // Unsplash credit line (required by Unsplash ToS when using their images)
  const creditHtml = visual.credit && visual.creditUrl
    ? `\n  <p style="margin-top:0.25rem;font-size:0.75rem;color:#64748b;"><a href="${escapeHtml(visual.creditUrl)}" target="_blank" rel="noopener noreferrer" style="color:#64748b;text-decoration:underline;">${escapeHtml(visual.credit)}</a></p>`
    : ''

  // Responsive sizing per visual type
  let imgStyle, figureStyle
  if (isDiagram) {
    // Diagrams: fill container width, allow tall flowcharts to breathe
    figureStyle = 'margin:2rem 0;text-align:center;overflow-x:auto;'
    imgStyle = 'width:100%;max-width:750px;height:auto;border-radius:12px;border:1px solid rgba(148,163,184,0.2);background:rgb(15,23,42);padding:1.5rem;'
  } else if (isChart) {
    // Charts: constrained width, maintain aspect ratio
    figureStyle = 'margin:2rem 0;text-align:center;'
    imgStyle = 'width:100%;max-width:700px;height:auto;border-radius:12px;border:1px solid rgba(148,163,184,0.2);background:rgb(15,23,42);padding:1rem;'
  } else {
    // Stock/AI images: fill container
    figureStyle = 'margin:2rem 0;text-align:center;'
    imgStyle = 'max-width:100%;height:auto;border-radius:12px;border:1px solid rgba(148,163,184,0.2);'
  }

  return `<figure class="ck-visual ck-visual--${visual.type.toLowerCase()}" style="${figureStyle}">
  <img src="${visual.url}" alt="${escapeHtml(visual.altText)}" loading="lazy" style="${imgStyle}" />
  <figcaption style="margin-top:0.5rem;font-size:0.85rem;color:#94a3b8;font-style:italic;">${escapeHtml(visual.altText)}</figcaption>${creditHtml}
</figure>`
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')}

// ─── Orchestrator ───

/**
 * Process all visual placeholders in content HTML.
 *
 * @param {string} htmlContent - The full article HTML with placeholders
 * @param {object} options
 * @param {string} options.contentId - Content/review ID for storage paths
 * @param {string} options.contentType - 'content' or 'review'
 * @param {object} options.aiHelpers - { callModel, extractJSON } from ai-models.js
 * @param {function} options.onProgress - SSE progress callback: (step, progress, message) => void
 * @returns {{ html: string, visuals: Array, stats: object }}
 */
async function processVisuals(htmlContent, options = {}) {
  const { contentId, contentType = 'content', aiHelpers, onProgress, imagenOnly = false } = options

  if (!htmlContent || typeof htmlContent !== 'string') {
    return { html: htmlContent, visuals: [], stats: { total: 0, succeeded: 0, failed: 0 } }
  }

  // Dashed fallback cards are leftover from a prior failed pass. Convert them
  // back to [TYPE NEEDED] markers so retry / Regenerate Images can see them.
  htmlContent = reviveFailedVisualPlaceholders(htmlContent)

  const placeholders = parseVisualPlaceholders(htmlContent)

  if (placeholders.length === 0) {
    console.log('[Visual] No placeholders found in content')
    const cleaned = unwrapVisualPending(stripFailedVisualPlaceholders(htmlContent))
    return { html: cleaned, visuals: [], stats: { total: 0, succeeded: 0, failed: 0 } }
  }

  console.log(`[Visual] Found ${placeholders.length} placeholder(s): ${placeholders.map(p => p.type).join(', ')}`)
  if (onProgress) {
    onProgress('visuals', 72, `Generating ${placeholders.length} visual(s)...`)
  }

  const visuals = []
  let succeeded = 0
  let failed = 0

  // Process placeholders concurrently (max 3 at a time to avoid rate limits)
  const chunks = chunkArray(placeholders, 3)

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci]

    const results = await Promise.allSettled(
      chunk.map(async (ph, idx) => {
        const globalIdx = ci * 3 + idx
        const storagePath = `${contentType}/${contentId || 'unknown'}/${ph.type.toLowerCase()}_${globalIdx}_${Date.now()}`

        let visual = null

        switch (ph.type) {
          case 'CHART':
            visual = await generateChart(ph.description, ph.altText, { aiHelpers })
            break
          case 'DIAGRAM':
            visual = await generateDiagram(ph.description, ph.altText, { aiHelpers })
            break
          case 'IMAGE':
            visual = await generateImage(ph.description, ph.altText, { imagenOnly })
            break
        }
        if (!visual) return { placeholder: ph, visual: null }

        // Upload to Supabase Storage for persistence
        if (visual.source === 'imagen') {
          // Already uploaded to Supabase inside generateImage — skip the round trip.
        } else if (visual.tempUrl || ph.type === 'IMAGE') {
          // DALL-E images have expiring URLs — must upload
          const ext = 'png'
          const persistentUrl = await uploadToSupabaseStorage(visual.url, `${storagePath}.${ext}`)
          visual.url = persistentUrl
          visual.tempUrl = false
        } else if (ph.type === 'CHART') {
          // Charts from QuickChart.io — upload for persistence too
          const persistentUrl = await uploadToSupabaseStorage(visual.url, `${storagePath}.png`)
          visual.url = persistentUrl
        } else if (ph.type === 'DIAGRAM') {
          // Diagrams from mermaid.ink — upload for persistence (external service may go down)
          try {
            const persistentUrl = await uploadToSupabaseStorage(visual.url, `${storagePath}.png`)
            visual.url = persistentUrl
            console.log(`[Visual] Diagram persisted to Supabase`)
          } catch (uploadErr) {
            // Non-fatal: keep the mermaid.ink URL as fallback
            console.warn(`[Visual] Diagram upload failed, keeping mermaid.ink URL: ${uploadErr.message}`)
          }
        }

        return { placeholder: ph, visual }
      })
    )
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.visual) {
        visuals.push(result.value)
        succeeded++
      } else {
        if (result.status === 'fulfilled') {
          visuals.push(result.value) // visual is null, keep for tracking
        } else {
          // Promise rejected — log the rejection reason
          console.error(`[Visual] Promise rejected: ${result.reason?.message || result.reason}`)
        }
        failed++
      }
    }

    if (onProgress && ci < chunks.length - 1) {
      const pct = 72 + Math.round(((ci + 1) / chunks.length) * 10)
      onProgress('visuals', pct, `Generated ${succeeded + failed}/${placeholders.length} visuals...`)
    }
  }

  console.log(`[Visual] Generation complete: ${succeeded} succeeded, ${failed} failed out of ${placeholders.length}`)

  // Replace placeholders in HTML
  let updatedHtml = htmlContent

  for (const { placeholder, visual } of visuals) {
    if (visual) {
      const figureHtml = buildVisualHtml(visual)
      updatedHtml = updatedHtml.replace(placeholder.fullMatch, figureHtml)
    } else {
      // Failed generation — drop the marker. A dashed fallback card is worse
      // than no image: retry cannot see it, and the old publish gate missed it.
      updatedHtml = updatedHtml.replace(placeholder.fullMatch, '')
    }
  }

  updatedHtml = unwrapVisualPending(updatedHtml)
  updatedHtml = stripFailedVisualPlaceholders(updatedHtml)

  // Strip any remaining {{VERIFY}} tags from the output
  updatedHtml = stripVerifyTags(updatedHtml)

  if (onProgress) {
    onProgress('visuals', 82, `Visual generation complete: ${succeeded} succeeded, ${failed} failed`)
  }

  return {
    html: updatedHtml,
    visuals: visuals.map(({ placeholder, visual }) => ({
      type: placeholder.type,
      originalType: placeholder.originalType,
      description: placeholder.description,
      altText: placeholder.altText,
      url: visual?.url || null,
      succeeded: !!visual,
      width: visual?.width || null,
      height: visual?.height || null,
    })),    stats: {
      total: placeholders.length,
      succeeded,
      failed,
    },
  }
}

/**
 * Process visual placeholders inside a sections array.
 * Each section has { heading, body } — body may contain placeholders.
 * Returns updated sections array with visuals embedded in body text.
 */
async function processVisualsSections(sections, options = {}) {
  if (!Array.isArray(sections) || sections.length === 0) {
    return { sections, allVisuals: [], stats: { total: 0, succeeded: 0, failed: 0 } }
  }

  const allVisuals = []
  let totalSucceeded = 0
  let totalFailed = 0

  const updatedSections = [...sections]

  for (let i = 0; i < updatedSections.length; i++) {
    const section = { ...updatedSections[i] }
    if (!section.body || typeof section.body !== 'string') continue

    const placeholders = parseVisualPlaceholders(section.body)
    if (placeholders.length === 0) continue
    console.log(`[Visual] Section "${section.heading}": ${placeholders.length} placeholder(s)`)

    const result = await processVisuals(section.body, {
      ...options,
      contentId: `${options.contentId || 'unknown'}_s${i}`,
    })

    section.body = result.html
    updatedSections[i] = section
    allVisuals.push(...result.visuals)
    totalSucceeded += result.stats.succeeded
    totalFailed += result.stats.failed
  }

  return {
    sections: updatedSections,
    allVisuals,
    stats: { total: totalSucceeded + totalFailed, succeeded: totalSucceeded, failed: totalFailed },
  }
}

// ─── Refresh Existing Visuals ───

/**
 * Find already-rendered visual figures in HTML, re-upload their images to
 * Supabase Storage (fixing broken mermaid.ink / QuickChart URLs), and
 * update the <img> tags with responsive styling.
 *
 * This does NOT regenerate visuals from scratch — it keeps the same images
 * but ensures they're hosted on Supabase and have proper responsive CSS.
 */
async function refreshVisualAssets(html, options = {}) {
  if (!html || typeof html !== 'string') {
    return { html, refreshed: 0, failed: 0 }
  }

  const { contentId, contentType = 'content' } = options

  // Match existing <figure class="ck-visual ck-visual--TYPE"> blocks
  const figureRegex = /<figure\s+class="ck-visual\s+ck-visual--(diagram|chart|image)"[^>]*>[\s\S]*?<\/figure>/gi
  const figures = [...html.matchAll(figureRegex)]

  if (figures.length === 0) {
    console.log('[Visual] No existing visual figures found to refresh')
    return { html, refreshed: 0, failed: 0 }
  }

  console.log(`[Visual] Found ${figures.length} visual figure(s) to refresh`)

  let updatedHtml = html
  let refreshed = 0
  let failed = 0

  for (let i = 0; i < figures.length; i++) {
    const figureMatch = figures[i]
    const originalFigure = figureMatch[0]
    const visualType = figureMatch[1].toUpperCase() // DIAGRAM, CHART, IMAGE

    // Extract the current src URL
    const srcMatch = originalFigure.match(/src="([^"]+)"/)
    const altMatch = originalFigure.match(/alt="([^"]*)"/)
    const captionMatch = originalFigure.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/)

    if (!srcMatch) {
      console.warn(`[Visual] Figure ${i}: no src found, skipping`)
      failed++
      continue
    }

    const currentUrl = srcMatch[1]
    const altText = altMatch?.[1] || ''
    const caption = captionMatch?.[1] || altText

    // Check if already on Supabase Storage
    const isAlreadyOnSupabase = currentUrl.includes('/storage/v1/object/public/')
    const needsReupload = !isAlreadyOnSupabase

    let finalUrl = currentUrl

    if (needsReupload) {
      try {
        const storagePath = `${contentType}/${contentId || 'unknown'}/${visualType.toLowerCase()}_${i}_${Date.now()}.png`
        finalUrl = await uploadToSupabaseStorage(currentUrl, storagePath)
        console.log(`[Visual] Figure ${i} (${visualType}): re-uploaded to Supabase`)
      } catch (err) {
        console.error(`[Visual] Figure ${i} re-upload failed: ${err.message}`)
        failed++
        continue
      }
    }

    // Build refreshed figure HTML with responsive styling
    const visual = {
      type: visualType,
      url: finalUrl,
      altText: altText || caption?.replace(/<[^>]*>/g, '') || '',
    }
    const newFigure = buildVisualHtml(visual)

    updatedHtml = updatedHtml.replace(originalFigure, newFigure)
    refreshed++
  }

  console.log(`[Visual] Refresh complete: ${refreshed} refreshed, ${failed} failed`)
  return { html: updatedHtml, refreshed, failed }
}

// ─── Utility ───

function chunkArray(arr, size) {
  const chunks = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}
export {
  parseVisualPlaceholders,
  processVisuals,
  processVisualsSections,
  refreshVisualAssets,
  generateChart,
  generateDiagram,
  generateImage,
  uploadToSupabaseStorage,
  buildVisualHtml,
  stripVerifyTags,
}
