begin;

alter table public.students
  add column if not exists leveling_objective text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'students_leveling_objective_length'
      and conrelid = 'public.students'::regclass
  ) then
    alter table public.students
      add constraint students_leveling_objective_length
      check (leveling_objective is null or char_length(leveling_objective) <= 500);
  end if;
end
$$;

comment on column public.students.leveling_objective is
  'Objectif Leveling Math individuel défini par le professeur. NULL utilise l’objectif général.';

commit;

-- Aucune policy permissive n'est ajoutée : les policies RLS existantes de
-- public.students continuent de déterminer quelles lignes chaque compte peut
-- lire ou modifier. À contrôler dans le SQL Editor avant déploiement :
--
-- select policyname, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname = 'public' and tablename = 'students'
-- order by policyname;
