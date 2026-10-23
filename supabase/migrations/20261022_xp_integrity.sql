-- XP integrity hardening.
-- Historical question_results.xp_delta values are immutable accounting events.
-- series_results and students are server-maintained projections of those events.

begin;

-- Administrative deletion relies on a single auth.users DELETE and PostgreSQL
-- cascades. Abort before changing the schema if an isolated environment does
-- not have every required relationship with ON DELETE CASCADE.
do $$
declare
  v_missing text;
begin
  with required_fk(
    child_schema,
    child_table,
    child_column,
    parent_schema,
    parent_table,
    parent_column
  ) as (
    values
      ('public', 'students', 'auth_user_id', 'auth', 'users', 'id'),
      ('public', 'series_results', 'student_id', 'public', 'students', 'id'),
      ('public', 'question_results', 'student_id', 'public', 'students', 'id'),
      ('public', 'question_results', 'series_id', 'public', 'series_results', 'id'),
      ('public', 'targeted_skill_progress', 'student_id', 'public', 'students', 'id'),
      ('public', 'targeted_series', 'student_id', 'public', 'students', 'id'),
      ('public', 'targeted_question_results', 'student_id', 'public', 'students', 'id'),
      ('public', 'targeted_question_results', 'series_id', 'public', 'targeted_series', 'id'),
      ('public', 'parent_students', 'student_id', 'public', 'students', 'id')
  )
  select string_agg(
    format('%I.%I(%I) -> %I.%I(%I) ON DELETE CASCADE',
      required_fk.child_schema,
      required_fk.child_table,
      required_fk.child_column,
      required_fk.parent_schema,
      required_fk.parent_table,
      required_fk.parent_column
    ),
    ', '
  )
  into v_missing
  from required_fk
  where not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class child_table
      on child_table.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace child_namespace
      on child_namespace.oid = child_table.relnamespace
    join pg_catalog.pg_class parent_table
      on parent_table.oid = constraint_row.confrelid
    join pg_catalog.pg_namespace parent_namespace
      on parent_namespace.oid = parent_table.relnamespace
    join pg_catalog.pg_attribute child_column
      on child_column.attrelid = child_table.oid
     and child_column.attname = required_fk.child_column
     and child_column.attnum = any(constraint_row.conkey)
    join pg_catalog.pg_attribute parent_column
      on parent_column.attrelid = parent_table.oid
     and parent_column.attname = required_fk.parent_column
     and parent_column.attnum = any(constraint_row.confkey)
    where constraint_row.contype = 'f'
      and constraint_row.confdeltype = 'c'
      and child_namespace.nspname = required_fk.child_schema
      and child_table.relname = required_fk.child_table
      and parent_namespace.nspname = required_fk.parent_schema
      and parent_table.relname = required_fk.parent_table
  );

  if v_missing is not null then
    raise exception 'XP integrity migration aborted: missing required ON DELETE CASCADE foreign keys: %', v_missing;
  end if;
end;
$$;

do $$
declare
  v_duplicate_auth_ids text;
begin
  select string_agg(auth_user_id::text, ', ' order by auth_user_id::text)
  into v_duplicate_auth_ids
  from (
    select s.auth_user_id
    from public.students s
    where s.auth_user_id is not null
    group by s.auth_user_id
    having count(*) > 1
  ) duplicates;

  if v_duplicate_auth_ids is not null then
    raise exception
      'XP integrity migration aborted: auth identities shared by multiple students: %',
      v_duplicate_auth_ids;
  end if;
end;
$$;

create unique index if not exists students_auth_user_id_uidx
  on public.students (auth_user_id)
  where auth_user_id is not null;

