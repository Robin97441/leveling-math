begin;

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
set search_path = pg_catalog, public
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
      select source_qr.student_id, source_qr.client_answer_id
      from public.question_results source_qr
      where source_qr.client_answer_id is not null
      group by source_qr.student_id, source_qr.client_answer_id
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

commit;
