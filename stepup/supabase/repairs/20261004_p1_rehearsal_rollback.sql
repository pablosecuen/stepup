begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
create temporary table __tap_capture__ (ord serial, line text);
grant insert, select on __tap_capture__ to authenticated, anon;
grant usage on sequence __tap_capture___ord_seq to authenticated, anon;
create temporary table __fp__ (label text primary key, val text);
insert into __tap_capture__(line) values ('== ENSAYO P1: transacción descartable, termina en ROLLBACK ==');
-- ===== A. huellas ANTES (estado real de la base) =====

insert into __fp__(label, val) values
 ('antes.reglas_sin_R1', (select coalesce(md5(string_agg(md5(to_jsonb(r)::text), ',' order by r.id)), '') from public.recurrence_rules r where r.id <> 'ea060182-6ea0-4ecf-8362-6c2ddf526efd' and r.owner_id is distinct from 'f5000000-0000-0000-0000-000000000001'::uuid)),
 ('antes.R1', (select md5(to_jsonb(r)::text) from public.recurrence_rules r where r.id = 'ea060182-6ea0-4ecf-8362-6c2ddf526efd')),
 ('antes.R1_sin_end_date', (select md5((to_jsonb(r) - 'end_date')::text) from public.recurrence_rules r where r.id = 'ea060182-6ea0-4ecf-8362-6c2ddf526efd')),
 ('antes.R1_end_date', (select coalesce(end_date::text, 'NULL') from public.recurrence_rules where id = 'ea060182-6ea0-4ecf-8362-6c2ddf526efd')),
 ('antes.R1_status', (select status from public.recurrence_rules where id = 'ea060182-6ea0-4ecf-8362-6c2ddf526efd')),
 ('antes.R1_updated_at', (select updated_at::text from public.recurrence_rules where id = 'ea060182-6ea0-4ecf-8362-6c2ddf526efd')),
 ('antes.participantes', (select coalesce(md5(string_agg(md5(to_jsonb(p)::text), ',' order by md5(to_jsonb(p)::text))), '') from public.recurrence_rule_participants p where p.owner_id is distinct from 'f5000000-0000-0000-0000-000000000001'::uuid)),
 ('antes.clases', (select coalesce(md5(string_agg(md5(to_jsonb(l)::text), ',' order by md5(to_jsonb(l)::text))), '') from public.calendar_lessons l where l.owner_id is distinct from 'f5000000-0000-0000-0000-000000000001'::uuid)),
 ('antes.clase_participantes', (select coalesce(md5(string_agg(md5(to_jsonb(p)::text), ',' order by md5(to_jsonb(p)::text))), '') from public.calendar_lesson_participants p where p.owner_id is distinct from 'f5000000-0000-0000-0000-000000000001'::uuid)),
 ('antes.excepciones', (select coalesce(md5(string_agg(md5(to_jsonb(e)::text), ',' order by md5(to_jsonb(e)::text))), '') from public.recurrence_exceptions e where e.owner_id is distinct from 'f5000000-0000-0000-0000-000000000001'::uuid)),
 ('antes.alumnos', (select coalesce(md5(string_agg(md5(to_jsonb(s)::text), ',' order by md5(to_jsonb(s)::text))), '') from public.students s where s.owner_id is distinct from 'f5000000-0000-0000-0000-000000000001'::uuid));
insert into __tap_capture__(line) values ('A. R1 antes: end_date=' || (select val from __fp__ where label='antes.R1_end_date') || ' status=' || (select val from __fp__ where label='antes.R1_status') || ' huella=' || (select val from __fp__ where label='antes.R1'));
-- ===== B. defecto reproducido con la función VIGENTE (cliente que manda endDate) =====

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('f5000000-0000-0000-0000-000000000001', 'qa-ensayo-p1@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated');
insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values
  ('f5100000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', 'F5 Alumno 1', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);
insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status) values
  ('f5200000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', 'f5100000-0000-0000-0000-000000000001', 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-11-02', 'active');
insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id) values
  ('f5000000-0000-0000-0000-000000000001', 'f5200000-0000-0000-0000-000000000001', 'f5100000-0000-0000-0000-000000000001');