create table if not exists public.admin_student_deletion_requests (
  request_id uuid primary key,
  student_id uuid not null unique,
  auth_user_id uuid not null,
  requested_by uuid not null,
  last_attempt_by uuid not null,
  status text not null check (status in ('deleting', 'completed', 'failed')),
  attempt_id uuid,
  lease_expires_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.admin_student_deletion_requests enable row level security;
revoke all on table public.admin_student_deletion_requests from public, anon, authenticated;
grant select, insert, update on table public.admin_student_deletion_requests to service_role;

alter table public.question_results
  add column if not exists client_answer_id uuid;

create unique index if not exists question_results_student_client_answer_uidx
  on public.question_results (student_id, client_answer_id)
  where client_answer_id is not null;

create index if not exists question_results_series_created_idx
  on public.question_results (series_id, created_at, id);

create index if not exists question_results_student_session_idx
  on public.question_results (student_id, session);

create index if not exists series_results_student_session_created_idx
  on public.series_results (student_id, session, created_at, id);

create or replace function public.calculate_student_xp_projection(
  p_student_id uuid,
  p_session integer
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total integer := 0;
  v_series_delta integer;
begin
  for v_series_delta in
    select coalesce(sum(qr.xp_delta), 0)::integer
    from public.series_results sr
    left join public.question_results qr on qr.series_id = sr.id
    where sr.student_id = p_student_id
      and sr.session = p_session
    group by sr.id, sr.created_at
    order by sr.created_at, sr.id
  loop
    v_total := greatest(0, v_total + v_series_delta);
  end loop;
  return v_total;
end;
$$;

revoke all on function public.calculate_student_xp_projection(uuid, integer)
  from public, anon, authenticated;

create or replace function public.audit_xp_integrity(p_student_id uuid default null)
returns table (
  student_id uuid,
  pseudo text,
  session integer,
  current_xp integer,
  calculated_xp integer,
  manual_bonus integer,
  series_count bigint,
  question_count bigint,
  anomalies jsonb,
  has_blocking_anomaly boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  return query
  with selected_students as (
    select s.*
    from public.students s
    where p_student_id is null or s.id = p_student_id
  ),
  series_stats as (
    select
      sr.student_id,
      sr.id as series_id,
      count(qr.id) as all_questions,
      count(qr.id) filter (where qr.category is distinct from 'refresh_penalty') as normal_questions
    from public.series_results sr
    join selected_students ss
      on ss.id = sr.student_id
     and sr.session = coalesce(ss.session, 1)
    left join public.question_results qr on qr.series_id = sr.id
    group by sr.student_id, sr.id
  ),
  series_summary as (
    select
      st.student_id,
      count(*) as series_count,
      count(*) filter (where st.all_questions = 0) as empty_series,
      count(*) filter (where st.normal_questions between 1 and 9) as incomplete_series,
      count(*) filter (where st.normal_questions > 10) as oversized_series
    from series_stats st
    group by st.student_id
  ),
  question_summary as (
    select
      ss.id as student_id,
      count(qr.id) as question_count,
      count(qr.id) filter (where qr.xp_delta is null) as null_xp_delta,
      count(qr.id) filter (where qr.series_id is null or sr.id is null) as orphan_questions,
      count(qr.id) filter (
        where sr.id is not null
          and (
            qr.student_id is distinct from sr.student_id
            or qr.session is distinct from sr.session
          )
      ) as mismatched_owner
    from selected_students ss
    left join public.question_results qr
      on qr.student_id = ss.id
     and qr.session = coalesce(ss.session, 1)
    left join public.series_results sr on sr.id = qr.series_id
    group by ss.id
  ),
  series_question_mismatch as (
    select
      sr.student_id,
      count(qr.id) filter (
        where qr.student_id is distinct from sr.student_id
           or qr.session is distinct from sr.session
      ) as mismatched_owner
    from public.series_results sr
    join selected_students ss
      on ss.id = sr.student_id
     and sr.session = coalesce(ss.session, 1)
    left join public.question_results qr on qr.series_id = sr.id
    group by sr.student_id
  ),
  duplicate_ids as (
    select qr.student_id, count(*)::bigint as duplicate_count
    from (
      select student_id, client_answer_id
      from public.question_results
      where client_answer_id is not null
      group by student_id, client_answer_id
      having count(*) > 1
    ) qr
    group by qr.student_id
  )
  select
    ss.id,
    ss.pseudo,
    coalesce(ss.session, 1),
    coalesce(ss.xp_total, 0),
    public.calculate_student_xp_projection(ss.id, coalesce(ss.session, 1)),
    coalesce(ss.manual_xp_bonus, 0),
    coalesce(su.series_count, 0),
    coalesce(qs.question_count, 0),
    jsonb_build_object(
      'series_without_questions', coalesce(su.empty_series, 0),
      'incomplete_series', coalesce(su.incomplete_series, 0),
      'series_over_10_questions', coalesce(su.oversized_series, 0),
      'null_xp_delta', coalesce(qs.null_xp_delta, 0),
      'mismatched_question_owner', coalesce(qs.mismatched_owner, 0) + coalesce(sqm.mismatched_owner, 0),
      'orphan_questions', coalesce(qs.orphan_questions, 0),
      'duplicate_client_answer_ids', coalesce(di.duplicate_count, 0)
    ),
    coalesce(su.empty_series, 0) > 0
      or coalesce(su.incomplete_series, 0) > 0
      or coalesce(su.oversized_series, 0) > 0
      or coalesce(qs.null_xp_delta, 0) > 0
      or coalesce(qs.mismatched_owner, 0) + coalesce(sqm.mismatched_owner, 0) > 0
      or coalesce(qs.orphan_questions, 0) > 0
      or coalesce(di.duplicate_count, 0) > 0
  from selected_students ss
  left join series_summary su on su.student_id = ss.id
  left join question_summary qs on qs.student_id = ss.id
  left join series_question_mismatch sqm on sqm.student_id = ss.id
  left join duplicate_ids di on di.student_id = ss.id
  order by lower(ss.pseudo), ss.id;
end;
$$;

revoke all on function public.audit_xp_integrity(uuid)
  from public, anon, authenticated;
grant execute on function public.audit_xp_integrity(uuid) to authenticated;

-- Internal projection rebuild shared by administrative transactions. It is
-- intentionally not executable by API roles and never changes manual_xp_bonus.
create or replace function public.rebuild_student_current_projection(p_student_id uuid)
returns public.students
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_student public.students%rowtype;
  v_best_score integer;
  v_best_avg_time numeric;
  v_games_played integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text, 1));

  select s.* into v_student
  from public.students s
  where s.id = p_student_id
  for update;
  if not found then
    raise exception 'Student not found';
  end if;

  perform set_config('leveling_math.server_xp_write', 'on', true);

  with ordered as (
    select
      qr.series_id,
      qr.is_correct,
      row_number() over (partition by qr.series_id order by qr.created_at, qr.id) as rn_all,
      row_number() over (
        partition by qr.series_id, qr.is_correct order by qr.created_at, qr.id
      ) as rn_part
    from public.question_results qr
    join public.series_results sr on sr.id = qr.series_id
    where sr.student_id = p_student_id
      and sr.session = coalesce(v_student.session, 1)
      and qr.category is distinct from 'refresh_penalty'
  ),
  streaks as (
    select series_id, max(streak_len)::integer as streak_max
    from (
      select series_id, rn_all - rn_part as streak_group, count(*)::integer as streak_len
      from ordered
      where is_correct = true
      group by series_id, rn_all - rn_part
    ) grouped_streaks
    group by series_id
  ),
  aggregates as (
    select
      sr.id,
      count(qr.id) filter (
        where qr.category is distinct from 'refresh_penalty' and qr.is_correct = true
      )::integer as score,
      coalesce(sum(qr.xp_delta), 0)::integer as xp_gained,
      avg(qr.response_time) filter (
        where qr.category is distinct from 'refresh_penalty' and qr.response_time is not null
      ) as avg_time,
      coalesce(st.streak_max, 0) as streak_max
    from public.series_results sr
    left join public.question_results qr on qr.series_id = sr.id
    left join streaks st on st.series_id = sr.id
    where sr.student_id = p_student_id
      and sr.session = coalesce(v_student.session, 1)
    group by sr.id, st.streak_max
  )
  update public.series_results sr
  set score = a.score,
      xp_gained = a.xp_gained,
      avg_time = a.avg_time,
      streak_max = a.streak_max
  from aggregates a
  where sr.id = a.id;

  select
    coalesce(max(sr.score), 0)::integer,
    min(sr.avg_time) filter (where sr.avg_time is not null),
    count(sr.id) filter (
      where exists (
        select 1
        from public.question_results qr
        where qr.series_id = sr.id
          and qr.category is distinct from 'refresh_penalty'
      )
    )::integer
  into v_best_score, v_best_avg_time, v_games_played
  from public.series_results sr
  where sr.student_id = p_student_id
    and sr.session = coalesce(v_student.session, 1);

  update public.students s
  set xp_total = public.calculate_student_xp_projection(s.id, coalesce(s.session, 1)),
      best_score = coalesce(v_best_score, 0),
      best_avg_time = v_best_avg_time,
      games_played = coalesce(v_games_played, 0),
      updated_at = now()
  where s.id = p_student_id
  returning s.* into v_student;

  return v_student;
end;
$$;

revoke all on function public.rebuild_student_current_projection(uuid)
  from public, anon, authenticated;

create or replace function public.repair_xp_integrity(p_student_id uuid default null)
returns setof public.students
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  for v_lock_id in
    select s.id from public.students s
    where p_student_id is null or s.id = p_student_id
    order by s.id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_lock_id::text, 1));
  end loop;

  if exists (
    select 1
    from public.audit_xp_integrity(p_student_id) audit
    where audit.has_blocking_anomaly
  ) then
    raise exception 'XP repair aborted: blocking data anomalies detected';
  end if;

  for v_lock_id in
    select s.id from public.students s
    where p_student_id is null or s.id = p_student_id
    order by s.id
  loop
    perform public.rebuild_student_current_projection(v_lock_id);
  end loop;

  return query
  select s.* from public.students s
  where p_student_id is null or s.id = p_student_id
  order by lower(s.pseudo), s.id;
