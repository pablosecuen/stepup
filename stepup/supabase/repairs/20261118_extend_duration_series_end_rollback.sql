-- Reversión de `20261118200000_extend_duration_and_series_end.sql` (solo si hiciera falta; NO forma parte de las migraciones y no se ejecuta sola).
--
-- La migración es ADITIVA: agrega dos columnas con valor por defecto, dos disparadores, funciones nuevas y una capa sobre `create_calendar_lesson`. No modifica ni borra ningún dato existente.
-- Antes de revertir con datos reales ya cargados: la fecha de finalización de las series (`recurrence_rules.series_end_date`) y la marca de las clases canceladas por ese límite
-- (`calendar_lessons.cancelled_by_series_limit`) se pierden al borrar las columnas. Las clases que el límite había cancelado quedarían canceladas (no se pierde ninguna fila).
-- Si hay series con fecha de finalización, conviene primero quitarla desde la pantalla (así vuelven las clases que había quitado el límite) y recién después revertir.

begin;

-- 1) Capa de creación: se devuelve la función anterior a su nombre.
do $$
begin
  if to_regprocedure('public.create_calendar_lesson_before_slot_guard(jsonb)') is not null then
    drop function public.create_calendar_lesson(jsonb);
    alter function public.create_calendar_lesson_before_slot_guard(jsonb) rename to create_calendar_lesson;
    revoke all on function public.create_calendar_lesson(jsonb) from public, anon;
    grant execute on function public.create_calendar_lesson(jsonb) to authenticated;
  end if;
end $$;

-- 2) Funciones nuevas.
drop function if exists public.edit_recurrence_future_with_end(jsonb);
drop function if exists public.set_recurrence_series_end(jsonb);
drop function if exists public.recurrence_series_current_end(uuid);
drop function if exists public.extend_calendar_lesson_duration(jsonb);
drop function if exists public.calendar_agenda_stamp();
drop function if exists public.calendar_lesson_occupies_slot(public.calendar_lessons);

-- 3) Disparadores y sus funciones.
drop trigger if exists clear_series_limit_flag on public.calendar_lessons;
drop function if exists public.clear_series_limit_flag();
drop trigger if exists inherit_series_end_date on public.recurrence_rules;
drop function if exists public.inherit_series_end_date();

-- 4) Columnas (ver la advertencia de arriba).
alter table public.calendar_lessons drop column if exists cancelled_by_series_limit;
alter table public.recurrence_rules drop column if exists series_end_date;

commit;
