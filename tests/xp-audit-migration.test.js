const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20261023_fix_xp_audit_ambiguity.sql"),
  "utf8"
);

function functionBody(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sql.match(new RegExp(
    `create or replace function public\\.${escaped}\\b[\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`,
    "i"
  ));
  assert.ok(match, `SQL function ${name} should exist`);
  return match[1];
}

test("audit migration qualifies duplicate client answer columns", () => {
  const body = functionBody("audit_xp_integrity");
  assert.match(body, /source_qr\.student_id/);
  assert.match(body, /source_qr\.client_answer_id/);
  assert.match(body, /group by source_qr\.student_id, source_qr\.client_answer_id/);
  assert.match(body, /group by qr\.student_id/);
  assert.doesNotMatch(body, /select\s+student_id,\s+client_answer_id/i);
  assert.doesNotMatch(body, /group by\s+student_id,\s+client_answer_id/i);
});

test("audit migration remains read-only", () => {
  const body = functionBody("audit_xp_integrity");
  assert.match(sql, /language plpgsql\s+stable\s+security definer/i);
  assert.doesNotMatch(body, /\b(?:insert\s+into|update|delete\s+from|truncate|alter|drop|create)\b/i);
  assert.doesNotMatch(body, /repair_xp_integrity|rebuild_student_current_projection/i);
});

test("audit fix does not redefine XP calculation or answer submission", () => {
  assert.doesNotMatch(sql, /create or replace function public\.calculate_student_xp_projection/i);
  assert.doesNotMatch(sql, /create or replace function public\.submit_answer/i);
  assert.match(sql, /public\.calculate_student_xp_projection\(/);
});

test("audit RPC keeps authenticated-only execution", () => {
  assert.match(sql, /set search_path = pg_catalog, public/i);
  assert.match(sql, /revoke all on function public\.audit_xp_integrity\(uuid\)\s+from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.audit_xp_integrity\(uuid\) to authenticated/i);
});
