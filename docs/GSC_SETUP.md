# Google Search Console Integration — Setup (one-time, ~10 min)

The admin Analytics page shows GSC clicks/impressions/queries once these three env vars exist in Vercel. Until then, the Search tab shows a "not configured" notice and the cron no-ops (no errors).

## Steps (Niro)

1. **Create a service account**
   - console.cloud.google.com → create/select a project → "APIs & Services" → enable **Google Search Console API**.
   - "IAM & Admin" → "Service Accounts" → Create. Name it e.g. `gsc-reader`. No roles needed.
   - Open the account → "Keys" → "Add key" → JSON. Download the file.

2. **Grant it access to the GSC property**
   - search.google.com/search-console → cryptokiller.org property → Settings → Users and permissions → Add user.
   - Add the service account email (`gsc-reader@<project>.iam.gserviceaccount.com`) with **Full** or **Restricted** permission (Restricted is enough for reads).

3. **Set Vercel env vars** (Project → Settings → Environment Variables, Production + Preview):

   | Var | Value |
   |---|---|
   | `GSC_CLIENT_EMAIL` | `client_email` from the JSON |
   | `GSC_PRIVATE_KEY` | `private_key` from the JSON (paste as-is, `\n` escapes are handled) |
   | `GSC_SITE_URL` | `sc-domain:cryptokiller.org` (or the exact URL-prefix property, e.g. `https://cryptokiller.org/`) |

4. **Backfill + verify**
   - Redeploy (env vars need a fresh deployment).
   - Trigger a manual sync: `curl -H "Authorization: Bearer $ADMIN_SECRET" https://crypto-killer.vercel.app/api/cron/gsc-sync`
   - Response should show `pages`/`queries` counts. Data appears in /admin/analytics → Search.
   - The cron then keeps it fresh daily at 06:30 UTC (re-syncs trailing 5 days, since GSC back-fills late data).

## Notes

- Read-only scope (`webmasters.readonly`) — the service account can't change anything in GSC.
- For a longer backfill after first setup, temporarily bump `LOOKBACK_DAYS` in `app/api/cron/gsc-sync/route.js` (GSC keeps 16 months) and run the manual curl once.
