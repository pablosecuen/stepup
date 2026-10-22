-- TeacherFlow Web — la baja («Inactivo») quita al alumno de la agenda futura, de forma atómica.
--
-- Problema comprobado (22/10/2026, cuenta real): al pasar un alumno a «Inactivo» sólo cambiaba su estado
-- (`change_student_status`); seguía figurando en las series y clases por venir, así que el Calendario le seguía mostrando clases a
-- alguien dado de baja. Archivar ya tenía la poda atómica (`archive_student_and_prune_future`, Fase 10).
--
-- Corrección aditiva (nunca edita 20260928110000, ya aplicada): `create or replace` de las MISMAS dos funciones.
--  - archive_student_and_prune_future acepta también 'inactivo' y, para la baja, EXIGE remove_from_future = true (no hay opción de
--    conservar la agenda). Todo lo demás —plan vivo recalculado en el servidor, promoción determinística, congelamiento del
--    tramo anterior, series terminadas sólo si el alumno era el único participante, clases sueltas canceladas, idempotencia por
--    operation_id— es idéntico a archivar. Nunca se borra nada: clases dictadas, registros, tareas, fotos, reportes y movimientos
--    financieros no se tocan; reactivar sólo vuelve el estado a activo y nunca reconstruye la agenda retirada.
--  - change_student_status rechaza 'inactivo' (como ya hacía con 'archivado'): la baja no puede saltearse la poda por otra vía.
-- `create or replace function` reinicia los privilegios por defecto: se repiten el revoke/grant de siempre.