do $b$
declare v_end date; v_msg text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub": "f5000000-0000-0000-0000-000000000001", "role": "authenticated"}', true);
  begin
    perform public.split_recurrence_this_and_future(jsonb_build_object(
      'original_recurrence_id', 'f5200000-0000-0000-0000-000000000001', 'effective_date', '2026-11-16',
      'original_patch', jsonb_build_object('status', 'active', 'endDate', '2026-11-15'),
      'successor_id', 'f5300000-0000-0000-0000-000000000001', 'successor_start_date', '2026-11-16', 'successor_end_date', null,
      'rule_type', 'weekly', 'cycle_length_weeks', 1,
      'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
      'participant_ids', jsonb_build_array('f5100000-0000-0000-0000-000000000001'),
      'primary_student_id', 'f5100000-0000-0000-0000-000000000001', 'excluded_occurrence_keys', '[]'::jsonb));
    v_msg := 'la función vigente aceptó el payload';
  exception when others then
    v_msg := 'la función vigente falló: ' || sqlerrm;
  end;
  reset role;
  select end_date into v_end from public.recurrence_rules where id = 'f5200000-0000-0000-0000-000000000001';
  insert into __tap_capture__(line) values ('B. ANTES de la migración, cliente con endDate: ' || v_msg || '; end_date de la original = ' || coalesce(v_end::text, 'NULL  <-- defecto reproducido'));