end;
$$;

revoke all on function public.repair_xp_integrity(uuid)
  from public, anon, authenticated;
grant execute on function public.repair_xp_integrity(uuid) to authenticated;

create or replace function public.protect_student_xp_projection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('leveling_math.server_xp_write', true), '') <> 'on' then
      new.xp_total := 0;
      new.manual_xp_bonus := 0;
      new.best_score := 0;
      new.best_avg_time := null;
      new.games_played := 0;
      new.session := 1;
    end if;
    return new;
  end if;
  if coalesce(current_setting('leveling_math.server_xp_write', true), '') <> 'on'
     and (
       new.xp_total is distinct from old.xp_total
       or new.best_score is distinct from old.best_score
       or new.best_avg_time is distinct from old.best_avg_time
       or new.games_played is distinct from old.games_played
       or new.session is distinct from old.session
     ) then
    raise exception 'XP projection columns are server-managed' using errcode = '42501';
  end if;
  if new.manual_xp_bonus is distinct from old.manual_xp_bonus and not public.is_admin() then
    raise exception 'Manual XP bonus requires admin access' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_student_xp_projection()
  from public, anon, authenticated;

drop trigger if exists protect_student_xp_projection on public.students;
create trigger protect_student_xp_projection
before insert or update on public.students
for each row execute function public.protect_student_xp_projection();

