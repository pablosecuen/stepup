-- R6.1 — Rollback MANUAL de la corrección funcional de las importaciones (NO es una migración; no se aplica con `db push`). Vuelve a definir las 6 funciones que
-- R6.1 redefinió con el cuerpo EXACTO que tenían antes (R6, 0d9256e: sacado de las migraciones 20261010100000 / 20261010110000 / 20261010120000 y de
-- 20261001160000 para `_apply_singleton`) y elimina las 3 funciones internas nuevas de 4 argumentos. Firma, resultado y privilegios de las RPC públicas no cambian
-- (CREATE OR REPLACE conserva el ACL), así que la web desplegada sigue funcionando.
--
-- ES UNA REGRESIÓN deliberada: con este rollback vuelven (1) las series con acuerdo nuevo, las clases de series nuevas y los registros de clases nuevas se OMITEN
-- en una cuenta vacía, (2) los reemplazos de los porcentajes 50/30/20 fallan siempre (la suma 100 se comprueba por campo), (3) un nivel repetido termina en el
-- error genérico «ya existe». Ejecutar sólo si R6.1 rompiera algo que la aplicación necesita, y volver a aplicar R6.1 después de corregirlo
-- (`supabase migration repair --status reverted 20261011100000`).

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

create or replace function public._import_classify_custom_levels(p_owner uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_arr jsonb := public._import_arr(p_payload, 'customLevels');
begin
  return (
    with b as (
      select x.ord, x.r from jsonb_array_elements(v_arr) with ordinality as x(r, ord)
    ), k as (
      select b.ord, b.r ->> 'id' as lid, cl.id as cid, cl.name as web_name, b.r ->> 'name' as backup_name,
             case when cl.id is null then 'insert'
                  when btrim(cl.name) = btrim(coalesce(b.r ->> 'name', '')) then 'equal' else 'conflict' end as kind
        from b left join public.custom_levels cl on cl.owner_id = p_owner and cl.legacy_mobile_id = b.r ->> 'id'
    )
    select jsonb_build_object(
      'inserts', coalesce((select jsonb_agg(jsonb_build_object('legacy_mobile_id', k.lid) order by k.ord) from k where k.kind = 'insert'), '[]'::jsonb),
      'equal', coalesce((select jsonb_agg(jsonb_build_object('legacy_mobile_id', k.lid, 'row_id', k.cid) order by k.ord) from k where k.kind = 'equal'), '[]'::jsonb),
      'conflicts', coalesce((select jsonb_agg(jsonb_build_object('legacy_mobile_id', k.lid, 'row_id', k.cid,
          'fields', jsonb_build_object('name', jsonb_build_object('web', k.web_name, 'backup', k.backup_name))) order by k.ord) from k where k.kind = 'conflict'), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.preview_backup_import(p_payload jsonb, p_excluded_collections jsonb)
returns table(preview_id uuid, expires_at timestamptz, summary jsonb, classification jsonb, excluded_collections jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_size_bytes int;
  v_students jsonb; v_custom_levels jsonb;
  v_teacher_profile jsonb; v_budget jsonb; v_availability jsonb;
  v_training_agreements jsonb; v_level_history jsonb; v_surcharge jsonb;
  v_recurrence jsonb; v_calendar jsonb; v_lesson_registrations jsonb;
  v_financial jsonb;
  v_classification jsonb;
  v_preview_id uuid;
  v_checksum text;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.'; end if;

  -- 1) Rechazo ANTES de procesar: tamaño, forma y cantidad de filas (límites en `_import_limits`). Nada se escribe si se rechaza.
  v_size_bytes := pg_column_size(p_payload);
  if v_size_bytes > (public._import_limits() ->> 'max_payload_bytes')::int then
    raise exception 'El backup supera el tamaño máximo permitido.';
  end if;
  perform public._import_check_payload(p_payload);

  -- Limpieza perezosa de previews propios PENDIENTES vencidos (>24h) — nunca de otra cuenta. Nunca de un preview 'applied': `import_runs.preview_id`
  -- lo referencia sin cascada a propósito (retención real del run).
  delete from public.import_previews as ip
    where ip.owner_id = v_owner and ip.status = 'pending' and ip.expires_at < now() - interval '24 hours';

  -- 2) Clasificación por lotes (sin ningún lock de cuenta: es sólo lectura de datos de negocio).
  v_students := public._import_classify_students(v_owner, p_payload);
  v_custom_levels := public._import_classify_custom_levels(v_owner, p_payload);
  v_teacher_profile := public._classify_singleton('teacher_profiles', v_owner, p_payload -> 'teacherProfile');
  v_budget := public._classify_singleton('budget_distribution_settings', v_owner, p_payload -> 'budgetDistribution');
  v_availability := public._classify_singleton('teacher_availability', v_owner, p_payload -> 'teacherAvailability');
  v_training_agreements := public._import_classify_insert_only('training_billing_agreements', v_owner, p_payload -> 'trainingBillingAgreements');
  v_level_history := public._import_classify_insert_only('student_level_history', v_owner, (
    select coalesce(jsonb_agg(jsonb_build_object('id', entry ->> 'id', 'studentId', key)), '[]'::jsonb)
      from jsonb_each(case when jsonb_typeof(p_payload -> 'profiles') = 'object' then p_payload -> 'profiles' else '{}'::jsonb end) as p(key, profile)
      cross join lateral jsonb_array_elements(case when jsonb_typeof(profile -> 'levelHistory') = 'array' then profile -> 'levelHistory' else '[]'::jsonb end) as entry
      where entry ->> 'id' is not null
  ));
  v_surcharge := public._classify_singleton('surcharge_settings', v_owner, p_payload -> 'surchargeSettings' -> 'current');

  v_recurrence := public._import_classify_recurrence_rules(v_owner, p_payload, v_students);
  v_calendar := public._import_classify_calendar_lessons(v_owner, p_payload, v_students);
  v_lesson_registrations := public._import_classify_lesson_registrations(v_owner, p_payload, v_students);
  v_financial := public._import_classify_financial_components(v_owner, p_payload, v_students, v_training_agreements, v_calendar, v_lesson_registrations);

  v_classification := jsonb_build_object(
    'maestros', jsonb_build_object(
      'students', v_students,
      'custom_levels', v_custom_levels,
      'teacher_profiles', v_teacher_profile,
      'budget_distribution_settings', v_budget,
      'teacher_availability', v_availability
    ),
    'insert_only', jsonb_build_object(
      'training_billing_agreements', v_training_agreements,
      'student_level_history', v_level_history,
      'surcharge_settings', v_surcharge
    ),
    'aggregates', jsonb_build_object(
      'recurrence_rules', v_recurrence,
      'calendar_lessons', v_calendar,
      'lesson_registrations', v_lesson_registrations,
      'financial_components', v_financial
    )
  );

  -- 3) Lo que se va a AGREGAR no puede repetir identificadores (antes terminaba en «ya existe» al confirmar, con todo el trabajo hecho).
  if exists (
    select 1 from (
      select e ->> 'legacy_mobile_id' as lid, 'a' as grp from jsonb_array_elements(v_students -> 'inserts') e
      union all select e ->> 'backup_legacy_mobile_id', 'a' from jsonb_array_elements(v_students -> 'duplicates') e
      union all select e ->> 'legacy_mobile_id', 'b' from jsonb_array_elements(v_custom_levels -> 'inserts') e
      union all select e ->> 'legacy_mobile_id', 'c' from jsonb_array_elements(v_training_agreements -> 'inserts') e
      union all select e ->> 'legacy_mobile_id', 'd' from jsonb_array_elements(v_level_history -> 'inserts') e
      union all select e ->> 'legacy_mobile_id', 'e' from jsonb_array_elements(v_recurrence) e where e ->> 'status' = 'insertable'
      union all select e ->> 'legacy_mobile_id', 'f' from jsonb_array_elements(v_calendar) e where e ->> 'status' = 'insertable'
      union all select e ->> 'legacy_mobile_id', 'g' from jsonb_array_elements(v_lesson_registrations) e where e ->> 'status' = 'insertable'
    ) t group by t.grp, t.lid having count(*) > 1
  ) then
    raise exception 'El backup tiene datos repetidos.' using errcode = '22023';
  end if;

  -- 4) Cuotas de la cuenta (R3): si de todas formas se frenaría al aplicar, se avisa ahora y no se guarda nada.
  perform public._import_project_quotas(v_owner, v_classification);

  v_checksum := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');

  insert into public.import_previews (owner_id, backup_checksum, schema_version, app_version, normalized_payload, classification, excluded_collections)
    values (v_owner, v_checksum, coalesce((p_payload ->> 'schemaVersion')::int, 2), p_payload ->> 'appVersion', p_payload, v_classification, coalesce(p_excluded_collections, '{}'::jsonb))
    returning id into v_preview_id;

  -- Huellas de todas las filas YA EXISTENTES matched (maestros con override real) — por lote, una consulta por tabla.
  insert into public.import_preview_row_fingerprints (preview_id, table_name, row_id, fingerprint)
    select v_preview_id, 'students', s.id, public._fingerprint_canonical('students', to_jsonb(s))
      from public.students s
      join (select distinct (e ->> 'row_id')::uuid as rid from jsonb_array_elements(coalesce(v_students -> 'equal', '[]'::jsonb) || coalesce(v_students -> 'conflicts', '[]'::jsonb)) e) x on x.rid = s.id
     where s.owner_id = v_owner;
  insert into public.import_preview_row_fingerprints (preview_id, table_name, row_id, fingerprint)
    select v_preview_id, 'custom_levels', c.id, public._fingerprint_canonical('custom_levels', to_jsonb(c))
      from public.custom_levels c
      join (select distinct (e ->> 'row_id')::uuid as rid from jsonb_array_elements(coalesce(v_custom_levels -> 'equal', '[]'::jsonb) || coalesce(v_custom_levels -> 'conflicts', '[]'::jsonb)) e) x on x.rid = c.id
     where c.owner_id = v_owner;
  if v_teacher_profile ? 'row_id' then
    insert into public.import_preview_row_fingerprints (preview_id, table_name, row_id, fingerprint)
      values (v_preview_id, 'teacher_profiles', v_owner, public._fingerprint_row('teacher_profiles', v_owner, v_owner));
  end if;
  if v_budget ? 'row_id' then
    insert into public.import_preview_row_fingerprints (preview_id, table_name, row_id, fingerprint)
      values (v_preview_id, 'budget_distribution_settings', v_owner, public._fingerprint_row('budget_distribution_settings', v_owner, v_owner));
  end if;
  if v_availability ? 'row_id' then
    insert into public.import_preview_row_fingerprints (preview_id, table_name, row_id, fingerprint)
      values (v_preview_id, 'teacher_availability', v_owner, public._fingerprint_row('teacher_availability', v_owner, v_owner));
  end if;

  insert into public.import_preview_duplicate_candidates (preview_id, backup_legacy_mobile_id, candidate_student_id, match_signals, candidate_fingerprint, field_diff)
    select v_preview_id, d ->> 'backup_legacy_mobile_id', (d ->> 'candidate_student_id')::uuid,
           array(select jsonb_array_elements_text(d -> 'match_signals')), d ->> 'candidate_fingerprint', d -> 'field_diff'
      from jsonb_array_elements(coalesce(v_students -> 'duplicates', '[]'::jsonb)) d;

  return query
    select v_preview_id, ip.expires_at,
      jsonb_build_object(
        'students', jsonb_build_object(
          'inserts', jsonb_array_length(v_students -> 'inserts'), 'equal', jsonb_array_length(v_students -> 'equal'),
          'conflicts', jsonb_array_length(v_students -> 'conflicts'), 'possible_duplicates', jsonb_array_length(v_students -> 'duplicates')
        )
      ),
      v_classification, coalesce(p_excluded_collections, '{}'::jsonb)
    from public.import_previews ip where ip.id = v_preview_id;
end;
$$;

create or replace function public._import_validate_selection(p_preview_id uuid, p_classification jsonb, p_field_overrides jsonb, p_duplicate_decisions jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lim jsonb := public._import_limits();
  v_code text;
begin
  if jsonb_typeof(coalesce(p_field_overrides, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_duplicate_decisions, '[]'::jsonb)) <> 'array' then
    raise exception 'Decisión de duplicado inválida.' using errcode = '22023';
  end if;
  if public._import_len(p_field_overrides) > (v_lim ->> 'max_field_overrides')::int or public._import_len(p_duplicate_decisions) > (v_lim ->> 'max_duplicate_decisions')::int then
    raise exception 'La selección tiene demasiadas decisiones para confirmar de una vez.' using errcode = '22023';
  end if;

  -- Decisiones de duplicado
  with dec as (
    select x.backup_legacy_mobile_id as bid, x.decision, x.candidate_student_id as cid
      from jsonb_to_recordset(coalesce(p_duplicate_decisions, '[]'::jsonb)) as x(backup_legacy_mobile_id text, decision text, candidate_student_id uuid)
  )
  select v.code into v_code from (
    select 1 as pri, 'Decisión de duplicado inválida.' as code from dec where dec.decision not in ('link', 'create_separate', 'skip')
    union all
    select 2, 'No hay ningún candidato de duplicado en este preview.'
      from dec left join public.import_preview_duplicate_candidates dc on dc.preview_id = p_preview_id and dc.backup_legacy_mobile_id = dec.bid
     where dc.id is null
    union all
    select 3, 'candidate_student_id no coincide con el candidato real analizado por el preview.'
      from dec join public.import_preview_duplicate_candidates dc on dc.preview_id = p_preview_id and dc.backup_legacy_mobile_id = dec.bid
     where dec.decision = 'link' and dec.cid is distinct from dc.candidate_student_id
    union all
    select 4, 'Decisión de duplicado inválida (repetida).' from dec group by dec.bid having count(*) > 1
    union all
    select 5, 'Decisión de duplicado inválida (dos vínculos al mismo alumno).' from dec where dec.decision = 'link' group by dec.cid having count(*) > 1
  ) v order by v.pri limit 1;
  if v_code is not null then raise exception '%', v_code using errcode = '22023'; end if;

  -- Reemplazos de campos
  with ov as (
    select x.table_name, x.row_id, coalesce(x.fields, array[]::text[]) as fields
      from jsonb_to_recordset(coalesce(p_field_overrides, '[]'::jsonb)) as x(table_name text, row_id uuid, fields text[])
  ), dec as (
    select x.decision, x.candidate_student_id as cid
      from jsonb_to_recordset(coalesce(p_duplicate_decisions, '[]'::jsonb)) as x(backup_legacy_mobile_id text, decision text, candidate_student_id uuid)
  ), conf_s as (
    select distinct on ((c ->> 'row_id')::uuid) (c ->> 'row_id')::uuid as rid, c -> 'fields' as f
      from jsonb_array_elements(coalesce(p_classification #> '{maestros,students,conflicts}', '[]'::jsonb)) c order by (c ->> 'row_id')::uuid
  ), conf_l as (
    select distinct on ((c ->> 'row_id')::uuid) (c ->> 'row_id')::uuid as rid, c -> 'fields' as f
      from jsonb_array_elements(coalesce(p_classification #> '{maestros,custom_levels,conflicts}', '[]'::jsonb)) c order by (c ->> 'row_id')::uuid
  ), lk as (
    select distinct on (dc.candidate_student_id) dc.candidate_student_id as rid, dc.field_diff as f
      from public.import_preview_duplicate_candidates dc
      join dec on dec.decision = 'link' and dec.cid = dc.candidate_student_id
     where dc.preview_id = p_preview_id order by dc.candidate_student_id, dc.id
  ), rf as (
    select ov.*,
           case ov.table_name
             when 'students' then coalesce(cs.f, lk.f)
             when 'custom_levels' then cl.f
             else case when p_classification -> 'maestros' -> ov.table_name ->> 'status' = 'conflict'
                       then (select jsonb_object_agg(k, true) from unnest(public._field_override_allowlist(ov.table_name)) k) end
           end as row_fields
      from ov
      left join conf_s cs on ov.table_name = 'students' and cs.rid = ov.row_id
      left join lk on ov.table_name = 'students' and lk.rid = ov.row_id
      left join conf_l cl on ov.table_name = 'custom_levels' and cl.rid = ov.row_id
  )
  select v.code into v_code from (
    select 1 as pri, 'Tabla no admite overrides de campo.' as code from rf where rf.table_name is null or rf.table_name not in ('students', 'custom_levels', 'teacher_profiles', 'budget_distribution_settings', 'teacher_availability')
    union all
    select 2, 'La fila no está clasificada como conflicto en este preview.' from rf where rf.row_fields is null
    union all
    select 3, 'Campo no es overridable.' from rf cross join lateral unnest(rf.fields) f where not (f = any(public._field_override_allowlist(rf.table_name)))
    union all
    select 4, 'Campo no fue detectado como distinto en el preview.' from rf cross join lateral unnest(rf.fields) f where rf.row_fields is not null and not (rf.row_fields ? f)
    union all
    select 5, 'Tabla no admite overrides de campo (repetido).' from ov group by ov.table_name, ov.row_id having count(*) > 1
  ) v order by v.pri limit 1;
  if v_code is not null then raise exception '%', v_code using errcode = '22023'; end if;
end;
$$;

create or replace function public._import_apply_custom_levels(p_run_id uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from _ia_cl_new s join public.custom_levels w on w.owner_id = p_owner and w.legacy_mobile_id = s.lid) then
    raise exception 'Un nivel ya existe — el preview quedó desactualizado.' using errcode = '22023';
  end if;
  with ins as (
    insert into public.custom_levels (owner_id, legacy_mobile_id, name, created_at)
      select p_owner, s.lid, s.name, s.created_at from _ia_cl_new s
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'custom_levels', i.id, 'inserted', null, to_jsonb(i) from ins i;

  with ov as (
    select o.row_id, o.fields, r.name as new_name
      from _ia_ov o
      join public.custom_levels c on c.id = o.row_id and c.owner_id = p_owner
      join _ia_cl_raw r on r.lid = c.legacy_mobile_id
     where o.table_name = 'custom_levels'
  ), before as (
    select c.id, to_jsonb(c) as b from public.custom_levels c join ov on ov.row_id = c.id
  ), upd as (
    update public.custom_levels c set name = case when 'name' = any(ov.fields) then ov.new_name else c.name end from ov where c.id = ov.row_id returning c.*
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'custom_levels', u.id, 'field_overwritten', b.b, to_jsonb(u) from upd u join before b on b.id = u.id;
end;
$$;

create or replace function public._apply_singleton(p_run_id uuid, p_owner uuid, p_table_name text, p_backup_doc jsonb, p_classification_entry jsonb, p_field_overrides jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_fields text[];
  v_field text;
  v_exists boolean;
begin
  if public._jsonb_is_absent(p_backup_doc) then
    return; -- el backup no traía esta colección (o la traía null): nada que hacer
  end if;
  if not (p_classification_entry ? 'present_in_backup') or not (p_classification_entry->>'present_in_backup')::boolean then
    return; -- la vista previa tampoco la consideró presente
  end if;

  perform public._validate_singleton_doc(p_table_name, p_backup_doc);

  case p_table_name
    when 'teacher_profiles' then select exists(select 1 from public.teacher_profiles t where t.owner_id = p_owner) into v_exists;
    when 'budget_distribution_settings' then select exists(select 1 from public.budget_distribution_settings t where t.owner_id = p_owner) into v_exists;
    when 'teacher_availability' then select exists(select 1 from public.teacher_availability t where t.owner_id = p_owner) into v_exists;
  end case;

  if not v_exists then
    case p_table_name
      when 'teacher_profiles' then
        insert into public.teacher_profiles (owner_id, display_name) values (p_owner, btrim(p_backup_doc->>'displayName'));
      when 'budget_distribution_settings' then
        insert into public.budget_distribution_settings (owner_id, needs_percent, wants_percent, savings_percent, savings_goal_enabled, savings_goal_target_amount, savings_goal_target_date)
          values (p_owner, (p_backup_doc->'distribution'->>'needs')::smallint, (p_backup_doc->'distribution'->>'wants')::smallint, (p_backup_doc->'distribution'->>'savings')::smallint,
                  (p_backup_doc->'savingsGoal'->>'enabled')::boolean, (p_backup_doc->'savingsGoal'->>'targetAmount')::numeric, (p_backup_doc->'savingsGoal'->>'targetDate')::date);
      when 'teacher_availability' then
        insert into public.teacher_availability (owner_id, timezone, weekly_blocks, exceptions)
          values (p_owner, p_backup_doc->>'timezone', p_backup_doc->'weeklyBlocks', p_backup_doc->'exceptions');
    end case;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, p_table_name, p_owner, 'inserted', null, public._singleton_row_json(p_table_name, p_owner));
    return;
  end if;

  -- Ya existe: sólo se toca si hay overrides autorizados para esta tabla.
  select array_agg(distinct x.field) into v_fields
    from jsonb_to_recordset(coalesce(p_field_overrides, '[]'::jsonb)) as e(table_name text, row_id uuid, fields text[])
    cross join lateral unnest(e.fields) as x(field)
    where e.table_name = p_table_name and e.row_id = p_owner;

  if v_fields is null then return; end if; -- sin override -> se conserva la web, sin tocar nada

  v_before := public._singleton_row_json(p_table_name, p_owner);
  foreach v_field in array v_fields
  loop
    case p_table_name || ':' || v_field
      when 'teacher_profiles:display_name' then update public.teacher_profiles set display_name = btrim(p_backup_doc->>'displayName') where owner_id = p_owner;
      when 'budget_distribution_settings:needs_percent' then update public.budget_distribution_settings set needs_percent = (p_backup_doc->'distribution'->>'needs')::smallint where owner_id = p_owner;
      when 'budget_distribution_settings:wants_percent' then update public.budget_distribution_settings set wants_percent = (p_backup_doc->'distribution'->>'wants')::smallint where owner_id = p_owner;
      when 'budget_distribution_settings:savings_percent' then update public.budget_distribution_settings set savings_percent = (p_backup_doc->'distribution'->>'savings')::smallint where owner_id = p_owner;
      when 'budget_distribution_settings:savings_goal_enabled' then update public.budget_distribution_settings set savings_goal_enabled = (p_backup_doc->'savingsGoal'->>'enabled')::boolean where owner_id = p_owner;
      when 'budget_distribution_settings:savings_goal_target_amount' then update public.budget_distribution_settings set savings_goal_target_amount = (p_backup_doc->'savingsGoal'->>'targetAmount')::numeric where owner_id = p_owner;
      when 'budget_distribution_settings:savings_goal_target_date' then update public.budget_distribution_settings set savings_goal_target_date = (p_backup_doc->'savingsGoal'->>'targetDate')::date where owner_id = p_owner;
      when 'teacher_availability:timezone' then update public.teacher_availability set timezone = p_backup_doc->>'timezone' where owner_id = p_owner;
      when 'teacher_availability:weekly_blocks' then update public.teacher_availability set weekly_blocks = p_backup_doc->'weeklyBlocks' where owner_id = p_owner;
      when 'teacher_availability:exceptions' then update public.teacher_availability set exceptions = p_backup_doc->'exceptions' where owner_id = p_owner;
      else raise exception 'Override singleton inesperado: %.%', p_table_name, v_field;
    end case;
  end loop;

  -- Constraint real de la base (budget_distribution_settings_sum_100) es el respaldo final si un
  -- override parcial dejara una suma inválida — la transacción completa fallaría y todo se revertiría.
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    values (p_run_id, p_table_name, p_owner, 'field_overwritten', v_before, public._singleton_row_json(p_table_name, p_owner));
end;
$$;

drop function if exists public._import_classify_recurrence_rules(uuid, jsonb, jsonb, jsonb);
drop function if exists public._import_classify_calendar_lessons(uuid, jsonb, jsonb, jsonb);
drop function if exists public._import_classify_lesson_registrations(uuid, jsonb, jsonb, jsonb);

revoke all on function public._import_available_ids(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public._import_classify_custom_levels(uuid, jsonb) from public, anon, authenticated;
revoke all on function public._import_apply_custom_levels(uuid, uuid) from public, anon, authenticated;
revoke all on function public._import_validate_selection(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._apply_singleton(uuid, uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
