/**
 * Visual Generator — Phase 4 Pipeline Module
 *
 * Parses visual placeholders from AI-generated content and replaces them
 * with actual rendered visuals:
 *   [CHART NEEDED: description | Alt: alt text]  → Chart.js chart via QuickChart.io
 *   [DIAGRAM NEEDED: description | Alt: alt text] → Mermaid diagram via mermaid.ink
 *   [IMAGE NEEDED: description | Alt: alt text]   → AI image via DALL-E 3
 *
 * Generated images are uploaded to Supabase Storage for persistence.
 * Returns updated HTML with <figure> elements + visual metadata array.
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY

// ─── Placeholder Parsing ───

const PLACEHOLDER_REGEX = /\[(CHART|DIAGRAM|IMAGE)\s+NEEDED:\s*([^\]|]+?)(?:\s*\|\s*Alt:\s*([^\]]+?))?\]/gi

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
    placeholders.push({
      type: match[1].toUpperCase(),          // CHART | DIAGRAM | IMAGE
      description: match[2].trim(),           // "Bar chart showing frequency of..."
      altText: match[3]?.trim() || match[2].trim(), // Alt text or fallback to description
      fullMatch: match[0],                    // Full matched string for replacement
      index: match.index,
    })
  }

  return placeholders
}

// ─── Chart Generation (QuickChart.io) ───

/**
 * Use AI to convert a natural-language chart description into a Chart.js config,
 * then render it via QuickChart.io and return the image URL.
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
- NO JavaScript functions — pure JSON only (no callbacks, no custom tick formatters)`

  const userPrompt = `Generate a Chart.js config for: "${description}"`

  try {
    const res = await callModel('claude-haiku', systemPrompt, userPrompt, {
      maxTokens: 2048,
      timeoutMs: 20000,
    })

    const chartConfig = extractJSON(res.text)

    // Encode config for QuickChart.io URL
    const configStr = JSON.stringify(chartConfig)
    const encodedConfig = encodeURIComponent(configStr)

    // QuickChart.io renders Chart.js configs as images
    const chartUrl = `https://quickchart.io/chart?c=${encodedConfig}&w=700&h=420&bkg=rgb(15,23,42)&f=png`

    // Verify the URL works by fetching it
    const testRes = await fetch(chartUrl, { method: 'HEAD' })
    if (!testRes.ok) throw new Error(`QuickChart returned ${testRes.status}`)

    return {
      type: 'CHART',
      url: chartUrl,
      altText,
      config: chartConfig,
      width: 700,
      height: 420,
    }
  } catch (err) {
    console.error('Chart generation failed:', err.message)
    return null
  }
}

// ─── Diagram Generation (mermaid.ink) ───

/**
 * Use AI to convert a natural-language diagram description into Mermaid syntax,
 * then render it via mermaid.ink and return the SVG URL.
 */
