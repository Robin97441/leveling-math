# XP integrity architecture

## Invariants

- `question_results.xp_delta` is the immutable accounting event. Historical answers are not reinterpreted with newer balancing rules.
- `series_results.xp_gained`, `students.xp_total`, scores, times, streaks, and game counts are server-maintained projections.
- `students.manual_xp_bonus` remains separate and is added only for display, ranks, and level eligibility.
- The official floor is applied after each series in `(created_at, id)` order: `total = max(0, total + series_delta)`.
- Only `submit_answer`, `repair_xp_integrity`, and the session-management RPCs can write projection fields.

## Answer flow

Before its first network attempt, every general-mode answer is assigned a stable UUID and stored in IndexedDB. `submit_answer` serializes writes per student, enforces a unique `(student_id, client_answer_id)` constraint, and returns the authoritative student and series projections. A retry returns the existing result and never creates XP twice.

The UI may show answer feedback immediately, but it changes displayed XP only from the confirmed RPC snapshot. Pending entries survive reloads and are deleted from IndexedDB only after server confirmation.

## Audit and repair

`audit_xp_integrity` is read-only. It compares `students.xp_total` with the projection calculated from persisted deltas and reports empty, incomplete, oversized, orphaned, mismatched, null-delta, and duplicate data.

`repair_xp_integrity` is a separate admin-only transaction. It shares the per-student advisory lock used by `submit_answer` and aborts before writing if any blocking anomaly exists. The dashboard never reconstructs or writes XP itself.

## Administrative deletion

`admin_delete_student_session` remains the only path for deleting one general-mode session. It is a `SECURITY DEFINER` RPC that verifies `is_admin()`, acquires the same per-student transaction lock as answer submission, locks the student row, and lets PostgreSQL roll back the complete operation if any statement fails.

Deleting a session removes only that session's general-mode series and answers. Other session numbers and rows are not rewritten. If the current session is deleted, the latest remaining session becomes current; the server then rebuilds its series and student projections from persisted `xp_delta` events. `manual_xp_bonus` is never included in or overwritten by this rebuild.

Permanent student deletion uses the `delete-student` Edge Function. The dashboard sends only `student_id` and a stable idempotency `request_id`; it never receives or stores the service-role key. The function validates the caller's JWT, then calls `admin_prepare_student_deletion` with the caller's RLS context. That preflight verifies `is_admin()`, rejects a missing or shared Auth identity, the caller's own account, and every account protected by Auth app metadata or `admin_users`.

After preflight, the Edge Function performs exactly one destructive operation: `auth.admin.deleteUser(auth_user_id)`. The `auth.users` row is the deletion root. PostgreSQL then cascades to `students`, `series_results`, `question_results`, `targeted_skill_progress`, `targeted_series`, `targeted_question_results`, and `parent_students` in the Auth deletion transaction. The Edge Function reads back Auth and all known application tables before reporting success. The application-only `admin_delete_student` RPC is dropped, and direct `DELETE` privileges on these tables are revoked from `PUBLIC`, `anon`, and `authenticated`.

The migration refuses to install this path unless all required foreign keys exist with `ON DELETE CASCADE`. It also refuses existing duplicate non-null `students.auth_user_id` values, creates a partial unique index for that identity, and makes an established student-to-Auth link immutable. These checks must pass on the isolated database before deployment; the migration does not silently rewrite incompatible production constraints or identities.

### Idempotency and failure recovery

`admin_student_deletion_requests` stores a private, service-role-only receipt before the Auth API call. A per-student advisory lock and a 15-second lease prevent concurrent requests from deliberately launching two deletions. Completed requests are replayable without calling Auth again. If the HTTP response or Auth API response is lost, a retry with the same request ID succeeds only after proving that the Auth user, student profile, and every known dependent row are absent.

The receipt write and `auth.admin.deleteUser()` are not one cross-service transaction. The receipt is therefore coordination and audit state, not an atomicity claim. The only destructive call is Auth deletion itself; a PostgreSQL constraint failure must make that call fail and roll back its cascades. If verification cannot prove the final state, the dashboard reports no success and retains the request ID for a safe retry.

Known platform limits:

- Supabase may refuse Auth deletion while the user owns Storage objects. No application data should be reported as deleted in that case; Storage ownership must be resolved separately on the isolated environment.
- A JWT issued before deletion remains cryptographically valid until expiry. Application authorization must continue to require the now-deleted `students.auth_user_id` mapping, so the stale token cannot reach student-owned data.
- The Edge Function and migration must be deployed together. Deploying the function before its preflight RPC and receipt table, or deploying the dashboard before the function, fails closed with an error rather than using a browser-side deletion fallback.

### Isolated validation checklist

Before production, apply the migration to a disposable Supabase project and deploy the Edge Function there. Create an admin plus at least two fictitious students with general results, targeted results, and a parent association, then verify:

1. A non-admin receives `403` and no row changes.
2. Self-deletion and deletion of a second admin are refused.
3. A duplicate Auth mapping makes the migration/preflight fail before deletion.
4. Deleting one fictitious student removes its Auth row and every dependent application row while preserving the second student.
5. A forced foreign-key or Storage failure returns an error and does not report success.
6. Replaying the same `request_id`, including after an interrupted HTTP response, returns the completed receipt without a second destructive call.
7. `admin_delete_student_session`, XP audit/repair, answer idempotency, and manual bonuses still behave as documented.

## Deployment

Apply `supabase/migrations/20261022_xp_integrity.sql`, deploy `supabase/functions/delete-student`, and only then deploy the matching dashboard/client. The migration intentionally disables the legacy 12-argument `submit_answer`; deploying only one side will make general-mode submissions fail safely instead of silently using a non-idempotent path.