create or replace function public.archive_student_and_prune_future(p_payload jsonb)
returns public.students
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_student_id uuid := (p_payload->>'student_id')::uuid;
  v_status text := p_payload->>'status';
  v_occurred_on date := (p_payload->>'occurred_on')::date;
  v_reason text := nullif(p_payload->>'reason', '');
  v_internal_note text := nullif(p_payload->>'internal_note', '');
  v_remove_from_future boolean := coalesce((p_payload->>'remove_from_future')::boolean, false);
  v_operation_id uuid := (p_payload->>'operation_id')::uuid;
  v_effective_instant timestamptz;
  v_result public.students;
  v_existing_history public.student_status_history%rowtype;
  v_canonical_payload jsonb;
  v_entry jsonb;
  v_entry_text text;
  v_occ jsonb;
  v_new_lesson_id uuid;
  -- Autoridad real: conjuntos vivos vs. conjuntos recibidos.
  v_live_rule_ids uuid[];
  v_submitted_rule_ids uuid[];
  v_live_loose_ids uuid[];
  v_submitted_loose_ids uuid[];
  v_live_rule record;
  v_live_loose record;
  v_correct_promotion uuid;
  v_promote_entry jsonb;
  v_submitted_rule_count int;
  v_submitted_loose_count int;
  v_occ_count int;
  v_occ_distinct_count int;
  v_out_of_order boolean;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if v_operation_id is null then
    raise exception 'operation_id es obligatorio.' using errcode = '22023';
  end if;
  if v_status not in ('activo', 'pausado', 'inactivo', 'archivado') then
    raise exception 'Estado de alumno inválido: %', v_status using errcode = '22023';
  end if;
  if v_remove_from_future and v_status not in ('archivado', 'inactivo') then
    raise exception 'remove_from_future sólo aplica al archivar o dar de baja.' using errcode = '22023';
  end if;
  -- Dar de baja SIEMPRE quita al alumno de la agenda futura (no hay elección): un alumno inactivo no puede seguir
  -- participando de series ni de clases por venir. Mismo plan, mismas validaciones y misma transacción que archivar.
  if v_status = 'inactivo' and not v_remove_from_future then
    raise exception 'Dar de baja a un alumno exige quitarlo de la agenda futura (remove_from_future = true).' using errcode = '22023';
  end if;

  -- Canonicaliza el payload ANTES de comparar/guardar nada: dos llamadas
  -- con el mismo operation_id y la MISMA decisión pueden llegar con los
  -- arrays en orden distinto (dos corridas independientes de la
  -- planificación en TypeScript, que no garantiza orden — un reintento
  -- real tras una respuesta perdida vuelve a leer todo de cero). Ordenar
  -- cada array por su clave real antes de comparar/guardar hace que "mismo
  -- payload, distinto orden" sea indistinguible de un replay canónico —
  -- nunca lo rechaza por una diferencia que no es una decisión distinta.
  -- Las ocurrencias congeladas (`freeze_occurrences`) NO se reordenan acá:
  -- ya salen en orden cronológico determinístico de `generateOccurrences`
  -- (motor puro), nunca dependen del orden de una consulta a la base.
  v_canonical_payload := p_payload || jsonb_build_object(
    'series_end', (
      select coalesce(jsonb_agg(e order by (e->>'recurrence_id')), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_payload->'series_end', '[]'::jsonb)) e
    ),
    'series_promote', (
      select coalesce(jsonb_agg(e order by (e->>'rule_id')), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_payload->'series_promote', '[]'::jsonb)) e
    ),
    'series_participant_removal', (
      select coalesce(jsonb_agg(e order by (e->>'rule_id')), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_payload->'series_participant_removal', '[]'::jsonb)) e
    ),
    'loose_cancel', (
      select coalesce(jsonb_agg(x order by x), '[]'::jsonb)
      from jsonb_array_elements_text(coalesce(p_payload->'loose_cancel', '[]'::jsonb)) x
    ),
    'loose_reassign', (
      select coalesce(jsonb_agg(e order by (e->>'lesson_id')), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_payload->'loose_reassign', '[]'::jsonb)) e
    ),
    'loose_remove_participant', (
      select coalesce(jsonb_agg(x order by x), '[]'::jsonb)
      from jsonb_array_elements_text(coalesce(p_payload->'loose_remove_participant', '[]'::jsonb)) x
    )
  );

  -- Bloquea la fila del alumno antes de leer/escribir nada más — serializa
  -- cambios concurrentes sobre el MISMO alumno (mismo criterio que
  -- change_student_status), y por la FK real de cada tabla hija
  -- (primary_student_id/student_id -> students(id)) también bloquea contra
  -- filas hijas nuevas que se estén insertando referenciando a este mismo
  -- alumno mientras esta transacción está abierta (el INSERT hijo toma
  -- FOR KEY SHARE sobre el padre, incompatible con este FOR UPDATE).
  perform 1 from public.students where id = v_student_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Alumno no encontrado.' using errcode = 'P0002';
  end if;

  -- Replay idempotente real CON fingerprint: mismo operation_id + mismo
  -- payload -> replay canónico seguro. Mismo operation_id + payload
  -- DISTINTO -> rechazo explícito, nunca aplica ni ignora en silencio.
  select * into v_existing_history from public.student_status_history where owner_id = v_owner and operation_id = v_operation_id;
  if found then
    if v_existing_history.payload_snapshot is not distinct from v_canonical_payload then
      select * into v_result from public.students where id = v_student_id and owner_id = v_owner;
      return v_result;
    else
      raise exception 'Este operation_id ya se usó con una solicitud distinta — nunca se reaplica con datos diferentes.' using errcode = '22023';
    end if;
  end if;

  if v_remove_from_future then
    -- Medianoche real en civil Argentina — nunca la medianoche UTC de la
    -- sesión de Postgres (mismo criterio que split_recurrence_this_and_future).
    v_effective_instant := (v_occurred_on::text || ' 00:00:00')::timestamp at time zone 'America/Argentina/Buenos_Aires';

    -- =====================================================================
    -- AUTORIDAD REAL — recalcula el conjunto VIVO completo (series) y lo
    -- compara EXACTO contra lo recibido, ANTES de escribir nada.
    -- =====================================================================
    select coalesce(array_agg(r.id), array[]::uuid[]) into v_live_rule_ids
    from public.recurrence_rules r
    where r.owner_id = v_owner
      and r.status in ('active', 'paused')
      and (
        r.primary_student_id = v_student_id
        or exists (select 1 from public.recurrence_rule_participants rp where rp.recurrence_rule_id = r.id and rp.owner_id = v_owner and rp.student_id = v_student_id)
      );

    select count(*), coalesce(array_agg(distinct x), array[]::uuid[]) into v_submitted_rule_count, v_submitted_rule_ids
    from (
      select (e->>'recurrence_id')::uuid as x from jsonb_array_elements(coalesce(v_canonical_payload->'series_end', '[]'::jsonb)) e
      union all
      select (e->>'rule_id')::uuid from jsonb_array_elements(coalesce(v_canonical_payload->'series_promote', '[]'::jsonb)) e
      union all
      select (e->>'rule_id')::uuid from jsonb_array_elements(coalesce(v_canonical_payload->'series_participant_removal', '[]'::jsonb)) e
    ) t;

    -- Duplicados nunca se aceptan de forma ambigua: la misma serie repetida
    -- dentro de un balde, o presente en más de un balde a la vez, se
    -- rechaza explícitamente en vez de tomar "la primera" en silencio.
    if v_submitted_rule_count <> coalesce(array_length(v_submitted_rule_ids, 1), 0) then
      raise exception 'El plan de poda de series contiene ids duplicados — una misma serie no puede aparecer repetida ni en más de un balde a la vez.' using errcode = '22023';
    end if;

    if not (v_live_rule_ids <@ v_submitted_rule_ids and v_submitted_rule_ids <@ v_live_rule_ids) then
      raise exception 'El plan de poda de series está incompleto, desactualizado o incluye series que ya no corresponden — recargá y reintentá.' using errcode = '22023';
    end if;

    for v_live_rule in
      select r.id as rule_id, r.primary_student_id,
        (select count(*)::int from public.recurrence_rule_participants rp2 where rp2.recurrence_rule_id = r.id and rp2.owner_id = v_owner and rp2.student_id <> v_student_id) as other_count
      from public.recurrence_rules r
      where r.owner_id = v_owner and r.id = any(v_live_rule_ids)
    loop
      if v_live_rule.primary_student_id = v_student_id then
        if v_live_rule.other_count = 0 then
          if not exists (select 1 from jsonb_array_elements(coalesce(v_canonical_payload->'series_end', '[]'::jsonb)) e where (e->>'recurrence_id')::uuid = v_live_rule.rule_id) then
            raise exception 'La serie % es primario sin otros participantes — debe terminarse, el plan recibido no lo hace.', v_live_rule.rule_id using errcode = '22023';
          end if;
        else
          select rp.student_id into v_correct_promotion
          from public.recurrence_rule_participants rp
          where rp.recurrence_rule_id = v_live_rule.rule_id and rp.owner_id = v_owner and rp.student_id <> v_student_id
          order by rp.created_at asc, rp.student_id asc
          limit 1;

          select e into v_promote_entry from jsonb_array_elements(coalesce(v_canonical_payload->'series_promote', '[]'::jsonb)) e where (e->>'rule_id')::uuid = v_live_rule.rule_id;
          if v_promote_entry is null then
            raise exception 'La serie % es primario con otros participantes — falta la promoción en el plan recibido.', v_live_rule.rule_id using errcode = '22023';
          end if;
          if (v_promote_entry->>'new_primary_student_id')::uuid is distinct from v_correct_promotion then
            raise exception 'La promoción indicada para la serie % no es el participante determinístico correcto — el servidor nunca confía en la elección del cliente.', v_live_rule.rule_id using errcode = '22023';
          end if;

          -- freeze_occurrences NUNCA se asume ordenado/sin duplicados sólo
          -- porque el planner de TypeScript lo produce así — se valida acá.
          select count(*), count(distinct e->>'occurrence_key')
            into v_occ_count, v_occ_distinct_count
            from jsonb_array_elements(coalesce(v_promote_entry->'freeze_occurrences', '[]'::jsonb)) e;
          if v_occ_count <> v_occ_distinct_count then
            raise exception 'freeze_occurrences de la serie % contiene occurrence_key duplicados.', v_live_rule.rule_id using errcode = '22023';
          end if;
          select bool_or(start_at <= prev_start) into v_out_of_order
          from (
            select (e.val->>'start_at')::timestamptz as start_at,
                   lag((e.val->>'start_at')::timestamptz) over (order by e.ord) as prev_start
            from jsonb_array_elements(coalesce(v_promote_entry->'freeze_occurrences', '[]'::jsonb)) with ordinality as e(val, ord)
          ) t;
          if coalesce(v_out_of_order, false) then
            raise exception 'freeze_occurrences de la serie % no está en orden cronológico estrictamente ascendente.', v_live_rule.rule_id using errcode = '22023';
          end if;
        end if;
      else
        select e into v_promote_entry from jsonb_array_elements(coalesce(v_canonical_payload->'series_participant_removal', '[]'::jsonb)) e where (e->>'rule_id')::uuid = v_live_rule.rule_id;
        if v_promote_entry is null then
          raise exception 'La serie % tiene al alumno como participante secundario — debe quitarse del roster futuro, el plan recibido no lo hace.', v_live_rule.rule_id using errcode = '22023';
        end if;

        select count(*), count(distinct e->>'occurrence_key')
          into v_occ_count, v_occ_distinct_count
          from jsonb_array_elements(coalesce(v_promote_entry->'freeze_occurrences', '[]'::jsonb)) e;
        if v_occ_count <> v_occ_distinct_count then
          raise exception 'freeze_occurrences de la serie % contiene occurrence_key duplicados.', v_live_rule.rule_id using errcode = '22023';
        end if;
        select bool_or(start_at <= prev_start) into v_out_of_order
        from (
          select (e.val->>'start_at')::timestamptz as start_at,
                 lag((e.val->>'start_at')::timestamptz) over (order by e.ord) as prev_start
          from jsonb_array_elements(coalesce(v_promote_entry->'freeze_occurrences', '[]'::jsonb)) with ordinality as e(val, ord)
        ) t;
        if coalesce(v_out_of_order, false) then
          raise exception 'freeze_occurrences de la serie % no está en orden cronológico estrictamente ascendente.', v_live_rule.rule_id using errcode = '22023';
        end if;
      end if;
    end loop;

    -- =====================================================================
    -- AUTORIDAD REAL — mismo criterio para clases sueltas futuras.
    -- =====================================================================
    select coalesce(array_agg(x), array[]::uuid[]) into v_live_loose_ids
    from (
      select cl.id as x
      from public.calendar_lessons cl
      where cl.owner_id = v_owner and cl.recurrence_id is null and cl.status = 'scheduled' and cl.start_at >= v_effective_instant
        and cl.primary_student_id = v_student_id
      union
      select cl.id
      from public.calendar_lessons cl
      join public.calendar_lesson_participants clp on clp.calendar_lesson_id = cl.id and clp.owner_id = v_owner
      where cl.owner_id = v_owner and cl.recurrence_id is null and cl.status = 'scheduled' and cl.start_at >= v_effective_instant
        and clp.student_id = v_student_id
    ) t;

    select count(*), coalesce(array_agg(distinct x), array[]::uuid[]) into v_submitted_loose_count, v_submitted_loose_ids
    from (
      select y::uuid as x from jsonb_array_elements_text(coalesce(v_canonical_payload->'loose_cancel', '[]'::jsonb)) y
      union all
      select (e->>'lesson_id')::uuid from jsonb_array_elements(coalesce(v_canonical_payload->'loose_reassign', '[]'::jsonb)) e
      union all
      select y::uuid from jsonb_array_elements_text(coalesce(v_canonical_payload->'loose_remove_participant', '[]'::jsonb)) y
    ) t;

    if v_submitted_loose_count <> coalesce(array_length(v_submitted_loose_ids, 1), 0) then
      raise exception 'El plan de poda de clases sueltas contiene ids duplicados — una misma clase no puede aparecer repetida ni en más de un balde a la vez.' using errcode = '22023';
    end if;

    if not (v_live_loose_ids <@ v_submitted_loose_ids and v_submitted_loose_ids <@ v_live_loose_ids) then
      raise exception 'El plan de poda de clases sueltas está incompleto, desactualizado o incluye clases que ya no corresponden — recargá y reintentá.' using errcode = '22023';
    end if;

    for v_live_loose in
      select cl.id as lesson_id, cl.primary_student_id,
        (select count(*)::int from public.calendar_lesson_participants clp2 where clp2.calendar_lesson_id = cl.id and clp2.owner_id = v_owner and clp2.student_id <> v_student_id) as other_count
      from public.calendar_lessons cl
      where cl.owner_id = v_owner and cl.id = any(v_live_loose_ids)
    loop
      if v_live_loose.primary_student_id = v_student_id then
        if v_live_loose.other_count = 0 then
          if not exists (select 1 from jsonb_array_elements_text(coalesce(v_canonical_payload->'loose_cancel', '[]'::jsonb)) y where y::uuid = v_live_loose.lesson_id) then
            raise exception 'La clase suelta % es primario sin otros participantes — debe cancelarse, el plan recibido no lo hace.', v_live_loose.lesson_id using errcode = '22023';
          end if;
        else
          select clp.student_id into v_correct_promotion
          from public.calendar_lesson_participants clp
          where clp.calendar_lesson_id = v_live_loose.lesson_id and clp.owner_id = v_owner and clp.student_id <> v_student_id
          order by clp.created_at asc, clp.student_id asc
          limit 1;

          select e into v_promote_entry from jsonb_array_elements(coalesce(v_canonical_payload->'loose_reassign', '[]'::jsonb)) e where (e->>'lesson_id')::uuid = v_live_loose.lesson_id;
          if v_promote_entry is null then
            raise exception 'La clase suelta % es primario con otros participantes — falta la promoción en el plan recibido.', v_live_loose.lesson_id using errcode = '22023';
          end if;
          if (v_promote_entry->>'new_primary_student_id')::uuid is distinct from v_correct_promotion then
            raise exception 'La promoción indicada para la clase suelta % no es el participante determinístico correcto.', v_live_loose.lesson_id using errcode = '22023';
          end if;
        end if;
      else
        if not exists (select 1 from jsonb_array_elements_text(coalesce(v_canonical_payload->'loose_remove_participant', '[]'::jsonb)) y where y::uuid = v_live_loose.lesson_id) then
          raise exception 'La clase suelta % tiene al alumno como participante secundario — debe quitarse, el plan recibido no lo hace.', v_live_loose.lesson_id using errcode = '22023';
        end if;
      end if;
    end loop;
  end if;

  -- Validación completa: recién ahora se escribe algo.
  insert into public.student_status_history (owner_id, student_id, status, occurred_on, reason, internal_note, operation_id, payload_snapshot)
  values (v_owner, v_student_id, v_status, v_occurred_on, v_reason, v_internal_note, v_operation_id, v_canonical_payload);

  update public.students
  set status = v_status, status_change_date = v_occurred_on
  where id = v_student_id and owner_id = v_owner
  returning * into v_result;

  if v_remove_from_future then
    -- ---------------------------------------------------------------------
    -- series_end — primario SIN otros participantes: termina la serie,
    -- CANCELA (nunca borra) sus ocurrencias futuras ya materializadas.
    -- ---------------------------------------------------------------------
    for v_entry in select * from jsonb_array_elements(coalesce(v_canonical_payload->'series_end', '[]'::jsonb))
    loop
      perform 1 from public.recurrence_rules where id = (v_entry->>'recurrence_id')::uuid and owner_id = v_owner for update;
      if not found then
        raise exception 'Serie no encontrada.' using errcode = 'P0002';
      end if;

      update public.recurrence_rules
      set status = 'ended', end_date = v_occurred_on - 1
      where id = (v_entry->>'recurrence_id')::uuid and owner_id = v_owner;

      update public.calendar_lessons
      set status = 'cancelled'
      where owner_id = v_owner
        and recurrence_id = (v_entry->>'recurrence_id')::uuid
        and status = 'scheduled'
        and start_at >= v_effective_instant;
    end loop;

    -- ---------------------------------------------------------------------
    -- series_promote — primario CON otros participantes: congela roster
    -- viejo hasta la fecha efectiva, promueve al elegido (ya validado
    -- server-side arriba), reasigna ya-materializadas futuras. La
    -- actividad de los demás participantes NUNCA se cancela.
    -- ---------------------------------------------------------------------
    for v_entry in select * from jsonb_array_elements(coalesce(v_canonical_payload->'series_promote', '[]'::jsonb))
    loop
      perform 1 from public.recurrence_rules where id = (v_entry->>'rule_id')::uuid and owner_id = v_owner for update;
      if not found then
        raise exception 'Serie no encontrada.' using errcode = 'P0002';
      end if;
      if not exists (select 1 from public.students where id = (v_entry->>'new_primary_student_id')::uuid and owner_id = v_owner) then
        raise exception 'Alumno a promover no encontrado.' using errcode = 'P0002';
      end if;

      for v_occ in select * from jsonb_array_elements(coalesce(v_entry->'freeze_occurrences', '[]'::jsonb))
      loop
        v_new_lesson_id := null;
        insert into public.calendar_lessons (
          owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at,
          modality, status, color, is_recurring, recurrence_id, recurrence_occurrence_key,
          recurrence_index, recurrence_original_start, class_title, activity_kind
        ) values (
          v_owner,
          (v_occ->>'primary_student_id')::uuid,
          v_occ->>'student_name',
          v_occ->>'level',
          v_occ->>'lesson_type',
          (v_occ->>'start_at')::timestamptz,
          (v_occ->>'end_at')::timestamptz,
          v_occ->>'modality',
          'scheduled',
          coalesce(v_occ->>'color', '#FCE4D2'),
          true,
          (v_entry->>'rule_id')::uuid,
          v_occ->>'occurrence_key',
          (v_occ->>'recurrence_index')::int,
          (v_occ->>'start_at')::timestamptz,
          nullif(v_occ->>'class_title', ''),
          coalesce(v_occ->>'activity_kind', 'class')
        )
        on conflict (recurrence_id, recurrence_occurrence_key) where recurrence_id is not null and recurrence_occurrence_key is not null
        do nothing
        returning id into v_new_lesson_id;

        if v_new_lesson_id is not null then
          insert into public.calendar_lesson_participants (owner_id, calendar_lesson_id, student_id, student_name, level)
          select v_owner, v_new_lesson_id, (p->>'student_id')::uuid, p->>'student_name', p->>'level'
          from jsonb_array_elements(coalesce(v_occ->'participants', '[]'::jsonb)) as p
          on conflict (calendar_lesson_id, student_id) do nothing;
        end if;
      end loop;

      update public.recurrence_rules
      set primary_student_id = (v_entry->>'new_primary_student_id')::uuid
      where id = (v_entry->>'rule_id')::uuid and owner_id = v_owner;

      delete from public.recurrence_rule_participants
      where recurrence_rule_id = (v_entry->>'rule_id')::uuid and owner_id = v_owner and student_id = v_student_id;

      update public.calendar_lessons
      set primary_student_id = (v_entry->>'new_primary_student_id')::uuid,
          student_name = v_entry->>'new_primary_student_name',
          level = v_entry->>'new_primary_level'
      where owner_id = v_owner
        and recurrence_id = (v_entry->>'rule_id')::uuid
        and status = 'scheduled'
        and start_at >= v_effective_instant
        and primary_student_id = v_student_id;

      delete from public.calendar_lesson_participants
      where owner_id = v_owner
        and student_id = v_student_id
        and calendar_lesson_id in (
          select id from public.calendar_lessons
          where owner_id = v_owner and recurrence_id = (v_entry->>'rule_id')::uuid
            and status = 'scheduled' and start_at >= v_effective_instant
        );
    end loop;

    -- ---------------------------------------------------------------------
    -- series_participant_removal — secundario: se lo quita del roster
    -- futuro (congelando antes el tramo viejo), la serie sigue igual.
    -- ---------------------------------------------------------------------
    for v_entry in select * from jsonb_array_elements(coalesce(v_canonical_payload->'series_participant_removal', '[]'::jsonb))
    loop
      perform 1 from public.recurrence_rules where id = (v_entry->>'rule_id')::uuid and owner_id = v_owner for update;
      if not found then
        raise exception 'Serie no encontrada.' using errcode = 'P0002';
      end if;

      for v_occ in select * from jsonb_array_elements(coalesce(v_entry->'freeze_occurrences', '[]'::jsonb))
      loop
        v_new_lesson_id := null;
        insert into public.calendar_lessons (
          owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at,
          modality, status, color, is_recurring, recurrence_id, recurrence_occurrence_key,
          recurrence_index, recurrence_original_start, class_title, activity_kind
        ) values (
          v_owner,
          (v_occ->>'primary_student_id')::uuid,
          v_occ->>'student_name',
          v_occ->>'level',
          v_occ->>'lesson_type',
          (v_occ->>'start_at')::timestamptz,
          (v_occ->>'end_at')::timestamptz,
          v_occ->>'modality',
          'scheduled',
          coalesce(v_occ->>'color', '#FCE4D2'),
          true,
          (v_entry->>'rule_id')::uuid,
          v_occ->>'occurrence_key',
          (v_occ->>'recurrence_index')::int,
          (v_occ->>'start_at')::timestamptz,
          nullif(v_occ->>'class_title', ''),
          coalesce(v_occ->>'activity_kind', 'class')
        )
        on conflict (recurrence_id, recurrence_occurrence_key) where recurrence_id is not null and recurrence_occurrence_key is not null
        do nothing
        returning id into v_new_lesson_id;

        if v_new_lesson_id is not null then
          insert into public.calendar_lesson_participants (owner_id, calendar_lesson_id, student_id, student_name, level)
          select v_owner, v_new_lesson_id, (p->>'student_id')::uuid, p->>'student_name', p->>'level'
          from jsonb_array_elements(coalesce(v_occ->'participants', '[]'::jsonb)) as p
          on conflict (calendar_lesson_id, student_id) do nothing;
        end if;
      end loop;

      delete from public.recurrence_rule_participants
      where recurrence_rule_id = (v_entry->>'rule_id')::uuid and owner_id = v_owner and student_id = v_student_id;

      delete from public.calendar_lesson_participants
      where owner_id = v_owner
        and student_id = v_student_id
        and calendar_lesson_id in (
          select id from public.calendar_lessons
          where owner_id = v_owner and recurrence_id = (v_entry->>'rule_id')::uuid
            and status = 'scheduled' and start_at >= v_effective_instant
        );
    end loop;

    -- ---------------------------------------------------------------------
    -- loose_cancel — clase suelta futura, primario y único participante:
    -- cancela (nunca borra).
    -- ---------------------------------------------------------------------
    for v_entry_text in select * from jsonb_array_elements_text(coalesce(v_canonical_payload->'loose_cancel', '[]'::jsonb))
    loop
      perform 1 from public.calendar_lessons where id = v_entry_text::uuid and owner_id = v_owner for update;
      if not found then
        raise exception 'Clase no encontrada.' using errcode = 'P0002';
      end if;
      update public.calendar_lessons
      set status = 'cancelled'
      where id = v_entry_text::uuid and owner_id = v_owner and status = 'scheduled';
    end loop;

    -- ---------------------------------------------------------------------
    -- loose_reassign — clase suelta futura, primario con otros
    -- participantes: promueve al elegido (ya validado server-side arriba),
    -- nunca cancela la clase.
    -- ---------------------------------------------------------------------
    for v_entry in select * from jsonb_array_elements(coalesce(v_canonical_payload->'loose_reassign', '[]'::jsonb))
    loop
      perform 1 from public.calendar_lessons where id = (v_entry->>'lesson_id')::uuid and owner_id = v_owner for update;
      if not found then
        raise exception 'Clase no encontrada.' using errcode = 'P0002';
      end if;
      if not exists (select 1 from public.students where id = (v_entry->>'new_primary_student_id')::uuid and owner_id = v_owner) then
        raise exception 'Alumno a promover no encontrado.' using errcode = 'P0002';
      end if;

      update public.calendar_lessons
      set primary_student_id = (v_entry->>'new_primary_student_id')::uuid,
          student_name = v_entry->>'new_primary_student_name',
          level = v_entry->>'new_primary_level'
      where id = (v_entry->>'lesson_id')::uuid and owner_id = v_owner and status = 'scheduled';

      delete from public.calendar_lesson_participants
      where calendar_lesson_id = (v_entry->>'lesson_id')::uuid and owner_id = v_owner and student_id = v_student_id;
    end loop;

    -- ---------------------------------------------------------------------
    -- loose_remove_participant — clase suelta futura, secundario: se lo
    -- quita, la clase y los demás participantes siguen intactos.
    -- ---------------------------------------------------------------------
    for v_entry_text in select * from jsonb_array_elements_text(coalesce(v_canonical_payload->'loose_remove_participant', '[]'::jsonb))
    loop
      delete from public.calendar_lesson_participants
      where calendar_lesson_id = v_entry_text::uuid and owner_id = v_owner and student_id = v_student_id;
    end loop;
  end if;

  return v_result;
