-- R6 — Importaciones grandes (3/4): aplicación por LOTES. ADITIVA e idempotente: funciones nuevas `_import_*` (internas, sin EXECUTE para la API) y
-- `apply_backup_import` redefinida con la MISMA firma, el mismo resultado, la misma idempotencia y los mismos privilegios. Las funciones `_apply_*`
-- anteriores NO se tocan (quedan sin llamadas; `supabase/repairs/r6_import_rollback.sql` vuelve a la versión anterior de las funciones públicas).
--
-- Qué cambia (medido, ver docs/R6_IMPORTACIONES_GRANDES.md):
--   * Una sentencia por tabla (INSERT … SELECT con uniones por hash) en lugar de una consulta y un INSERT por elemento. Antes cada fila disparaba el
--     disparador por sentencia de cuotas (R3: un `count(*)` de la tabla por fila → O(n²)) y cada búsqueda en el respaldo copiaba el arreglo entero.
--   * El respaldo se convierte UNA vez a tablas temporales tipadas ANTES de tomar el lock de la cuenta (análisis, conversiones y validaciones); el
--     lock se toma después y sólo cubre: re-verificación contra el estado actual + escritura + invariantes.
--   * Las referencias entre filas de la MISMA tabla (clase liberada por otra, serie que reemplaza a otra, pago que reemplaza a otro, registro
--     reprogramado) se resuelven en el mismo INSERT con ids asignados de antemano: ya no hay una segunda pasada de UPDATE, así que la huella de la
--     instantánea coincide con la fila final y la importación se puede DESHACER (antes la segunda pasada la dejaba «editada después de importar»).
--   * `_apply_student_level_history` (anterior) nunca podía completarse cuando el respaldo traía historial de niveles con id (referencia a una
--     variable inexistente): se corrige en la versión nueva.
--   * Mensajes de error sin identificadores ni nombres de tablas.
-- Se conserva: atomicidad (una función = una transacción), idempotencia por `unique (owner_id, preview_id)` + el mismo resultado en el reintento,
-- decisiones (agregar / conservar / reemplazar / vincular / crear aparte / omitir), instantáneas, RLS (todo filtrado por `auth.uid()` + owner explícito)
-- y cuotas de R3 (los disparadores siguen activos: una cuota alcanzada a mitad de la aplicación revierte TODO).

