/**
 * scripts/smoke-test-phase4.mjs
 *
 * End-to-end smoke test for the Phase 4 flexible-content flow. Validates:
 *
 *   1. POST /api/admin/topical-map/topics with free-form payload creates a
 *      standalone topic (map_id=NULL) and returns it with the expected
 *      content_type/topic_type values.
 *   2. POST /api/admin/content/create with { title, content_type } (no
 *      topic_id) creates BOTH a topic AND a content draft, linked.
 *   3. The topics_content_type_check constraint accepts blog_post,
 *      informational_page, and landing_page values without a Postgres error.
 *   4. The created records are queryable through Supabase with the right
 *      shape (map_id NULL, content_type as set, content_status='draft').
 *
 * Does NOT trigger the actual writer (that would burn ~$2-3 in Opus tokens
 * per run). To validate the writer's content-type branching, run a generate
 * pass via /admin/content/<id> and inspect the output prose style.
 *
 * Cleanup: by default, all created topics and content rows are DELETED at
 * the end. Pass --keep to leave them for manual inspection.
 *
 * Usage:
 *   ADMIN_SECRET=... node scripts/smoke-test-phase4.mjs
 *   ADMIN_SECRET=... node scripts/smoke-test-phase4.mjs --keep
 *
 * Env:
 *   ADMIN_SECRET                  Required. Matches the one /api/admin routes accept.
 *   ADMIN_BASE_URL                Optional. Defaults to https://crypto-killer.vercel.app.
 *   NEXT_PUBLIC_SUPABASE_URL      Required unless present in .env.local.
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY Required unless present in .env.local.
 *   SUPABASE_SERVICE_ROLE_KEY     Optional. Preferred for cleanup if present.
 */

import { readFileSync } from 'node:fs';

function loadLocalEnv() {
  try {
    const text = readFileSync('.env.local', 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx);
      if (process.env[key]) continue;
      process.env[key] = trimmed.slice(idx + 1).replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // Optional convenience only; CI can pass env vars directly.
  }
}

loadLocalEnv();

const ADMIN_BASE_URL = process.env.ADMIN_BASE_URL || 'https://crypto-killer.vercel.app';
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const KEEP_RECORDS = process.argv.includes('--keep');

if (!ADMIN_SECRET) {
  console.error('ERROR: ADMIN_SECRET env var is required.');
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL and a Supabase key are required.');
  console.error('       Pass NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY, or keep them in .env.local.');
  process.exit(1);
}

const supabaseHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: 'Bearer ' + SUPABASE_KEY,
  'Content-Type': 'application/json',
};

async function supaQuery(path) {
  const r = await fetch(SUPABASE_URL + '/rest/v1' + path, { headers: supabaseHeaders });
  if (!r.ok) throw new Error(`supabase ${r.status}: ${await r.text()}`);
  return r.json();
}

async function adminPost(path, body) {
  const r = await fetch(`${ADMIN_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_SECRET}`,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, ok: r.ok, body: json || text };
}

const created = { topicIds: [], contentIds: [] };

