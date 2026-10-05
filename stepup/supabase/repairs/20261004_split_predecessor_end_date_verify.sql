-- VERIFICACIÓN POSTERIOR (SOLO LECTURA) de la reparación 20261004_split_predecessor_end_date_repair.sql
-- Esperado: R1 con end_date = 2026-10-11, status = active, updated_at = 2026-09-21 02:04:21.325665+00 (sin cambios),
-- huella_fila = e0943dfc99a046dd396689404a5a7a72, huella_sin_end_date = 4e9ba00933c46804040ab356ea051171, y cero candidatos.
select
  r.id, r.status, r.start_date, r.end_date, r.updated_at,
  md5((to_jsonb(r))::text) as huella_fila,
  md5((to_jsonb(r) - 'end_date')::text) as huella_sin_end_date,
  (select count(*) from public.recurrence_rule_participants x where x.recurrence_rule_id = r.id) as participantes,
  (select count(*) from public.calendar_lessons l where l.recurrence_id = r.id) as clases_materializadas,
  (select count(*) from public.recurrence_exceptions e where e.recurrence_id = r.id) as excepciones,
  (select tgenabled from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.recurrence_rules'::regclass) as trigger_set_updated_at,
  (select count(*) from public.recurrence_rules p join public.recurrence_rules s on s.supersedes_recurrence_id = p.id and p.superseded_by_recurrence_id = s.id
    where s.effective_from_date is not null and p.status = 'active' and (p.end_date is null or p.end_date >= s.effective_from_date)) as candidatos_restantes
from public.recurrence_rules r
where r.id = 'ea060182-6ea0-4ecf-8362-6c2ddf526efd';