end
$b$;
update public.recurrence_rules set end_date = date '2026-11-15' where id = 'f5200000-0000-0000-0000-000000000001';
-- ===== C. migración pendiente (aplicada SÓLO dentro de esta transacción descartable) =====
-- ============================================================================
-- split_recurrence_this_and_future: contrato `original_patch.end_date` (aditiva, compatible)
-- ============================================================================
-- Hallazgo (2026-10-04, auditoría "Series vs. Calendario"): el cliente web enviaba
--   original_patch: { status, endDate }          (camelCase — el plan de dominio de `planRecurrenceSplit`)
-- mientras que la función (todas sus versiones, desde 20260920130000) lee
--   original_patch->>'end_date'                  (snake_case)
-- así que la fecha de fin de la serie ORIGINAL llegaba siempre como NULL: la original quedaba `active` y sin fin, y seguía
-- generando ocurrencias en paralelo a la sucesora después de `effective_from_date` (la semana del 12/10/2026 mostraba el
-- lunes viejo Y el martes nuevo). Ver docs/CALENDAR_RPC_PAYLOAD_CONTRACT.md.
--
-- Esta migración NO edita ninguna migración ya aplicada: reemplaza la función con `create or replace` (mismo nombre, misma
-- firma, mismo tipo de retorno, `security invoker`) y cambia SÓLO el manejo de `original_patch`:
--   1. `end_date` es la clave canónica.
--   2. `endDate` se acepta TEMPORALMENTE (clientes web anteriores al arreglo que todavía estén abiertos o en caché). Si
--      llegan las dos, gana `end_date`. Retirar este respaldo en una migración futura, cuando ya no haya clientes viejos.
--   3. Un split de una regla que queda `active` EXIGE poder determinar su fecha de fin: si no llega (ni `end_date` ni
--      `endDate`) se rechaza con 22023 y NO se escribe nada — antes se guardaba NULL en silencio.
--   4. El fin debe ser ANTERIOR a `effective_from` (`effective_date`) y no anterior al inicio de la serie original.
--   5. `status` debe ser 'active' o 'ended' (para 'ended' la fecha de fin es opcional: es el caso "el cambio rige desde el
--      propio inicio de la serie", la original queda cerrada).
-- Todo lo demás (idempotencia por sucesora existente, validación de alumnos, exclusiones, limpieza de materializadas
-- futuras, alumno principal explícito) es idéntico a 20261001140000.
--
-- Regla de proyecto (anon): la función nueva/reemplazada vuelve a revocar EXECUTE a `public` y `anon` en la MISMA migración.
-- ============================================================================

create or replace function public.split_recurrence_this_and_future(p_payload jsonb)
returns public.recurrence_rules
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_original_id uuid := (p_payload->>'original_recurrence_id')::uuid;
  v_effective_date date := (p_payload->>'effective_date')::date;
  v_primary_student_id uuid := nullif(p_payload->>'primary_student_id', '')::uuid;
  v_existing_successor public.recurrence_rules;
  v_original public.recurrence_rules;
  v_successor public.recurrence_rules;
  v_original_patch jsonb := p_payload->'original_patch';
  v_patch_status text;
  v_patch_end_date date;
  v_participant_id text;
  v_excluded_key text;
  v_effective_instant timestamptz;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  select * into v_existing_successor
  from public.recurrence_rules
  where owner_id = v_owner and supersedes_recurrence_id = v_original_id and effective_from_date = v_effective_date
  limit 1;
  if found then
    return v_existing_successor;
  end if;

  select * into v_original from public.recurrence_rules where id = v_original_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Serie original no encontrada.' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from jsonb_array_elements_text(p_payload->'participant_ids') as sid
    where not exists (select 1 from public.students where id = sid::uuid and owner_id = v_owner)
  ) then
    raise exception 'Alguno de los alumnos no existe o no te pertenece.' using errcode = 'P0002';
  end if;

  if v_primary_student_id is null then
    raise exception 'Elegí quién es el alumno principal.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.students where id = v_primary_student_id and owner_id = v_owner) then
    raise exception 'Alumno no encontrado.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from jsonb_array_elements_text(p_payload->'participant_ids') as sid where sid::uuid = v_primary_student_id
  ) then
    raise exception 'El alumno principal debe estar entre los participantes seleccionados.' using errcode = '22023';
  end if;

  -- Contrato de `original_patch` (ver el encabezado). Se valida ANTES de escribir cualquier cosa.
  v_patch_status := v_original_patch->>'status';
  if v_patch_status is null or v_patch_status not in ('active', 'ended') then
    raise exception 'original_patch.status debe ser active o ended.' using errcode = '22023';
  end if;
  -- `end_date` canónica; `endDate` sólo como compatibilidad temporal con clientes anteriores.
  v_patch_end_date := coalesce(
    nullif(v_original_patch->>'end_date', ''),
    nullif(v_original_patch->>'endDate', '')
  )::date;
  if v_patch_status = 'active' then
    if v_patch_end_date is null then
      raise exception 'No se puede determinar la fecha de fin de la serie original (original_patch.end_date): se rechaza el cambio para no dejarla activa y sin fin.' using errcode = '22023';
    end if;
    if v_patch_end_date >= v_effective_date then
      raise exception 'La fecha de fin de la serie original debe ser anterior a la fecha efectiva del cambio.' using errcode = '22023';
    end if;
    if v_patch_end_date < v_original.start_date then
      raise exception 'La fecha de fin de la serie original no puede ser anterior a su inicio.' using errcode = '22023';
    end if;
  end if;

  v_effective_instant := (v_effective_date::text || ' 00:00:00')::timestamp at time zone v_original.timezone;

  update public.recurrence_rules
  set status = v_patch_status,
      end_date = v_patch_end_date
  where id = v_original_id and owner_id = v_owner;

  insert into public.recurrence_rules (
    id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone,
    start_date, end_date, status, supersedes_recurrence_id, effective_from_date,
    class_title, activity_kind, training_billing_agreement_id
  ) values (
    (p_payload->>'successor_id')::uuid,
    v_owner,
    v_primary_student_id,
    p_payload->>'rule_type',
    (p_payload->>'cycle_length_weeks')::smallint,
    p_payload->'weeks',
    coalesce(p_payload->>'modality', v_original.modality),
    v_original.timezone,
    (p_payload->>'successor_start_date')::date,
    nullif(p_payload->>'successor_end_date', '')::date,
    'active',
    v_original_id,
    v_effective_date,
    coalesce(p_payload->>'class_title', v_original.class_title),
    coalesce(p_payload->>'activity_kind', v_original.activity_kind),
    v_original.training_billing_agreement_id
  )
  returning * into v_successor;

  update public.recurrence_rules set superseded_by_recurrence_id = v_successor.id where id = v_original_id and owner_id = v_owner;

  for v_participant_id in select * from jsonb_array_elements_text(p_payload->'participant_ids')
  loop
    insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id)
    values (v_owner, v_successor.id, v_participant_id::uuid)
    on conflict (recurrence_rule_id, student_id) do nothing;
  end loop;

  for v_excluded_key in select * from jsonb_array_elements_text(p_payload->'excluded_occurrence_keys')
  loop
    insert into public.recurrence_exceptions (owner_id, recurrence_id, occurrence_key, exception_type)
    values (v_owner, v_successor.id, v_excluded_key, 'excluded')
    on conflict (recurrence_id, occurrence_key) do nothing;
  end loop;

  delete from public.calendar_lessons
  where owner_id = v_owner
    and recurrence_id = v_original_id
    and status not in ('completed', 'cancelled')
    and coalesce(recurrence_original_start, start_at) >= v_effective_instant;

  return v_successor;
end;
$$;

revoke all on function public.split_recurrence_this_and_future(jsonb) from public;
grant execute on function public.split_recurrence_this_and_future(jsonb) to authenticated;
revoke execute on function public.split_recurrence_this_and_future(jsonb) from anon;

