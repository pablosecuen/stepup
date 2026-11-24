-- ROLLBACK de 20261124200000_slot_occupancy_replacement_links.sql: vuelve calendar_lesson_occupies_slot a su definición anterior (idéntica a 20261118200000).
-- Efecto: los orígenes liberados por un vínculo vuelven a contarse como ocupados en la base (el defecto corregido). No toca datos.
create or replace function public.calendar_lesson_occupies_slot(l public.calendar_lessons)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when l.status = 'cancelled' then false
    when l.status = 'rescheduled' and l.recurrence_original_start is null then false
    when l.recurrence_id is not null and l.recurrence_occurrence_key is not null and exists (
      select 1 from public.recurrence_exceptions e
      where e.owner_id = l.owner_id and e.recurrence_id = l.recurrence_id and e.occurrence_key = l.recurrence_occurrence_key
        and e.exception_type = 'rescheduled' and e.replacement_lesson_id is not null and e.replacement_lesson_id <> l.id
    ) then false
    else true
  end
$$;
