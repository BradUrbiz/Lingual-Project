#!/usr/bin/env bash
# E2E Test: School Onboarding Chain
# Tests the full flow: request → approve → invite code → teacher joins → admin approves teacher
#
# Prerequisites: backend on :5001
set -euo pipefail

PASS=0
FAIL=0
BASE_URL="http://localhost:5001"

log_pass() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
log_fail() { echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

echo "=== E2E: School Onboarding Chain ==="

# Create test users via test harness
echo "Setting up test users..."

# Admin user (will submit the school request)
curl -s -X POST "$BASE_URL/api/test/login" \
  -H 'Content-Type: application/json' \
  -d '{"uid":"e2e-school-admin-1","name":"School Admin","email":"admin@testschool.edu","age":40}' \
  -c /tmp/e2e-admin-cookies.txt > /dev/null

# Lingual admin — seed sets lingual_admin=true on e2e-admin-1
curl -s -X POST "$BASE_URL/api/test/seed" -H 'Content-Type: application/json' -d '{}' > /dev/null
curl -s -X POST "$BASE_URL/api/test/login" \
  -H 'Content-Type: application/json' \
  -d '{"uid":"e2e-admin-1"}' \
  -c /tmp/e2e-lingual-admin-cookies.txt > /dev/null

# Teacher user (fresh UID each run to avoid "already a member")
TEACHER_UID="e2e-teacher-join-$(date +%s)"
curl -s -X POST "$BASE_URL/api/test/login" \
  -H 'Content-Type: application/json' \
  -d "{\"uid\":\"$TEACHER_UID\",\"name\":\"Join Teacher\",\"email\":\"jointeacher@testschool.edu\",\"age\":30}" \
  -c /tmp/e2e-teacher-cookies.txt > /dev/null

log_pass "Test users created"

# =========================================================================
# Step 1: School admin submits a request
# =========================================================================
echo ""
echo "Step 1: Submit school request..."

# Try to submit — may get 409 if request exists from a prior run
curl -s -X POST "$BASE_URL/api/school-requests" \
  -H 'Content-Type: application/json' \
  -d '{"schoolName":"E2E Test Academy","orgType":"school","websiteUrl":"https://testacademy.edu","canvasInstanceUrl":"https://testacademy.instructure.com"}' \
  -b /tmp/e2e-admin-cookies.txt > /dev/null 2>&1

# Get the request ID from /mine (works regardless of whether submit was fresh or duplicate)
MINE_RESP=$(curl -s "$BASE_URL/api/school-requests/mine" -b /tmp/e2e-admin-cookies.txt)
REQUEST_ID=$(echo "$MINE_RESP" | python3 -c "import sys,json; r=json.load(sys.stdin).get('request'); print(r.get('id','') if r else '')")
STATUS=$(echo "$MINE_RESP" | python3 -c "import sys,json; r=json.load(sys.stdin).get('request'); print(r.get('status','') if r else '')")

if [ -n "$REQUEST_ID" ]; then
  log_pass "School request exists (ID: ${REQUEST_ID:0:12}..., status: $STATUS)"
else
  log_fail "No school request found"
fi

if [ "$STATUS" = "pending" ]; then
  log_pass "Request status is pending"
elif [ "$STATUS" = "approved" ]; then
  echo "  (Request already approved from prior run — skipping to step 3)"
else
  log_fail "Unexpected request status: $STATUS"
fi

# =========================================================================
# Step 2: Lingual admin approves the request
# =========================================================================
echo ""
echo "Step 2: Lingual admin approves..."

if [ "$STATUS" = "pending" ]; then
  APPROVE_RESP=$(curl -s -X POST "$BASE_URL/api/admin/school-requests/$REQUEST_ID/approve" \
    -b /tmp/e2e-lingual-admin-cookies.txt)
  APPROVE_SUCCESS=$(echo "$APPROVE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',False))")
  ORG_ID=$(echo "$APPROVE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('orgId',''))")

  if [ "$APPROVE_SUCCESS" = "True" ] && [ -n "$ORG_ID" ]; then
    log_pass "Request approved, org created (ID: ${ORG_ID:0:12}...)"
  else
    log_fail "Approval failed: $APPROVE_RESP"
  fi
else
  # Already approved from prior run — get orgId from the request
  ORG_ID=$(echo "$MINE_RESP" | python3 -c "import sys,json; r=json.load(sys.stdin).get('request'); print(r.get('createdOrgId','') if r else '')")
  log_pass "Request already approved (org: ${ORG_ID:0:12}...)"
fi

# Verify request status updated
STATUS_RESP2=$(curl -s "$BASE_URL/api/school-requests/mine" -b /tmp/e2e-admin-cookies.txt)
STATUS2=$(echo "$STATUS_RESP2" | python3 -c "import sys,json; r=json.load(sys.stdin).get('request',{}); print(r.get('status',''))")

if [ "$STATUS2" = "approved" ]; then
  log_pass "Request status updated to approved"
else
  log_fail "Expected approved, got: $STATUS2"
fi

# =========================================================================
# Step 3: School admin generates teacher invite code
# =========================================================================
echo ""
echo "Step 3: Generate teacher invite code..."

# Re-login admin to pick up the new membership
curl -s -X POST "$BASE_URL/api/test/login" \
  -H 'Content-Type: application/json' \
  -d '{"uid":"e2e-school-admin-1"}' \
  -c /tmp/e2e-admin-cookies.txt > /dev/null

INVITE_RESP=$(curl -s -X POST "$BASE_URL/api/schools/teacher-invite-code" \
  -b /tmp/e2e-admin-cookies.txt)

INVITE_SUCCESS=$(echo "$INVITE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',False))")
INVITE_CODE=$(echo "$INVITE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('inviteCode',''))")

if [ "$INVITE_SUCCESS" = "True" ] && [ -n "$INVITE_CODE" ]; then
  log_pass "Teacher invite code generated: $INVITE_CODE"
else
  log_fail "Invite code generation failed: $INVITE_RESP"
fi

# =========================================================================
# Step 4: Teacher enters invite code
# =========================================================================
echo ""
echo "Step 4: Teacher joins with invite code..."

JOIN_RESP=$(curl -s -X POST "$BASE_URL/api/schools/join-as-teacher" \
  -H 'Content-Type: application/json' \
  -d "{\"inviteCode\":\"$INVITE_CODE\"}" \
  -b /tmp/e2e-teacher-cookies.txt)

JOIN_SUCCESS=$(echo "$JOIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',False))")
INVITATION_ID=$(echo "$JOIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('invitationId',''))")
JOIN_STATUS=$(echo "$JOIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))")
TEACHER_MEM_ID=$(echo "$JOIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('membershipId',''))")

# Pilot: teacher join auto-approves — expect status=approved and a membershipId in the same response.
if [ "$JOIN_SUCCESS" = "True" ] && [ "$JOIN_STATUS" = "approved" ] && [ -n "$TEACHER_MEM_ID" ]; then
  log_pass "Teacher joined + auto-approved (invitation: ${INVITATION_ID:0:12}..., membership: ${TEACHER_MEM_ID:0:12}...)"
else
  log_fail "Teacher join failed: $JOIN_RESP"
fi

# =========================================================================
# Step 5: Admin re-approve on already-approved invitation returns 409
# =========================================================================
echo ""
echo "Step 5: Verify admin approve guard on already-approved invitation..."

TEACHER_APPROVE_RESP=$(curl -s -X POST "$BASE_URL/api/schools/teacher-invitations/$INVITATION_ID/approve" \
  -b /tmp/e2e-admin-cookies.txt)

TEACHER_APPROVE_SUCCESS=$(echo "$TEACHER_APPROVE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',False))")
TEACHER_APPROVE_ERROR=$(echo "$TEACHER_APPROVE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',''))")

if [ "$TEACHER_APPROVE_SUCCESS" = "False" ] && echo "$TEACHER_APPROVE_ERROR" | grep -qi "already approved"; then
  log_pass "Double-approve correctly rejected: $TEACHER_APPROVE_ERROR"
else
  log_fail "Expected 'already approved' rejection, got: $TEACHER_APPROVE_RESP"
fi

# =========================================================================
# Step 6: Verify teacher now has teacher role
# =========================================================================
echo ""
echo "Step 6: Verify teacher membership..."

# Re-login teacher to pick up the membership
curl -s -X POST "$BASE_URL/api/test/login" \
  -H 'Content-Type: application/json' \
  -d "{\"uid\":\"$TEACHER_UID\"}" \
  -c /tmp/e2e-teacher-cookies.txt > /dev/null

VERIFY_RESP=$(curl -s "$BASE_URL/api/test/verify" -b /tmp/e2e-teacher-cookies.txt)
TEACHER_ROLES=$(echo "$VERIFY_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('user',{}).get('activeRoles',[]))")

if echo "$TEACHER_ROLES" | grep -q "teacher"; then
  log_pass "Teacher has teacher role: $TEACHER_ROLES"
else
  log_fail "Expected teacher role, got: $TEACHER_ROLES"
fi

# Summary
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
