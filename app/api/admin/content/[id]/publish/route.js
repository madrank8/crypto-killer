import { revalidatePath } from 'next/cache'

import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

async function syncToLiveBlog({ content, topic }) {
  const replitUrl = process.env.REPLIT_SITE_URL
  const syncSecret = process.env.SYNC_SECRET
  if (!replitUrl || !syncSecret) {
    return { success: false, error: 'REPLIT_SITE_URL and SYNC_SECRET are not configured' }
  }

  const payload = {
    content,
    topic,
    destination: 'blog',
    url: `/blog/${content.slug}`,
  }

  const endpoints = ['/api/sync/blog', '/api/sync/content', '/api/sync/post']

  let lastErr = null
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`${replitUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${syncSecret}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      })

      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        return { success: true, endpoint, result: data }
      }

      const text = await res.text().catch(() => '')
      lastErr = `${endpoint} -> ${res.status} ${text}`
    } catch (e) {
      lastErr = `${endpoint} -> ${e.message}`
    }
  }

  return { success: false, error: lastErr || 'Unknown sync failure' }
}

/**
 * POST /api/admin/content/[id]/publish
 * Body: { action: "publish" | "unpublish" }
 */
export async function POST(request, { params }) {
  try {
    verifyAdmin(request)

    const { id } = await params
    const { action } = await request.json()
    if (!['publish', 'unpublish'].includes(action)) {
      return Response.json({ error: 'Invalid action. Use publish or unpublish' }, { status: 400 })
    }

    const rows = await supaFetch(`/content?id=eq.${id}&select=*&limit=1`)
    const content = Array.isArray(rows) ? rows[0] : null
    if (!content) return Response.json({ error: 'Content not found' }, { status: 404 })

    const nowIso = new Date().toISOString()
    const contentUpdates =
      action === 'publish'
        ? { status: 'published', published_at: nowIso, updated_at: nowIso }
        : { status: 'draft', published_at: null, updated_at: nowIso }

    await supaFetch(`/content?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(contentUpdates),
    })

    if (content.topic_id) {
      const topicStatus = action === 'publish' ? 'published' : 'draft'
      await supaFetch(`/topics?id=eq.${content.topic_id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ content_status: topicStatus, updated_at: nowIso }),
      })
    }

    let topic = null
    if (content.topic_id) {
      const tRows = await supaFetch(`/topics?id=eq.${content.topic_id}&select=*&limit=1`)
      topic = Array.isArray(tRows) ? tRows[0] : null
    }

    let liveSync = null
    if (action === 'publish') {
      liveSync = await syncToLiveBlog({
        content: { ...content, ...contentUpdates },
        topic,
      })
    } else if (action === 'unpublish') {
      // Notify live site to remove/unpublish the article
      liveSync = await syncToLiveBlog({
        content: { ...content, ...contentUpdates, _action: 'unpublish' },
        topic,
      })
    }

    try {
      revalidatePath('/blog')
      revalidatePath(`/blog/${content.slug}`)
      if (content.topic_id) revalidatePath('/admin/topical-map')
    } catch (e) {
      // non-fatal
      console.error('revalidate failed:', e.message)
    }

    return Response.json({
      success: true,
      id,
      action,
      status: contentUpdates.status,
      published_at: contentUpdates.published_at,
      live_sync: liveSync,
      blog_url: `https://cryptokiller.org/blog/${content.slug}`,
    })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}

