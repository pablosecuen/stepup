-- R6 — Importaciones grandes (1/4): límites explícitos por importación y utilidades compartidas. ADITIVA e idempotente: sólo crea funciones nuevas
-- (`_import_*`, internas, sin EXECUTE para la API); no modifica filas ni funciones existentes. Las funciones públicas (`preview_backup_import`,
-- `apply_backup_import`, `preview_undo_backup_import`, `apply_undo_backup_import`) se redefinen en las migraciones siguientes con la MISMA firma.
--
-- Por qué hay límites (medido en Postgres 17.6, ver docs/R6_IMPORTACIONES_GRANDES.md): la vista previa y la aplicación crecían de forma
-- cuadrática y, con ~5.000 filas, la aplicación superaba el `statement_timeout` de 8 s del rol `authenticated` (se cancelaba y revertía todo).
-- Los límites rechazan ANTES de procesar y con un mensaje que dice qué puede hacer la usuaria.

-- Fuente única de los límites en la base. La web repite estos mismos números en `lib/backup/limits.ts` (una prueba los compara).
create or replace function public._import_limits()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'max_payload_bytes', 20971520,       -- igual al límite real de `upload_cloud_backup` (app móvil)
    'max_rows_per_collection', 5000,
    'max_rows_total', 7500,              -- filas de las 17 colecciones que cuenta la validación
    'max_nested_rows', 7500,             -- filas ANIDADAS (integrantes, asistencias, evaluaciones, historial de niveles…)
    'max_work_units', 7500,              -- filas contadas + anidadas: la medida real de trabajo de una importación
    'max_field_overrides', 2000,
    'max_duplicate_decisions', 2000
  )
$$;

-- Longitud de un arreglo JSON (0 si falta, es null o no es un arreglo).
create or replace function public._import_len(p_value jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_value) = 'array' then jsonb_array_length(p_value) else 0 end
$$;

