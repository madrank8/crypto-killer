import { createHash } from 'crypto'
import { supabaseRequest } from '@/lib/supabase'

/**
 * POST /api/track — first-party analytics collector.
 *
 * Receives pageview/click beacons from cryptokiller.org (Replit production)
 * and any Vercel-rendered pages, and writes them to Supabase
 * `analytics_events` (service_role; RLS blocks anon entirely).
 *
 * Privacy model: no cookies, no raw IP/UA stored. Visitor identity is
 * sha256(dailySalt + ip + ua) — the salt rotates at UTC midnight, so a
 * visitor is only linkable within a single day (Plausible-style).
 *
 * Accepts sendBeacon payloads (Content-Type text/plain) as well as
 * fetch JSON. Responds 204 always on handled requests — a collector
 * should never make the page care about its failures.
 */

const ALLOWED_ORIGINS = new Set([
  'https://cryptokiller.org',
  'https://www.cryptokiller.org',
  'https://crypto-killer.vercel.app',
  'http://localhost:3000',
  'http://localhost:5000',
])

const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|pingdom|monitor|scrape|python-requests|curl|wget|facebookexternalhit|preview/i

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : 'https://cryptokiller.org'
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export async function OPTIONS(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin') || '') })
}

function sha256(input) {
  return createHash('sha256').update(input).digest('hex')
}

function deviceFromUA(ua) {
  if (/ipad|tablet|kindle|silk/i.test(ua)) return 'tablet'
  if (/mobi|iphone|android.*mobile/i.test(ua)) return 'mobile'
  return 'desktop'
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

const trim = (v, max) => (typeof v === 'string' && v ? v.slice(0, max) : null)

export async function POST(request) {
  const origin = request.headers.get('origin') || ''
  const headers = corsHeaders(origin)

  try {
    const ua = request.headers.get('user-agent') || ''
    // Drop bots and UA-less clients silently — they get a 204 too so
    // nothing retries; they just never reach the table.
    if (!ua || BOT_RE.test(ua)) {
      return new Response(null, { status: 204, headers })
    }

    // sendBeacon often ships text/plain; parse defensively.
    let body
    try {
      body = JSON.parse(await request.text())
    } catch {
      return new Response(null, { status: 204, headers })
    }

    const path = trim(body.path, 500)
    if (!path || !path.startsWith('/')) {
      return new Response(null, { status: 204, headers })
    }

    const eventType = body.event_type === 'click' ? 'click' : 'pageview'

    const ip =
      request.headers.get('x-real-ip') ||
      (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
      '0.0.0.0'
    const dailySalt = new Date().toISOString().slice(0, 10)
    const visitorHash = sha256(`${dailySalt}|${ip}|${ua}`)
    const sessionHash = body.sid ? sha256(`${dailySalt}|${trim(body.sid, 64)}`) : null

    const referrer = trim(body.referrer, 500)
    const referrerHost = referrer ? hostOf(referrer) : null

    // POST → service_role via getKeyForMethod; RLS keeps anon locked out.
    await supabaseRequest('/analytics_events', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([{
        event_type: eventType,
        path,
        locale: trim(body.locale, 10),
        referrer: referrerHost && referrerHost !== 'cryptokiller.org' ? referrer : null,
        referrer_host: referrerHost !== 'cryptokiller.org' ? referrerHost : null,
        utm_source: trim(body.utm_source, 100),
        utm_medium: trim(body.utm_medium, 100),
        utm_campaign: trim(body.utm_campaign, 100),
        visitor_hash: visitorHash,
        session_hash: sessionHash,
        country: request.headers.get('x-vercel-ip-country') || null,
        device: deviceFromUA(ua),
        target: eventType === 'click' ? trim(body.target, 500) : null,
      }]),
    })

    return new Response(null, { status: 204, headers })
  } catch (err) {
    // Collector never surfaces errors to the page.
    console.error('[track]', err.message)
    return new Response(null, { status: 204, headers })
  }
}
