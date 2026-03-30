#!/usr/bin/env bash
set -euo pipefail
PASS=0; FAIL=0; BASE_URL="http://localhost:5001"
log_pass() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
log_fail() { echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

echo "=== E2E: LTI Flow ==="

# Seed + login as school admin
curl -s -X POST "$BASE_URL/api/test/seed" -H 'Content-Type: application/json' -d '{}' > /dev/null
curl -s -X POST "$BASE_URL/api/test/login" -H 'Content-Type: application/json' -d '{"uid":"e2e-admin-1"}' -c /tmp/e2e-lti-cookies.txt > /dev/null

# 1. JWKS endpoint returns valid key set
JWKS=$(curl -s "$BASE_URL/lti/jwks")
HAS_KEYS=$(echo "$JWKS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('keys',[])))")
if [ "$HAS_KEYS" -gt 0 ]; then log_pass "JWKS returns keys"; else log_fail "JWKS empty"; fi

# 2. Register LTI platform
REG_RESP=$(curl -s -X POST "$BASE_URL/api/schools/lti-platform" \
  -H 'Content-Type: application/json' \
  -d '{"issuer":"https://test.instructure.com","clientId":"10000000001","deploymentId":"1","authLoginUrl":"https://test.instructure.com/api/lti/authorize_redirect","authTokenUrl":"https://test.instructure.com/login/oauth2/token","keySetUrl":"https://test.instructure.com/api/lti/security/jwks"}' \
  -b /tmp/e2e-lti-cookies.txt)
REG_SUCCESS=$(echo "$REG_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',False))")
if [ "$REG_SUCCESS" = "True" ]; then log_pass "LTI platform registered"; else log_fail "Registration failed: $REG_RESP"; fi

# 3. Get platform config
GET_RESP=$(curl -s "$BASE_URL/api/schools/lti-platform" -b /tmp/e2e-lti-cookies.txt)
ISSUER=$(echo "$GET_RESP" | python3 -c "import sys,json; p=json.load(sys.stdin).get('platform'); print(p.get('issuer','') if p else '')")
if [ "$ISSUER" = "https://test.instructure.com" ]; then log_pass "Platform config retrieved"; else log_fail "Wrong issuer: $ISSUER"; fi

# 4. Grade config (set + get)
# Login as teacher first
curl -s -X POST "$BASE_URL/api/test/login" -H 'Content-Type: application/json' -d '{"uid":"e2e-teacher-1"}' -c /tmp/e2e-lti-cookies.txt > /dev/null
# Get a seed assignment ID
SEED=$(curl -s -X POST "$BASE_URL/api/test/seed" -H 'Content-Type: application/json' -d '{}')
ASSIGN_ID=$(echo "$SEED" | python3 -c "import sys,json; print(json.load(sys.stdin)['seed']['assignmentId'])")

GRADE_SET=$(curl -s -X POST "$BASE_URL/api/teacher/assignments/$ASSIGN_ID/grade-config" \
  -H 'Content-Type: application/json' \
  -d '{"metric":"completion","points":10}' \
  -b /tmp/e2e-lti-cookies.txt)
GRADE_OK=$(echo "$GRADE_SET" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',False))")
if [ "$GRADE_OK" = "True" ]; then log_pass "Grade config set"; else log_fail "Grade config set failed: $GRADE_SET"; fi

GRADE_GET=$(curl -s "$BASE_URL/api/teacher/assignments/$ASSIGN_ID/grade-config" -b /tmp/e2e-lti-cookies.txt)
METRIC=$(echo "$GRADE_GET" | python3 -c "import sys,json; print(json.load(sys.stdin).get('metric',''))")
if [ "$METRIC" = "completion" ]; then log_pass "Grade config retrieved"; else log_fail "Wrong metric: $METRIC"; fi

# 5. Delete platform
curl -s -X POST "$BASE_URL/api/test/login" -H 'Content-Type: application/json' -d '{"uid":"e2e-admin-1"}' -c /tmp/e2e-lti-cookies.txt > /dev/null
DEL_RESP=$(curl -s -X DELETE "$BASE_URL/api/schools/lti-platform" -b /tmp/e2e-lti-cookies.txt)
DEL_OK=$(echo "$DEL_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',False))")
if [ "$DEL_OK" = "True" ]; then log_pass "Platform deleted"; else log_fail "Delete failed"; fi

# Verify deleted
GET2=$(curl -s "$BASE_URL/api/schools/lti-platform" -b /tmp/e2e-lti-cookies.txt)
IS_NULL=$(echo "$GET2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('platform') is None)")
if [ "$IS_NULL" = "True" ]; then log_pass "Platform confirmed deleted"; else log_fail "Platform still exists"; fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -gt 0 ] && exit 1