async function generateDiagram(description, altText, options = {}) {
  const { callModel } = options.aiHelpers || {}
  if (!callModel) throw new Error('callModel helper required for diagram generation')

  const systemPrompt = `You are a diagramming expert. Given a description, generate valid Mermaid.js diagram syntax.

RULES:
- Output ONLY the raw Mermaid syntax — no markdown fences, no explanation
- Supported diagram types: flowchart (TD/LR), sequenceDiagram, classDiagram, stateDiagram-v2, pie, timeline, mindmap
- Choose the most appropriate type for the description
- Use clear, concise node labels (max 6 words each)
- Keep diagrams between 5-12 nodes for readability
- Use subgraph blocks for grouping when appropriate
- For flowcharts, prefer TD (top-down) direction
- Style with %%{init: {'theme': 'dark'}}%% at the top
- Escape special chars in labels with quotes: A["Label with (parens)"]
- NEVER use semicolons at end of lines — Mermaid doesn't need them`

  const userPrompt = `Generate a Mermaid diagram for: "${description}"`

  try {
    const res = await callModel('claude-haiku', systemPrompt, userPrompt, {
      maxTokens: 1500,
      timeoutMs: 15000,
    })

    // Extract just the mermaid code (strip any markdown fences the model might add)
    let mermaidCode = res.text.trim()
    mermaidCode = mermaidCode.replace(/^```(?:mermaid)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()

    // Ensure dark theme init
    if (!mermaidCode.includes('%%{init')) {
      mermaidCode = `%%{init: {'theme': 'dark'}}%%\n${mermaidCode}`
    }

    // Base64 encode for mermaid.ink
    const base64 = Buffer.from(mermaidCode, 'utf-8').toString('base64')
    const svgUrl = `https://mermaid.ink/svg/${base64}`

    // Verify it renders
    const testRes = await fetch(svgUrl, { method: 'HEAD' })
    if (!testRes.ok) throw new Error(`mermaid.ink returned ${testRes.status}`)

    return {
      type: 'DIAGRAM',
      url: svgUrl,
      altText,
      mermaidCode,
      width: 700,
      height: 'auto',
    }
  } catch (err) {
    console.error('Diagram generation failed:', err.message)
    return null
  }
}

// ─── Image Generation (DALL-E 3) ───

/**
 * Generate an image using OpenAI's DALL-E 3 API.
 * Returns the image URL directly (OpenAI hosts for ~1 hour).
 */
async function generateImage(description, altText) {
  if (!OPENAI_API_KEY) {
    console.error('DALL-E: OPENAI_API_KEY not set, skipping image generation')
    return null
  }

  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: `Professional infographic illustration for a cybersecurity/crypto safety article. Topic: ${description}. Style: modern, clean, dark theme (slate-900 background), flat design with subtle gradients, no text overlays, no watermarks. Colors: indigo-500, rose-500, emerald-500 accents on dark background.`,
        n: 1,
        size: '1792x1024',
        quality: 'standard',
        style: 'vivid',
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`DALL-E API ${res.status}: ${errText}`)
    }

    const data = await res.json()
    const imageUrl = data.data?.[0]?.url
    if (!imageUrl) throw new Error('No image URL in DALL-E response')

    return {
      type: 'IMAGE',
      url: imageUrl,
      altText,
      width: 1792,
      height: 1024,
      tempUrl: true, // DALL-E URLs expire — must upload to storage
    }
  } catch (err) {
    console.error('DALL-E generation failed:', err.message)
    return null
  }
}

// ─── Supabase Storage Upload ───

/**
 * Download an image from a URL and upload it to Supabase Storage.
 * Returns the public URL.
 */