end;
$$;

create or replace function public.change_student_status(
  p_student_id uuid,
  p_status text,
  p_occurred_on date,
  p_reason text default null,
  p_internal_note text default null
)
returns public.students
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_result public.students;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if p_status not in ('activo', 'pausado', 'inactivo', 'archivado') then
    raise exception 'Estado de alumno inválido: %', p_status using errcode = '22023';
  end if;
  if p_status = 'archivado' then
    raise exception 'Para archivar un alumno usá archive_student_and_prune_future — exige elegir explícitamente si se conserva o se quita la agenda futura.' using errcode = '22023';
  end if;
  if p_status = 'inactivo' then
    raise exception 'Para dar de baja a un alumno usá archive_student_and_prune_future — la baja quita al alumno de la agenda futura en la misma transacción.' using errcode = '22023';
  end if;

  -- Bloquea la fila del alumno antes de escribir — dos cambios de estado
  -- concurrentes sobre el MISMO alumno nunca se pisan ni dejan el
  -- historial desincronizado del estado final.
  perform 1 from public.students where id = p_student_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Alumno no encontrado.' using errcode = 'P0002';
  end if;

  insert into public.student_status_history (owner_id, student_id, status, occurred_on, reason, internal_note)
  values (v_owner, p_student_id, p_status, p_occurred_on, p_reason, p_internal_note);

  update public.students
  set status = p_status, status_change_date = p_occurred_on
  where id = p_student_id and owner_id = v_owner
  returning * into v_result;

  return v_result;
