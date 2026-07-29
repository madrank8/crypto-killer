import { NextResponse } from 'next/server'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { supaFetch } from '@/lib/supabase'
import { parseSheetInput, fetchGoogleSheetCsv } from '@/lib/topical-map/import/parse-sheet'
import { consolidateKoray } from '@/lib/topical-map/import/koray-structure'
import { persistImportedMap } from '@/lib/topical-map/import/persist'

export const maxDuration = 120

/**
 * POST /api/admin/topical-map/import
 *
 * Multipart: file (.xlsx/.csv) + optional map_name
 * OR JSON: { sheet_url, map_name? }
 *
 * Always creates a NEW topical_maps row + topic tree.
 */
export async function POST(request) {
  try {
    verifyAdmin(request)

    const contentType = request.headers.get('content-type') || ''
    let parsed
    let mapName = null
    let source = 'upload'

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      mapName = form.get('map_name') ? String(form.get('map_name')) : null
      const sheetUrl = form.get('sheet_url') ? String(form.get('sheet_url')).trim() : ''
      const file = form.get('file')

      if (sheetUrl) {
        source = 'google-sheet'
        parsed = await fetchGoogleSheetCsv(sheetUrl)
      } else if (file && typeof file.arrayBuffer === 'function') {
        const buf = Buffer.from(await file.arrayBuffer())
        const filename = file.name || 'upload.xlsx'
        parsed = parseSheetInput({ buffer: buf, filename })
        source = filename.toLowerCase().endsWith('.csv') ? 'csv-upload' : 'xlsx-upload'
      } else {
        return NextResponse.json(
          { error: 'Provide a file upload or sheet_url' },
          { status: 400 }
        )
      }
    } else {
      let body = {}
      try {
        body = await request.json()
      } catch {
        body = {}
      }
      mapName = body.map_name || null
      if (body.sheet_url) {
        source = 'google-sheet'
        parsed = await fetchGoogleSheetCsv(String(body.sheet_url))
      } else if (body.csv_text) {
        source = 'csv-body'
        parsed = parseSheetInput({ csvText: String(body.csv_text) })
      } else {
        return NextResponse.json(
          { error: 'Provide sheet_url or csv_text (or multipart file)' },
          { status: 400 }
        )
      }
    }

    const { structure, warnings, counts } = consolidateKoray(parsed.pages)
    const allWarnings = [...(parsed.warnings || []), ...warnings]

    const seedKeyword =
      structure.pillars?.[0]?.pillar?.target_keyword ||
      parsed.pages.find((p) => p.target_keyword)?.target_keyword ||
      'crypto scams'

    const saved = await persistImportedMap({
      structure,
      mapName,
      seedKeyword,
      coreComponents: parsed.core_components,
      source,
      warnings: allWarnings,
      counts,
      supaFetch,
    })

    return NextResponse.json({
      map_id: saved.map_id,
      map_name: saved.map_name,
      topic_count: saved.topic_count,
      counts,
      warnings: allWarnings,
      enrich_available: true,
      source_meta: parsed.source_meta || null,
    })
  } catch (error) {
    if (error.message?.includes('Unauthorized')) return unauthorizedResponse()
    console.error('[topical-map/import]', error)
    return NextResponse.json({ error: error.message || 'Import failed' }, { status: 500 })
  }
}
