/**
 * Google Imagen 4.0 — Image Generation Client
 *
 * Generates high-quality editorial photography-style images via Google's
 * Imagen 4.0 API through the Gemini API endpoint.
 *
 * Pipeline: prompt → Imagen 4.0 Fast → base64 PNG → Buffer
 *
 * Model options:
 *   - imagen-4.0-fast-generate-001  (~5-8s, good quality)
 *   - imagen-4.0-generate-001       (~10-15s, best quality)
 *   - imagen-4.0-ultra-generate-001 (~15-20s, ultra quality, 2K)
 */

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY || ''
const MODEL = 'imagen-4.0-fast-generate-001'
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:predict`

/**
 * Content policy sanitizer for Imagen.
 * Similar to DALL-E/MJ but Imagen has its own content filters.
 */
const IMAGEN_SANITIZE_PATTERNS = [
  [/\bscam\w*/gi, 'scheme'],
  [/\bfraud\w*/gi, 'risk'],
  [/\bfake[sd]?\b/gi, 'synthetic'],
  [/\btheft\b/gi, 'loss'],
  [/\bsteal\w*/gi, 'take'],
  [/\bhack\w*/gi, 'breach'],
  [/\battack\w*/gi, 'incident'],
  [/\bvictim\w*/gi, 'target'],
  [/\bexploit\w*/gi, 'vulnerability'],
  [/\bmalicious\w*/gi, 'suspicious'],
  [/\bphishing\b/gi, 'social engineering'],
  [/\bcriminal\w*/gi, 'actor'],
  [/\billegal\w*/gi, 'unauthorized'],
  [/\bkill\w*/gi, 'eliminate'],
  [/\bdeath\w*/gi, 'end'],
  [/\bdie[sd]?\b/gi, 'end'],
  [/\bblood\w*/gi, 'fluid'],
  [/\bviolen\w*/gi, 'conflict'],
  [/\bweapon\w*/gi, 'tool'],
  [/\bgun\w*/gi, 'device'],
  [/\bbomb\w*/gi, 'threat'],
  [/\bterror\w*/gi, 'threat'],
  [/\bdrug\w*/gi, 'substance'],
  [/\bnude\w*/gi, 'figure'],
  [/\bsex\w*/gi, 'content'],
  [/\bgore\b/gi, 'damage'],
  [/\btorture\w*/gi, 'harm'],
  [/\babuse\w*/gi, 'misuse'],
  [/\bslave\w*/gi, 'forced'],
  [/\bsuicid\w*/gi, 'crisis'],
  [/\bdeepfake\w*/gi, 'AI media'],
  [/\bporn\w*/gi, 'content'],
]

function sanitizeForImagen(prompt) {
  let sanitized = prompt
  for (const [pattern, replacement] of IMAGEN_SANITIZE_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement)
  }
  return sanitized.replace(/\s{2,}/g, ' ').trim()
}

/**
 * Generate an image using Google Imagen 4.0 Fast.
 *
 * @param {string} rawPrompt - The image description/prompt
 * @param {Object} [options]
 * @param {string} [options.aspectRatio] - '1:1', '3:4', '4:3', '9:16', '16:9' (default: '16:9')
 * @param {number} [options.sampleCount] - Number of images to generate, 1-4 (default: 1)
 * @param {string} [options.personGeneration] - 'dont_allow', 'allow_adult', 'allow_all' (default: 'allow_adult')
 * @returns {Promise<{ buffer: Buffer, mimeType: string, width: number, height: number, prompt: string }>}
 */
async function generateImagenImage(rawPrompt, options = {}) {
  const {
    aspectRatio = '16:9',
    sampleCount = 1,
    personGeneration = 'allow_adult',
  } = options

  if (!GOOGLE_AI_API_KEY) {
    throw new Error('Missing GOOGLE_AI_API_KEY env var')
  }

  const prompt = sanitizeForImagen(rawPrompt)

  console.log(`[Imagen] Generating: "${prompt.slice(0, 100)}..." (${aspectRatio}, ${MODEL})`)

  const body = {
    instances: [{ prompt }],
    parameters: {
      sampleCount,
      aspectRatio,
      personGeneration,
    },
  }

  const res = await fetch(`${API_URL}?key=${GOOGLE_AI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    // Parse error for content policy rejection
    if (res.status === 400 && errText.includes('SAFETY')) {
      throw new Error(`Imagen content policy rejection: ${errText.slice(0, 200)}`)
    }
    throw new Error(`Imagen API ${res.status}: ${errText.slice(0, 300)}`)
  }

  const data = await res.json()

  // Extract base64 image from response
  const predictions = data.predictions || []
  if (predictions.length === 0) {
    throw new Error('Imagen returned no predictions')
  }

  const imageData = predictions[0].bytesBase64Encoded
  if (!imageData) {
    throw new Error('Imagen prediction missing bytesBase64Encoded')
  }

  const mimeType = predictions[0].mimeType || 'image/png'
  const buffer = Buffer.from(imageData, 'base64')

  console.log(`[Imagen] Generated ${(buffer.length / 1024).toFixed(0)}KB image`)

  // Dimensions based on aspect ratio (Imagen generates at 1024px base)
  const dims = {
    '16:9': { width: 1536, height: 864 },
    '4:3':  { width: 1365, height: 1024 },
    '3:4':  { width: 1024, height: 1365 },
    '9:16': { width: 864, height: 1536 },
    '1:1':  { width: 1024, height: 1024 },
  }
  const { width, height } = dims[aspectRatio] || dims['16:9']

  return {
    buffer,
    mimeType,
    width,
    height,
    prompt,
    source: 'imagen',
  }
}

export {
  generateImagenImage,
  sanitizeForImagen,
  GOOGLE_AI_API_KEY,
}