comment on function public.split_recurrence_this_and_future(jsonb) is
  'Cambio de patrón "esta y las siguientes". original_patch = { status: active|ended, end_date: YYYY-MM-DD } (snake_case; endDate se acepta temporalmente por compatibilidad). Una original que queda active exige end_date, anterior a effective_date y no anterior a su inicio; nunca se deja activa y sin fin.';

insert into __tap_capture__(line) values ('C. migración 20261004120000 aplicada en la transacción');
-- ===== D. vista previa exacta (la misma consulta de solo lectura) =====
insert into __tap_capture__(line) select 'D. PREVIEW: ' || row_to_json(t)::text from (
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
order by c.id
) t;
insert into __tap_capture__(line) values ('D. filas de la vista previa: ' || (select count(*) from (-- ============================================================================
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
order by c.id) q));
-- ===== E. casos de aborto (cada uno se deshace solo) =====

do $e$
declare v_msg text; v_owner uuid; v_student uuid;
begin
  select owner_id into v_owner from public.recurrence_rules where id = 'ea060182-6ea0-4ecf-8362-6c2ddf526efd';
  select id into v_student from public.students where owner_id = v_owner order by id limit 1;
  begin
    
    insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status)
    values ('f6200000-0000-0000-0000-000000000001', v_owner, v_student, 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-12-14', 'active');
    insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status, supersedes_recurrence_id, effective_from_date)
    values ('f6200000-0000-0000-0000-000000000002', v_owner, v_student, 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-12-14', 'active', 'f6200000-0000-0000-0000-000000000001', '2026-12-14');
    update public.recurrence_rules set superseded_by_recurrence_id = 'f6200000-0000-0000-0000-000000000002' where id = 'f6200000-0000-0000-0000-000000000001';
    execute $rr$
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

$rr$;
    v_msg := 'NO ABORTÓ (la reparación terminó sin error)';
    raise exception 'deshacer-preparación';
  exception when others then
    if v_msg is null then v_msg := sqlerrm; end if;
  end;
  insert into __tap_capture__(line) values ('E. caso start_date >= effective_from (debe ABORTAR, nunca marcarlo ended): ' || v_msg);
end
$e$;

do $e$
declare v_msg text; v_owner uuid; v_student uuid;
begin
  select owner_id into v_owner from public.recurrence_rules where id = 'ea060182-6ea0-4ecf-8362-6c2ddf526efd';
  select id into v_student from public.students where owner_id = v_owner order by id limit 1;
  begin
    
    insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status)
    values ('f6200000-0000-0000-0000-000000000003', v_owner, v_student, 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-11-02', 'active');
    insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status, supersedes_recurrence_id, effective_from_date)
    values ('f6200000-0000-0000-0000-000000000004', v_owner, v_student, 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-11-16', 'active', 'f6200000-0000-0000-0000-000000000003', '2026-11-16');
    update public.recurrence_rules set superseded_by_recurrence_id = 'f6200000-0000-0000-0000-000000000004' where id = 'f6200000-0000-0000-0000-000000000003';
    execute $rr$
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

$rr$;
    v_msg := 'NO ABORTÓ (la reparación terminó sin error)';
    raise exception 'deshacer-preparación';
  exception when others then
    if v_msg is null then v_msg := sqlerrm; end if;
  end;
  insert into __tap_capture__(line) values ('E. caso inesperado además de R1 (debe ABORTAR): ' || v_msg);
end
$e$;

do $e$
declare v_msg text; v_owner uuid; v_student uuid;
begin
  select owner_id into v_owner from public.recurrence_rules where id = 'ea060182-6ea0-4ecf-8362-6c2ddf526efd';
  select id into v_student from public.students where owner_id = v_owner order by id limit 1;
  begin
    update public.recurrence_rules set class_title = 'ensayo-deriva' where id = 'ea060182-6ea0-4ecf-8362-6c2ddf526efd';
    execute $rr$
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

$rr$;
    v_msg := 'NO ABORTÓ (la reparación terminó sin error)';
    raise exception 'deshacer-preparación';
  exception when others then
    if v_msg is null then v_msg := sqlerrm; end if;
  end;
  insert into __tap_capture__(line) values ('E. R1 modificada desde la vista previa (huella distinta, debe ABORTAR): ' || v_msg);
end
$e$;

do $e2$
declare v_a text; v_b text;
begin
  select val into v_a from __fp__ where label = 'antes.R1';
  select md5(to_jsonb(r)::text) into v_b from public.recurrence_rules r where r.id = 'ea060182-6ea0-4ecf-8362-6c2ddf526efd';
  insert into __tap_capture__(line) values ('E. tras los 3 abortos R1 sigue idéntica: ' || (v_a = v_b)::text);
end
$e2$;
-- ===== F. reparación real sobre R1 (dentro de la transacción) =====

do $f$
declare v_msg text;
begin
  begin
    execute $rr$
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

$rr$;
    v_msg := 'terminó sin error';
  exception when others then
    v_msg := 'ERROR: ' || sqlerrm;
  end;
  insert into __tap_capture__(line) values ('F. primera ejecución de la reparación: ' || v_msg);
end
$f$;

insert into __fp__(label, val) values
 ('despues.reglas_sin_R1', (select coalesce(md5(string_agg(md5(to_jsonb(r)::text), ',' order by r.id)), '') from public.recurrence_rules r where r.id <> 'ea060182-6ea0-4ecf-8362-6c2ddf526efd' and r.owner_id is distinct from 'f5000000-0000-0000-0000-000000000001'::uuid)),
 ('despues.R1', (select md5(to_jsonb(r)::text) from public.recurrence_rules r where r.id = 'ea060182-6ea0-4ecf-8362-6c2ddf526efd')),
 ('despues.R1_sin_end_date', (select md5((to_jsonb(r) - 'end_date')::text) from public.recurrence_rules r where r.id = 'ea060182-6ea0-4ecf-8362-6c2ddf526efd')),
 ('despues.R1_end_date', (select coalesce(end_date::text, 'NULL') from public.recurrence_rules where id = 'ea060182-6ea0-4ecf-8362-6c2ddf526efd')),
 ('despues.R1_status', (select status from public.recurrence_rules where id = 'ea060182-6ea0-4ecf-8362-6c2ddf526efd')),
 ('despues.R1_updated_at', (select updated_at::text from public.recurrence_rules where id = 'ea060182-6ea0-4ecf-8362-6c2ddf526efd')),
 ('despues.participantes', (select coalesce(md5(string_agg(md5(to_jsonb(p)::text), ',' order by md5(to_jsonb(p)::text))), '') from public.recurrence_rule_participants p where p.owner_id is distinct from 'f5000000-0000-0000-0000-000000000001'::uuid)),
 ('despues.clases', (select coalesce(md5(string_agg(md5(to_jsonb(l)::text), ',' order by md5(to_jsonb(l)::text))), '') from public.calendar_lessons l where l.owner_id is distinct from 'f5000000-0000-0000-0000-000000000001'::uuid)),
 ('despues.clase_participantes', (select coalesce(md5(string_agg(md5(to_jsonb(p)::text), ',' order by md5(to_jsonb(p)::text))), '') from public.calendar_lesson_participants p where p.owner_id is distinct from 'f5000000-0000-0000-0000-000000000001'::uuid)),
 ('despues.excepciones', (select coalesce(md5(string_agg(md5(to_jsonb(e)::text), ',' order by md5(to_jsonb(e)::text))), '') from public.recurrence_exceptions e where e.owner_id is distinct from 'f5000000-0000-0000-0000-000000000001'::uuid)),
 ('despues.alumnos', (select coalesce(md5(string_agg(md5(to_jsonb(s)::text), ',' order by md5(to_jsonb(s)::text))), '') from public.students s where s.owner_id is distinct from 'f5000000-0000-0000-0000-000000000001'::uuid));
insert into __tap_capture__(line) select 'F. VERIFY: ' || row_to_json(t)::text from (
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
where r.id = 'ea060182-6ea0-4ecf-8362-6c2ddf526efd'
) t;
insert into __tap_capture__(line) values ('F. las demás reglas (todas menos R1): ' || case when (select val from __fp__ where label='antes.reglas_sin_R1') = (select val from __fp__ where label='despues.reglas_sin_R1') then 'IGUAL' else 'DIFIERE' end || '  (esperado: IGUAL)');
insert into __tap_capture__(line) values ('F. fila completa de R1: ' || case when (select val from __fp__ where label='antes.R1') = (select val from __fp__ where label='despues.R1') then 'IGUAL' else 'DIFIERE' end || '  (esperado: DIFIERE solo por end_date)');
insert into __tap_capture__(line) values ('F. R1 sin la columna end_date: ' || case when (select val from __fp__ where label='antes.R1_sin_end_date') = (select val from __fp__ where label='despues.R1_sin_end_date') then 'IGUAL' else 'DIFIERE' end || '  (esperado: IGUAL)');
insert into __tap_capture__(line) values ('F. estado de R1: ' || case when (select val from __fp__ where label='antes.R1_status') = (select val from __fp__ where label='despues.R1_status') then 'IGUAL' else 'DIFIERE' end || '  (esperado: IGUAL)');
insert into __tap_capture__(line) values ('F. updated_at de R1: ' || case when (select val from __fp__ where label='antes.R1_updated_at') = (select val from __fp__ where label='despues.R1_updated_at') then 'IGUAL' else 'DIFIERE' end || '  (esperado: IGUAL)');
insert into __tap_capture__(line) values ('F. recurrence_rule_participants (toda la tabla): ' || case when (select val from __fp__ where label='antes.participantes') = (select val from __fp__ where label='despues.participantes') then 'IGUAL' else 'DIFIERE' end || '  (esperado: IGUAL)');
insert into __tap_capture__(line) values ('F. calendar_lessons (toda la tabla): ' || case when (select val from __fp__ where label='antes.clases') = (select val from __fp__ where label='despues.clases') then 'IGUAL' else 'DIFIERE' end || '  (esperado: IGUAL)');
insert into __tap_capture__(line) values ('F. calendar_lesson_participants (toda la tabla): ' || case when (select val from __fp__ where label='antes.clase_participantes') = (select val from __fp__ where label='despues.clase_participantes') then 'IGUAL' else 'DIFIERE' end || '  (esperado: IGUAL)');
insert into __tap_capture__(line) values ('F. recurrence_exceptions (toda la tabla): ' || case when (select val from __fp__ where label='antes.excepciones') = (select val from __fp__ where label='despues.excepciones') then 'IGUAL' else 'DIFIERE' end || '  (esperado: IGUAL)');
insert into __tap_capture__(line) values ('F. students (toda la tabla): ' || case when (select val from __fp__ where label='antes.alumnos') = (select val from __fp__ where label='despues.alumnos') then 'IGUAL' else 'DIFIERE' end || '  (esperado: IGUAL)');
insert into __tap_capture__(line) values ('F. R1 end_date: ' || (select val from __fp__ where label='antes.R1_end_date') || ' -> ' || (select val from __fp__ where label='despues.R1_end_date') || '; huella ' || (select val from __fp__ where label='antes.R1') || ' -> ' || (select val from __fp__ where label='despues.R1'));
-- ===== G. idempotencia: segunda ejecución =====

do $g$
declare v_msg text; v_a text; v_b text;
begin
  select md5(to_jsonb(r)::text) into v_a from public.recurrence_rules r where r.id = 'ea060182-6ea0-4ecf-8362-6c2ddf526efd';
  begin
    execute $rr$
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

$rr$;
    v_msg := 'terminó sin error';
  exception when others then
    v_msg := 'ERROR: ' || sqlerrm;
  end;
  select md5(to_jsonb(r)::text) into v_b from public.recurrence_rules r where r.id = 'ea060182-6ea0-4ecf-8362-6c2ddf526efd';
  insert into __tap_capture__(line) values ('G. segunda ejecución de la reparación: ' || v_msg || '; R1 sin cambios respecto de la primera ejecución: ' || (v_a = v_b)::text);
end
$g$;
-- ===== H. pruebas pgTAP del split =====
insert into __tap_capture__(line) select plan(22);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('f4000000-0000-0000-0000-000000000001', 'qa-split-a@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated');

set local role postgres;
insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values
  ('f4100000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000001', 'F4 Alumno 1', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('f4100000-0000-0000-0000-000000000002', 'f4000000-0000-0000-0000-000000000001', 'F4 Alumno 2', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);

-- Series originales (lunes 18:00, start_date SIEMPRE lunes): R1 canónica, R2 legado, R3 ambas claves, R4 rechazos, R5 cierre.
insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status) values
  ('f4200000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000001', 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-11-02', 'active'),
  ('f4200000-0000-0000-0000-000000000002', 'f4000000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000001', 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-11-02', 'active'),
  ('f4200000-0000-0000-0000-000000000003', 'f4000000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000001', 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-11-02', 'active'),
  ('f4200000-0000-0000-0000-000000000004', 'f4000000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000001', 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-11-02', 'active'),
  ('f4200000-0000-0000-0000-000000000005', 'f4000000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000001', 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-11-30', 'active');
insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id)
select 'f4000000-0000-0000-0000-000000000001', r.id, 'f4100000-0000-0000-0000-000000000001'
from public.recurrence_rules r where r.owner_id = 'f4000000-0000-0000-0000-000000000001';

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f4000000-0000-0000-0000-000000000001", "role": "authenticated"}';

-- 1-5) Clave canónica `end_date`: la original queda activa y con fin = día anterior a la fecha efectiva.
insert into __tap_capture__(line) select lives_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'f4200000-0000-0000-0000-000000000001', 'effective_date', '2026-11-16',
       'original_patch', jsonb_build_object('status', 'active', 'end_date', '2026-11-15'),
       'successor_id', 'f4300000-0000-0000-0000-000000000001', 'successor_start_date', '2026-11-16', 'successor_end_date', null,
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000002'),
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001', 'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  'split con original_patch.end_date (canónica) funciona'
);
set local role postgres;
insert into __tap_capture__(line) select is((select end_date from public.recurrence_rules where id = 'f4200000-0000-0000-0000-000000000001')::text, '2026-11-15', 'la original queda con end_date = día anterior a effective_date');
insert into __tap_capture__(line) select is((select status from public.recurrence_rules where id = 'f4200000-0000-0000-0000-000000000001'), 'active', 'la original sigue active (hasta su fin)');
insert into __tap_capture__(line) select is((select effective_from_date from public.recurrence_rules where id = 'f4300000-0000-0000-0000-000000000001')::text, '2026-11-16', 'la sucesora rige desde effective_date');
insert into __tap_capture__(line) select is((select superseded_by_recurrence_id from public.recurrence_rules where id = 'f4200000-0000-0000-0000-000000000001')::text, 'f4300000-0000-0000-0000-000000000001', 'la original apunta a su sucesora');

-- 6-7) Compatibilidad temporal: un cliente anterior que manda `endDate` (camelCase) también cierra la original.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f4000000-0000-0000-0000-000000000001", "role": "authenticated"}';
insert into __tap_capture__(line) select lives_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'f4200000-0000-0000-0000-000000000002', 'effective_date', '2026-11-23',
       'original_patch', jsonb_build_object('status', 'active', 'endDate', '2026-11-22'),
       'successor_id', 'f4300000-0000-0000-0000-000000000002', 'successor_start_date', '2026-11-23', 'successor_end_date', null,
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001'),
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001', 'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  'split con original_patch.endDate (clave anterior, compatibilidad temporal) funciona'
);
set local role postgres;
insert into __tap_capture__(line) select is((select end_date from public.recurrence_rules where id = 'f4200000-0000-0000-0000-000000000002')::text, '2026-11-22', 'endDate legado: la original queda con su fin');

-- 8-9) Si llegan las dos claves y difieren, gana la canónica `end_date`.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f4000000-0000-0000-0000-000000000001", "role": "authenticated"}';
insert into __tap_capture__(line) select lives_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'f4200000-0000-0000-0000-000000000003', 'effective_date', '2026-11-23',
       'original_patch', jsonb_build_object('status', 'active', 'end_date', '2026-11-22', 'endDate', '2026-11-10'),
       'successor_id', 'f4300000-0000-0000-0000-000000000003', 'successor_start_date', '2026-11-23', 'successor_end_date', null,
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001'),
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001', 'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  'split con las dos claves funciona'
);
set local role postgres;
insert into __tap_capture__(line) select is((select end_date from public.recurrence_rules where id = 'f4200000-0000-0000-0000-000000000003')::text, '2026-11-22', 'con las dos claves gana end_date');

