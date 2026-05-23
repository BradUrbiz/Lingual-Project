# Plan 6 Rollout Runbook

Status: ready
Owner: Engineering

Plan 6 ships in three deployable units. Do NOT bundle them.

## Phase 1 — Backend endpoint only

1. Land Plan 6 Tasks 1–2 (mark_user_legacy_role_picked helper + /api/auth/migrate-role).
2. Deploy backend.
3. Verify: `curl -i -X POST https://l1ngual.com/api/auth/migrate-role -d '{"role":"student"}' -H 'Cookie: ...'` returns 200 for a known legacy user.
4. **Frontend has no caller yet** → no user-visible behavior change.

## Phase 2 — Backfill (dry-run, then real)

1. Run staging dry-run:
   ```
   python3 scripts/backfill_legacy_user_roles.py --dry-run
   ```
   Inspect stats. Sanity checks:
   - `scanned` matches expected user count.
   - `would_set_admin + would_set_teacher + would_set_student + skipped_already_migrated + skipped_no_signal == scanned`.
   - No exceptions in stderr.

2. Run staging real:
   ```
   python3 scripts/backfill_legacy_user_roles.py
   ```
   Verify `written` matches the dry-run's `would_set_*` sum.

3. Sample 5 users from each transition class and verify their `profile.intended_role` + `onboarding_state` in Firestore console.

4. Run production dry-run.

5. Run production real. Monitor Cloud Logging for `[backfill]` lines.

## Phase 3 — Frontend modal

**Prerequisite (hard stop):** Phase 1 endpoint MUST already be deployed and verified (step 3 above). Skipping Phase 1 will cause the modal to call a non-existent `/api/auth/migrate-role` → 404 → user stuck on a frozen modal with no recovery path (the modal is intentionally non-dismissible). Do not proceed to step 1 below unless `curl -i -X POST $BASE_URL/api/auth/migrate-role -H 'Cookie: …' -d '{"role":"student"}'` returns 200 for a known legacy user.

1. Land Plan 6 Tasks 3–6 (api client + modal + AuthContext mount + dispatcher gate).
2. Deploy frontend.
3. Verify in production:
   - Sign in as a known legacy user (one not resolved by the backfill — e.g., a B2C user with no enrollments). Modal appears.
   - Pick "Student" → modal closes, lands on `/app/learn`. Verify `users/{uid}/profile` now has `intended_role='student'`, `onboarding_state='complete'`.
   - Sign out + sign in again. Modal does NOT reappear.
4. Spot-check 3 non-legacy users (recent signups). They should NEVER see the modal.

## Monitoring (1 week)

- Cloud Logging filter: `textPayload =~ "legacy_role_pick"` (modal picks) and `textPayload =~ "\\[backfill\\]"` (script transitions).
- Look for:
  - **Picks per day** declining toward zero (modal converges).
  - **Distribution of picks** — if >5% pick teacher/admin from the modal, surface to product as a signal that the spec text should be tuned.
  - **Stuck legacy population** — users who saw the modal but did not pick (`requires_legacy_role_pick=true` and `last_sign_in` >24h after modal first appeared). Track this via an ad-hoc query if needed.

## Rollback

- If the modal breaks the app: revert Phase 3 commit only. Phases 1 + 2 are independent and remain.
- If the endpoint breaks: revert Phase 1. Phases 2 + 3 are not yet deployed at this point in the rollout.
- If the backfill misclassifies users: re-run with `--dry-run` first to inspect; correct individual users via Firestore console (the script is idempotent on subsequent runs).
