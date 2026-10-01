'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')

// Execute the actual ESM route/helper source with isolated fake environment and
// network boundaries. No live credentials, database writes, or external calls.
const ROOT = path.resolve(__dirname, '..')
function load(relative, context, imports = {}) {
  let source = fs.readFileSync(path.join(ROOT, relative), 'utf8')
  const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map(m => m[1])
  source = source.replace(/^import\s+(.+?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, binding, specifier) => {
    return `const ${binding} = __imports[${JSON.stringify(specifier)}]`
  })
  source = source.replace(/export\s*\{([^}]+)\}\s*;?/g, (_, list) => {
    names.push(...list.split(',').map(s => s.trim()))
    return ''
  }).replace(/\bexport\s+/g, '')
  return vm.runInNewContext(`(function (__imports) { ${source}\nreturn { ${names.join(',')} } })`, context, { filename: relative })(imports)
}
function setup({ service = 'test-service', browser = false, respond = () => [] } = {}) {
  const calls = []
  const context = {
    process: { env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.invalid',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon',
      SUPABASE_SERVICE_ROLE_KEY: service,
      ADMIN_SECRET: 'test-admin', CRON_SECRET: 'test-cron',
    } },
    Response, Request, URL, Headers, Buffer, console,
    fetch: async (url, options) => {
      calls.push({ url, options })
      return new Response(JSON.stringify(await respond(url, options)), {
        headers: { 'content-range': '0-0/1', 'Content-Type': 'application/json' },
      })
    },
  }
  if (browser) context.window = {}
  const supabase = load('lib/supabase.js', context)
  const auth = load('lib/admin-auth.js', context, { crypto })
  const dependencies = {
    '@/lib/supabase': supabase,
    '@/lib/admin-auth': auth,
    '@/lib/update-history': { EDITORIAL_FIELDS: [], appendUpdateHistory() {}, makeEntry() {} },
    '@/lib/topical-map/stages': { STAGES: [{ key: 'research' }], DEFAULT_CONFIG: {} },
    '@/lib/keyword-data': { isKeywordDataAvailable: () => true },
    '@/lib/content-brief/sullivan': require('../lib/content-brief/sullivan'),
    '@/lib/content-brief/assemble': require('../lib/content-brief/assemble'),
    '@/lib/topical-map/publication-plan': require('../lib/topical-map/publication-plan'),
  }
  return { calls, context, supabase, auth, route: file => load(file, context, dependencies) }
}
function request(method = 'GET', token = null, body) {
  return new Request('https://app.invalid/api/admin/test', {
    method, headers: token ? { Authorization: `Bearer ${token}` } : {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
const routes = [
  ['app/api/admin/reviews/list/route.js', ['GET']],
  ['app/api/admin/reviews/[id]/route.js', ['GET', 'PATCH']],
  ['app/api/admin/content/list/route.js', ['GET']],
  ['app/api/admin/content/[id]/route.js', ['GET', 'PATCH']],
  ['app/api/admin/topical-map/runs/route.js', ['GET', 'POST']],
  ['app/api/admin/topical-map/runs/[id]/route.js', ['GET', 'DELETE']],
  ['app/api/admin/topical-map/topics/[id]/content-brief/route.js', ['GET', 'PATCH', 'PUT']],
  ['app/api/admin/stats/route.js', ['GET']],
  ['app/api/admin/brands/route.js', ['GET']],
]
for (const [file, methods] of routes) {
  for (const method of methods) test(`${file} ${method}: denies missing/invalid/expired authorization before any data request`, async () => {
    const h = setup()
    const route = h.route(file)
    for (const token of [null, 'wrong-token', h.auth.issueSessionToken(-1000)]) {
      const res = await route[method](request(method, token, method === 'GET' ? undefined : {}), { params: { id: 'draft-1' } })
      assert.equal(res.status, 401)
      assert.equal(h.calls.length, 0)
    }
  })
}

test('public GET/HEAD keep anon credentials; explicit privileged reads and writes use service credentials', async () => {
  const h = setup()
  for (const options of [{}, { method: 'HEAD' }, { useServiceRole: true }, { method: 'HEAD', useServiceRole: true }, { method: 'PATCH' }]) {
    await h.supabase.supabaseRequest('/reviews', options)
  }
  assert.deepEqual(h.calls.map(c => c.options.headers.apikey), ['test-anon', 'test-anon', 'test-service', 'test-service', 'test-service'])
  assert.ok(h.calls.every(c => !('useServiceRole' in c.options)))
})

test('privileged reads and writes fail closed before fetch when service key is absent', async () => {
  const h = setup({ service: '' })
  for (const options of [{ useServiceRole: true }, { method: 'HEAD', useServiceRole: true }, ...['POST', 'PATCH', 'PUT', 'DELETE'].map(method => ({ method }))]) {
    await assert.rejects(h.supabase.supabaseRequest('/reviews', options), /SUPABASE_SERVICE_ROLE_KEY is required/)
  }
  assert.equal(h.calls.length, 0)
  await h.supabase.supabaseRequest('/reviews')
  assert.equal(h.calls[0].options.headers.apikey, 'test-anon')
})

test('browser code cannot issue privileged reads or writes', async () => {
  const h = setup({ browser: true })
  await assert.rejects(h.supabase.supabaseRequest('/reviews', { useServiceRole: true }), /server-only/)
  await assert.rejects(h.supabase.supabaseRequest('/reviews', { method: 'POST' }), /server-only/)
  assert.equal(h.calls.length, 0)
  await h.supabase.supabaseRequest('/reviews')
  assert.equal(h.calls[0].options.headers.apikey, 'test-anon')
})

function draftResponse(url, options) {
  const table = new URL(url).pathname.split('/').at(-1)
  if (['reviews', 'content', 'topical_map_runs', 'content_briefs'].includes(table)) {
    assert.equal(options.headers.apikey, 'test-service', `${table} must be read with explicit server privilege`)
  }
  if (table === 'reviews') return [{ id: 'draft-1', brand_id: 'brand-1', title: 'Draft review', status: 'draft' }]
  if (table === 'content') return [{ id: 'draft-1', title: 'Draft article', status: 'draft' }]
  if (table === 'scam_brands') return [{ id: 'brand-1', name: 'Example' }]
  if (table === 'topical_map_runs') return [{ id: 'draft-1', status: 'running', artifacts: {} }]
  if (table === 'topics') return [{ id: 'draft-1', title: 'Example topic' }]
  if (table === 'content_briefs') return [{ id: 'brief-1', topic_id: 'draft-1', status: 'draft', content_type: null }]
  return []
}
for (const [file, methods] of routes.filter(([file]) => !file.endsWith('/brands/route.js'))) {
  if (!methods.includes('GET')) continue
  test(`${file} GET: a signed admin session can read draft/planning rows`, async () => {
    const h = setup({ respond: draftResponse })
    const res = await h.route(file).GET(request('GET', h.auth.issueSessionToken()), { params: { id: 'draft-1' } })
    assert.equal(res.status, 200, await res.clone().text())
    assert.ok(h.calls.some(c => c.options.headers.apikey === 'test-service'))
  })
}

test('content-brief PATCH and PUT opt in on all prereads and reloads after auth', async () => {
  for (const [method, body] of [['PATCH', { status: 'draft' }], ['PUT', { content_type: null, forcing_inputs: null }]]) {
    const h = setup({ respond: draftResponse })
    const route = h.route('app/api/admin/topical-map/topics/[id]/content-brief/route.js')
    const res = await route[method](request(method, h.auth.issueSessionToken(), body), { params: { id: 'draft-1' } })
    assert.equal(res.status, 200, await res.clone().text())
    assert.ok(h.calls.filter(c => c.url.includes('/content_briefs?')).length >= 3)
  }
})

test('privileged pagination preserves service role for every page', async () => {
  const h = setup({ respond: url => new URL(url).searchParams.get('offset') === '0' ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }] })
  const rows = await h.supabase.fetchAllRows('/reviews', 'id', 2, { useServiceRole: true })
  assert.equal(rows.length, 3)
  assert.equal(h.calls.length, 2)
  assert.ok(h.calls.every(c => c.options.headers.apikey === 'test-service'))
})

test('admin draft read with missing service key returns configuration error, never an empty anon result', async () => {
  const h = setup({ service: '' })
  const res = await h.route('app/api/admin/reviews/list/route.js').GET(request('GET', h.auth.issueSessionToken()))
  assert.equal(res.status, 500)
  assert.match((await res.json()).error, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.equal(h.calls.length, 0)
})

test('polish watchdog authenticates first and uses privileged reads for unfinished drafts', async () => {
  const h = setup()
  const route = h.route('app/api/cron/polish-watchdog/route.js')
  assert.equal((await route.GET(request())).status, 401)
  assert.equal(h.calls.length, 0)
  assert.equal((await route.GET(request('GET', 'test-cron'))).status, 200)
  assert.equal(h.calls.length, 2)
  assert.ok(h.calls.every(c => c.options.headers.apikey === 'test-service'))
})

test('unauthenticated localized preview never uses service-role credentials and filters both translation reads', () => {
  const source = fs.readFileSync(path.join(ROOT, 'app/[locale]/review/[slug]/page.js'), 'utf8')
  assert.doesNotMatch(source, /useServiceRole\s*:\s*true/)
  const queries = source.match(/`\/review_translations\?locale=[^`]+`/g)
  assert.equal(queries.length, 2)
  assert.ok(queries.every(q => q.includes('status=eq.published')))
  const masterQueries = source.match(/`\/reviews\?id=[^`]+`/g)
  assert.ok(masterQueries.every(q => q.includes('status=eq.published')))
})