create or replace function public.protect_student_auth_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.auth_user_id is not null
     and new.auth_user_id is distinct from old.auth_user_id then
    raise exception 'A linked student Auth identity is immutable' using errcode = '42501';
  end if;

  if old.auth_user_id is null
     and new.auth_user_id is not null
     and new.auth_user_id is distinct from auth.uid()
     and not public.is_admin() then
    raise exception 'Student Auth identity can only be linked to the current user' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_student_auth_identity()
  from public, anon, authenticated;

drop trigger if exists protect_student_auth_identity on public.students;
create trigger protect_student_auth_identity
before update of auth_user_id on public.students
for each row execute function public.protect_student_auth_identity();

create or replace function public.protect_xp_accounting_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('leveling_math.server_xp_write', true), '') <> 'on' then
    if tg_table_name = 'question_results' then
      if new.xp_delta is distinct from old.xp_delta
         or new.client_answer_id is distinct from old.client_answer_id then
        raise exception 'Question XP accounting fields are immutable' using errcode = '42501';
      end if;
    end if;
    if tg_table_name = 'series_results' then
      if new.xp_gained is distinct from old.xp_gained
         or new.score is distinct from old.score
         or new.avg_time is distinct from old.avg_time
         or new.streak_max is distinct from old.streak_max then
        raise exception 'Series projection fields are server-managed' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_xp_accounting_fields()
  from public, anon, authenticated;

drop trigger if exists protect_question_xp_accounting on public.question_results;
create trigger protect_question_xp_accounting
before update on public.question_results
for each row execute function public.protect_xp_accounting_fields();

drop trigger if exists protect_series_xp_projection on public.series_results;
create trigger protect_series_xp_projection
before update on public.series_results
for each row execute function public.protect_xp_accounting_fields();

drop policy if exists "update all students" on public.students;
drop policy if exists "student update own profile" on public.students;
create policy "student update own profile"
on public.students
for update
to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());

drop policy if exists "Allow read by parent link code during signup" on public.students;

create or replace function public.start_student_session(p_student_id uuid)
returns public.students
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student public.students%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text, 1));
  perform set_config('leveling_math.server_xp_write', 'on', true);
  update public.students
  set session = coalesce(session, 1) + 1,
      xp_total = 0,
      best_score = 0,
      best_avg_time = null,
      games_played = 0,
      updated_at = now()
  where id = p_student_id
  returning * into v_student;
  if not found then raise exception 'Student not found'; end if;
  return v_student;
end;
$$;

revoke all on function public.start_student_session(uuid)
  from public, anon, authenticated;
grant execute on function public.start_student_session(uuid) to authenticated;

create or replace function public.admin_set_student_session(
  p_student_id uuid,
  p_session integer,
  p_manual_xp_bonus integer default null
)
returns public.students
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student public.students%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_session is null or p_session < 1 then raise exception 'Invalid session'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text, 1));
  perform set_config('leveling_math.server_xp_write', 'on', true);
  update public.students
  set session = p_session,
      manual_xp_bonus = coalesce(p_manual_xp_bonus, manual_xp_bonus),
      updated_at = now()
  where id = p_student_id
  returning * into v_student;
  if not found then raise exception 'Student not found'; end if;
  return v_student;
end;
$$;

