-- ============================================================================
-- VISTA PREVIA (SOLO LECTURA — SELECT únicamente) de la reparación
-- supabase/repairs/20261004_split_predecessor_end_date_repair.sql
-- ============================================================================
-- Qué busca: series ORIGINALES de un split "esta y las siguientes" que quedaron `active` con `end_date` vacío (o no anterior a
-- la fecha efectiva de su sucesora) por el defecto de contrato original_patch.endDate/end_date. Ejecutar con:
--   supabase db query --linked --file supabase/repairs/20261004_split_predecessor_end_date_preview.sql
-- Esperado al 2026-10-04: EXACTAMENTE una fila (R1 = ea060182-6ea0-4ecf-8362-6c2ddf526efd), end_date NULL -> 2026-10-11.
-- Cualquier fila con `veredicto` distinto de 'REPARABLE' (por ejemplo start_date >= effective_from) ABORTA la reparación.
-- ============================================================================
with candidatos as (
  select
    p.id,
    p.status,
    p.start_date,
    p.end_date,
    s.id as sucesora_id,
    s.effective_from_date,
    (s.effective_from_date - 1) as end_date_propuesta,
    case when p.start_date < s.effective_from_date then 'REPARABLE' else 'ABORTAR: start_date >= effective_from' end as veredicto
  from public.recurrence_rules p
  join public.recurrence_rules s
    on s.supersedes_recurrence_id = p.id and p.superseded_by_recurrence_id = s.id
  where s.effective_from_date is not null
    and p.status = 'active'
    and (p.end_date is null or p.end_date >= s.effective_from_date)
)
select
  c.id as regla_original,
  c.status,
  c.start_date,
  c.end_date as end_date_actual,
  c.end_date_propuesta,
  c.sucesora_id,
  c.effective_from_date,
  c.veredicto,
  (select count(*) from public.recurrence_rule_participants x where x.recurrence_rule_id = c.id) as participantes,
  (select count(*) from public.calendar_lessons l where l.recurrence_id = c.id) as clases_materializadas,
  (select count(*) from public.recurrence_exceptions e where e.recurrence_id = c.id) as excepciones,
  md5((to_jsonb(r))::text) as huella_fila_antes,
  md5((to_jsonb(r) - 'end_date')::text) as huella_sin_end_date,
  md5(((to_jsonb(r) || jsonb_build_object('end_date', c.end_date_propuesta::text)))::text) as huella_fila_esperada_despues
from candidatos c
join public.recurrence_rules r on r.id = c.id
order by c.id;