end;
$$;

comment on function public.archive_student_and_prune_future(jsonb) is
  'Archivado o baja (inactivo) con poda atómica de agenda futura. Archivar: la poda es una elección explícita. Dar de baja: la poda es obligatoria (remove_from_future = true). AUTORIDAD REAL: recalcula el conjunto vivo de series/clases futuras después de bloquear al alumno y exige que el plan recibido coincida exacto. Idempotente por operation_id con fingerprint del payload. Nunca borra historial, registros, pagos ni reportes; restaurar nunca reconstruye la agenda retirada.';

revoke all on function public.archive_student_and_prune_future(jsonb) from public;
grant execute on function public.archive_student_and_prune_future(jsonb) to authenticated;
revoke execute on function public.archive_student_and_prune_future(jsonb) from anon;

comment on function public.change_student_status(uuid, text, date, text, text) is
  'Cambia el estado de un alumno propio (pausar / restaurar) y agrega su entrada de historial en una sola transacción atómica. Rechaza archivado e inactivo: ambos pasan por archive_student_and_prune_future (poda de agenda futura en la misma transacción).';

revoke all on function public.change_student_status(uuid, text, date, text, text) from public;
grant execute on function public.change_student_status(uuid, text, date, text, text) to authenticated;
revoke execute on function public.change_student_status(uuid, text, date, text, text) from anon;