function pass(label, detail = '') {
  console.log(`  \x1b[32m✓\x1b[0m ${label}${detail ? ' — ' + detail : ''}`);
}
function fail(label, detail = '') {
  console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ' — ' + detail : ''}`);
  process.exitCode = 1;
}

async function test1_createStandaloneTopicViaTopicsRoute() {
  console.log('\nTest 1: POST /api/admin/topical-map/topics — standalone topic creation');
  const title = `Smoke test topic ${Date.now()}`;
  const res = await adminPost('/api/admin/topical-map/topics', {
    title,
    content_type: 'blog_post',
    topic_type: 'supporting',
    target_keyword: 'smoke test keyword',
    // No map_id → standalone
  });
  if (!res.ok) return fail('POST returned non-ok', `${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
  if (!res.body?.topic?.id) return fail('Response missing topic.id', JSON.stringify(res.body).slice(0, 200));

  const t = res.body.topic;
  created.topicIds.push(t.id);
  pass('Topic created', `id=${t.id.slice(0, 8)}…`);
  if (t.map_id !== null) fail('map_id should be NULL', `got ${t.map_id}`);
  else pass('map_id is NULL (standalone)');
  if (t.content_type !== 'blog_post') fail('content_type mismatch', `got ${t.content_type}`);
  else pass('content_type=blog_post');
  if (t.topic_type !== 'supporting') fail('topic_type mismatch', `got ${t.topic_type}`);
  else pass('topic_type=supporting');
  if (t.target_keyword !== 'smoke test keyword') fail('target_keyword mismatch', `got ${t.target_keyword}`);
  else pass('target_keyword preserved');

  // Verify in DB
  const rows = await supaQuery(`/topics?id=eq.${t.id}&select=id,title,content_type,topic_type,map_id,content_status`);
  if (!Array.isArray(rows) || rows.length !== 1) return fail('Topic not findable in DB');
  pass('Topic visible in DB', `content_status=${rows[0].content_status}`);
}