-- Colección del respaldo como arreglo (vacío si falta o es null). Se llama UNA vez por colección: cada `->` copia el subárbol.
create or replace function public._import_arr(p_doc jsonb, p_key text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(t.v) = 'array' then t.v else '[]'::jsonb end from (select p_doc -> p_key as v) t
$$;

-- Valida forma y tamaño del respaldo ANTES de procesarlo y devuelve los conteos. Rechaza con mensajes estables que la web traduce:
--   «El backup no tiene el formato esperado.»                    → formato inválido
--   «El backup tiene demasiados datos para importar de una vez.»  → supera el máximo de filas / trabajo
-- No lee ninguna tabla: sólo recorre el documento recibido (una pasada por colección).
create or replace function public._import_check_payload(p_payload jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_lim jsonb := public._import_limits();
  v_collections text[] := array['students','pedagogicalLessons','calendarLessons','recurrenceRules','recurrenceExceptions','paymentCharges','payments','paymentAllocations','paymentAdjustments','reportRecords','packagePurchases','packageCreditMovements','monthlyAmountCorrections','initialPaidSurchargeCorrections','firstMonthProrationDecisions','trainingBillingAgreements','customLevels'];
  v_key text;
  v_val jsonb;
  v_len integer;
  v_total integer := 0;
  v_nested integer := 0;
  v_bad integer;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'El backup no tiene el formato esperado.' using errcode = '22023';
  end if;

  foreach v_key in array v_collections loop
    v_val := p_payload -> v_key;
    if v_val is null or jsonb_typeof(v_val) = 'null' then continue; end if;
    if jsonb_typeof(v_val) <> 'array' then
      raise exception 'El backup no tiene el formato esperado.' using errcode = '22023';
    end if;
    v_len := jsonb_array_length(v_val);
    if v_len > (v_lim ->> 'max_rows_per_collection')::int then
      raise exception 'El backup tiene demasiados datos para importar de una vez.' using errcode = '22023';
    end if;
    v_total := v_total + v_len;
    if v_total > (v_lim ->> 'max_rows_total')::int then
      raise exception 'El backup tiene demasiados datos para importar de una vez.' using errcode = '22023';
    end if;
    -- Cada elemento debe ser un objeto con `id` de texto (menos las excepciones de series, que se identifican por serie + ocurrencia).
    if v_key = 'recurrenceExceptions' then
      select count(*) into v_bad from jsonb_array_elements(v_val) e where jsonb_typeof(e) is distinct from 'object';
    else
      select count(*) into v_bad from jsonb_array_elements(v_val) e
        where jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(e -> 'id') is distinct from 'string' or btrim(e ->> 'id') = '';
    end if;
    if v_bad > 0 then
      raise exception 'El backup no tiene el formato esperado.' using errcode = '22023';
    end if;
  end loop;

  -- Referencias obligatorias entre filas financieras: una asignación sin pago o sin cobro, un ajuste sin cobro o un movimiento sin paquete
  -- no se pueden relacionar con nada (antes terminaban en un error interno al analizar).
  select count(*) into v_bad from jsonb_array_elements(public._import_arr(p_payload, 'paymentAllocations')) e
    where jsonb_typeof(e -> 'paymentId') is distinct from 'string' or jsonb_typeof(e -> 'chargeId') is distinct from 'string';
  if v_bad > 0 then raise exception 'El backup no tiene el formato esperado.' using errcode = '22023'; end if;
  select count(*) into v_bad from jsonb_array_elements(public._import_arr(p_payload, 'paymentAdjustments')) e where jsonb_typeof(e -> 'chargeId') is distinct from 'string';
  if v_bad > 0 then raise exception 'El backup no tiene el formato esperado.' using errcode = '22023'; end if;
  select count(*) into v_bad from jsonb_array_elements(public._import_arr(p_payload, 'packageCreditMovements')) e where jsonb_typeof(e -> 'packageId') is distinct from 'string';
  if v_bad > 0 then raise exception 'El backup no tiene el formato esperado.' using errcode = '22023'; end if;

  -- Filas anidadas que la cuenta de arriba no ve (lo que realmente se escribe además de las filas principales).
  select coalesce(sum(public._import_len(e -> 'participants')), 0) into v_bad from jsonb_array_elements(public._import_arr(p_payload, 'calendarLessons')) e;
  v_nested := v_nested + v_bad;
  select coalesce(sum(public._import_len(e -> 'participantStudentIds')), 0) into v_bad from jsonb_array_elements(public._import_arr(p_payload, 'recurrenceRules')) e;
  v_nested := v_nested + v_bad;
  select coalesce(sum(public._import_len(e -> 'roster') + public._import_len(e -> 'attendance') + public._import_len(e -> 'evaluations') + public._import_len(e -> 'homeworkReviews')), 0)
    into v_bad from jsonb_array_elements(public._import_arr(p_payload, 'pedagogicalLessons')) e;
  v_nested := v_nested + v_bad;
  if jsonb_typeof(p_payload -> 'profiles') = 'object' then
    select coalesce(sum(public._import_len(p.value -> 'levelHistory')), 0) into v_bad from jsonb_each(p_payload -> 'profiles') p where jsonb_typeof(p.value) = 'object';
    v_nested := v_nested + v_bad;
  end if;

  if v_nested > (v_lim ->> 'max_nested_rows')::int or v_total + v_nested > (v_lim ->> 'max_work_units')::int then
    raise exception 'El backup tiene demasiados datos para importar de una vez.' using errcode = '22023';
  end if;

  return jsonb_build_object('counted_rows', v_total, 'nested_rows', v_nested, 'work_units', v_total + v_nested);
end;
$$;

-- Ids disponibles de una tabla externa para resolver referencias: los que ya existen en la web (legacy_mobile_id) MÁS los que esta misma
-- importación va a agregar (`inserts`, o la lista de componentes con estado insertable). Misma regla que la función anterior por elemento
-- (`_external_ref_available`), pero devuelve el CONJUNTO una sola vez para que cada clasificador lo una por hash.
create or replace function public._import_available_ids(p_table_name text, p_owner uuid, p_classified jsonb)
returns setof text
language plpgsql
stable
set search_path = ''
as $$
begin
  case p_table_name
    when 'students' then
      return query select s.legacy_mobile_id from public.students s where s.owner_id = p_owner and s.legacy_mobile_id is not null;
    when 'training_billing_agreements' then
      return query select a.legacy_mobile_id from public.training_billing_agreements a where a.owner_id = p_owner and a.legacy_mobile_id is not null;
    when 'calendar_lessons' then
      return query select c.legacy_mobile_id from public.calendar_lessons c where c.owner_id = p_owner and c.legacy_mobile_id is not null;
    when 'lesson_registrations' then
      return query select l.legacy_mobile_id from public.lesson_registrations l where l.owner_id = p_owner and l.legacy_mobile_id is not null;
    else raise exception 'Tabla externa no reconocida: %', p_table_name;
  end case;
  if p_classified is not null then
    return query
      select e ->> 'legacy_mobile_id'
        from jsonb_array_elements(coalesce(p_classified -> 'inserts', p_classified, '[]'::jsonb)) e
       where (e ->> 'status') is null or e ->> 'status' = 'insertable';
  end if;
end;
$$;

revoke all on function public._import_limits() from public, anon, authenticated;
revoke all on function public._import_len(jsonb) from public, anon, authenticated;
revoke all on function public._import_arr(jsonb, text) from public, anon, authenticated;
revoke all on function public._import_check_payload(jsonb) from public, anon, authenticated;
revoke all on function public._import_available_ids(text, uuid, jsonb) from public, anon, authenticated;
