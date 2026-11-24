-- Un horario liberado por una reprogramación o un reemplazo NO vuelve a ocupar el calendario (24/11/2026).
--
-- CAUSA: la agenda operativa de la aplicación (`lib/calendar/agenda.ts` + `replacement-visibility.ts`) libera el origen de una reprogramación o de un reemplazo por los VÍNCULOS exactos guardados en
-- `calendar_replacement_links` («moved» siempre; «replaced» mientras su reemplazo esté vigente). `calendar_lesson_occupies_slot` —la regla que repite la base dentro de `create_calendar_lesson` (con
-- `guard_overlap`) y de `extend_calendar_lesson_duration`— sólo conocía las excepciones de serie y las «reprogramadas» sin origen. Un origen liberado POR VÍNCULO (p. ej. una clase reprogramada al
-- martes 08:00–09:00 que después volvió a moverse a otro día) la aplicación lo ocultaba y no lo contaba, pero la base seguía considerándolo ocupado: el selector ofrecía 08:30–10:00 y, al guardar,
-- la base respondía «El horario elegido se superpone con otra clase ya agendada» contra una clase que ya no estaba ahí. Las comparaciones de intervalo siempre fueron estrictas ([inicio, fin)).
--
-- ARREGLO: la función incorpora la misma regla de vínculos. Sólo cambia la regla de ocupación (una función estable): no toca ninguna fila, ninguna clase ni ningún cobro, y no relaja la protección contra
-- superposiciones reales (una clase vigente, un destino de reprogramación, una dictada y un origen cuyo reemplazo no está vigente siguen ocupando).
--   - «moved»: el origen queda libre, esté como esté el destino (igual que `applyReplacementVisibility`).
--   - «replaced»: libre sólo si su reemplazo existe, no está cancelado y no es una «reprogramada» sin origen (igual que `buildCalendarReplacementLinks`).
--   - una clase dictada (`completed`) es evidencia histórica: ningún vínculo la libera.
-- Idempotente (create or replace). Rollback: `supabase/repairs/20261124200000_slot_occupancy_rollback.sql`.
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
    when l.status <> 'completed' and exists (
      select 1
        from public.calendar_replacement_links k
        left join public.calendar_lessons r on r.id = k.replacement_lesson_id and r.owner_id = k.owner_id
       where k.owner_id = l.owner_id and k.original_lesson_id = l.id
         and (k.kind = 'moved' or (r.id is not null and r.status <> 'cancelled' and not (r.status = 'rescheduled' and r.recurrence_original_start is null)))
    ) then false
    else true
  end
$$;
