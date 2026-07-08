#!/usr/bin/env bash
# END-TO-END SMOKE — run against a booted local API (default :3000).
# Usage: API=http://localhost:3000 KEY=dev-key-123 PAYER=<payer-uuid> bash scripts/smoke.sh
set -e
API=${API:-http://localhost:3000}
KEY=${KEY:-dev-key-123}
PAYER=${PAYER:?set PAYER=<payer uuid>}

echo "1) ready";        curl -sf $API/ready > /dev/null && echo "   OK"
echo "2) payers";       curl -sf -H "x-api-key: $KEY" $API/v1/payers > /dev/null && echo "   OK"
echo "3) POST eligibility (with dateOfService)"
TX=$(curl -sf -X POST $API/v1/eligibility-checks \
  -H "x-api-key: $KEY" -H "content-type: application/json" -H "idempotency-key: smoke-$RANDOM" \
  -d "{\"payer\":{\"id\":\"$PAYER\"},\"provider\":{\"npi\":\"1999999984\",\"organizationName\":\"Smoke Test\"},\"subscriber\":{\"memberId\":\"23456789100\",\"firstName\":\"James\",\"lastName\":\"Jones\",\"dateOfBirth\":\"1991-02-02\"},\"serviceTypeCodes\":[\"30\"],\"dateOfService\":\"2026-07-09\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['transactionId'])")
echo "   OK tx=$TX"
echo "4) worklist + schedule filter"
curl -sf -H "x-api-key: $KEY" "$API/v1/eligibility-checks?from=2026-07-08&to=2026-07-10" > /dev/null && echo "   OK"
echo "5) reverify"
curl -sf -X POST -H "x-api-key: $KEY" -H "content-type: application/json" -d '{}' \
  "$API/v1/eligibility-checks/$TX/reverify" > /dev/null && echo "   OK"
echo "6) bad key rejected"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H 'x-api-key: nope' $API/v1/eligibility-checks)" = "401" ] && echo "   OK"
echo "SMOKE PASSED"