-- 10-12) Original que quedaría activa sin fecha de fin determinable: se rechaza y NO se escribe nada.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f4000000-0000-0000-0000-000000000001", "role": "authenticated"}';
insert into __tap_capture__(line) select throws_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'f4200000-0000-0000-0000-000000000004', 'effective_date', '2026-11-16',
       'original_patch', jsonb_build_object('status', 'active'),
       'successor_id', 'f4300000-0000-0000-0000-000000000004', 'successor_start_date', '2026-11-16', 'successor_end_date', null,
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001'),
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001', 'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  '22023', null,
  'original active sin end_date/endDate: se rechaza (22023)'
);
set local role postgres;
insert into __tap_capture__(line) select is((select end_date from public.recurrence_rules where id = 'f4200000-0000-0000-0000-000000000004'), null, 'rechazo: la original queda intacta (end_date sigue vacía)');
insert into __tap_capture__(line) select is((select count(*)::int from public.recurrence_rules where id = 'f4300000-0000-0000-0000-000000000004'), 0, 'rechazo: no se creó ninguna sucesora');

-- 13-15) Validaciones de fechas y estado.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f4000000-0000-0000-0000-000000000001", "role": "authenticated"}';
insert into __tap_capture__(line) select throws_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'f4200000-0000-0000-0000-000000000004', 'effective_date', '2026-11-16',
       'original_patch', jsonb_build_object('status', 'active', 'end_date', '2026-11-16'),
       'successor_id', 'f4300000-0000-0000-0000-000000000004', 'successor_start_date', '2026-11-16', 'successor_end_date', null,
       'rule_type', 'weekly', 'cycle_length_weeks', 1, 'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001'),
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001', 'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  '22023', null,
  'el fin igual a la fecha efectiva se rechaza (debe ser anterior)'
);
insert into __tap_capture__(line) select throws_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'f4200000-0000-0000-0000-000000000004', 'effective_date', '2026-11-16',
       'original_patch', jsonb_build_object('status', 'active', 'end_date', '2026-10-31'),
       'successor_id', 'f4300000-0000-0000-0000-000000000004', 'successor_start_date', '2026-11-16', 'successor_end_date', null,
       'rule_type', 'weekly', 'cycle_length_weeks', 1, 'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001'),
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001', 'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  '22023', null,
  'el fin anterior al inicio de la serie original se rechaza'
);
insert into __tap_capture__(line) select throws_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'f4200000-0000-0000-0000-000000000004', 'effective_date', '2026-11-16',
       'original_patch', jsonb_build_object('status', 'paused', 'end_date', '2026-11-15'),
       'successor_id', 'f4300000-0000-0000-0000-000000000004', 'successor_start_date', '2026-11-16', 'successor_end_date', null,
       'rule_type', 'weekly', 'cycle_length_weeks', 1, 'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001'),
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001', 'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  '22023', null,
  'un status distinto de active/ended se rechaza'
);