async function test2_createContentDraftWithFreeForm() {
  console.log('\nTest 2: POST /api/admin/content/create — dual-mode (free-form path)');
  const title = `Smoke test content ${Date.now()}`;
  const res = await adminPost('/api/admin/content/create', {
    title,
    content_type: 'informational_page',
    topic_type: 'supporting',
    target_keyword: 'smoke test page',
  });
  if (!res.ok) return fail('POST returned non-ok', `${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
  if (!res.body?.id) return fail('Response missing content id');
  if (!res.body?.topic_id) return fail('Response missing topic_id (free-form should create both)');

  created.contentIds.push(res.body.id);
  created.topicIds.push(res.body.topic_id);
  pass('Content draft + topic created together', `content=${res.body.id.slice(0, 8)}… topic=${res.body.topic_id.slice(0, 8)}…`);
  if (res.body.existing) fail('existing should be false for new topic');
  else pass('existing=false');

  // Verify topic + content shape in DB
  const topic = await supaQuery(`/topics?id=eq.${res.body.topic_id}&select=*`);
  if (!Array.isArray(topic) || topic.length !== 1) return fail('Topic not findable in DB');
  if (topic[0].content_type !== 'informational_page') fail('topic content_type mismatch', `got ${topic[0].content_type}`);
  else pass('topic.content_type=informational_page');
  if (topic[0].content_id !== res.body.id) fail('topic.content_id not linked', `got ${topic[0].content_id}`);
  else pass('topic.content_id linked to content row');

  const content = await supaQuery(`/content?id=eq.${res.body.id}&select=*`);
  if (!Array.isArray(content) || content.length !== 1) return fail('Content not findable in DB');
  if (content[0].content_type !== 'informational_page') fail('content content_type mismatch', `got ${content[0].content_type}`);
  else pass('content.content_type=informational_page');
  if (content[0].status !== 'draft') fail('content status not draft', `got ${content[0].status}`);
  else pass('content.status=draft');
  if (content[0].topic_id !== res.body.topic_id) fail('content.topic_id mismatch');
  else pass('content.topic_id linked');
}

async function test3_landingPageEnumAccepted() {
  console.log('\nTest 3: landing_page content_type accepted by DB constraint');
  const title = `Smoke test landing ${Date.now()}`;
  const res = await adminPost('/api/admin/topical-map/topics', {
    title,
    content_type: 'landing_page',
    topic_type: 'pillar',
  });
  if (!res.ok) return fail('landing_page rejected', `${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
  if (!res.body?.topic?.id) return fail('No topic returned');
  created.topicIds.push(res.body.topic.id);
  pass('landing_page topic created');
  if (res.body.topic.content_type !== 'landing_page') fail('content_type mismatch');
  else pass('content_type=landing_page persisted');
}

async function test4_invalidContentTypeRejected() {
  console.log('\nTest 4: Invalid content_type rejected with 400');
  const res = await adminPost('/api/admin/topical-map/topics', {
    title: `Smoke test bogus ${Date.now()}`,
    content_type: 'definitely_not_a_real_type',
  });
  if (res.status !== 400) return fail(`Expected 400, got ${res.status}`, JSON.stringify(res.body).slice(0, 200));
  pass('Returns 400 for invalid content_type');
  const errMsg = res.body?.error || '';
  if (!errMsg.toLowerCase().includes('invalid')) fail('Error message should say "invalid"', `got: ${errMsg}`);
  else pass(`Error message: ${errMsg.slice(0, 80)}`);
}

async function test5_legacyTopicIdPath() {
  console.log('\nTest 5: Legacy { topic_id } path still works on /api/admin/content/create');
  // First create a topic via the new path so we have a topic_id to feed in
  const t = await adminPost('/api/admin/topical-map/topics', {
    title: `Smoke legacy ${Date.now()}`,
    content_type: 'guide',
  });
  if (!t.ok || !t.body?.topic?.id) return fail('Could not seed topic');
  const topicId = t.body.topic.id;
  created.topicIds.push(topicId);

  // Now create content via legacy { topic_id }
  const res = await adminPost('/api/admin/content/create', { topic_id: topicId });
  if (!res.ok) return fail('Legacy path failed', `${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
  if (!res.body?.id) return fail('No content id returned');
  created.contentIds.push(res.body.id);
  pass('Legacy { topic_id } still creates content');
  if (res.body.topic_id !== topicId) fail('Returned topic_id does not match');
  else pass('Returned topic_id matches input');

  // Hit it twice — should return existing
  const res2 = await adminPost('/api/admin/content/create', { topic_id: topicId });
  if (!res2.ok) return fail('Second call failed');
  if (!res2.body?.existing) fail('Second call should return existing=true');
  else pass('Second call returns existing=true (idempotent)');
}

async function cleanup() {
  if (KEEP_RECORDS) {
    console.log('\n[cleanup] Skipping cleanup (--keep flag set)');
    console.log(`  Topics created: ${created.topicIds.length} — ${created.topicIds.map(id => id.slice(0, 8)).join(', ')}`);
    console.log(`  Content created: ${created.contentIds.length}`);
    return;
  }
  console.log('\n[cleanup] Removing test records…');
  // Delete content first (FK), then topics
  for (const id of created.contentIds) {
    try {
      await fetch(SUPABASE_URL + `/rest/v1/content?id=eq.${id}`, {
        method: 'DELETE',
        headers: supabaseHeaders,
      });
    } catch (e) { console.log(`  failed to delete content ${id}: ${e.message}`); }
  }
  for (const id of created.topicIds) {
    try {
      await fetch(SUPABASE_URL + `/rest/v1/topics?id=eq.${id}`, {
        method: 'DELETE',
        headers: supabaseHeaders,
      });
    } catch (e) { console.log(`  failed to delete topic ${id}: ${e.message}`); }
  }
  console.log(`  Deleted ${created.contentIds.length} content row(s) and ${created.topicIds.length} topic(s).`);
}

async function main() {
  console.log(`Phase 4 smoke test`);
  console.log(`  base: ${ADMIN_BASE_URL}`);
  console.log(`  cleanup: ${KEEP_RECORDS ? 'NO (--keep)' : 'YES'}`);

  try {
    await test1_createStandaloneTopicViaTopicsRoute();
    await test2_createContentDraftWithFreeForm();
    await test3_landingPageEnumAccepted();
    await test4_invalidContentTypeRejected();
    await test5_legacyTopicIdPath();
  } finally {
    await cleanup();
  }

  console.log(`\nResult: ${process.exitCode ? '\x1b[31mFAILED\x1b[0m' : '\x1b[32mALL PASSED\x1b[0m'}`);
}

main().catch(e => { console.error('\nCrash:', e); process.exit(1); });
