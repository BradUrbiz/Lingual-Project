#!/usr/bin/env bash
# E2E Test: Teacher Dashboard
# BDD Scenarios covered:
#   - Teacher views the dashboard with populated classes
#   - Teacher sees onboarding hints on an empty dashboard (setup checklist)
#
# Prerequisites: backend on :5001, frontend on :5173
set -euo pipefail

PASS=0
FAIL=0
BASE_URL="http://localhost:5001"
FRONTEND_URL="http://localhost:5173"

log_pass() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
log_fail() { echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

echo "=== E2E: Teacher Dashboard ==="

# 1. Seed test data
echo "Seeding test data..."
SEED=$(curl -s -X POST "$BASE_URL/api/test/seed" -H 'Content-Type: application/json' -d '{}')
SUCCESS=$(echo "$SEED" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',False))")

if [ "$SUCCESS" = "True" ]; then
  log_pass "Seed completed"
else
  log_fail "Seed failed"
  echo "$SEED"
  exit 1
fi

# 2. Open browser and login
echo "Opening browser and logging in..."
playwright-cli open "$BASE_URL" 2>/dev/null

playwright-cli run-code "async page => {
  // Navigate to frontend first so cookies are set on :5173 domain
  await page.goto('$FRONTEND_URL');
  // Login via the Vite proxy (membership auto-pinned for known test users)
  await page.request.post('$FRONTEND_URL/api/test/login', {
    data: { uid: 'e2e-teacher-1' },
    headers: { 'Content-Type': 'application/json' }
  });
  await page.evaluate(() => localStorage.setItem('__e2e_uid__', 'e2e-teacher-1'));
  // Navigate to teacher dashboard
  await page.goto('$FRONTEND_URL/app/teacher');
  await page.waitForTimeout(3000);
  return page.url();
}" 2>/dev/null

# 3. Take snapshot and verify
echo "Verifying dashboard content..."
playwright-cli snapshot --filename=e2e/snapshots/teacher-dashboard.yaml 2>/dev/null
SNAPSHOT_FILE="e2e/snapshots/teacher-dashboard.yaml"

# Check for key elements in snapshot
if grep -q "E2E Test School" "$SNAPSHOT_FILE" 2>/dev/null; then
  log_pass "Dashboard shows org name 'E2E Test School'"
else
  log_fail "Dashboard missing org name 'E2E Test School'"
fi

if grep -q "E2E Teacher" "$SNAPSHOT_FILE" 2>/dev/null; then
  log_pass "Dashboard shows teacher name 'E2E Teacher'"
else
  log_fail "Dashboard missing teacher name"
fi

if grep -q "Classes" "$SNAPSHOT_FILE" 2>/dev/null; then
  log_pass "Dashboard shows Classes stat card"
else
  log_fail "Dashboard missing Classes stat card"
fi

if grep -q "Students" "$SNAPSHOT_FILE" 2>/dev/null; then
  log_pass "Dashboard shows Students stat card"
else
  log_fail "Dashboard missing Students stat card"
fi

if grep -q "Assignments" "$SNAPSHOT_FILE" 2>/dev/null; then
  log_pass "Dashboard shows Assignments stat card"
else
  log_fail "Dashboard missing Assignments stat card"
fi

if grep -q "E2E French 101" "$SNAPSHOT_FILE" 2>/dev/null; then
  log_pass "Dashboard shows class 'E2E French 101'"
else
  log_fail "Dashboard missing class 'E2E French 101'"
fi

if grep -q "Setup checklist" "$SNAPSHOT_FILE" 2>/dev/null; then
  log_pass "Dashboard shows setup checklist"
else
  log_fail "Dashboard missing setup checklist"
fi

if grep -q "Create class" "$SNAPSHOT_FILE" 2>/dev/null; then
  log_pass "Dashboard shows 'Create class' button"
else
  log_fail "Dashboard missing 'Create class' button"
fi

# 4. Close browser
playwright-cli close 2>/dev/null

# Summary
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