revoke all on function public.admin_set_student_session(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_set_student_session(uuid, integer, integer) to authenticated;

create or replace function public.admin_delete_student_session(
  p_student_id uuid,
  p_session integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_student public.students%rowtype;
  v_deleted_questions integer := 0;
  v_deleted_series integer := 0;
  v_remaining_series integer := 0;
  v_current_session integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_session is null or p_session < 1 then
    raise exception 'Invalid session';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text, 1));
  select s.* into v_student
  from public.students s
  where s.id = p_student_id
  for update;
  if not found then
    raise exception 'Student not found';
  end if;

  if not exists (
    select 1 from public.series_results sr
    where sr.student_id = p_student_id and sr.session = p_session
  ) and not exists (
    select 1 from public.question_results qr
    where qr.student_id = p_student_id and qr.session = p_session
  ) then
    raise exception 'Session not found';
  end if;

  delete from public.question_results qr
  where (qr.student_id = p_student_id and qr.session = p_session)
     or exists (
       select 1
       from public.series_results sr
       where sr.id = qr.series_id
         and sr.student_id = p_student_id
         and sr.session = p_session
     );
  get diagnostics v_deleted_questions = row_count;

  delete from public.series_results sr
  where sr.student_id = p_student_id
    and sr.session = p_session;
  get diagnostics v_deleted_series = row_count;

  v_current_session := coalesce(v_student.session, 1);
  if v_current_session = p_session then
    select coalesce(max(sr.session), 1)
    into v_current_session
    from public.series_results sr
    where sr.student_id = p_student_id;
  end if;

  perform set_config('leveling_math.server_xp_write', 'on', true);
  update public.students
  set session = v_current_session,
      updated_at = now()
  where id = p_student_id;

  select * into v_student
  from public.rebuild_student_current_projection(p_student_id);

  select count(*)::integer into v_remaining_series
  from public.series_results sr
  where sr.student_id = p_student_id;

  return jsonb_build_object(
    'student_id', v_student.id,
    'deleted_session', p_session,
    'deleted_question_count', v_deleted_questions,
    'deleted_series_count', v_deleted_series,
    'remaining_series_count', v_remaining_series,
    'current_session', coalesce(v_student.session, 1),
    'xp_total', coalesce(v_student.xp_total, 0),
    'manual_xp_bonus', coalesce(v_student.manual_xp_bonus, 0),
    'display_xp', coalesce(v_student.xp_total, 0) + coalesce(v_student.manual_xp_bonus, 0)
  );
end;
$$;

