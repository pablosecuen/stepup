-- ============================================================================
-- REPARACIÓN DE DATOS (NO es una migración; NO se aplica sola con `supabase db push`)
-- split_recurrence_this_and_future dejó la serie original R1 activa y sin fin (defecto original_patch.endDate/end_date).
-- ============================================================================
-- Qué hace: cambia ÚNICAMENTE `recurrence_rules.end_date` de la serie R1 de NULL a 2026-10-11 (el día anterior a
-- `effective_from_date` de su sucesora, 2026-10-12). NO cambia `status`, `updated_at`, participantes, clases materializadas ni
-- excepciones. Atómica (un solo bloque DO: si algo falla, no queda nada a medias), idempotente y con guardas:
--   * ABORTA con excepción si algún candidato tiene start_date >= effective_from (nunca lo marca `ended` solo).
--   * ABORTA si aparece cualquier candidato distinto de R1 (la vista previa debe encontrar EXACTAMENTE R1).
--   * ABORTA si la fila de R1 ya no coincide con la huella de la vista previa (alguien la tocó desde entonces).
--   * Si R1 ya tiene end_date = 2026-10-11 (o no hay candidatos): no hace nada.
-- Antes de ejecutarla: correr la vista previa (supabase/repairs/20261004_split_predecessor_end_date_preview.sql) y conservar
-- el snapshot (supabase/repairs/snapshots/20261004_R1_before.json). `updated_at` se preserva desactivando SÓLO el trigger
-- set_updated_at dentro de la misma transacción y reactivándolo antes de terminar.
-- Orden: aplicar DESPUÉS de la migración 20261004120000 (así un cliente viejo ya no puede volver a producir el defecto).
-- Reversión: update public.recurrence_rules set end_date = null where id = 'ea060182-6ea0-4ecf-8362-6c2ddf526efd' (con el
-- mismo desactivado del trigger si se quiere conservar updated_at).
-- ============================================================================
do $repair$
declare
  c_rule_id constant uuid := 'ea060182-6ea0-4ecf-8362-6c2ddf526efd';
  c_end_date constant date := date '2026-10-11';
  c_fp_before constant text := '81c38948329ed3b788a120fff737759c';
  c_fp_without_end constant text := '4e9ba00933c46804040ab356ea051171';
  c_fp_after constant text := 'e0943dfc99a046dd396689404a5a7a72';
  v_found uuid[];
  v_unrepairable uuid[];
  v_unexpected uuid[];
  v_fp text;
  v_fp_without_end text;
  v_participants_before text;
  v_participants_after text;
  v_lessons_before int;
  v_lessons_after int;
  v_exceptions_before int;
  v_exceptions_after int;
  v_rows int;
  v_trigger_state "char";
begin
  select array_agg(p.id order by p.id) into v_found
  from public.recurrence_rules p
  join public.recurrence_rules s on s.supersedes_recurrence_id = p.id and p.superseded_by_recurrence_id = s.id
  where s.effective_from_date is not null and p.status = 'active'
    and (p.end_date is null or p.end_date >= s.effective_from_date);

  select array_agg(p.id order by p.id) into v_unrepairable
  from public.recurrence_rules p
  join public.recurrence_rules s on s.supersedes_recurrence_id = p.id and p.superseded_by_recurrence_id = s.id
  where s.effective_from_date is not null and p.status = 'active'
    and (p.end_date is null or p.end_date >= s.effective_from_date)
    and p.start_date >= s.effective_from_date;
  if v_unrepairable is not null then
    raise exception 'ABORTA: hay series con start_date >= effective_from (%). No se marcan "ended" automáticamente; requieren decisión manual.', v_unrepairable;
  end if;

  if v_found is null then
    raise notice 'Sin cambios: no hay series originales activas con fin vacío o no anterior a la fecha efectiva (reparación ya aplicada o innecesaria).';
    return;
  end if;

  select array_agg(x order by x) into v_unexpected from unnest(v_found) as x where x <> c_rule_id;
  if v_unexpected is not null then
    raise exception 'ABORTA: aparecieron casos inesperados además de R1 (%). La vista previa debía encontrar exactamente R1.', v_unexpected;
  end if;

  select md5((to_jsonb(r))::text), md5((to_jsonb(r) - 'end_date')::text) into v_fp, v_fp_without_end
  from public.recurrence_rules r where r.id = c_rule_id;
  if v_fp is distinct from c_fp_before or v_fp_without_end is distinct from c_fp_without_end then
    raise exception 'ABORTA: la fila de R1 cambió desde la vista previa (huella %, esperada %).', v_fp, c_fp_before;
  end if;
  if not exists (
    select 1 from public.recurrence_rules p join public.recurrence_rules s on s.id = p.superseded_by_recurrence_id
    where p.id = c_rule_id and s.effective_from_date - 1 = c_end_date
  ) then
    raise exception 'ABORTA: el día anterior a la fecha efectiva de la sucesora no coincide con %.', c_end_date;
  end if;

  select coalesce(string_agg(student_id::text, ',' order by student_id), '') into v_participants_before
  from public.recurrence_rule_participants where recurrence_rule_id = c_rule_id;
  select count(*) into v_lessons_before from public.calendar_lessons where recurrence_id = c_rule_id;
  select count(*) into v_exceptions_before from public.recurrence_exceptions where recurrence_id = c_rule_id;

  -- updated_at se preserva: sólo ESTE trigger se desactiva, dentro de esta misma transacción.
  alter table public.recurrence_rules disable trigger set_updated_at;
  update public.recurrence_rules set end_date = c_end_date where id = c_rule_id and end_date is null;
  get diagnostics v_rows = row_count;
  alter table public.recurrence_rules enable trigger set_updated_at;
  if v_rows <> 1 then
    raise exception 'ABORTA: se esperaba actualizar exactamente 1 fila y se actualizaron %.', v_rows;
  end if;

  select tgenabled into v_trigger_state from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.recurrence_rules'::regclass;
  if v_trigger_state is distinct from 'O'::"char" then
    raise exception 'ABORTA: el trigger set_updated_at no quedó activo.';
  end if;

  select md5((to_jsonb(r))::text), md5((to_jsonb(r) - 'end_date')::text) into v_fp, v_fp_without_end
  from public.recurrence_rules r where r.id = c_rule_id;
  select coalesce(string_agg(student_id::text, ',' order by student_id), '') into v_participants_after
  from public.recurrence_rule_participants where recurrence_rule_id = c_rule_id;
  select count(*) into v_lessons_after from public.calendar_lessons where recurrence_id = c_rule_id;
  select count(*) into v_exceptions_after from public.recurrence_exceptions where recurrence_id = c_rule_id;

  if v_fp_without_end is distinct from c_fp_without_end then
    raise exception 'ABORTA: cambió algo además de end_date (huella sin end_date %).', v_fp_without_end;
  end if;
  if v_fp is distinct from c_fp_after then
    raise exception 'ABORTA: la huella posterior (%) no coincide con la esperada (%).', v_fp, c_fp_after;
  end if;
  if v_participants_after <> v_participants_before or v_lessons_after <> v_lessons_before or v_exceptions_after <> v_exceptions_before then
    raise exception 'ABORTA: cambiaron participantes u ocurrencias.';
  end if;

  raise notice 'OK: R1 end_date NULL -> %; huella antes %, después %; participantes, clases materializadas (%) y excepciones (%) intactos.', c_end_date, c_fp_before, v_fp, v_lessons_after, v_exceptions_after;
end
$repair$;
