import { NextResponse } from 'next/server'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { supaFetch } from '@/lib/supabase'
import { parseSheetInput, fetchGoogleSheetCsv } from '@/lib/topical-map/import/parse-sheet'
import { consolidateKoray } from '@/lib/topical-map/import/koray-structure'
import { persistImportedMap, deleteOrphanMap, retireMapSlugs } from '@/lib/topical-map/import/persist'
import { validateImportedPages } from '@/lib/topical-map/import/validate-sheet'
import { assertImportCoverage } from '@/lib/topical-map/import/coverage'

export const maxDuration = 120

/**
 * Fire-and-forget readiness kickoff. Stubbed until Task 7 lands the real
 * orchestrator (lib/topical-map/readiness/run-map.js); the try/catch keeps
 * a missing or broken module from failing the import itself. We only await
 * the module load, never the readiness work, so the import response is
 * never blocked on it.
 */
async function kickoffReadiness(mapId) {
  try {
    const { startMapReadiness } = await import('@/lib/topical-map/readiness/run-map')
    void startMapReadiness({ mapId, supaFetch }).catch((e) => {
      console.error('[topical-map/import] readiness kickoff failed', e)
    })
    return { started: true }
  } catch (e) {
    console.error('[topical-map/import] readiness module unavailable', e)
    return { started: false, error: e.message }
  }
}

/**
 * POST /api/admin/topical-map/import
 *
 * Multipart: file (.xlsx/.csv) + optional map_name + optional replace_map_id
 * OR JSON: { sheet_url, map_name?, replace_map_id? }
 *
 * Always creates a NEW topical_maps row + topic tree; when replace_map_id
 * is set, the prior map is deleted only after the new one persists and
 * verifies successfully (never delete-before-write).
 */
export async function POST(request) {
  try {
    verifyAdmin(request)

    const contentType = request.headers.get('content-type') || ''
    let parsed
    let mapName = null
    let replaceMapId = null
    let source = 'upload'

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      mapName = form.get('map_name') ? String(form.get('map_name')) : null
      replaceMapId = form.get('replace_map_id') ? String(form.get('replace_map_id')).trim() : null
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
      replaceMapId = body.replace_map_id ? String(body.replace_map_id).trim() : null
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

    const gate = validateImportedPages(parsed.pages)
    if (!gate.ok) {
      return NextResponse.json(
        { error: 'Sheet failed required-field gate', validation_errors: gate.errors },
        { status: 422 }
      )
    }

    const { structure, warnings, counts } = consolidateKoray(parsed.pages)

    const coverage = assertImportCoverage({ pages: parsed.pages, structure, counts })
    if (!coverage.ok) {
      return NextResponse.json(
        {
          error: 'Sheet failed coverage gate',
          coverage_errors: coverage.errors,
          missing_titles: coverage.missing_titles,
        },
        { status: 422 }
      )
    }

    const allWarnings = [...(parsed.warnings || []), ...gate.warnings, ...warnings]

    const seedKeyword =
      structure.pillars?.[0]?.pillar?.target_keyword ||
      parsed.pages.find((p) => p.target_keyword)?.target_keyword ||
      'crypto scams'

    // Free the replaced map's slugs before persist so the new tree can use
    // clean names. Old topics stay until deleteOrphanMap after success.
    if (replaceMapId) {
      await retireMapSlugs(supaFetch, replaceMapId)
    }

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

    // Replace an existing map only now that the new one has persisted and
    // verified. Never delete the old map before the new one succeeds.
    let replaced = null
    if (replaceMapId) {
      const cleanup = await deleteOrphanMap(supaFetch, replaceMapId)
      replaced = { map_id: replaceMapId, cleaned: cleanup.cleaned, errors: cleanup.errors }
      if (!cleanup.cleaned) {
        console.error(
          `[topical-map/import] CRITICAL: replace_map_id ${replaceMapId} was not fully removed`,
          cleanup.errors
        )
      }
    }

    const readiness = await kickoffReadiness(saved.map_id)

    return NextResponse.json({
      map_id: saved.map_id,
      map_name: saved.map_name,
      topic_count: saved.topic_count,
      counts,
      warnings: allWarnings,
      enrich_available: true,
      source_meta: parsed.source_meta || null,
      replaced,
      readiness,
    })
  } catch (error) {
    if (error.message?.includes('Unauthorized')) return unauthorizedResponse()
    console.error('[topical-map/import]', error)
    return NextResponse.json({ error: error.message || 'Import failed' }, { status: 500 })
  }
}