-- ---------------------------------------------------------------------------------------------------------------------
-- Validación de las decisiones elegidas (reemplaza `_validate_field_overrides` + `_validate_duplicate_decisions`, que consultaban por elemento)
-- ---------------------------------------------------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------------------------------------------------
-- Conversión del respaldo a tablas temporales TIPADAS (una sola pasada, sin lock de cuenta)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public._import_stage(p_owner uuid, p_payload jsonb, p_classification jsonb, p_field_overrides jsonb, p_duplicate_decisions jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stu jsonb := public._import_arr(p_payload, 'students');
  v_cl jsonb := public._import_arr(p_payload, 'customLevels');
  v_agr jsonb := public._import_arr(p_payload, 'trainingBillingAgreements');
  v_rr jsonb := public._import_arr(p_payload, 'recurrenceRules');
  v_lsn jsonb := public._import_arr(p_payload, 'calendarLessons');
  v_exc jsonb := public._import_arr(p_payload, 'recurrenceExceptions');
  v_reg jsonb := public._import_arr(p_payload, 'pedagogicalLessons');
  v_pay jsonb := public._import_arr(p_payload, 'payments');
  v_pk jsonb := public._import_arr(p_payload, 'packagePurchases');
  v_chg jsonb := public._import_arr(p_payload, 'paymentCharges');
  v_alloc jsonb := public._import_arr(p_payload, 'paymentAllocations');
  v_adj jsonb := public._import_arr(p_payload, 'paymentAdjustments');
  v_isc jsonb := public._import_arr(p_payload, 'initialPaidSurchargeCorrections');
  v_fm jsonb := public._import_arr(p_payload, 'firstMonthProrationDecisions');
  v_pm jsonb := public._import_arr(p_payload, 'packageCreditMovements');
  v_profiles jsonb := case when jsonb_typeof(p_payload -> 'profiles') = 'object' then p_payload -> 'profiles' else '{}'::jsonb end;
  v_name text;
  v_missing bigint;
begin
  foreach v_name in array array['_ia_dec','_ia_ov','_ia_stu','_ia_stu_raw','_ia_cl_new','_ia_cl_raw','_ia_agr','_ia_lh','_ia_rr','_ia_rr_part','_ia_lsn','_ia_lsn_part','_ia_exc','_ia_reg','_ia_reg_roster','_ia_reg_att','_ia_reg_eval','_ia_reg_hw','_ia_fin_ids','_ia_pay','_ia_pk','_ia_chg','_ia_alloc','_ia_adj','_ia_isc','_ia_fm','_ia_pm'] loop
    execute format('drop table if exists %I', v_name);
  end loop;

  create temporary table _ia_dec on commit drop as
    select x.backup_legacy_mobile_id as bid, x.decision, x.candidate_student_id as cid
      from jsonb_to_recordset(coalesce(p_duplicate_decisions, '[]'::jsonb)) as x(backup_legacy_mobile_id text, decision text, candidate_student_id uuid);
  create temporary table _ia_ov on commit drop as
    select x.table_name, x.row_id, coalesce(x.fields, array[]::text[]) as fields
      from jsonb_to_recordset(coalesce(p_field_overrides, '[]'::jsonb)) as x(table_name text, row_id uuid, fields text[]);

  -- Alumnos a AGREGAR («insert» de la clasificación + decisión «crear aparte») con los mismos valores que `_insert_student_from_backup_row`.
  create temporary table _ia_stu on commit drop as
    with ids as (
      select e ->> 'legacy_mobile_id' as lid, 'insert'::text as kind from jsonb_array_elements(coalesce(p_classification #> '{maestros,students,inserts}', '[]'::jsonb)) e
      union all
      select d.bid, 'separate' from _ia_dec d where d.decision = 'create_separate'
    ), src as (
      select distinct on (x.r ->> 'id') x.r ->> 'id' as lid, x.r from jsonb_array_elements(v_stu) with ordinality as x(r, ord) order by x.r ->> 'id', x.ord
    )
    select ids.kind, ids.lid, src.r as raw,
           src.r ->> 'name' as name, src.r ->> 'phone' as phone, src.r ->> 'whatsapp' as whatsapp, src.r ->> 'email' as email,
           array(select jsonb_array_elements_text(coalesce(src.r -> 'usualDays', '[]'::jsonb))) as usual_days,
           src.r ->> 'usualTime' as usual_time, src.r ->> 'notes' as notes, (src.r ->> 'birthDate')::date as birth_date,
           array(select jsonb_array_elements_text(coalesce(src.r -> 'levels', '[]'::jsonb))) as levels,
           coalesce(src.r ->> 'initialLevel', '') as initial_level, src.r ->> 'modality' as modality, src.r ->> 'status' as status,
           src.r ->> 'category' as category, src.r ->> 'billingType' as billing_type, src.r -> 'billingPlan' as billing_plan,
           (src.r ->> 'dateJoined')::date as date_joined, (src.r ->> 'lastReactivatedAt')::date as last_reactivated_at,
           (src.r ->> 'statusChangeDate')::date as status_change_date,
           coalesce((src.r ->> 'usualDurationMinutes')::int, 60) as usual_duration_minutes,
           coalesce((src.r ->> 'weeklyFrequency')::int, 1) as weekly_frequency, coalesce((src.r ->> 'price')::numeric, 0) as price,
           src.r ->> 'pendingHomework' as pending_homework,
           array(select jsonb_array_elements_text(coalesce(src.r -> 'alerts', '[]'::jsonb))) as alerts,
           array(select jsonb_array_elements_text(coalesce(src.r -> 'currentGoals', '[]'::jsonb))) as current_goals,
           array(select jsonb_array_elements_text(coalesce(src.r -> 'strengths', '[]'::jsonb))) as strengths,
           array(select jsonb_array_elements_text(coalesce(src.r -> 'areasToImprove', '[]'::jsonb))) as areas_to_improve,
           coalesce((src.r ->> 'isFeatured')::boolean, false) as is_featured, coalesce((src.r ->> 'isNew')::boolean, true) as is_new
      from ids left join src on src.lid = ids.lid;

  -- Filas del respaldo de los alumnos con conflicto o vínculo (los reemplazos de campos leen de acá).
  create temporary table _ia_stu_raw on commit drop as
    select distinct on (s.lid) s.lid, s.r as raw
      from (select x.r ->> 'id' as lid, x.r, x.ord from jsonb_array_elements(v_stu) with ordinality as x(r, ord)) s
     where s.lid in (
       select e ->> 'legacy_mobile_id' from jsonb_array_elements(coalesce(p_classification #> '{maestros,students,conflicts}', '[]'::jsonb)) e
       union select d.bid from _ia_dec d where d.decision = 'link')
     order by s.lid, s.ord;

  create temporary table _ia_cl_new on commit drop as
    with ids as (select e ->> 'legacy_mobile_id' as lid from jsonb_array_elements(coalesce(p_classification #> '{maestros,custom_levels,inserts}', '[]'::jsonb)) e),
         src as (select distinct on (x.r ->> 'id') x.r ->> 'id' as lid, x.r from jsonb_array_elements(v_cl) with ordinality as x(r, ord) order by x.r ->> 'id', x.ord)
    select ids.lid, src.r as raw, btrim(coalesce(src.r ->> 'name', '')) as name, coalesce((src.r ->> 'createdAt')::timestamptz, now()) as created_at
      from ids left join src on src.lid = ids.lid;
  create temporary table _ia_cl_raw on commit drop as
    select distinct on (s.lid) s.lid, btrim(coalesce(s.r ->> 'name', '')) as name
      from (select x.r ->> 'id' as lid, x.r, x.ord from jsonb_array_elements(v_cl) with ordinality as x(r, ord)) s
     where s.lid in (select e ->> 'legacy_mobile_id' from jsonb_array_elements(coalesce(p_classification #> '{maestros,custom_levels,conflicts}', '[]'::jsonb)) e)
     order by s.lid, s.ord;

  create temporary table _ia_agr on commit drop as
    with ids as (select e ->> 'legacy_mobile_id' as lid from jsonb_array_elements(coalesce(p_classification #> '{insert_only,training_billing_agreements,inserts}', '[]'::jsonb)) e),
         src as (select distinct on (x.r ->> 'id') x.r ->> 'id' as lid, x.r from jsonb_array_elements(v_agr) with ordinality as x(r, ord) order by x.r ->> 'id', x.ord)
    select ids.lid, src.r as raw, (src.r ->> 'monthlyFee')::numeric as monthly_fee, (src.r ->> 'pendingMonthlyFee')::numeric as pending_monthly_fee,
           src.r ->> 'pendingMonthlyFeeEffectiveFrom' as pending_from, src.r ->> 'startPeriod' as start_period
      from ids left join src on src.lid = ids.lid;

  -- Historial de niveles: la entrada se busca en TODOS los perfiles (la primera que aparece gana) y se asocia al alumno por la clave del perfil.
  create temporary table _ia_lh on commit drop as
    with ids as (select e ->> 'legacy_mobile_id' as lid from jsonb_array_elements(coalesce(p_classification #> '{insert_only,student_level_history,inserts}', '[]'::jsonb)) e),
         ent as (
           select distinct on (en.entry ->> 'id') en.entry ->> 'id' as lid, en.entry, p.key as student_lid
             from jsonb_each(v_profiles) with ordinality as p(key, profile, pord)
             cross join lateral jsonb_array_elements(case when jsonb_typeof(p.profile -> 'levelHistory') = 'array' then p.profile -> 'levelHistory' else '[]'::jsonb end) with ordinality as en(entry, eord)
            where en.entry ->> 'id' is not null
            order by en.entry ->> 'id', p.pord, en.eord
         )
    select ids.lid, ent.student_lid, ent.entry as raw, ent.entry ->> 'level' as level, ent.entry ->> 'fromLevel' as from_level,
           (ent.entry ->> 'date')::date as achieved_on, (ent.entry ->> 'recordedAt')::timestamptz as recorded_at,
           (ent.entry ->> 'previousMilestoneAt')::timestamptz as previous_milestone_at, (ent.entry ->> 'durationDays')::int as duration_days,
           ent.entry ->> 'note' as note, ent.entry ->> 'origin' as origin
      from ids left join ent on ent.lid = ids.lid;

  -- Series (con id asignado de antemano para resolver «reemplaza a» en el mismo INSERT)
  create temporary table _ia_rr on commit drop as
    with ids as (select e ->> 'legacy_mobile_id' as lid from jsonb_array_elements(coalesce(p_classification #> '{aggregates,recurrence_rules}', '[]'::jsonb)) e where e ->> 'status' = 'insertable'),
         src as (select distinct on (x.r ->> 'id') x.r ->> 'id' as lid, x.r from jsonb_array_elements(v_rr) with ordinality as x(r, ord) order by x.r ->> 'id', x.ord)
    select ids.lid, gen_random_uuid() as new_id, src.r as raw,
           src.r ->> 'primaryStudentId' as primary_student_lid, src.r ->> 'trainingBillingAgreementId' as agreement_lid, src.r ->> 'supersedesRecurrenceId' as supersedes_lid,
           src.r ->> 'ruleType' as rule_type, (src.r ->> 'cycleLengthWeeks')::smallint as cycle_length_weeks, coalesce(src.r -> 'weeks', '[]'::jsonb) as weeks,
           src.r ->> 'modality' as modality, src.r ->> 'timezone' as timezone, (src.r ->> 'startDate')::date as start_date, (src.r ->> 'endDate')::date as end_date,
           src.r ->> 'status' as status, (src.r ->> 'effectiveFromDate')::date as effective_from_date, src.r ->> 'classTitle' as class_title,
           coalesce(src.r ->> 'activityKind', 'class') as activity_kind
      from ids left join src on src.lid = ids.lid;
  create temporary table _ia_rr_part on commit drop as
    select rr.lid as rule_lid, e.v #>> '{}' as student_lid, e.ord
      from _ia_rr rr
      cross join lateral jsonb_array_elements(case when jsonb_typeof(rr.raw -> 'participantStudentIds') = 'array' then rr.raw -> 'participantStudentIds' else '[]'::jsonb end) with ordinality as e(v, ord);

  create temporary table _ia_lsn on commit drop as
    with ids as (select e ->> 'legacy_mobile_id' as lid from jsonb_array_elements(coalesce(p_classification #> '{aggregates,calendar_lessons}', '[]'::jsonb)) e where e ->> 'status' = 'insertable'),
         src as (select distinct on (x.r ->> 'id') x.r ->> 'id' as lid, x.r from jsonb_array_elements(v_lsn) with ordinality as x(r, ord) order by x.r ->> 'id', x.ord)
    select ids.lid, gen_random_uuid() as new_id, src.r as raw,
           src.r ->> 'primaryStudentId' as primary_student_lid, src.r ->> 'recurrenceId' as recurrence_lid, src.r ->> 'freedByLessonId' as freed_lid,
           src.r ->> 'studentName' as student_name, src.r ->> 'level' as level, src.r ->> 'lessonType' as lesson_type,
           (src.r ->> 'startAt')::timestamptz as start_at, (src.r ->> 'endAt')::timestamptz as end_at, src.r ->> 'modality' as modality,
           src.r ->> 'status' as status, src.r ->> 'color' as color, coalesce((src.r ->> 'overlapAllowed')::boolean, false) as overlap_allowed,
           src.r ->> 'notes' as notes, coalesce((src.r ->> 'isRecurring')::boolean, false) as is_recurring,
           src.r ->> 'recurrenceOccurrenceKey' as recurrence_occurrence_key, (src.r ->> 'recurrenceIndex')::int as recurrence_index,
           (src.r ->> 'recurrenceOriginalStart')::timestamptz as recurrence_original_start, src.r -> 'scheduleAdjustment' as schedule_adjustment,
           src.r ->> 'classTitle' as class_title, coalesce(src.r ->> 'activityKind', 'class') as activity_kind
      from ids left join src on src.lid = ids.lid;
  create temporary table _ia_lsn_part on commit drop as
    select l.lid as lesson_lid, e.v ->> 'studentId' as student_lid, e.v ->> 'studentName' as student_name, e.v ->> 'level' as level, e.ord
      from _ia_lsn l
      cross join lateral jsonb_array_elements(case when jsonb_typeof(l.raw -> 'participants') = 'array' then l.raw -> 'participants' else '[]'::jsonb end) with ordinality as e(v, ord);

  -- Excepciones de series: se leen directo del respaldo (no las clasifica la vista previa); sólo se usan las de series agregadas en esta corrida.
  create temporary table _ia_exc on commit drop as
    select x.ord, x.r ->> 'recurrenceId' as recurrence_lid, x.r ->> 'occurrenceKey' as occurrence_key, x.r ->> 'exceptionType' as exception_type, x.r ->> 'replacementLessonId' as replacement_lid
      from jsonb_array_elements(v_exc) with ordinality as x(r, ord)
     where x.r ->> 'recurrenceId' in (select lid from _ia_rr);

  create temporary table _ia_reg on commit drop as
    with ids as (select e ->> 'legacy_mobile_id' as lid from jsonb_array_elements(coalesce(p_classification #> '{aggregates,lesson_registrations}', '[]'::jsonb)) e where e ->> 'status' = 'insertable'),
         src as (select distinct on (x.r ->> 'id') x.r ->> 'id' as lid, x.r from jsonb_array_elements(v_reg) with ordinality as x(r, ord) order by x.r ->> 'id', x.ord)
    select ids.lid, gen_random_uuid() as new_id, src.r as raw,
           src.r ->> 'calendarLessonId' as calendar_lesson_lid, src.r ->> 'rescheduledFromRegistrationId' as rescheduled_lid,
           coalesce(src.r ->> 'activityKind', 'class') as activity_kind, coalesce((src.r ->> 'countsAsClass')::boolean, true) as counts_as_class,
           src.r ->> 'homeworkDescription' as homework_description, (src.r ->> 'homeworkDueDate')::date as homework_due_date,
           (src.r ->> 'billedAmount')::numeric as billed_amount, (src.r ->> 'scheduledStartAt')::timestamptz as scheduled_start_at,
           (src.r ->> 'actualStartedAt')::timestamptz as actual_started_at, (src.r ->> 'actualEndedAt')::timestamptz as actual_ended_at,
           coalesce(src.r ->> 'outcome', 'clase_dictada') as outcome, coalesce((src.r ->> 'holidayException')::boolean, false) as holiday_exception,
           src.r ->> 'modality' as modality, (src.r ->> 'scheduledEndAt')::timestamptz as scheduled_end_at,
           src.r ->> 'lateCancellationPolicy' as late_cancellation_policy, (src.r ->> 'lateCancellationPercentage')::smallint as late_cancellation_percentage
      from ids left join src on src.lid = ids.lid;
  create temporary table _ia_reg_roster on commit drop as
    select r.lid as reg_lid, e.v ->> 'studentId' as student_lid, e.ord
      from _ia_reg r cross join lateral jsonb_array_elements(case when jsonb_typeof(r.raw -> 'roster') = 'array' then r.raw -> 'roster' else '[]'::jsonb end) with ordinality as e(v, ord);
  create temporary table _ia_reg_att on commit drop as
    select r.lid as reg_lid, e.v ->> 'studentId' as student_lid, e.v ->> 'status' as status, (e.v ->> 'lateMinutes')::int as late_minutes, e.ord
      from _ia_reg r cross join lateral jsonb_array_elements(case when jsonb_typeof(r.raw -> 'attendance') = 'array' then r.raw -> 'attendance' else '[]'::jsonb end) with ordinality as e(v, ord);
  create temporary table _ia_reg_eval on commit drop as
    select r.lid as reg_lid, e.v ->> 'studentId' as student_lid, (e.v ->> 'generalGrade')::numeric as general_grade, coalesce(e.v -> 'skillGrades', '{}'::jsonb) as skill_grades,
           array(select jsonb_array_elements_text(coalesce(e.v -> 'strengths', '[]'::jsonb))) as strengths,
           array(select jsonb_array_elements_text(coalesce(e.v -> 'areasToImprove', '[]'::jsonb))) as areas_to_improve,
           e.v ->> 'individualObservation' as individual_observation, e.v ->> 'individualHomeworkDescription' as individual_homework_description,
           (e.v ->> 'individualHomeworkDueDate')::date as individual_homework_due_date, (e.v ->> 'billedAmount')::numeric as billed_amount, e.ord
      from _ia_reg r cross join lateral jsonb_array_elements(case when jsonb_typeof(r.raw -> 'evaluations') = 'array' then r.raw -> 'evaluations' else '[]'::jsonb end) with ordinality as e(v, ord);
  create temporary table _ia_reg_hw on commit drop as
    select r.lid as reg_lid, e.v ->> 'studentId' as student_lid, e.v ->> 'taskId' as task_id, e.v ->> 'outcome' as outcome,
           coalesce((e.v ->> 'reviewedAt')::timestamptz, now()) as reviewed_at, e.ord
      from _ia_reg r cross join lateral jsonb_array_elements(case when jsonb_typeof(r.raw -> 'homeworkReviews') = 'array' then r.raw -> 'homeworkReviews' else '[]'::jsonb end) with ordinality as e(v, ord);

  -- Componentes financieras insertables → ids por tabla.
  create temporary table _ia_fin_ids on commit drop as
    select distinct m ->> 'table_name' as tbl, m ->> 'legacy_mobile_id' as lid
      from jsonb_array_elements(coalesce(p_classification #> '{aggregates,financial_components}', '[]'::jsonb)) c
      cross join lateral jsonb_array_elements(coalesce(c -> 'members', '[]'::jsonb)) m
     where c ->> 'status' = 'insertable';

  create temporary table _ia_pay on commit drop as
    with src as (select distinct on (x.r ->> 'id') x.r ->> 'id' as lid, x.r from jsonb_array_elements(v_pay) with ordinality as x(r, ord) order by x.r ->> 'id', x.ord)
    select f.lid, gen_random_uuid() as new_id, src.r as raw, src.r ->> 'studentId' as student_lid, src.r ->> 'replacesPaymentId' as replaces_lid,
           (src.r ->> 'amount')::numeric as amount, coalesce(src.r ->> 'currency', 'ARS') as currency, src.r ->> 'method' as method, (src.r ->> 'paidAt')::date as paid_at,
           src.r ->> 'notes' as notes, (src.r ->> 'voidedAt')::timestamptz as voided_at, src.r ->> 'voidReason' as void_reason, src.r ->> 'source' as source
      from _ia_fin_ids f left join src on src.lid = f.lid where f.tbl = 'payments';
  create temporary table _ia_pk on commit drop as
    with src as (select distinct on (x.r ->> 'id') x.r ->> 'id' as lid, x.r from jsonb_array_elements(v_pk) with ordinality as x(r, ord) order by x.r ->> 'id', x.ord)
    select f.lid, src.r as raw, src.r ->> 'studentId' as student_lid, (src.r ->> 'includedClasses')::int as included_classes, (src.r ->> 'amount')::numeric as amount,
           (src.r ->> 'validFrom')::date as valid_from, (src.r ->> 'validUntil')::date as valid_until, (src.r ->> 'voidedAt')::timestamptz as voided_at, src.r ->> 'voidReason' as void_reason
      from _ia_fin_ids f left join src on src.lid = f.lid where f.tbl = 'package_purchases';
  create temporary table _ia_chg on commit drop as
    with src as (select distinct on (x.r ->> 'id') x.r ->> 'id' as lid, x.r from jsonb_array_elements(v_chg) with ordinality as x(r, ord) order by x.r ->> 'id', x.ord)
    select f.lid, src.r as raw, src.r ->> 'studentId' as student_lid, src.r ->> 'chargeType' as charge_type, (src.r ->> 'originalAmount')::numeric as original_amount,
           coalesce(src.r ->> 'currency', 'ARS') as currency, (src.r ->> 'dueDate')::date as due_date, src.r ->> 'billingPeriod' as billing_period,
           src.r ->> 'savedLessonId' as saved_lesson_lid, src.r ->> 'packageId' as package_lid, src.r ->> 'trainingBillingAgreementId' as agreement_lid,
           src.r ->> 'trainingSeriesName' as training_series_name, src.r ->> 'calendarLessonId' as calendar_lesson_lid,
           (src.r ->> 'voidedAt')::timestamptz as voided_at, src.r ->> 'voidReason' as void_reason
      from _ia_fin_ids f left join src on src.lid = f.lid where f.tbl = 'payment_charges';
  create temporary table _ia_alloc on commit drop as
    with src as (select distinct on (x.r ->> 'id') x.r ->> 'id' as lid, x.r from jsonb_array_elements(v_alloc) with ordinality as x(r, ord) order by x.r ->> 'id', x.ord)
    select f.lid, src.r as raw, src.r ->> 'paymentId' as payment_lid, src.r ->> 'chargeId' as charge_lid, src.r ->> 'studentId' as student_lid, (src.r ->> 'amount')::numeric as amount
      from _ia_fin_ids f left join src on src.lid = f.lid where f.tbl = 'payment_allocations';
  create temporary table _ia_adj on commit drop as
    with src as (select distinct on (x.r ->> 'id') x.r ->> 'id' as lid, x.r from jsonb_array_elements(v_adj) with ordinality as x(r, ord) order by x.r ->> 'id', x.ord)
    select f.lid, src.r as raw, src.r ->> 'chargeId' as charge_lid, src.r ->> 'studentId' as student_lid, src.r ->> 'reason' as reason,
           (src.r ->> 'voidedAt')::timestamptz as voided_at, src.r ->> 'voidReason' as void_reason
      from _ia_fin_ids f left join src on src.lid = f.lid where f.tbl = 'payment_adjustments';
  create temporary table _ia_isc on commit drop as
    with src as (select distinct on (x.r ->> 'id') x.r ->> 'id' as lid, x.r from jsonb_array_elements(v_isc) with ordinality as x(r, ord) order by x.r ->> 'id', x.ord)
    select f.lid, src.r as raw, src.r ->> 'studentId' as student_lid, src.r ->> 'billingPeriod' as billing_period, (src.r ->> 'previousSurchargeAmount')::numeric as previous_surcharge_amount,
           src.r ->> 'voidedPaymentId' as voided_payment_lid, src.r ->> 'newPaymentId' as new_payment_lid,
           coalesce((src.r ->> 'correctedAt')::timestamptz, now()) as corrected_at, src.r ->> 'reason' as reason
      from _ia_fin_ids f left join src on src.lid = f.lid where f.tbl = 'initial_paid_surcharge_corrections';
  create temporary table _ia_fm on commit drop as
    with src as (select distinct on (x.r ->> 'id') x.r ->> 'id' as lid, x.r from jsonb_array_elements(v_fm) with ordinality as x(r, ord) order by x.r ->> 'id', x.ord)
    select f.lid, src.r as raw, src.r ->> 'studentId' as student_lid, src.r ->> 'billingPeriod' as billing_period, (src.r ->> 'effectiveJoinDate')::date as effective_join_date,
           src.r ->> 'criterion' as criterion, (src.r ->> 'classesRemaining')::int as classes_remaining, (src.r ->> 'classesPerFullPeriod')::int as classes_per_full_period,
           (src.r ->> 'permanentMonthlyAmount')::numeric as permanent_monthly_amount, (src.r ->> 'chargedAmount')::numeric as charged_amount, src.r ->> 'chargeId' as charge_lid,
           coalesce((src.r ->> 'confirmedAt')::timestamptz, now()) as confirmed_at, src.r ->> 'source' as source
      from _ia_fin_ids f left join src on src.lid = f.lid where f.tbl = 'first_month_proration_decisions';
  create temporary table _ia_pm on commit drop as
    with src as (select distinct on (x.r ->> 'id') x.r ->> 'id' as lid, x.r from jsonb_array_elements(v_pm) with ordinality as x(r, ord) order by x.r ->> 'id', x.ord)
    select f.lid, src.r as raw, src.r ->> 'packageId' as package_lid, src.r ->> 'studentId' as student_lid, src.r ->> 'movementType' as movement_type, (src.r ->> 'amount')::int as amount,
           src.r ->> 'savedLessonId' as saved_lesson_lid, src.r ->> 'reason' as reason, (src.r ->> 'voidedAt')::timestamptz as voided_at, src.r ->> 'voidReason' as void_reason
      from _ia_fin_ids f left join src on src.lid = f.lid where f.tbl = 'package_credit_movements';

  -- Todo lo que la clasificación manda agregar tiene que estar en el respaldo y no repetirse (si no, la vista previa quedó desactualizada).
  foreach v_name in array array['_ia_stu','_ia_cl_new','_ia_agr','_ia_lh','_ia_rr','_ia_lsn','_ia_reg','_ia_pay','_ia_pk','_ia_chg','_ia_alloc','_ia_adj','_ia_isc','_ia_fm','_ia_pm'] loop
    execute format('select count(*) from %I where %s is null', v_name, case when v_name in ('_ia_lh') then 'student_lid' else 'raw' end) into v_missing;
    if v_missing > 0 then
      raise exception 'No se encontró en el backup un dato que la vista previa pedía agregar — el preview quedó desactualizado.' using errcode = '22023';
    end if;
    execute format('select count(*) - count(distinct lid) from %I', v_name) into v_missing;
    if v_missing > 0 then
      raise exception 'El backup tiene datos repetidos — el preview quedó desactualizado.' using errcode = '22023';
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Escritura por lote de cada tabla (todas leen las tablas temporales de `_import_stage`)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public._import_apply_students(p_run_id uuid, p_owner uuid, p_preview_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from _ia_stu s join public.students w on w.owner_id = p_owner and w.legacy_mobile_id = s.lid) then
    raise exception 'Un alumno ya existe — el preview quedó desactualizado.' using errcode = '22023';
  end if;
  -- Coincidencia heurística NUEVA (sólo para las altas; los «crear aparte» ya la vio la profesora). Una unión por hash por señal.
  if exists (
    select 1 from _ia_stu s join public.students w on w.owner_id = p_owner and w.legacy_mobile_id is null and lower(btrim(w.name)) = lower(btrim(s.name))
     where s.kind = 'insert' and btrim(w.name) <> '')
  or exists (
    select 1 from _ia_stu s join public.students w on w.owner_id = p_owner and w.legacy_mobile_id is null and public._normalize_email(w.email) = public._normalize_email(s.email)
     where s.kind = 'insert' and w.email is not null and s.email is not null and public._normalize_email(w.email) <> '')
  or exists (
    select 1 from _ia_stu s join public.students w on w.owner_id = p_owner and w.legacy_mobile_id is null and public._normalize_phone(w.phone) = public._normalize_phone(s.phone)
     where s.kind = 'insert' and w.phone is not null and s.phone is not null and public._normalize_phone(w.phone) <> '')
  then
    raise exception 'Apareció una coincidencia heurística nueva desde que se generó el preview — generá un preview nuevo.' using errcode = '22023';
  end if;

  with ins as (
    insert into public.students (
      owner_id, legacy_mobile_id, name, phone, whatsapp, email, usual_days, usual_time, notes, birth_date,
      levels, initial_level, modality, status, category, billing_type, billing_plan, date_joined,
      last_reactivated_at, status_change_date, usual_duration_minutes, weekly_frequency, price,
      pending_homework, alerts, current_goals, strengths, areas_to_improve, is_featured, is_new
    )
    select p_owner, s.lid, s.name, s.phone, s.whatsapp, s.email, s.usual_days, s.usual_time, s.notes, s.birth_date,
           s.levels, s.initial_level, s.modality, s.status, s.category, s.billing_type, s.billing_plan, s.date_joined,
           s.last_reactivated_at, s.status_change_date, s.usual_duration_minutes, s.weekly_frequency, s.price,
           s.pending_homework, s.alerts, s.current_goals, s.strengths, s.areas_to_improve, s.is_featured, s.is_new
      from _ia_stu s
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'students', i.id, 'inserted', null, to_jsonb(i) from ins i;

  -- Vínculos de identidad («vincular»): asigna legacy_mobile_id al alumno web candidato, NUNCA otro campo salvo que además venga en los reemplazos.
  with tgt as (
    select d.bid, d.cid from _ia_dec d where d.decision = 'link'
  ), before as (
    select s.id, to_jsonb(s) as b from public.students s join tgt on tgt.cid = s.id where s.owner_id = p_owner
  ), upd as (
    update public.students s set legacy_mobile_id = tgt.bid from tgt where s.id = tgt.cid and s.owner_id = p_owner returning s.*
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'students', u.id, 'identity_linked', b.b, to_jsonb(u) from upd u join before b on b.id = u.id;

  -- Reemplazos de campos elegidos (ya validados por `_import_validate_selection`).
  with ov as (
    select o.row_id, o.fields, r.raw
      from _ia_ov o
      join public.students s on s.id = o.row_id and s.owner_id = p_owner
      left join lateral (
        select dc.backup_legacy_mobile_id from public.import_preview_duplicate_candidates dc
         where dc.preview_id = p_preview_id and dc.candidate_student_id = o.row_id order by dc.id limit 1) d on true
      join _ia_stu_raw r on r.lid = coalesce(d.backup_legacy_mobile_id, s.legacy_mobile_id)
     where o.table_name = 'students'
  ), before as (
    select s.id, to_jsonb(s) as b from public.students s join ov on ov.row_id = s.id
  ), upd as (
    update public.students s set
      name = case when 'name' = any(ov.fields) then btrim(coalesce(ov.raw ->> 'name', '')) else s.name end,
      phone = case when 'phone' = any(ov.fields) then ov.raw ->> 'phone' else s.phone end,
      whatsapp = case when 'whatsapp' = any(ov.fields) then ov.raw ->> 'whatsapp' else s.whatsapp end,
      email = case when 'email' = any(ov.fields) then ov.raw ->> 'email' else s.email end,
      notes = case when 'notes' = any(ov.fields) then ov.raw ->> 'notes' else s.notes end,
      birth_date = case when 'birth_date' = any(ov.fields) then (ov.raw ->> 'birthDate')::date else s.birth_date end,
      current_goals = case when 'current_goals' = any(ov.fields) then array(select jsonb_array_elements_text(coalesce(ov.raw -> 'currentGoals', '[]'::jsonb))) else s.current_goals end,
      strengths = case when 'strengths' = any(ov.fields) then array(select jsonb_array_elements_text(coalesce(ov.raw -> 'strengths', '[]'::jsonb))) else s.strengths end,
      areas_to_improve = case when 'areas_to_improve' = any(ov.fields) then array(select jsonb_array_elements_text(coalesce(ov.raw -> 'areasToImprove', '[]'::jsonb))) else s.areas_to_improve end,
      alerts = case when 'alerts' = any(ov.fields) then array(select jsonb_array_elements_text(coalesce(ov.raw -> 'alerts', '[]'::jsonb))) else s.alerts end,
      usual_days = case when 'usual_days' = any(ov.fields) then array(select jsonb_array_elements_text(coalesce(ov.raw -> 'usualDays', '[]'::jsonb))) else s.usual_days end,
      usual_time = case when 'usual_time' = any(ov.fields) then ov.raw ->> 'usualTime' else s.usual_time end
    from ov where s.id = ov.row_id returning s.*
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'students', u.id, 'field_overwritten', b.b, to_jsonb(u) from upd u join before b on b.id = u.id;
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

create or replace function public._import_apply_agreements(p_run_id uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from _ia_agr s join public.training_billing_agreements w on w.owner_id = p_owner and w.legacy_mobile_id = s.lid) then
    raise exception 'Un acuerdo ya existe — el preview quedó desactualizado.' using errcode = '22023';
  end if;
  with ins as (
    insert into public.training_billing_agreements (owner_id, legacy_mobile_id, monthly_fee, pending_monthly_fee, pending_monthly_fee_effective_from, start_period)
      select p_owner, s.lid, s.monthly_fee, s.pending_monthly_fee, s.pending_from, s.start_period from _ia_agr s
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'training_billing_agreements', i.id, 'inserted', null, to_jsonb(i) from ins i;
end;
$$;

create or replace function public._import_apply_level_history(p_run_id uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from _ia_lh s join public.student_level_history w on w.owner_id = p_owner and w.legacy_mobile_id = s.lid) then
    raise exception 'Una entrada de nivel ya existe — el preview quedó desactualizado.' using errcode = '22023';
  end if;
  -- Una entrada cuyo alumno no se resuelve se omite (defensivo: los perfiles siempre referencian alumnos del mismo respaldo).
  with ins as (
    insert into public.student_level_history (owner_id, student_id, legacy_mobile_id, level, from_level, achieved_on, recorded_at, previous_milestone_at, duration_days, note, origin)
      select p_owner, st.id, s.lid, s.level, s.from_level, s.achieved_on, s.recorded_at, s.previous_milestone_at, s.duration_days, s.note, s.origin
        from _ia_lh s join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = s.student_lid
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'student_level_history', i.id, 'inserted', null, to_jsonb(i) from ins i;
end;
$$;

create or replace function public._import_apply_recurrence_rules(p_run_id uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from _ia_rr s join public.recurrence_rules w on w.owner_id = p_owner and w.legacy_mobile_id = s.lid) then
    raise exception 'Una serie ya existe — el preview quedó desactualizado.' using errcode = '22023';
  end if;
  -- `supersedes_recurrence_id` se resuelve en el mismo INSERT (serie agregada en esta corrida con id asignado de antemano, o ya existente en la web).
  with ins as (
    insert into public.recurrence_rules (id, owner_id, legacy_mobile_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, end_date, status,
                                         effective_from_date, class_title, activity_kind, training_billing_agreement_id, supersedes_recurrence_id)
      select s.new_id, p_owner, s.lid, st.id, s.rule_type, s.cycle_length_weeks, s.weeks, s.modality, s.timezone, s.start_date, s.end_date, s.status,
             s.effective_from_date, s.class_title, s.activity_kind, ag.id, coalesce(prev.new_id, w.id)
        from _ia_rr s
        left join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = s.primary_student_lid
        left join public.training_billing_agreements ag on ag.owner_id = p_owner and ag.legacy_mobile_id = s.agreement_lid
        left join _ia_rr prev on prev.lid = s.supersedes_lid
        left join public.recurrence_rules w on w.owner_id = p_owner and w.legacy_mobile_id = s.supersedes_lid
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'recurrence_rules', i.id, 'inserted', null, to_jsonb(i) from ins i;

  with ins as (
    insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id)
      select p_owner, rr.new_id, st.id
        from _ia_rr_part p
        join _ia_rr rr on rr.lid = p.rule_lid
        join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = p.student_lid
       order by p.rule_lid, p.ord
    on conflict (recurrence_rule_id, student_id) do nothing
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'recurrence_rule_participants', i.id, 'inserted', null, to_jsonb(i) from ins i;
end;
$$;

create or replace function public._import_apply_calendar_lessons(p_run_id uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from _ia_lsn s join public.calendar_lessons w on w.owner_id = p_owner and w.legacy_mobile_id = s.lid) then
    raise exception 'Una clase ya existe — el preview quedó desactualizado.' using errcode = '22023';
  end if;
  -- Sólo se agregan las clases cuyo alumno principal se resuelve (defensivo, igual que antes); `freed_by_lesson_id` apunta a otra clase agregada
  -- en esta corrida (sólo si ESA también se agrega) o a una que ya existe en la web.
  with base as (
    select s.*, st.id as student_id
      from _ia_lsn s join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = s.primary_student_lid
  ), ins as (
    insert into public.calendar_lessons (
      id, owner_id, legacy_mobile_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color,
      overlap_allowed, notes, is_recurring, recurrence_id, recurrence_occurrence_key, recurrence_index, recurrence_original_start,
      schedule_adjustment, class_title, activity_kind, freed_by_lesson_id
    )
      select b.new_id, p_owner, b.lid, b.student_id, b.student_name, b.level, b.lesson_type, b.start_at, b.end_at, b.modality, b.status, b.color,
             b.overlap_allowed, b.notes, b.is_recurring, rr.id, b.recurrence_occurrence_key, b.recurrence_index, b.recurrence_original_start,
             b.schedule_adjustment, b.class_title, b.activity_kind, coalesce(fl.new_id, fw.id)
        from base b
        left join public.recurrence_rules rr on rr.owner_id = p_owner and rr.legacy_mobile_id = b.recurrence_lid
        left join base fl on fl.lid = b.freed_lid
        left join public.calendar_lessons fw on fw.owner_id = p_owner and fw.legacy_mobile_id = b.freed_lid
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'calendar_lessons', i.id, 'inserted', null, to_jsonb(i) from ins i;

  with ins as (
    insert into public.calendar_lesson_participants (owner_id, calendar_lesson_id, student_id, student_name, level)
      select p_owner, l.new_id, st.id, p.student_name, p.level
        from _ia_lsn_part p
        join _ia_lsn l on l.lid = p.lesson_lid
        join public.calendar_lessons cl on cl.id = l.new_id and cl.owner_id = p_owner
        join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = p.student_lid
       order by p.lesson_lid, p.ord
    on conflict (calendar_lesson_id, student_id) do nothing
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'calendar_lesson_participants', i.id, 'inserted', null, to_jsonb(i) from ins i;
end;
$$;

create or replace function public._import_apply_recurrence_exceptions(p_run_id uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sólo las excepciones de series agregadas en esta corrida (si la serie ya existía el agregado quedó preservado y sus excepciones no se tocan).
  with ins as (
    insert into public.recurrence_exceptions (owner_id, recurrence_id, occurrence_key, exception_type, replacement_lesson_id)
      select p_owner, rr.new_id, e.occurrence_key, e.exception_type, cl.id
        from _ia_exc e
        join _ia_rr rr on rr.lid = e.recurrence_lid
        left join public.calendar_lessons cl on cl.owner_id = p_owner and cl.legacy_mobile_id = e.replacement_lid
       order by e.ord
    on conflict do nothing
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'recurrence_exceptions', i.id, 'inserted', null, to_jsonb(i) from ins i;
end;
$$;

create or replace function public._import_apply_lesson_registrations(p_run_id uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from _ia_reg s join public.lesson_registrations w on w.owner_id = p_owner and w.legacy_mobile_id = s.lid) then
    raise exception 'Un registro ya existe — el preview quedó desactualizado.' using errcode = '22023';
  end if;
  with ins as (
    insert into public.lesson_registrations (
      id, owner_id, legacy_mobile_id, calendar_lesson_id, activity_kind, counts_as_class, homework_description, homework_due_date,
      billed_amount, scheduled_start_at, actual_started_at, actual_ended_at, outcome, holiday_exception, modality, scheduled_end_at,
      late_cancellation_policy, late_cancellation_percentage, rescheduled_from_registration_id
    )
      select s.new_id, p_owner, s.lid, cl.id, s.activity_kind, s.counts_as_class, s.homework_description, s.homework_due_date,
             s.billed_amount, s.scheduled_start_at, s.actual_started_at, s.actual_ended_at, s.outcome, s.holiday_exception, s.modality, s.scheduled_end_at,
             s.late_cancellation_policy, s.late_cancellation_percentage, coalesce(prev.new_id, w.id)
        from _ia_reg s
        left join public.calendar_lessons cl on cl.owner_id = p_owner and cl.legacy_mobile_id = s.calendar_lesson_lid
        left join _ia_reg prev on prev.lid = s.rescheduled_lid
        left join public.lesson_registrations w on w.owner_id = p_owner and w.legacy_mobile_id = s.rescheduled_lid
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'lesson_registrations', i.id, 'inserted', null, to_jsonb(i) from ins i;

  with ins as (
    insert into public.lesson_registration_students (owner_id, lesson_registration_id, student_id)
      select p_owner, r.new_id, st.id from _ia_reg_roster x join _ia_reg r on r.lid = x.reg_lid
        join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = x.student_lid order by x.reg_lid, x.ord
    on conflict (lesson_registration_id, student_id) do nothing returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'lesson_registration_students', i.id, 'inserted', null, to_jsonb(i) from ins i;

  with ins as (
    insert into public.lesson_registration_attendance (owner_id, lesson_registration_id, student_id, status, late_minutes)
      select p_owner, r.new_id, st.id, x.status, x.late_minutes from _ia_reg_att x join _ia_reg r on r.lid = x.reg_lid
        join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = x.student_lid order by x.reg_lid, x.ord
    on conflict (lesson_registration_id, student_id) do nothing returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'lesson_registration_attendance', i.id, 'inserted', null, to_jsonb(i) from ins i;

  with ins as (
    insert into public.lesson_registration_evaluations (owner_id, lesson_registration_id, student_id, general_grade, skill_grades, strengths, areas_to_improve,
                                                        individual_observation, individual_homework_description, individual_homework_due_date, billed_amount)
      select p_owner, r.new_id, st.id, x.general_grade, x.skill_grades, x.strengths, x.areas_to_improve,
             x.individual_observation, x.individual_homework_description, x.individual_homework_due_date, x.billed_amount
        from _ia_reg_eval x join _ia_reg r on r.lid = x.reg_lid
        join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = x.student_lid order by x.reg_lid, x.ord
    on conflict (lesson_registration_id, student_id) do nothing returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'lesson_registration_evaluations', i.id, 'inserted', null, to_jsonb(i) from ins i;

  with ins as (
    insert into public.lesson_registration_homework_reviews (owner_id, lesson_registration_id, student_id, task_id, outcome, reviewed_at)
      select p_owner, r.new_id, st.id, x.task_id, x.outcome, x.reviewed_at from _ia_reg_hw x join _ia_reg r on r.lid = x.reg_lid
        join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = x.student_lid order by x.reg_lid, x.ord
    on conflict (lesson_registration_id, student_id, task_id) do nothing returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'lesson_registration_homework_reviews', i.id, 'inserted', null, to_jsonb(i) from ins i;
end;
$$;

create or replace function public._import_apply_financial(p_run_id uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from _ia_pay s join public.payments w on w.owner_id = p_owner and w.legacy_mobile_id = s.lid)
     or exists (select 1 from _ia_pk s join public.package_purchases w on w.owner_id = p_owner and w.legacy_mobile_id = s.lid)
     or exists (select 1 from _ia_chg s join public.payment_charges w on w.owner_id = p_owner and w.legacy_mobile_id = s.lid)
     or exists (select 1 from _ia_alloc s join public.payment_allocations w on w.owner_id = p_owner and w.legacy_mobile_id = s.lid)
     or exists (select 1 from _ia_adj s join public.payment_adjustments w on w.owner_id = p_owner and w.legacy_mobile_id = s.lid)
     or exists (select 1 from _ia_isc s join public.initial_paid_surcharge_corrections w on w.owner_id = p_owner and w.legacy_mobile_id = s.lid)
     or exists (select 1 from _ia_fm s join public.first_month_proration_decisions w on w.owner_id = p_owner and w.legacy_mobile_id = s.lid)
     or exists (select 1 from _ia_pm s join public.package_credit_movements w on w.owner_id = p_owner and w.legacy_mobile_id = s.lid) then
    raise exception 'Un dato de cobros ya existe — el preview quedó desactualizado.' using errcode = '22023';
  end if;

  -- payments (con `replaces_payment_id` resuelto en el mismo INSERT)
  with base as (
    select s.*, st.id as student_id from _ia_pay s join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = s.student_lid
  ), ins as (
    insert into public.payments (id, owner_id, legacy_mobile_id, student_id, amount, currency, method, paid_at, notes, voided_at, void_reason, source, replaces_payment_id)
      select b.new_id, p_owner, b.lid, b.student_id, b.amount, b.currency, b.method, b.paid_at, b.notes, b.voided_at, b.void_reason, b.source, coalesce(prev.new_id, w.id)
        from base b
        left join base prev on prev.lid = b.replaces_lid
        left join public.payments w on w.owner_id = p_owner and w.legacy_mobile_id = b.replaces_lid
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'payments', i.id, 'inserted', null, to_jsonb(i) from ins i;

  with ins as (
    insert into public.package_purchases (owner_id, legacy_mobile_id, student_id, included_classes, amount, valid_from, valid_until, voided_at, void_reason)
      select p_owner, s.lid, st.id, s.included_classes, s.amount, s.valid_from, s.valid_until, s.voided_at, s.void_reason
        from _ia_pk s join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = s.student_lid
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'package_purchases', i.id, 'inserted', null, to_jsonb(i) from ins i;

  with ins as (
    insert into public.payment_charges (owner_id, legacy_mobile_id, student_id, charge_type, original_amount, currency, due_date, billing_period, saved_lesson_id, package_id,
                                        training_billing_agreement_id, training_series_name, calendar_lesson_id, voided_at, void_reason)
      select p_owner, s.lid, st.id, s.charge_type, s.original_amount, s.currency, s.due_date, s.billing_period, lr.id, pp.id, ag.id, s.training_series_name, cl.id, s.voided_at, s.void_reason
        from _ia_chg s
        join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = s.student_lid
        left join public.lesson_registrations lr on lr.owner_id = p_owner and lr.legacy_mobile_id = s.saved_lesson_lid
        left join public.package_purchases pp on pp.owner_id = p_owner and pp.legacy_mobile_id = s.package_lid
        left join public.training_billing_agreements ag on ag.owner_id = p_owner and ag.legacy_mobile_id = s.agreement_lid
        left join public.calendar_lessons cl on cl.owner_id = p_owner and cl.legacy_mobile_id = s.calendar_lesson_lid
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'payment_charges', i.id, 'inserted', null, to_jsonb(i) from ins i;

  with ins as (
    insert into public.payment_allocations (owner_id, legacy_mobile_id, payment_id, charge_id, student_id, amount)
      select p_owner, s.lid, p.id, c.id, st.id, s.amount
        from _ia_alloc s
        join public.payments p on p.owner_id = p_owner and p.legacy_mobile_id = s.payment_lid
        join public.payment_charges c on c.owner_id = p_owner and c.legacy_mobile_id = s.charge_lid
        join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = s.student_lid
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'payment_allocations', i.id, 'inserted', null, to_jsonb(i) from ins i;

  with ins as (
    insert into public.payment_adjustments (owner_id, legacy_mobile_id, charge_id, student_id, reason, voided_at, void_reason)
      select p_owner, s.lid, c.id, st.id, s.reason, s.voided_at, s.void_reason
        from _ia_adj s
        join public.payment_charges c on c.owner_id = p_owner and c.legacy_mobile_id = s.charge_lid
        join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = s.student_lid
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'payment_adjustments', i.id, 'inserted', null, to_jsonb(i) from ins i;

  with ins as (
    insert into public.initial_paid_surcharge_corrections (owner_id, legacy_mobile_id, student_id, billing_period, previous_surcharge_amount, voided_payment_id, new_payment_id, corrected_at, reason)
      select p_owner, s.lid, st.id, s.billing_period, s.previous_surcharge_amount, pv.id, pn.id, s.corrected_at, s.reason
        from _ia_isc s
        join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = s.student_lid
        left join public.payments pv on pv.owner_id = p_owner and pv.legacy_mobile_id = s.voided_payment_lid
        left join public.payments pn on pn.owner_id = p_owner and pn.legacy_mobile_id = s.new_payment_lid
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'initial_paid_surcharge_corrections', i.id, 'inserted', null, to_jsonb(i) from ins i;

  with ins as (
    insert into public.first_month_proration_decisions (owner_id, legacy_mobile_id, student_id, billing_period, effective_join_date, criterion, classes_remaining, classes_per_full_period,
                                                        permanent_monthly_amount, charged_amount, charge_id, confirmed_at, source)
      select p_owner, s.lid, st.id, s.billing_period, s.effective_join_date, s.criterion, s.classes_remaining, s.classes_per_full_period,
             s.permanent_monthly_amount, s.charged_amount, c.id, s.confirmed_at, s.source
        from _ia_fm s
        join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = s.student_lid
        left join public.payment_charges c on c.owner_id = p_owner and c.legacy_mobile_id = s.charge_lid
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'first_month_proration_decisions', i.id, 'inserted', null, to_jsonb(i) from ins i;

  with ins as (
    insert into public.package_credit_movements (owner_id, legacy_mobile_id, package_id, student_id, movement_type, amount, saved_lesson_id, reason, voided_at, void_reason)
      select p_owner, s.lid, pp.id, st.id, s.movement_type, s.amount, lr.id, s.reason, s.voided_at, s.void_reason
        from _ia_pm s
        join public.package_purchases pp on pp.owner_id = p_owner and pp.legacy_mobile_id = s.package_lid
        join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = s.student_lid
        left join public.lesson_registrations lr on lr.owner_id = p_owner and lr.legacy_mobile_id = s.saved_lesson_lid
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'package_credit_movements', i.id, 'inserted', null, to_jsonb(i) from ins i;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Re-verificación de huellas (nada de lo que la profesora vio cambió desde la vista previa) — por lote
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public._import_verify_fingerprints(p_preview_id uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bad boolean;
  v_fp record;
begin
  -- Se une sólo por la clave de la fila y el dueño se comprueba en el CASE (ver `_import_undo_analyze`).
  select exists (
    select 1 from public.import_preview_row_fingerprints f
      left join public.students s on s.id = f.row_id
     where f.preview_id = p_preview_id and f.table_name = 'students'
       and f.fingerprint is distinct from (case when s.owner_id = p_owner then public._fingerprint_canonical('students', to_jsonb(s)) end)
  ) or exists (
    select 1 from public.import_preview_row_fingerprints f
      left join public.custom_levels c on c.id = f.row_id
     where f.preview_id = p_preview_id and f.table_name = 'custom_levels'
       and f.fingerprint is distinct from (case when c.owner_id = p_owner then public._fingerprint_canonical('custom_levels', to_jsonb(c)) end)
  ) or exists (
    select 1 from public.import_preview_duplicate_candidates dc
      left join public.students s on s.id = dc.candidate_student_id
     where dc.preview_id = p_preview_id
       and dc.candidate_fingerprint is distinct from (case when s.owner_id = p_owner then public._fingerprint_canonical('students', to_jsonb(s)) end)
  ) into v_bad;
  if v_bad then
    raise exception 'Una fila cambió desde que se generó el preview. Generá un preview nuevo.' using errcode = '22023';
  end if;
  -- Singletons (como mucho tres filas): misma función por fila que antes.
  for v_fp in select * from public.import_preview_row_fingerprints where preview_id = p_preview_id and table_name not in ('students', 'custom_levels') loop
    if public._fingerprint_row(v_fp.table_name, v_fp.row_id, p_owner) is distinct from v_fp.fingerprint then
      raise exception 'Una fila cambió desde que se generó el preview. Generá un preview nuevo.' using errcode = '22023';
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Invariantes de la importación (mismas reglas que antes; las decisiones se comprueban por lote)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public._import_validate_invariants(p_run_id uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Una sola pasada por las instantáneas de la corrida (antes cada regla las recorría de nuevo y releía el JSON de cada fila).
  drop table if exists _iv_snap;
  create temporary table _iv_snap on commit drop as
    select s.table_name, s.row_id, s.action, (s.new_row ->> 'amount') as amount_txt, (s.new_row ->> 'student_id') as student_txt,
           (s.new_row ->> 'charge_type') as charge_type, (s.new_row ->> 'package_id') as package_id, (s.new_row ->> 'legacy_mobile_id') as legacy_id
      from public.import_run_row_snapshots s where s.import_run_id = p_run_id;
  create index on _iv_snap (table_name, row_id);

  if exists (select 1 from _iv_snap s where s.amount_txt is not null and s.amount_txt::numeric < 0) then
    raise exception 'Invariante violada: una fila importada tiene un importe negativo.';
  end if;

  if exists (
    select 1 from public.payments p
      join _iv_snap s on s.table_name = 'payments' and s.row_id = p.id
      left join public.payment_allocations pa on pa.payment_id = p.id
     where p.owner_id = p_owner
     group by p.id, p.amount
    having coalesce(sum(pa.amount), 0) > p.amount
  ) then
    raise exception 'Invariante violada: las asignaciones de un pago superan su importe.';
  end if;

  if exists (
    select 1 from public.payment_charges c
      join _iv_snap s on s.table_name = 'payment_charges' and s.row_id = c.id
      left join public.payment_allocations pa on pa.charge_id = c.id
     where c.owner_id = p_owner
     group by c.id, c.original_amount
    having coalesce(sum(pa.amount), 0) > c.original_amount
  ) then
    raise exception 'Invariante violada: las asignaciones de un cargo superan su importe original.';
  end if;

  -- Asume `movement_type='consumo'` cuenta clases consumidas como cantidad positiva en `amount` — mismo criterio que el motor de paquetes existente.
  if exists (
    select 1 from public.package_purchases pp
      join _iv_snap s on s.table_name = 'package_purchases' and s.row_id = pp.id
      left join public.package_credit_movements m on m.package_id = pp.id
     where pp.owner_id = p_owner
     group by pp.id, pp.included_classes
    having coalesce(sum(m.amount) filter (where m.movement_type = 'consumo'), 0) > pp.included_classes
  ) then
    raise exception 'Invariante violada: un paquete tiene más clases consumidas que incluidas.';
  end if;

  -- (EXCEPT en lugar de un anti-join: con las filas recién insertadas aún sin estadísticas el planificador elegía un lazo anidado de ~770.000 comparaciones.)
  if exists (
    select s.student_txt::uuid from _iv_snap s
     where s.table_name in ('recurrence_rule_participants','calendar_lesson_participants','lesson_registration_students','lesson_registration_attendance','lesson_registration_evaluations','lesson_registration_homework_reviews')
       and s.student_txt is not null
    except
    select st.id from public.students st where st.owner_id = p_owner
  ) then
    raise exception 'Invariante violada: un participante referencia un alumno de otro owner.';
  end if;

  if exists (
    select 1 from _iv_snap s where s.table_name = 'payment_charges' and s.action = 'inserted' and s.charge_type = 'paquete' and s.package_id is null
  ) then
    raise exception 'Invariante violada: un cargo de tipo paquete quedó sin compra asociada.';
  end if;

  -- Toda decisión de duplicado aceptada debe haberse materializado realmente (`skip` es, a propósito, un no-op) — comprobación por lote.
  if exists (
    select 1 from public.import_runs ir
      cross join lateral jsonb_to_recordset(coalesce(ir.duplicate_decisions, '[]'::jsonb)) as x(backup_legacy_mobile_id text, decision text, candidate_student_id uuid)
      left join _iv_snap s on s.table_name = 'students' and s.action = 'inserted' and s.legacy_id = x.backup_legacy_mobile_id
     where ir.id = p_run_id and x.decision = 'create_separate' and s.row_id is null
  ) then
    raise exception 'Invariante violada: una decisión «crear aparte» no se materializó.';
  end if;
  if exists (
    select 1 from public.import_runs ir
      cross join lateral jsonb_to_recordset(coalesce(ir.duplicate_decisions, '[]'::jsonb)) as x(backup_legacy_mobile_id text, decision text, candidate_student_id uuid)
      left join _iv_snap s on s.table_name = 'students' and s.action = 'identity_linked' and s.row_id = x.candidate_student_id
     where ir.id = p_run_id and x.decision = 'link' and s.row_id is null
  ) then
    raise exception 'Invariante violada: una decisión «vincular» no se materializó.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Confirmar la importación (misma firma, mismo resultado, misma idempotencia)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.apply_backup_import(p_preview_id uuid, p_field_overrides jsonb, p_duplicate_decisions jsonb)
returns table(import_run_id uuid, summary jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_preview record;
  v_payload jsonb;
  v_run_id uuid;
  v_summary jsonb;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.'; end if;

  -- ---- Fase 1: SIN lock de cuenta. Sólo lee la vista previa (inmutable) y prepara todo lo que se puede preparar antes. ----
  select ip.id, ip.status, ip.expires_at, ip.classification into v_preview from public.import_previews ip where ip.id = p_preview_id and ip.owner_id = v_owner;
  if not found then raise exception 'El preview no existe o no te pertenece.'; end if;

  -- Reintento (respuesta perdida / doble clic): la importación ya se aplicó para esta vista previa → resultado canónico, cero escrituras.
  select ir.id, ir.summary into v_run_id, v_summary from public.import_runs as ir where ir.owner_id = v_owner and ir.preview_id = p_preview_id;
  if found then
    return query select v_run_id, v_summary || jsonb_build_object('replayed', true);
    return;
  end if;

  if v_preview.status <> 'pending' or v_preview.expires_at < now() then
    raise exception 'El preview ya no es válido (vencido o ya resuelto). Generá uno nuevo.';
  end if;

  perform public._import_validate_selection(p_preview_id, v_preview.classification, p_field_overrides, p_duplicate_decisions);
  select ip.normalized_payload into v_payload from public.import_previews ip where ip.id = p_preview_id and ip.owner_id = v_owner;
  perform public._import_stage(v_owner, v_payload, v_preview.classification, p_field_overrides, p_duplicate_decisions);

  -- ---- Fase 2: lock de la cuenta (serializa importaciones y deshacer de la misma cuenta). Sólo cubre re-verificación + escritura. ----
  perform pg_advisory_xact_lock(hashtext('backup_import:' || v_owner::text));

  select ip.id, ip.status, ip.expires_at, ip.backup_checksum, ip.schema_version, ip.app_version, ip.classification
    into v_preview from public.import_previews ip where ip.id = p_preview_id and ip.owner_id = v_owner for update;
  if not found then raise exception 'El preview no existe o no te pertenece.'; end if;

  select ir.id, ir.summary into v_run_id, v_summary from public.import_runs as ir where ir.owner_id = v_owner and ir.preview_id = p_preview_id;
  if found then
    return query select v_run_id, v_summary || jsonb_build_object('replayed', true);
    return;
  end if;
  if v_preview.status <> 'pending' or v_preview.expires_at < now() then
    raise exception 'El preview ya no es válido (vencido o ya resuelto). Generá uno nuevo.';
  end if;

  insert into public.import_runs (owner_id, preview_id, backup_checksum, schema_version, app_version, summary, field_overrides, duplicate_decisions, retained_payload)
    values (v_owner, p_preview_id, v_preview.backup_checksum, v_preview.schema_version, v_preview.app_version, '{}'::jsonb,
            coalesce(p_field_overrides, '[]'::jsonb), coalesce(p_duplicate_decisions, '[]'::jsonb), v_payload)
    on conflict (owner_id, preview_id) do nothing
    returning id into v_run_id;
  if v_run_id is null then
    select ir.id, ir.summary into v_run_id, v_summary from public.import_runs as ir where ir.owner_id = v_owner and ir.preview_id = p_preview_id;
    return query select v_run_id, v_summary || jsonb_build_object('replayed', true);
    return;
  end if;

  perform public._import_verify_fingerprints(p_preview_id, v_owner);

  -- Orden topológico (igual que antes): alumnos → niveles → perfil/presupuesto/disponibilidad → acuerdos → historial de niveles → recargos →
  -- series → clases → excepciones → registros → cobros.
  perform public._import_apply_students(v_run_id, v_owner, p_preview_id);
  perform public._import_apply_custom_levels(v_run_id, v_owner);
  perform public._apply_singleton(v_run_id, v_owner, 'teacher_profiles', v_payload -> 'teacherProfile', v_preview.classification -> 'maestros' -> 'teacher_profiles', p_field_overrides);
  perform public._apply_singleton(v_run_id, v_owner, 'budget_distribution_settings', v_payload -> 'budgetDistribution', v_preview.classification -> 'maestros' -> 'budget_distribution_settings', p_field_overrides);
  perform public._apply_singleton(v_run_id, v_owner, 'teacher_availability', v_payload -> 'teacherAvailability', v_preview.classification -> 'maestros' -> 'teacher_availability', p_field_overrides);
  perform public._import_apply_agreements(v_run_id, v_owner);
  perform public._import_apply_level_history(v_run_id, v_owner);
  perform public._apply_surcharge_settings(v_run_id, v_owner, v_payload, v_preview.classification);
  perform public._import_apply_recurrence_rules(v_run_id, v_owner);
  perform public._import_apply_calendar_lessons(v_run_id, v_owner);
  perform public._import_apply_recurrence_exceptions(v_run_id, v_owner);
  perform public._import_apply_lesson_registrations(v_run_id, v_owner);
  perform public._import_apply_financial(v_run_id, v_owner);

  perform public._import_validate_invariants(v_run_id, v_owner);

  select jsonb_build_object(
    'replayed', false,
    'counts_by_table', (
      select jsonb_object_agg(s.table_name, s.cnt) from (
        select rs.table_name, count(*) as cnt from public.import_run_row_snapshots as rs where rs.import_run_id = v_run_id group by rs.table_name
      ) s
    ),
    'total_rows_written', (select count(*) from public.import_run_row_snapshots as rs2 where rs2.import_run_id = v_run_id)
  ) into v_summary;

  update public.import_runs set summary = v_summary where id = v_run_id;
  update public.import_previews set status = 'applied' where id = p_preview_id;

  return query select v_run_id, v_summary;
end;
$$;

revoke all on function public._import_validate_selection(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._import_stage(uuid, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._import_apply_students(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public._import_apply_custom_levels(uuid, uuid) from public, anon, authenticated;
revoke all on function public._import_apply_agreements(uuid, uuid) from public, anon, authenticated;
revoke all on function public._import_apply_level_history(uuid, uuid) from public, anon, authenticated;
revoke all on function public._import_apply_recurrence_rules(uuid, uuid) from public, anon, authenticated;
revoke all on function public._import_apply_calendar_lessons(uuid, uuid) from public, anon, authenticated;
revoke all on function public._import_apply_recurrence_exceptions(uuid, uuid) from public, anon, authenticated;
revoke all on function public._import_apply_lesson_registrations(uuid, uuid) from public, anon, authenticated;
revoke all on function public._import_apply_financial(uuid, uuid) from public, anon, authenticated;
revoke all on function public._import_verify_fingerprints(uuid, uuid) from public, anon, authenticated;
revoke all on function public._import_validate_invariants(uuid, uuid) from public, anon, authenticated;
