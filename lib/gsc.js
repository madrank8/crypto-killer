import { createSign } from 'crypto'

/**
 * Google Search Console API client — service-account auth, zero deps.
 *
 * Env vars (see docs/REPLIT_ANALYTICS_TRACKER_HANDOFF.md for the traffic
 * side; GSC setup steps live in docs/GSC_SETUP.md):
 *   GSC_CLIENT_EMAIL  service account email
 *   GSC_PRIVATE_KEY   PEM private key ("\n" escapes tolerated)
 *   GSC_SITE_URL      property, e.g. "sc-domain:cryptokiller.org"
 *
 * We hand-roll the RS256 JWT with node:crypto instead of pulling in
 * googleapis (~30 MB) for two small API calls.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'

function b64url(input) {
  return Buffer.from(input).toString('base64url')
}

function getConfig() {
  const clientEmail = process.env.GSC_CLIENT_EMAIL || ''
  const privateKey = (process.env.GSC_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  const siteUrl = process.env.GSC_SITE_URL || ''
  if (!clientEmail || !privateKey || !siteUrl) {
    throw new Error('GSC not configured: set GSC_CLIENT_EMAIL, GSC_PRIVATE_KEY, GSC_SITE_URL')
  }
  return { clientEmail, privateKey, siteUrl }
}

/** True when all three GSC env vars are present. */
export function gscConfigured() {
  return Boolean(process.env.GSC_CLIENT_EMAIL && process.env.GSC_PRIVATE_KEY && process.env.GSC_SITE_URL)
}

let cachedToken = null // { token, exp }

async function getAccessToken() {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token

  const { clientEmail, privateKey } = getConfig()
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  const signature = signer.sign(privateKey, 'base64url')
  const assertion = `${header}.${claims}.${signature}`

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) {
    throw new Error(`GSC token exchange failed: ${res.status} ${await res.text()}`)
  }
  const data = await res.json()
  cachedToken = { token: data.access_token, exp: Date.now() + (data.expires_in - 60) * 1000 }
  return cachedToken.token
}

/**
 * Query the Search Analytics API.
 * @param {object} opts
 * @param {string} opts.startDate - YYYY-MM-DD
 * @param {string} opts.endDate - YYYY-MM-DD
 * @param {string[]} opts.dimensions - e.g. ['date','page']
 * @param {number} [opts.rowLimit]
 * @returns {Promise<Array<{keys: string[], clicks: number, impressions: number, ctr: number, position: number}>>}
 */
export async function gscQuery({ startDate, endDate, dimensions, rowLimit = 5000 }) {
  const { siteUrl } = getConfig()
  const token = await getAccessToken()
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`

  const rows = []
  let startRow = 0
  // Page through (API caps at 25k rows/request; we use smaller pages)
  for (;;) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ startDate, endDate, dimensions, rowLimit, startRow }),
    })
    if (!res.ok) {
      throw new Error(`GSC query failed: ${res.status} ${await res.text()}`)
    }
    const data = await res.json()
    const batch = data.rows || []
    rows.push(...batch)
    if (batch.length < rowLimit) break
    startRow += batch.length
  }
  return rows
}
