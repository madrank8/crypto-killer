/**
 * Midjourney Client — APIFrame Pro API Integration
 *
 * Generates high-quality images via Midjourney through APIFrame's managed API.
 * Flow: POST /pro/imagine → poll /fetch → return CDN URL
 *
 * APIFrame handles MJ account management — no Discord needed,
 * no account bans, images hosted permanently on their CDN.
 */

const APIFRAME_API_KEY = process.env.APIFRAME_API_KEY || ''
const IMAGINE_URL = 'https://api.apiframe.ai/pro/imagine'
const FETCH_URL = 'https://api.apiframe.pro/fetch'

// Polling config
const POLL_INTERVAL_MS = 5000   // 5 seconds between status checks
const MAX_POLL_MS = 150000      // 2.5 minutes max wait
const MAX_RETRIES = 2           // Retry once on failure

/**
 * MJ-specific banned word sanitizer.
 * Midjourney has stricter content filters than DALL-E.
 * These replacements keep the visual intent while avoiding rejections.
 */
const MJ_SANITIZE_PATTERNS = [
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
  [/\bviolent?\w*/gi, 'conflict'],
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

function sanitizeForMidjourney(prompt) {
  let sanitized = prompt
  for (const [pattern, replacement] of MJ_SANITIZE_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement)
  }
  return sanitized.replace(/\s{2,}/g, ' ').trim()
}

/**
 * Submit an /imagine job to APIFrame Pro API.
 * Returns: { task_id: string }
 */
async function submitImagineJob(prompt, options = {}) {
  const { mode = 'fast' } = options

  if (!APIFRAME_API_KEY) {
    throw new Error('Missing APIFRAME_API_KEY env var')
  }

  const body = {
    prompt,
    mode,
  }

  // Add webhook if provided
  if (options.webhook_url) {
    body.webhook_url = options.webhook_url
    if (options.webhook_secret) {
      body.webhook_secret = options.webhook_secret
    }
  }

  console.log(`[MJ] Submitting /imagine: "${prompt.slice(0, 100)}..." (mode: ${mode})`)

  const res = await fetch(IMAGINE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: APIFRAME_API_KEY,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`APIFrame /imagine ${res.status}: ${errText.slice(0, 300)}`)
  }

  const data = await res.json()
  if (!data.task_id) {
    throw new Error('APIFrame returned no task_id')
  }

  console.log(`[MJ] Job submitted: ${data.task_id}`)
  return data
}

/**
 * Poll the /fetch endpoint until the task is complete or times out.
 * Returns the full result object with image URLs.
 */
async function pollForResult(taskId, options = {}) {
  const { onProgress, maxWaitMs = MAX_POLL_MS, intervalMs = POLL_INTERVAL_MS } = options

  const start = Date.now()
  let attempt = 0

  while (Date.now() - start < maxWaitMs) {
    attempt++
    const elapsed = Math.round((Date.now() - start) / 1000)

    try {
      const res = await fetch(FETCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: APIFRAME_API_KEY,
        },
        body: JSON.stringify({ task_id: taskId }),
        signal: AbortSignal.timeout(10000),
      })

      if (!res.ok) {
        console.warn(`[MJ] Fetch poll ${res.status} (attempt ${attempt}, ${elapsed}s)`)
        // Don't throw — just wait and retry
        await sleep(intervalMs)
        continue
      }

      const data = await res.json()
      const status = data.status || ''

      if (onProgress) {
        onProgress(status, elapsed, attempt)
      }

      // Check terminal states
      if (status === 'finished' || status === 'completed') {
        console.log(`[MJ] Task complete after ${elapsed}s (${attempt} polls)`)
        return data
      }

      if (status === 'failed' || status === 'error') {
        const errMsg = data.error || data.message || 'Unknown error'
        throw new Error(`MJ generation failed: ${errMsg}`)
      }

      // Still processing — log and continue
      if (attempt <= 3 || attempt % 5 === 0) {
        console.log(`[MJ] Status: ${status} (${elapsed}s, poll #${attempt})`)
      }

    } catch (err) {
      if (err.message.includes('MJ generation failed')) throw err
      console.warn(`[MJ] Poll error (attempt ${attempt}): ${err.message}`)
    }

    await sleep(intervalMs)
  }

  throw new Error(`MJ generation timed out after ${Math.round(MAX_POLL_MS / 1000)}s`)
}

