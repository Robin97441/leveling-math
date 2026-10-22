const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dashboard = fs.readFileSync(path.join(__dirname, "../dashboard.html"), "utf8");
const sql = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20261022_xp_integrity.sql"),
  "utf8"
);
const edgeFunction = fs.readFileSync(
  path.join(__dirname, "../supabase/functions/delete-student/index.ts"),
  "utf8"
);

function sqlFunctionBody(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sql.match(new RegExp(
    `create or replace function public\\.${escaped}\\b[\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`,
    "i"
  ));
  assert.ok(match, `SQL function ${name} should exist`);
  return match[1];
}

function dashboardBlock(startMarker, endMarker) {
  const start = dashboard.indexOf(startMarker);
  const end = dashboard.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `dashboard block ${startMarker} should exist`);
  return dashboard.slice(start, end);
}

test("pseudo merge UI and exclusive JavaScript are removed", () => {
  assert.doesNotMatch(dashboard, /mergePseudos|populateMergeSelects|mergeSrc|mergeTgt|mergeLog/);
  assert.doesNotMatch(sql, /merge[_ ]pseudos?/i);
});

test("dashboard session deletion is one confirmed server RPC", () => {
  const block = dashboardBlock(
    'btnDeleteSession.addEventListener("click"',
    "historyDiv.appendChild(btnDeleteSession)"
  );
  assert.match(block, /confirm\(/);
  assert.match(block, /admin_delete_student_session/);
  assert.match(block, /btnDeleteSession\.disabled = true/);
  assert.match(block, /finally/);
  assert.doesNotMatch(block, /\.from\("(?:question_results|series_results|students)"\)/);
  assert.doesNotMatch(block, /admin_set_student_session|repair_xp_integrity/);
});

test("dashboard permanent student deletion uses the Edge Function with reinforced confirmation", () => {
  const block = dashboardBlock(
    'btnDeleteStudent.addEventListener("click"',
    "historyDiv.appendChild(btnDeleteStudent)"
  );
  assert.match(block, /confirm\(/);
  assert.match(block, /prompt\(/);
  assert.match(block, /invokePermanentStudentDeletion/);
  assert.match(block, /compte de connexion Supabase Auth/);
  assert.match(block, /btnDeleteStudent\.disabled = true/);
  assert.match(block, /finally/);
  assert.match(block, /await loadStudents\(\)/);
  assert.match(block, /aucune donnée n'a été supprimée/);
  assert.doesNotMatch(block, /admin_delete_student/);
  assert.doesNotMatch(block, /\.from\("(?:question_results|series_results|students)"\)/);
});

test("session deletion is authorized, serialized, scoped, and recalculated", () => {
  const body = sqlFunctionBody("admin_delete_student_session");
  assert.match(body, /if not public\.is_admin\(\)/);
  assert.match(body, /pg_advisory_xact_lock\(hashtextextended\(p_student_id::text, 1\)\)/);
  assert.match(body, /from public\.students[\s\S]*for update/);
  assert.match(body, /delete from public\.question_results/);
  assert.match(body, /delete from public\.series_results/);
  assert.match(body, /sr\.student_id = p_student_id[\s\S]*sr\.session = p_session/);
  assert.match(body, /rebuild_student_current_projection\(p_student_id\)/);
  assert.doesNotMatch(body, /set manual_xp_bonus\s*=/);
  assert.doesNotMatch(body, /update public\.(?:series_results|question_results)[\s\S]*set session/);
  assert.doesNotMatch(body, /exception\s+when/i);
});

test("projection rebuild keeps the manual bonus outside raw XP", () => {
  const body = sqlFunctionBody("rebuild_student_current_projection");
  assert.match(sql, /function public\.rebuild_student_current_projection[\s\S]*?security invoker/);
  assert.match(body, /calculate_student_xp_projection\(s\.id, coalesce\(s\.session, 1\)\)/);
  assert.match(body, /set xp_total =/);
  assert.doesNotMatch(body, /manual_xp_bonus\s*=/);
  assert.match(sql, /revoke all on function public\.rebuild_student_current_projection\(uuid\)[\s\S]*from public, anon, authenticated/);
});

test("student deletion preflight is admin-only and fails closed for protected identities", () => {
  const body = sqlFunctionBody("admin_prepare_student_deletion");
  assert.match(body, /if not public\.is_admin\(\)/);
  assert.match(body, /pg_advisory_xact_lock\(hashtextextended\(p_student_id::text, 1\)\)/);
  assert.match(body, /from public\.students[\s\S]*for update/);
  assert.match(body, /v_student\.auth_user_id = v_actor/);
  assert.match(body, /Auth account is shared/);
  assert.match(body, /from auth\.users/);
  assert.match(body, /admin_users/);
  assert.match(body, /Administrator accounts cannot be deleted/);
  assert.match(body, /lease_expires_at/);
  assert.doesNotMatch(body, /delete\s+from/i);
  assert.doesNotMatch(body, /delete\s+from\s+auth\.users/i);
  assert.doesNotMatch(body, /exception\s+when/i);
});

test("session deletion and Edge preflight are denied by default", () => {
  assert.match(sql, /revoke all on function public\.admin_delete_student_session\(uuid, integer\)[\s\S]*?from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.admin_delete_student_session\(uuid, integer\)[\s\S]*?to authenticated/);
  assert.match(sql, /revoke all on function public\.admin_prepare_student_deletion\(uuid, uuid, uuid\)[\s\S]*?from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.admin_prepare_student_deletion\(uuid, uuid, uuid\)[\s\S]*?to authenticated/);
  assert.match(sql, /drop function if exists public\.admin_delete_student\(uuid\)/);
  assert.doesNotMatch(sql, /create or replace function public\.admin_delete_student\(p_student_id uuid\)/);
});

test("migration refuses permanent deletion unless every required foreign key cascades", () => {
  assert.match(sql, /missing required ON DELETE CASCADE foreign keys/);
  assert.match(sql, /constraint_row\.confdeltype = 'c'/);
  for (const relationship of [
    /'public', 'students', 'auth_user_id', 'auth', 'users', 'id'/,
    /'public', 'series_results', 'student_id', 'public', 'students', 'id'/,
    /'public', 'question_results', 'series_id', 'public', 'series_results', 'id'/,
    /'public', 'targeted_skill_progress', 'student_id', 'public', 'students', 'id'/,
    /'public', 'targeted_question_results', 'series_id', 'public', 'targeted_series', 'id'/,
    /'public', 'parent_students', 'student_id', 'public', 'students', 'id'/
  ]) {
    assert.match(sql, relationship);
  }
});

test("migration rejects shared Auth identities and removes direct browser DELETE paths", () => {
  assert.match(sql, /auth identities shared by multiple students/);
  assert.match(sql, /unique index if not exists students_auth_user_id_uidx/);
  assert.match(sql, /protect_student_auth_identity/);
  for (const table of [
    "students",
    "series_results",
    "question_results",
    "targeted_skill_progress",
    "targeted_series",
    "targeted_question_results",
    "parent_students"
  ]) {
    assert.match(sql, new RegExp(`revoke delete on table public\\.${table} from public, anon, authenticated`));
  }
});

test("deletion receipts are private service-role state", () => {
  assert.match(sql, /create table if not exists public\.admin_student_deletion_requests/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.admin_student_deletion_requests from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update on table public\.admin_student_deletion_requests to service_role/);
});

test("service-role credentials and Auth deletion exist only in the Edge Function", () => {
  assert.match(edgeFunction, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edgeFunction, /auth\.getUser\(token\)/);
  assert.match(edgeFunction, /auth\.admin\.deleteUser\(authUserId, false\)/);
  assert.match(edgeFunction, /admin_prepare_student_deletion/);
  assert.doesNotMatch(dashboard, /SUPABASE_SERVICE_ROLE_KEY|auth\.admin\.deleteUser/);
});
