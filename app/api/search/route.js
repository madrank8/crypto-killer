import { supabaseRequest } from '@/lib/supabase'

export async function GET(request) {
  try {
    const searchParams = request.nextUrl.searchParams
    const query = searchParams.get('q')

    if (!query || query.trim().length < 2) {
      return Response.json({ results: [] })
    }

    // Search scam_brands by name using ILIKE (case-insensitive like)
    const encodedQuery = encodeURIComponent(`%${query}%`)
    const results = await supabaseRequest(
      `/scam_brands?select=id,slug,name,scam_score&name=ilike.${encodedQuery}&limit=10`
    )

    return Response.json({ results: results || [] })
  } catch (error) {
    console.error('Search error:', error)
    return Response.json({ error: 'Search failed' }, { status: 500 })
  }
}