-- 16-17) status ended (el cambio rige desde el propio inicio de la serie): la fecha de fin es opcional.
insert into __tap_capture__(line) select lives_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'f4200000-0000-0000-0000-000000000005', 'effective_date', '2026-11-30',
       'original_patch', jsonb_build_object('status', 'ended', 'end_date', null),
       'successor_id', 'f4300000-0000-0000-0000-000000000005', 'successor_start_date', '2026-11-30', 'successor_end_date', null,
       'rule_type', 'weekly', 'cycle_length_weeks', 1, 'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001'),
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001', 'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  'status ended sin end_date: se acepta'
);
set local role postgres;
insert into __tap_capture__(line) select is((select status from public.recurrence_rules where id = 'f4200000-0000-0000-0000-000000000005'), 'ended', 'la original queda finalizada');

-- 18-19) Idempotencia: repetir el mismo split devuelve la sucesora existente, nunca crea otra.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f4000000-0000-0000-0000-000000000001", "role": "authenticated"}';
insert into __tap_capture__(line) select lives_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'f4200000-0000-0000-0000-000000000001', 'effective_date', '2026-11-16',
       'original_patch', jsonb_build_object('status', 'active', 'end_date', '2026-11-15'),
       'successor_id', 'f4300000-0000-0000-0000-0000000000ff', 'successor_start_date', '2026-11-16', 'successor_end_date', null,
       'rule_type', 'weekly', 'cycle_length_weeks', 1, 'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001'),
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001', 'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  'repetir el mismo split no falla'
);
set local role postgres;
insert into __tap_capture__(line) select is((select count(*)::int from public.recurrence_rules where supersedes_recurrence_id = 'f4200000-0000-0000-0000-000000000001'), 1, 'repetir el split no crea una segunda sucesora');

