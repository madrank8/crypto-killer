# Replit Handoff: Install Analytics Tracker on cryptokiller.org

One-line change. The admin dashboard on Vercel now has a self-hosted analytics system (Supabase-backed, privacy-friendly, no cookies). Production traffic data only starts flowing once this snippet is live on the Replit site.

## What to do

Add this to the global layout/document `<head>` (or end of `<body>`) so it renders on **every page, all locales**:

```html
<script defer src="https://crypto-killer.vercel.app/ck.js"></script>
```

That's it. No env vars, no packages, no config on the Replit side.

## What it does

- Sends pageviews (including client-side route changes) and outbound link clicks to `https://crypto-killer.vercel.app/api/track`, which writes to Supabase.
- CORS is locked to `cryptokiller.org` / `www.cryptokiller.org`.
- No cookies, no localStorage. A per-tab session id lives in sessionStorage only. Visitor identity is a daily-rotating hash computed server-side — no IP or user agent is ever stored. GDPR-safe without a consent banner (same model as Plausible/Umami).
- Bots, headless browsers, and localhost are filtered out.
- `defer` + sendBeacon: zero render-blocking, zero impact on Core Web Vitals.

## Verify after deploy

1. Open cryptokiller.org in a normal browser tab.
2. DevTools → Network → filter `track` → should see a `POST /api/track` returning `204` on page load and when clicking an outbound link.
3. Within a minute, the event appears in the admin dashboard at crypto-killer.vercel.app/admin/analytics (Traffic tab).

## Do NOT

- Do not proxy or rewrite the script URL — the collector reads the client IP and country from Vercel request headers, so the browser must call Vercel directly.
- Do not add it twice (e.g., both layout and page templates) — dedupe is per-path per-load, but double-inject would double click events.
