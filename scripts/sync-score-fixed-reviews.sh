#!/usr/bin/env bash
# One-off: push the score-corrected reviews to Replit via the existing per-review
# sync route. Only the 19 reviews that pass the publish gate cleanly are listed —
# the other 11 (3 audit_hard_fail + 8 missing audit_score) need the regeneration
# pass first, so they are deliberately NOT force-synced here.
#
# Usage:
#   ADMIN_URL="https://crypto-killer.vercel.app" ADMIN_TOKEN="<your admin token>" \
#     bash scripts/sync-score-fixed-reviews.sh
#
# The admin token is the same bearer the dashboard uses. Nothing here needs a
# secret you don't already have; the Replit URL + SYNC_SECRET live on the server.

set -uo pipefail

: "${ADMIN_URL:?set ADMIN_URL, e.g. https://crypto-killer.vercel.app}"
: "${ADMIN_TOKEN:?set ADMIN_TOKEN to your admin bearer token}"

IDS=(
  31d4a3cc-c1e8-4805-93c7-84ae9356187e
  a6818bc1-49dc-4f7b-b936-90c0d61dbe48
  9a7bc465-2369-425a-9d02-de9700671462
  398be545-7614-4228-9899-96890de84d26
  12ccda90-2b5f-4dc7-89e1-fc34ff7eba65
  48d976a5-06d4-4f19-9aff-4e0cca1d4774
  9c73c0c7-a6fe-40a1-b358-6fbafa65c781
  f52ce1c3-3a64-43f9-92be-4a36d10faa30
  22a329a3-820b-4d61-9692-9ea1e82f25b6
  7be46a59-c814-4a2b-9736-94de4b52f318
  eb915348-e9f2-41cc-a4e9-ccd7313c83e1
  fbbd3800-d858-4c0f-aa08-29c935044a1b
  e490d731-34df-4e27-8bd0-a7c4ed98d381
  921b6bbc-bf27-4e5b-8817-955f60ba15e2
  715e395c-69ad-44ea-8189-255fe3051124
  350c8cca-d277-43d5-b220-4aafa294a1cb
  1bdcbe78-5cac-4c7f-b4fa-2b02191efb7a
  3d9e8658-a7a4-4680-ac2b-e4363205279c
  91606a9c-f75d-4a33-a336-cfbab07106b8
)

ok=0; fail=0
for id in "${IDS[@]}"; do
  # No `force` — if a review no longer passes the gate we WANT it skipped, not shipped.
  code=$(curl -sS -o /tmp/sync-out.json -w '%{http_code}' \
    -X POST "${ADMIN_URL%/}/api/admin/reviews/${id}/sync" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -H 'Content-Type: application/json' -d '{}')
  if [ "$code" = "200" ]; then
    ok=$((ok+1)); echo "OK    $id"
  else
    fail=$((fail+1)); echo "FAIL  $id  (HTTP $code)  $(head -c 300 /tmp/sync-out.json)"
  fi
done

echo "----"
echo "synced: $ok   failed: $fail   of ${#IDS[@]}"