revoke all on function public.admin_delete_student_session(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.admin_delete_student_session(uuid, integer)
  to authenticated;

create or replace function public.admin_prepare_student_deletion(
  p_student_id uuid,
  p_request_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_student public.students%rowtype;
  v_receipt public.admin_student_deletion_requests%rowtype;
  v_actor uuid := auth.uid();
  v_profile_count integer := 0;
  v_auth_exists boolean := false;
  v_target_is_admin boolean := false;
  v_admin_table_match boolean := false;
  v_auth_metadata jsonb;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_student_id is null or p_request_id is null or p_attempt_id is null then
    raise exception 'student_id, request_id and attempt_id are required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text, 1));

  select r.* into v_receipt
  from public.admin_student_deletion_requests r
  where r.request_id = p_request_id or r.student_id = p_student_id
  order by (r.request_id = p_request_id) desc
  limit 1
  for update;

  if found and v_receipt.student_id is distinct from p_student_id then
    raise exception 'Deletion request does not match the selected student' using errcode = '22023';
  end if;

  if found and v_receipt.status = 'completed' then
    return jsonb_build_object(
      'request_id', v_receipt.request_id,
      'student_id', v_receipt.student_id,
      'auth_user_id', v_receipt.auth_user_id,
      'status', 'completed',
      'should_execute', false,
      'idempotent_replay', true
    );
  end if;

  if found
     and v_receipt.status = 'deleting'
     and v_receipt.lease_expires_at > now() then
    return jsonb_build_object(
      'request_id', v_receipt.request_id,
      'student_id', v_receipt.student_id,
      'auth_user_id', v_receipt.auth_user_id,
      'status', 'in_progress',
      'should_execute', false,
      'retry_after_ms', greatest(
        250,
        floor(extract(epoch from (v_receipt.lease_expires_at - now())) * 1000)::integer
      )
    );
  end if;

  select s.* into v_student
  from public.students s
  where s.id = p_student_id
  for update;
  if not found then
    if v_receipt.request_id is not null then
      select exists (
        select 1 from auth.users u where u.id = v_receipt.auth_user_id
      ) into v_auth_exists;

      if not v_auth_exists then
        update public.admin_student_deletion_requests
        set status = 'completed',
            result = jsonb_build_object('recovered_after_interruption', true),
            error_code = null,
            error_message = null,
            lease_expires_at = null,
            updated_at = now(),
            completed_at = coalesce(completed_at, now())
        where request_id = v_receipt.request_id;

        return jsonb_build_object(
          'request_id', v_receipt.request_id,
          'student_id', v_receipt.student_id,
          'auth_user_id', v_receipt.auth_user_id,
          'status', 'completed',
          'should_execute', false,
          'idempotent_replay', true,
          'recovered_after_interruption', true
        );
      end if;

      raise exception 'Student profile is missing while its Auth account still exists';
    end if;

    raise exception 'Student not found' using errcode = 'P0002';
  end if;

  if v_student.auth_user_id is null then
    raise exception 'Student has no linked Auth account' using errcode = '22023';
  end if;
  if v_student.auth_user_id = v_actor then
    raise exception 'An administrator cannot delete their own account' using errcode = '42501';
  end if;

  select count(*)::integer into v_profile_count
  from public.students s
  where s.auth_user_id = v_student.auth_user_id;
  if v_profile_count <> 1 then
    raise exception 'Auth account is shared by % student profiles', v_profile_count;
  end if;

  select true, coalesce(u.raw_app_meta_data, '{}'::jsonb)
  into v_auth_exists, v_auth_metadata
  from auth.users u
  where u.id = v_student.auth_user_id;
  if not found or not v_auth_exists then
    raise exception 'Linked Auth account not found' using errcode = 'P0002';
  end if;

  v_target_is_admin :=
    lower(coalesce(v_auth_metadata ->> 'role', '')) = 'admin'
    or lower(coalesce(v_auth_metadata ->> 'is_admin', '')) in ('true', '1');

  if to_regclass('public.admin_users') is not null then
    execute 'select exists (select 1 from public.admin_users where user_id = $1)'
      into v_admin_table_match
      using v_student.auth_user_id;
    v_target_is_admin := v_target_is_admin or v_admin_table_match;
  end if;

  if v_target_is_admin then
    raise exception 'Administrator accounts cannot be deleted from the student dashboard'
      using errcode = '42501';
  end if;

  if v_receipt.request_id is null then
    insert into public.admin_student_deletion_requests (
      request_id,
      student_id,
      auth_user_id,
      requested_by,
      last_attempt_by,
      status,
      attempt_id,
      lease_expires_at
    ) values (
      p_request_id,
      p_student_id,
      v_student.auth_user_id,
      v_actor,
      v_actor,
      'deleting',
      p_attempt_id,
      now() + interval '15 seconds'
    )
    returning * into v_receipt;
  else
    if v_receipt.auth_user_id is distinct from v_student.auth_user_id then
      raise exception 'Student Auth identity changed after deletion was requested';
    end if;

    update public.admin_student_deletion_requests
    set last_attempt_by = v_actor,
        status = 'deleting',
        attempt_id = p_attempt_id,
        lease_expires_at = now() + interval '15 seconds',
        error_code = null,
        error_message = null,
        updated_at = now()
    where request_id = v_receipt.request_id
    returning * into v_receipt;
  end if;

  return jsonb_build_object(
    'request_id', v_receipt.request_id,
    'student_id', v_student.id,
    'auth_user_id', v_student.auth_user_id,
    'status', 'ready',
    'should_execute', true,
    'lease_expires_at', v_receipt.lease_expires_at
  );
end;
$$;

revoke all on function public.admin_prepare_student_deletion(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_prepare_student_deletion(uuid, uuid, uuid)
  to authenticated;

-- Remove the legacy application-only deletion path. Permanent student deletion
-- must start with auth.admin.deleteUser() in the trusted Edge Function so that
-- auth.users is the cascade root.
drop function if exists public.admin_delete_student(uuid);

revoke delete on table public.students from public, anon, authenticated;
revoke delete on table public.series_results from public, anon, authenticated;
revoke delete on table public.question_results from public, anon, authenticated;
revoke delete on table public.targeted_skill_progress from public, anon, authenticated;
revoke delete on table public.targeted_series from public, anon, authenticated;
revoke delete on table public.targeted_question_results from public, anon, authenticated;
revoke delete on table public.parent_students from public, anon, authenticated;

create or replace function public.submit_answer(
  p_student_id uuid,
  p_series_id uuid,
  p_session integer,
  p_level text,
  p_category text,
  p_subcategory text,
  p_question_text text,
  p_expected_answer text,
  p_user_answer text,
  p_is_correct boolean,
  p_response_time numeric,
  p_answer_kind text,
  p_client_answer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_uid uuid := auth.uid();
  v_student_session integer;
  v_student_xp_before integer;
  v_manual_bonus integer;
  v_series_id uuid;
  v_series_level text;
  v_question_id uuid;
  v_existing public.question_results%rowtype;
  v_normal_count integer;
  v_gain integer;
  v_wrong integer;
  v_timeout integer;
  v_multiplier integer := 1;
  v_xp_delta integer;
  v_last_perfect_at timestamptz;
  v_last_wrong_at timestamptz;
  v_series_score integer;
  v_series_xp integer;
  v_series_avg_time numeric;
  v_streak_max integer;
  v_student_xp integer := 0;
  v_best_score integer;
  v_best_avg_time numeric;
  v_games_played integer;
begin
  if v_auth_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_client_answer_id is null then
    raise exception 'client_answer_id is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_client_answer_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text, 1));
  perform set_config('leveling_math.server_xp_write', 'on', true);

  select coalesce(s.session, 1), coalesce(s.xp_total, 0), coalesce(s.manual_xp_bonus, 0)
  into v_student_session, v_student_xp_before, v_manual_bonus
  from public.students s
  where s.id = p_student_id and s.auth_user_id = v_auth_uid;

  if not found then
    raise exception 'Student does not belong to authenticated user' using errcode = '42501';
  end if;
  if p_session is null or p_session <> v_student_session then
    raise exception 'Invalid session for student' using errcode = '42501';
  end if;
  if p_level not in ('beginner', 'intermediate', 'expert') then
    raise exception 'Invalid level';
  end if;

  select * into v_existing
  from public.question_results qr
  where qr.student_id = p_student_id and qr.client_answer_id = p_client_answer_id;

  if found then
    if (p_series_id is not null and v_existing.series_id is distinct from p_series_id)
       or v_existing.session is distinct from p_session
       or v_existing.level is distinct from p_level
       or v_existing.category is distinct from p_category
       or v_existing.subcategory is distinct from p_subcategory
       or v_existing.question_text is distinct from p_question_text
       or v_existing.expected_answer is distinct from p_expected_answer
       or v_existing.user_answer is distinct from p_user_answer
       or v_existing.is_correct is distinct from coalesce(p_is_correct, false)
       or v_existing.response_time is distinct from p_response_time then
      raise exception 'Idempotency key reused with a different answer';
    end if;
    v_series_id := v_existing.series_id;
    v_question_id := v_existing.id;
    v_xp_delta := coalesce(v_existing.xp_delta, 0);
    select score, xp_gained, avg_time, streak_max
      into v_series_score, v_series_xp, v_series_avg_time, v_streak_max
    from public.series_results where id = v_series_id;
    select xp_total, best_score, best_avg_time, games_played, coalesce(manual_xp_bonus, 0)
      into v_student_xp, v_best_score, v_best_avg_time, v_games_played, v_manual_bonus
    from public.students where id = p_student_id;
    return jsonb_build_object(
      'idempotent_replay', true,
      'student_id', p_student_id,
      'series_id', v_series_id,
      'question_id', v_question_id,
      'client_answer_id', p_client_answer_id,
      'xp_delta', v_xp_delta,
      'series_score', v_series_score,
      'series_xp_gained', v_series_xp,
      'student_xp_total', v_student_xp,
      'manual_xp_bonus', v_manual_bonus,
      'student_display_xp', v_student_xp + v_manual_bonus,
      'best_score', v_best_score,
      'best_avg_time', v_best_avg_time,
      'games_played', v_games_played,
      'session', v_student_session
    );
  end if;

  v_gain := case p_level when 'beginner' then 2 when 'intermediate' then 5 when 'expert' then 10 end;
  v_wrong := case p_level when 'beginner' then 0 when 'intermediate' then 5 when 'expert' then 15 end;
  v_timeout := v_wrong;

  if p_series_id is null then
    if p_level = 'beginner' and v_student_xp_before + v_manual_bonus >= 700 then
      raise exception 'Beginner level is locked for this student' using errcode = '42501';
    end if;
    if p_level = 'intermediate' and v_student_xp_before + v_manual_bonus >= 1500 then
      raise exception 'Intermediate level is locked for this student' using errcode = '42501';
    end if;
    insert into public.series_results (student_id, level, score, avg_time, xp_gained, streak_max, session)
    values (p_student_id, p_level, 0, null, 0, 0, v_student_session)
    returning id into v_series_id;
  else
    select sr.id, sr.level into v_series_id, v_series_level
    from public.series_results sr
    where sr.id = p_series_id and sr.student_id = p_student_id and sr.session = v_student_session;
    if not found then
      raise exception 'Series does not belong to student/session' using errcode = '42501';
    end if;
    if v_series_level is distinct from p_level then
      raise exception 'Level mismatch for series' using errcode = '42501';
    end if;
  end if;

  select count(*)::integer into v_normal_count
  from public.question_results qr
  where qr.series_id = v_series_id and qr.category is distinct from 'refresh_penalty';

  if p_answer_kind is distinct from 'refresh_penalty'
     and p_category is distinct from 'refresh_penalty'
     and v_normal_count >= 10 then
    raise exception 'Series already has 10 normal questions' using errcode = '42501';
  end if;

  select max(done_at) into v_last_perfect_at
  from (
    select max(qr.created_at) as done_at
    from public.question_results qr
    join public.series_results sr on sr.id = qr.series_id
    where sr.student_id = p_student_id and sr.session = v_student_session
      and qr.category is distinct from 'refresh_penalty'
    group by qr.series_id
    having count(*) = 10 and count(*) filter (where qr.is_correct = true) = 10
  ) perfect_series;

  select max(qr.created_at) into v_last_wrong_at
  from public.question_results qr
  join public.series_results sr on sr.id = qr.series_id
  where sr.student_id = p_student_id and sr.session = v_student_session
    and qr.category is distinct from 'refresh_penalty'
    and coalesce(qr.is_correct, false) = false;

  if v_last_perfect_at is not null
     and (v_last_wrong_at is null or v_last_perfect_at > v_last_wrong_at) then
    v_multiplier := 2;
  end if;

  if p_answer_kind = 'refresh_penalty' or p_category = 'refresh_penalty' then
    v_xp_delta := -10;
  elsif coalesce(p_is_correct, false) then
    v_xp_delta := v_gain * v_multiplier;
  elsif p_answer_kind = 'timeout' then
    v_xp_delta := -v_timeout;
  else
    v_xp_delta := -v_wrong;
  end if;

  insert into public.question_results (
    student_id, session, series_id, level, category, subcategory,
    question_text, expected_answer, user_answer, is_correct, response_time,
    xp_delta, client_answer_id
  ) values (
    p_student_id, v_student_session, v_series_id, p_level, p_category, p_subcategory,
    p_question_text, p_expected_answer, p_user_answer, coalesce(p_is_correct, false),
    p_response_time, v_xp_delta, p_client_answer_id
  ) returning id into v_question_id;

  select
    coalesce(count(*) filter (where qr.category is distinct from 'refresh_penalty' and qr.is_correct = true), 0),
    coalesce(sum(qr.xp_delta), 0),
    avg(qr.response_time) filter (where qr.category is distinct from 'refresh_penalty' and qr.response_time is not null)
  into v_series_score, v_series_xp, v_series_avg_time
  from public.question_results qr where qr.series_id = v_series_id;

  with ordered as (
    select qr.is_correct,
      row_number() over (order by qr.created_at, qr.id) as rn_all,
      row_number() over (partition by qr.is_correct order by qr.created_at, qr.id) as rn_part
    from public.question_results qr
    where qr.series_id = v_series_id and qr.category is distinct from 'refresh_penalty'
  ), streaks as (
    select count(*) as streak_len from ordered
    where is_correct = true group by rn_all - rn_part
  )
  select coalesce(max(streak_len), 0) into v_streak_max from streaks;

  update public.series_results
  set score = v_series_score, xp_gained = v_series_xp,
      avg_time = v_series_avg_time, streak_max = v_streak_max
  where id = v_series_id;

  v_student_xp := public.calculate_student_xp_projection(p_student_id, v_student_session);

  select coalesce(max(sr.score), 0),
    min(sr.avg_time) filter (where sr.avg_time is not null),
    count(*)::integer
  into v_best_score, v_best_avg_time, v_games_played
  from public.series_results sr
  where sr.student_id = p_student_id and sr.session = v_student_session
    and exists (
      select 1 from public.question_results qr
      where qr.series_id = sr.id and qr.category is distinct from 'refresh_penalty'
    );

  perform set_config('leveling_math.server_xp_write', 'on', true);
  update public.students
  set xp_total = v_student_xp,
      best_score = coalesce(v_best_score, 0),
      best_avg_time = v_best_avg_time,
      games_played = coalesce(v_games_played, 0),
      updated_at = now()
  where id = p_student_id and auth_user_id = v_auth_uid;

  return jsonb_build_object(
    'idempotent_replay', false,
    'student_id', p_student_id,
    'series_id', v_series_id,
    'question_id', v_question_id,
    'client_answer_id', p_client_answer_id,
    'xp_delta', v_xp_delta,
    'xp_multiplier', v_multiplier,
    'normal_question_count', case
      when p_answer_kind = 'refresh_penalty' or p_category = 'refresh_penalty'
      then v_normal_count else v_normal_count + 1 end,
    'series_score', v_series_score,
    'series_xp_gained', v_series_xp,
    'student_xp_total', v_student_xp,
    'manual_xp_bonus', v_manual_bonus,
    'student_display_xp', v_student_xp + v_manual_bonus,
    'best_score', v_best_score,
    'best_avg_time', v_best_avg_time,
    'games_played', v_games_played,
    'session', v_student_session
  );
end;
$$;

revoke all on function public.submit_answer(uuid, uuid, integer, text, text, text, text, text, text, boolean, numeric, text, uuid)
  from public, anon, authenticated;
grant execute on function public.submit_answer(uuid, uuid, integer, text, text, text, text, text, text, boolean, numeric, text, uuid) to authenticated;

create or replace function public.submit_answer(
  p_student_id uuid,
  p_series_id uuid,
  p_session integer,
  p_level text,
  p_category text,
  p_subcategory text,
  p_question_text text,
  p_expected_answer text,
  p_user_answer text,
  p_is_correct boolean,
  p_response_time numeric,
  p_answer_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'client_answer_id is required; update the application before retrying';
end;
$$;

revoke all on function public.submit_answer(uuid, uuid, integer, text, text, text, text, text, text, boolean, numeric, text)
  from public, anon, authenticated;

commit;