async function uploadToSupabaseStorage(imageUrl, storagePath) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Supabase Storage: missing credentials, using original URL')
    return imageUrl
  }

  try {
    // Download the image
    const imgRes = await fetch(imageUrl)
    if (!imgRes.ok) throw new Error(`Failed to download image: ${imgRes.status}`)

    const contentType = imgRes.headers.get('content-type') || 'image/png'
    const buffer = await imgRes.arrayBuffer()

    // Upload to Supabase Storage
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/visuals/${storagePath}`

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': contentType,
        'x-upsert': 'true', // Overwrite if exists
      },
      body: buffer,
    })

    if (!uploadRes.ok) {
      const errText = await uploadRes.text()
      // If bucket doesn't exist, try to create it
      if (errText.includes('Bucket not found') || errText.includes('not found')) {
        await createStorageBucket()
        // Retry upload
        const retryRes = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': contentType,
            'x-upsert': 'true',
          },
          body: buffer,
        })
        if (!retryRes.ok) throw new Error(`Upload retry failed: ${await retryRes.text()}`)
      } else {
        throw new Error(`Upload failed: ${errText}`)
      }
    }

    // Return the public URL
    return `${SUPABASE_URL}/storage/v1/object/public/visuals/${storagePath}`
  } catch (err) {
    console.error('Supabase Storage upload failed:', err.message)
    return imageUrl // Fall back to original URL
  }
}

/**
 * Create the 'visuals' storage bucket if it doesn't exist.
 */
async function createStorageBucket() {
  try {
    await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
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
  } catch (err) {
    console.error('Failed to create storage bucket:', err.message)
  }
}

// ─── HTML Replacement ───

/**
 * Build a <figure> HTML block for an embedded visual.
 */
function buildVisualHtml(visual) {
  if (!visual || !visual.url) return ''

  const isSvg = visual.url.includes('mermaid.ink/svg') || visual.type === 'DIAGRAM'

  if (isSvg) {
    return `<figure class="ck-visual ck-visual--${visual.type.toLowerCase()}" style="margin:2rem 0;text-align:center;">
  <img src="${visual.url}" alt="${escapeHtml(visual.altText)}" loading="lazy" style="max-width:100%;height:auto;border-radius:12px;border:1px solid rgba(148,163,184,0.2);background:rgb(15,23,42);padding:1rem;" />
  <figcaption style="margin-top:0.5rem;font-size:0.85rem;color:#94a3b8;font-style:italic;">${escapeHtml(visual.altText)}</figcaption>
</figure>`
  }

  return `<figure class="ck-visual ck-visual--${visual.type.toLowerCase()}" style="margin:2rem 0;text-align:center;">
  <img src="${visual.url}" alt="${escapeHtml(visual.altText)}" loading="lazy" width="${visual.width || 700}" style="max-width:100%;height:auto;border-radius:12px;border:1px solid rgba(148,163,184,0.2);" />
  <figcaption style="margin-top:0.5rem;font-size:0.85rem;color:#94a3b8;font-style:italic;">${escapeHtml(visual.altText)}</figcaption>
</figure>`
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

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
  const { contentId, contentType = 'content', aiHelpers, onProgress } = options

  if (!htmlContent || typeof htmlContent !== 'string') {
    return { html: htmlContent, visuals: [], stats: { total: 0, succeeded: 0, failed: 0 } }
  }

  const placeholders = parseVisualPlaceholders(htmlContent)

  if (placeholders.length === 0) {
    return { html: htmlContent, visuals: [], stats: { total: 0, succeeded: 0, failed: 0 } }
  }

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
            visual = await generateImage(ph.description, ph.altText)
            break
        }

        if (!visual) return { placeholder: ph, visual: null }

        // Upload to Supabase Storage for persistence (especially needed for DALL-E temp URLs)
        if (visual.tempUrl || ph.type === 'IMAGE') {
          const ext = visual.url.includes('.svg') ? 'svg' : 'png'
          const persistentUrl = await uploadToSupabaseStorage(visual.url, `${storagePath}.${ext}`)
          visual.url = persistentUrl
          visual.tempUrl = false
        } else if (ph.type === 'CHART') {
          // Charts from QuickChart.io — upload for persistence too
          const persistentUrl = await uploadToSupabaseStorage(visual.url, `${storagePath}.png`)
          visual.url = persistentUrl
        }
        // Diagrams from mermaid.ink are deterministic URLs, no upload needed

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
        }
        failed++
      }
    }

    if (onProgress && ci < chunks.length - 1) {
      const pct = 72 + Math.round(((ci + 1) / chunks.length) * 10)
      onProgress('visuals', pct, `Generated ${succeeded + failed}/${placeholders.length} visuals...`)
    }
  }

  // Replace placeholders in HTML
  let updatedHtml = htmlContent

  for (const { placeholder, visual } of visuals) {
    if (visual) {
      const figureHtml = buildVisualHtml(visual)
      updatedHtml = updatedHtml.replace(placeholder.fullMatch, figureHtml)
    } else {
      // Failed generation — replace with a styled fallback card
      const fallbackHtml = `<figure class="ck-visual ck-visual--placeholder" style="margin:2rem 0;text-align:center;padding:2rem;background:rgba(99,102,241,0.08);border:2px dashed rgba(99,102,241,0.3);border-radius:12px;">
  <div style="font-size:2rem;margin-bottom:0.5rem;">${placeholder.type === 'CHART' ? '📊' : placeholder.type === 'DIAGRAM' ? '🔀' : '🖼️'}</div>
  <p style="color:#94a3b8;font-size:0.9rem;margin:0;">${escapeHtml(placeholder.description)}</p>
</figure>`
      updatedHtml = updatedHtml.replace(placeholder.fullMatch, fallbackHtml)
    }
  }

  if (onProgress) {
    onProgress('visuals', 82, `Visual generation complete: ${succeeded} succeeded, ${failed} failed`)
  }

  return {
    html: updatedHtml,
    visuals: visuals.map(({ placeholder, visual }) => ({
      type: placeholder.type,
      description: placeholder.description,
      altText: placeholder.altText,
      url: visual?.url || null,
      succeeded: !!visual,
      width: visual?.width || null,
      height: visual?.height || null,
    })),
    stats: {
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
  generateChart,
  generateDiagram,
  generateImage,
  uploadToSupabaseStorage,
  buildVisualHtml,
}
