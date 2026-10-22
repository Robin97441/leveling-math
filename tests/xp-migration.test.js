const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20261022_xp_integrity.sql"),
  "utf8"
);

test("migration makes answer retries idempotent", () => {
  assert.match(sql, /client_answer_id uuid/);
  assert.match(sql, /unique index[\s\S]*student_id, client_answer_id/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_client_answer_id::text, 0\)\)/);
  assert.match(sql, /'idempotent_replay', true/);
  assert.match(sql, /Idempotency key reused with a different answer/);
});

test("migration keeps the established XP rules and per-series floor", () => {
  assert.match(sql, /when 'beginner' then 2 when 'intermediate' then 5 when 'expert' then 10/);
  assert.match(sql, /when 'beginner' then 0 when 'intermediate' then 5 when 'expert' then 15/);
  assert.match(sql, /v_timeout := v_wrong/);
  assert.match(sql, /v_total := greatest\(0, v_total \+ v_series_delta\)/);
  assert.match(sql, /v_xp_delta := -10/);
});

test("repair is server-side, serialized, and refuses blocking anomalies", () => {
  assert.match(sql, /create or replace function public\.audit_xp_integrity/);
  assert.match(sql, /create or replace function public\.repair_xp_integrity/);
  assert.match(sql, /XP repair aborted: blocking data anomalies detected/);
  assert.match(sql, /series_without_questions/);
  assert.match(sql, /incomplete_series/);
  assert.match(sql, /series_over_10_questions/);
  assert.match(sql, /mismatched_question_owner/);
  assert.match(sql, /orphan_questions/);
  assert.match(sql, /duplicate_client_answer_ids/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(v_lock_id::text, 1\)\)/);
});

test("session, bonus, and concurrent answer writes remain server-controlled", () => {
  assert.match(sql, /create or replace function public\.start_student_session/);
  assert.match(sql, /create or replace function public\.admin_set_student_session/);
  assert.match(sql, /Manual XP bonus requires admin access/);
  assert.match(sql, /v_student_xp_before \+ v_manual_bonus >= 700/);
  assert.match(sql, /v_student_xp_before \+ v_manual_bonus >= 1500/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_student_id::text, 1\)\)/);
});

test("client-side projection writes are rejected", () => {
  assert.match(sql, /XP projection columns are server-managed/);
  assert.match(sql, /if tg_table_name = 'question_results' then/);
  assert.match(sql, /if tg_table_name = 'series_results' then/);
  assert.match(sql, /drop policy if exists "update all students"/);
  assert.match(sql, /revoke all on function public\.submit_answer\(uuid, uuid, integer, text, text, text, text, text, text, boolean, numeric, text\) from public/);
});
