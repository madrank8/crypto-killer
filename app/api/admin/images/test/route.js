export const maxDuration = 60

/**
 * GET /api/admin/images/test
 * Temporary debug endpoint — tests each step of the image pipeline individually.
 * No auth required (temporary, remove after debugging).
 */
export async function GET() {

  const steps = {}

  // Step 1: Check env vars
  steps.env = {
    UNSPLASH_ACCESS_KEY: !!process.env.UNSPLASH_ACCESS_KEY,
    TINYPNG_API_KEY: !!process.env.TINYPNG_API_KEY,
    SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    APIFRAME_API_KEY: !!process.env.APIFRAME_API_KEY,
  }

  // Step 2: Test Unsplash search
  try {
    const key = process.env.UNSPLASH_ACCESS_KEY
    const params = new URLSearchParams({ query: 'laptop office desk', per_page: '1', orientation: 'landscape', content_filter: 'high' })
    const res = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
      headers: { Authorization: `Client-ID ${key}` },
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json()
    steps.unsplash = {
      status: res.status,
      total: data.total,
      firstUrl: data.results?.[0]?.urls?.regular?.slice(0, 100) || null,
    }
  } catch (e) {
    steps.unsplash = { error: e.message }
  }

  // Step 3: Test TinyPNG compression
  if (steps.unsplash?.firstUrl) {
    try {
      const key = process.env.TINYPNG_API_KEY
      const auth = Buffer.from(`api:${key}`).toString('base64')
      const res = await fetch('https://api.tinify.com/shrink', {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: { url: steps.unsplash.firstUrl } }),
        signal: AbortSignal.timeout(30000),
      })
      if (!res.ok) {
        steps.tinypng = { error: `${res.status}: ${await res.text()}` }
      } else {
        const result = await res.json()
        steps.tinypng = {
          inputSize: result.input?.size,
          outputSize: result.output?.size,
          outputUrl: result.output?.url?.slice(0, 80),
        }

        // Step 4: Download compressed image
        try {
          const dl = await fetch(result.output.url, { signal: AbortSignal.timeout(15000) })
          const buf = Buffer.from(await dl.arrayBuffer())
          steps.download = { size: buf.length, type: dl.headers.get('content-type') }

          // Step 5: Upload to Supabase
          try {
            const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
            const writeKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
            const fname = `test-${Date.now()}.jpg`
            const uploadUrl = `${supaUrl}/storage/v1/object/visuals/${fname}`

            const upRes = await fetch(uploadUrl, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${writeKey}`,
                'Content-Type': dl.headers.get('content-type') || 'image/jpeg',
                'x-upsert': 'true',
              },
              body: buf,
              signal: AbortSignal.timeout(15000),
            })

            if (!upRes.ok) {
              steps.upload = { error: `${upRes.status}: ${await upRes.text()}` }
            } else {
              const publicUrl = `${supaUrl}/storage/v1/object/public/visuals/${fname}`
              steps.upload = { success: true, publicUrl }
            }
          } catch (e) {
            steps.upload = { error: e.message }
          }
        } catch (e) {
          steps.download = { error: e.message }
        }
      }
    } catch (e) {
      steps.tinypng = { error: e.message }
    }
  }

  return Response.json({ steps })
}