-- 20) Invariante anti-duplicación: ninguna original activa queda sin fin o con fin no anterior a la fecha efectiva de su sucesora.
insert into __tap_capture__(line) select is(
  (select count(*)::int
     from public.recurrence_rules p
     join public.recurrence_rules s on s.supersedes_recurrence_id = p.id and p.superseded_by_recurrence_id = s.id
    where p.owner_id = 'f4000000-0000-0000-0000-000000000001'
      and s.effective_from_date is not null and p.status = 'active'
      and (p.end_date is null or p.end_date >= s.effective_from_date)),
  0,
  'invariante: ninguna serie original activa sigue generando ocurrencias después de la fecha efectiva de su sucesora'
);

-- 21-22) Permisos (regla del proyecto): anon sin EXECUTE, authenticated con EXECUTE.
insert into __tap_capture__(line) select ok(not has_function_privilege('anon', 'public.split_recurrence_this_and_future(jsonb)', 'execute'), 'anon no puede ejecutar la RPC');
insert into __tap_capture__(line) select ok(has_function_privilege('authenticated', 'public.split_recurrence_this_and_future(jsonb)', 'execute'), 'authenticated sí puede ejecutarla');

insert into __tap_capture__(line) select * from finish();

set local role postgres;
select ord, line from __tap_capture__ order by ord;
rollback;