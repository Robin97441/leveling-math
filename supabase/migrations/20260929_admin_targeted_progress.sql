begin;

create or replace function public.get_targeted_skill_progress_for_admin(
  p_student_id uuid,
  p_skill_key text default 'calcul_litteral'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_is_admin boolean := false;
  v_admin_table_match boolean := false;
  v_rows jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  v_is_admin :=
    coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
    or lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'is_admin', '')) in ('true', '1');

  if not v_is_admin and to_regclass('public.admin_users') is not null then
    execute 'select exists (select 1 from public.admin_users where user_id = $1)'
      into v_admin_table_match
      using auth.uid();
    v_is_admin := v_admin_table_match;
  end if;

  if not v_is_admin then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.students where id = p_student_id) then
    raise exception 'Student not found.' using errcode = 'P0002';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'student_id', progress.student_id,
        'skill_key', progress.skill_key,
        'difficulty', progress.difficulty,
        'xp', progress.xp,
        'completed', progress.completed,
        'completed_at', progress.completed_at
      )
      order by case progress.difficulty
        when 'beginner' then 1
        when 'intermediate' then 2
        when 'expert' then 3
        else 4
      end
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.targeted_skill_progress progress
  where progress.student_id = p_student_id
    and progress.skill_key = p_skill_key;

  return jsonb_build_object(
    'student_id', p_student_id,
    'skill_key', p_skill_key,
    'rows', v_rows
  );
end;
$$;

comment on function public.get_targeted_skill_progress_for_admin(uuid, text) is
  'Lecture seule de la progression ciblée d’un élève sélectionné, réservée aux administrateurs.';

revoke all on function public.get_targeted_skill_progress_for_admin(uuid, text) from public;
revoke all on function public.get_targeted_skill_progress_for_admin(uuid, text) from anon;
grant execute on function public.get_targeted_skill_progress_for_admin(uuid, text) to authenticated;

commit;