/**
 * Generate a Midjourney image from a text prompt.
 *
 * Full pipeline: sanitize prompt → submit /imagine → poll /fetch → return image URL.
 * MJ generates a 2x2 grid; the result contains the grid URL + individual image URLs.
 *
 * @param {string} rawPrompt - The image description/prompt
 * @param {Object} [options]
 * @param {string} [options.aspectRatio] - e.g. '16:9', '1:1', '3:2'
 * @param {string} [options.style] - Additional style suffix
 * @param {string} [options.mode] - 'fast' or 'turbo' (turbo = 10 credits, fast = 6)
 * @param {Function} [options.onProgress] - Progress callback: (status, elapsedSec, attempt) => void
 * @returns {Promise<{url: string, gridUrl: string, width: number, height: number, taskId: string}>}
 */
async function generateMidjourneyImage(rawPrompt, options = {}) {
  const { aspectRatio = '16:9', style = '', mode = 'fast', onProgress } = options

  // Sanitize the prompt for MJ content filters
  let prompt = sanitizeForMidjourney(rawPrompt)

  // Add aspect ratio parameter
  if (aspectRatio) {
    prompt += ` --ar ${aspectRatio}`
  }

  // Add style suffix (e.g. dark moody theme for crypto articles)
  if (style) {
    prompt += ` ${style}`
  }

  // Default quality/style params for consistent brand look
  if (!prompt.includes('--style') && !prompt.includes('--s ')) {
    prompt += ' --style raw'
  }
  if (!prompt.includes('--q ') && !prompt.includes('--quality')) {
    prompt += ' --q 1'
  }

  let lastError = null

  for (let retry = 0; retry <= MAX_RETRIES; retry++) {
    try {
      if (retry > 0) {
        console.log(`[MJ] Retry ${retry}/${MAX_RETRIES}...`)
        await sleep(3000 * retry) // Backoff
      }

      // 1. Submit the job
      const job = await submitImagineJob(prompt, { mode })

      // 2. Poll for result
      const result = await pollForResult(job.task_id, { onProgress })

      // 3. Extract image URL(s)
      // APIFrame returns image_urls array (4 individual images) + original_image_url (grid)
      const imageUrl = result.image_urls?.[0]  // First individual image (best pick)
        || result.task_result?.discord_image_url
        || result.task_result?.image_url
        || result.image_url
        || result.original_image_url           // Full 2x2 grid
        || result.task_result?.cdn_image_url
        || null

      // Also capture all 4 variants
      const allVariants = result.image_urls || []
      const gridUrl = result.original_image_url || imageUrl

      if (!imageUrl) {
        console.error('[MJ] Result structure:', JSON.stringify(result).slice(0, 500))
        throw new Error('No image URL found in API response')
      }

      console.log(`[MJ] ✓ Image generated: ${imageUrl.slice(0, 80)}...`)

      return {
        url: imageUrl,
        gridUrl,
        allVariants,
        width: 1792,
        height: 1024,
        taskId: job.task_id,
        prompt,
        source: 'midjourney',
      }

    } catch (err) {
      lastError = err
      console.error(`[MJ] Attempt ${retry + 1} failed: ${err.message}`)

      // Don't retry on certain errors
      if (err.message.includes('Missing APIFRAME_API_KEY')
        || err.message.includes('401')
        || err.message.includes('403')) {
        break
      }
    }
  }

  throw lastError || new Error('Midjourney generation failed after retries')
}

/**
 * Check APIFrame account credits/status.
 */
async function getAccountInfo() {
  if (!APIFRAME_API_KEY) return null

  try {
    const res = await fetch('https://api.apiframe.pro/account', {
      method: 'GET',
      headers: { Authorization: APIFRAME_API_KEY },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export {
  generateMidjourneyImage,
  sanitizeForMidjourney,
  getAccountInfo,
  APIFRAME_API_KEY,
}
