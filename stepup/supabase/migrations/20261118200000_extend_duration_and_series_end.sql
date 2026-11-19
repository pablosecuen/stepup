-- TeacherFlow Web — «Extender duración» de una clase y fecha de finalización opcional de una serie (18/11/2026).
--
-- 1) Extender duración (UNA clase, atómico). `extend_calendar_lesson_duration` corre bajo el mismo lock por cuenta que `reschedule_calendar_replacing` (lock de aviso transaccional),
--    así dos dispositivos que modifican la agenda a la vez se serializan. Dentro de ESA transacción: (a) localiza la clase por su identidad (o materializa UNA vez la ocurrencia
--    virtual de su serie), (b) detecta que otro dispositivo la cambió (inicio/fin/estado distintos a los que vio la pantalla) y pide actualizar, (c) comprueba que la agenda, las series y la
--    disponibilidad no cambiaron desde que el servidor validó las ocurrencias VIRTUALES y la disponibilidad (`calendar_agenda_stamp`), (d) rechaza el solapamiento con cualquier clase REAL
--    que ocupe horario (misma regla de agenda operativa que la web: canceladas, orígenes liberados de una reprogramación y reemplazadas no ocupan) y (e) recién entonces escribe el fin.
--    Un reintento (doble clic, respuesta perdida) encuentra la clase ya con ese fin y devuelve `already_applied`: una sola modificación. No toca tarifas, cobros, registros ni participantes.
--    `create_calendar_lesson` pasa a tomar el MISMO lock y, si la acción se lo pide (`guard_overlap`), rechaza dentro de la transacción un horario que otra clase ya ocupa: una clase nueva creada a la
--    vez que una extensión ya no puede dejar las dos superpuestas.
--
-- 2) Fecha de finalización de la serie. La fecha vive en `recurrence_rules.series_end_date`, a nivel del LINAJE completo (todos los tramos y cambios programados de la serie): una sucesora la hereda
--    por trigger, así ningún «Editar futuras» posterior la pierde. NO se reescribe `end_date` ni `status` de ningún tramo: el fin efectivo es el menor entre `end_date` y `series_end_date`, por lo que
--    quitarla o extenderla es reversible sin reconstruir nada. Las clases YA CREADAS, programadas y sin registro ni cobro que quedan después del límite pasan a canceladas marcándolas
--    (`cancelled_by_series_limit`): sólo esas se restauran al quitar o extender el límite; una cancelación manual nunca se «resucita». Una clase posterior con registro o cobro rechaza la operación
--    completa. `set_recurrence_series_end` y `edit_recurrence_future_with_end` (corte «esta y las siguientes» + límite) son UNA transacción.
--
-- Idempotente (create or replace / if not exists). No toca datos existentes.

-- ---------------------------------------------------------------------------
-- Esquema
-- ---------------------------------------------------------------------------
alter table public.recurrence_rules add column if not exists series_end_date date;
comment on column public.recurrence_rules.series_end_date is
  'Fecha de finalización (inclusive, fecha civil de la cuenta) de la serie ENTERA (todos los tramos de su linaje). Null = sin fecha. El fin efectivo de un tramo es least(end_date, series_end_date); una sucesora la hereda.';

alter table public.calendar_lessons add column if not exists cancelled_by_series_limit boolean not null default false;
comment on column public.calendar_lessons.cancelled_by_series_limit is
  'La clase quedó cancelada porque la serie recibió una fecha de finalización anterior a ella. Sólo estas se restauran al quitar o extender el límite; una cancelación manual nunca se restaura.';

create or replace function public.inherit_series_end_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.series_end_date is null and new.supersedes_recurrence_id is not null then
    select r.series_end_date into new.series_end_date from public.recurrence_rules r where r.id = new.supersedes_recurrence_id;
  end if;
  return new;
end;
$$;
drop trigger if exists inherit_series_end_date on public.recurrence_rules;
create trigger inherit_series_end_date before insert on public.recurrence_rules
  for each row execute function public.inherit_series_end_date();

-- Una clase que cambia de estado por cualquier camino distinto del límite deja de ser «cancelada por el límite» (una cancelación manual posterior nunca se restaura sola).
create or replace function public.clear_series_limit_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.cancelled_by_series_limit and new.status is distinct from old.status and coalesce(current_setting('tf.series_limit_op', true), '') <> 'on' then
    new.cancelled_by_series_limit := false;
  end if;
  return new;
end;
$$;
drop trigger if exists clear_series_limit_flag on public.calendar_lessons;
create trigger clear_series_limit_flag before update on public.calendar_lessons
  for each row execute function public.clear_series_limit_flag();

-- ---------------------------------------------------------------------------
-- Agenda operativa en SQL: ¿esta clase REAL ocupa su horario?
-- Misma regla que `lib/calendar/agenda.ts`: no cuentan las canceladas, el origen liberado de una reprogramación (clase suelta reprogramada o ocurrencia con excepción
-- «rescheduled» hacia otra clase) ni las reemplazadas (que quedan canceladas). Una dictada sigue ocupando.
-- ---------------------------------------------------------------------------
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
    else true
  end
$$;

-- Huella de lo que decide qué ocurrencias VIRTUALES y qué disponibilidad rigen: series (id + última modificación), excepciones y disponibilidad. Si cambia entre la validación del servidor
-- y la escritura, otro dispositivo tocó la agenda y hay que revalidar.
create or replace function public.calendar_agenda_stamp()
returns text
language sql
stable
set search_path = ''
as $$
  select md5(
    coalesce((select string_agg(r.id::text || ':' || r.updated_at::text || ':' || coalesce(r.series_end_date::text, ''), ',' order by r.id) from public.recurrence_rules r where r.owner_id = auth.uid()), '')
    || '|' ||
    coalesce((select count(*)::text || ':' || coalesce(max(e.created_at)::text, '') from public.recurrence_exceptions e where e.owner_id = auth.uid()), '')
    || '|' ||
    coalesce((select a.updated_at::text from public.teacher_availability a where a.owner_id = auth.uid()), '')
  )
$$;
revoke all on function public.calendar_agenda_stamp() from public, anon;
grant execute on function public.calendar_agenda_stamp() to authenticated;

-- ---------------------------------------------------------------------------
-- 1) Extender la duración de UNA clase
-- p_payload = { lesson_id?, recurrence_id?, occurrence_key?, base? (sólo para materializar una ocurrencia virtual: como `edit_calendar_lesson`),
--               expected_start_at, expected_end_at, new_end_at, max_duration_minutes?, agenda_stamp? }
-- Devuelve { lesson_id, start_at, end_at, already_applied, materialized }.
-- Errores propios: TF001 (la clase cambió), TF002 (se superpone; detail = {start,end,name}), TF003 (la agenda cambió), 22023 (datos inválidos), P0002 (no existe).
-- ---------------------------------------------------------------------------
create or replace function public.extend_calendar_lesson_duration(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_lesson_id uuid := nullif(p_payload->>'lesson_id', '')::uuid;
  v_recurrence_id uuid := nullif(p_payload->>'recurrence_id', '')::uuid;
  v_key text := nullif(p_payload->>'occurrence_key', '');
  v_base jsonb := p_payload->'base';
  v_expected_start timestamptz := nullif(p_payload->>'expected_start_at', '')::timestamptz;
  v_expected_end timestamptz := nullif(p_payload->>'expected_end_at', '')::timestamptz;
  v_new_end timestamptz := nullif(p_payload->>'new_end_at', '')::timestamptz;
  v_max_minutes int := coalesce(nullif(p_payload->>'max_duration_minutes', '')::int, 120);
  v_stamp text := nullif(p_payload->>'agenda_stamp', '');
  v_lesson public.calendar_lessons;
  v_clash public.calendar_lessons;
  v_participant jsonb;
  v_materialized boolean := false;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if v_expected_start is null or v_expected_end is null or v_new_end is null then
    raise exception 'Faltan datos de la clase para extender su duración.' using errcode = '22023';
  end if;
  if v_new_end <= v_expected_end then
    raise exception 'La nueva finalización debe ser posterior a la actual.' using errcode = '22023';
  end if;
  if extract(epoch from (v_new_end - v_expected_start)) / 60 > v_max_minutes then
    raise exception 'La duración no puede superar el máximo permitido.' using errcode = '22023';
  end if;

  -- Mismo lock por cuenta que `reschedule_calendar_replacing`: las modificaciones de agenda de la cuenta se serializan.
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 31100000));

  if v_lesson_id is not null then
    select * into v_lesson from public.calendar_lessons where id = v_lesson_id and owner_id = v_owner for update;
    if not found then
      raise exception 'Clase no encontrada.' using errcode = 'P0002';
    end if;
  elsif v_recurrence_id is not null and v_key is not null and v_base is not null then
    select * into v_lesson from public.calendar_lessons
      where owner_id = v_owner and recurrence_id = v_recurrence_id and recurrence_occurrence_key = v_key for update;
    if not found then
      if not exists (select 1 from public.recurrence_rules where id = v_recurrence_id and owner_id = v_owner) then
        raise exception 'La serie ya no existe.' using errcode = 'P0002';
      end if;
      if exists (select 1 from public.recurrence_exceptions where recurrence_id = v_recurrence_id and occurrence_key = v_key and owner_id = v_owner) then
        raise exception 'La clase cambió desde otro dispositivo. Actualizá el calendario.' using errcode = 'TF001';
      end if;
      if not exists (select 1 from public.students where id = (v_base->>'primary_student_id')::uuid and owner_id = v_owner) then
        raise exception 'Alumno no encontrado.' using errcode = 'P0002';
      end if;
      -- La agenda debe seguir como el servidor la validó ANTES de crear la fila (una serie editada a la vez cambia sus ocurrencias virtuales).
      if v_stamp is not null and public.calendar_agenda_stamp() is distinct from v_stamp then
        raise exception 'La agenda cambió mientras se guardaba. Actualizá el calendario y reintentá.' using errcode = 'TF003';
      end if;
      insert into public.calendar_lessons (
        owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color,
        is_recurring, recurrence_id, recurrence_occurrence_key, recurrence_index, recurrence_original_start, class_title, activity_kind
      ) values (
        v_owner,
        (v_base->>'primary_student_id')::uuid,
        v_base->>'student_name',
        v_base->>'level',
        v_base->>'lesson_type',
        (v_base->>'start_at')::timestamptz,
        (v_base->>'end_at')::timestamptz,
        v_base->>'modality',
        'scheduled',
        coalesce(v_base->>'color', '#FCE4D2'),
        true,
        v_recurrence_id,
        v_key,
        (v_base->>'recurrence_index')::int,
        (v_base->>'start_at')::timestamptz,
        nullif(v_base->>'class_title', ''),
        coalesce(v_base->>'activity_kind', 'class')
      )
      on conflict (recurrence_id, recurrence_occurrence_key) where recurrence_id is not null and recurrence_occurrence_key is not null do nothing
      returning * into v_lesson;
      if not found then
        select * into v_lesson from public.calendar_lessons
          where owner_id = v_owner and recurrence_id = v_recurrence_id and recurrence_occurrence_key = v_key for update;
      else
        v_materialized := true;
        for v_participant in select * from jsonb_array_elements(coalesce(v_base->'participants', '[]'::jsonb))
        loop
          insert into public.calendar_lesson_participants (owner_id, calendar_lesson_id, student_id, student_name, level)
          values (v_owner, v_lesson.id, (v_participant->>'student_id')::uuid, v_participant->>'student_name', v_participant->>'level')
          on conflict do nothing;
        end loop;
      end if;
    end if;
  else
    raise exception 'Falta identificar la clase.' using errcode = '22023';
  end if;

  -- Reintento (doble clic, respuesta perdida): la clase ya tiene ese fin → una única modificación.
  if v_lesson.start_at = v_expected_start and v_lesson.end_at = v_new_end then
    return jsonb_build_object('lesson_id', v_lesson.id, 'start_at', v_lesson.start_at, 'end_at', v_lesson.end_at, 'already_applied', true, 'materialized', false);
  end if;

  -- Otro dispositivo la cambió (o ya no es una clase vigente): se pide actualizar, nunca se sobrescribe en silencio.
  if v_lesson.start_at <> v_expected_start or v_lesson.end_at <> v_expected_end then
    raise exception 'La clase cambió desde otro dispositivo. Actualizá el calendario.' using errcode = 'TF001';
  end if;
  if v_lesson.status in ('completed', 'cancelled') or not public.calendar_lesson_occupies_slot(v_lesson)
     or exists (select 1 from public.lesson_registrations r where r.owner_id = v_owner and r.calendar_lesson_id = v_lesson.id and r.status = 'completed') then
    raise exception 'Esta clase ya no se puede extender: está cancelada, reemplazada o registrada.' using errcode = 'TF001';
  end if;

  -- La agenda (series, excepciones, disponibilidad) debe seguir como la validó el servidor.
  if v_stamp is not null and public.calendar_agenda_stamp() is distinct from v_stamp then
    raise exception 'La agenda cambió mientras se guardaba. Actualizá el calendario y reintentá.' using errcode = 'TF003';
  end if;

  -- El intervalo FINAL completo no puede invadir ninguna clase real que ocupe horario (terminar justo cuando empieza otra no es invadir).
  select c.* into v_clash from public.calendar_lessons c
    where c.owner_id = v_owner and c.id <> v_lesson.id
      and c.start_at < v_new_end and c.end_at > v_lesson.start_at
      and public.calendar_lesson_occupies_slot(c)
    order by c.start_at
    limit 1;
  if found then
    raise exception 'El nuevo horario se superpone con otra clase.' using errcode = 'TF002',
      detail = jsonb_build_object('start', v_clash.start_at, 'end', v_clash.end_at, 'name', coalesce(nullif(btrim(v_clash.class_title), ''), v_clash.student_name))::text;
  end if;

  update public.calendar_lessons set end_at = v_new_end where id = v_lesson.id and owner_id = v_owner returning * into v_lesson;
  return jsonb_build_object('lesson_id', v_lesson.id, 'start_at', v_lesson.start_at, 'end_at', v_lesson.end_at, 'already_applied', false, 'materialized', v_materialized);
end;
$$;
revoke all on function public.extend_calendar_lesson_duration(jsonb) from public, anon;
grant execute on function public.extend_calendar_lesson_duration(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Crear una clase suelta: mismo lock por cuenta y, con `guard_overlap`, rechazo atómico si otra clase real ya ocupa el horario.
-- Envuelve la versión anterior (que conserva idempotencia por `operation_id`, reemplazos y participantes). Un reintento de la MISMA operación no se vuelve a validar.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.create_calendar_lesson_before_slot_guard(jsonb)') is null then
    alter function public.create_calendar_lesson(jsonb) rename to create_calendar_lesson_before_slot_guard;
    revoke all on function public.create_calendar_lesson_before_slot_guard(jsonb) from public, anon, authenticated;
  end if;
end $$;

create or replace function public.create_calendar_lesson(p_payload jsonb)
returns public.calendar_lessons
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_start timestamptz;
  v_end timestamptz;
  v_clash public.calendar_lessons;
begin
  if v_owner is null then
    raise exception 'Sesión requerida';
  end if;
  if coalesce(p_payload->>'guard_overlap', 'false') = 'true' then
    perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 31100000));
    if not exists (select 1 from public.calendar_lessons where owner_id = v_owner and operation_id = nullif(p_payload->>'operation_id', '')::uuid) then
      v_start := (p_payload->>'start_at')::timestamptz;
      v_end := (p_payload->>'end_at')::timestamptz;
      select c.* into v_clash from public.calendar_lessons c
        where c.owner_id = v_owner and c.start_at < v_end and c.end_at > v_start and public.calendar_lesson_occupies_slot(c)
        order by c.start_at limit 1;
      if found then
        raise exception 'El horario elegido se superpone con otra clase ya agendada.' using errcode = 'TF002',
          detail = jsonb_build_object('start', v_clash.start_at, 'end', v_clash.end_at, 'name', coalesce(nullif(btrim(v_clash.class_title), ''), v_clash.student_name))::text;
      end if;
    end if;
  end if;
  return public.create_calendar_lesson_before_slot_guard(p_payload);
end;
$$;
revoke all on function public.create_calendar_lesson(jsonb) from public, anon;
grant execute on function public.create_calendar_lesson(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Fecha de finalización de la serie
-- ---------------------------------------------------------------------------

-- Fin efectivo de la serie de un tramo (el menor entre end_date y series_end_date); null = sin fecha.
create or replace function public.recurrence_series_current_end(p_head uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select least(r.end_date, r.series_end_date) from public.recurrence_rules r where r.id = p_head and r.owner_id = auth.uid()
$$;

-- p_payload = { head_id, end_date ('YYYY-MM-DD' | null), min_date ('YYYY-MM-DD' | null), timezone, expected_end? (string|null), check_expected? (bool) }
-- Devuelve { previous_end, end_date, cancelled, restored, rules }.
-- Errores propios: TF001 (la serie cambió), TF005 (una clase posterior tiene registro o cobro), 22023 (fecha inválida), P0002 (no existe).
create or replace function public.set_recurrence_series_end(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_head_id uuid := nullif(p_payload->>'head_id', '')::uuid;
  v_end date := nullif(p_payload->>'end_date', '')::date;
  v_min date := nullif(p_payload->>'min_date', '')::date;
  v_tz text := coalesce(nullif(p_payload->>'timezone', ''), 'America/Argentina/Buenos_Aires');
  v_check boolean := coalesce(p_payload->>'check_expected', 'false') = 'true';
  v_expected date := nullif(p_payload->>'expected_end', '')::date;
  v_head public.recurrence_rules;
  v_ids uuid[];
  v_previous date;
  v_blocked int;
  v_first_blocked date;
  v_cancelled int := 0;
  v_restored int := 0;
  v_rules int := 0;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if v_head_id is null then
    raise exception 'Falta la serie.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 31100000));

  select * into v_head from public.recurrence_rules where id = v_head_id and owner_id = v_owner for update;
  if not found then
    raise exception 'La serie ya no existe.' using errcode = 'P0002';
  end if;

  -- Linaje completo: la raíz (siguiendo `supersedes_recurrence_id` hacia atrás) y todos sus descendientes (tramos anteriores, vigente y cambios programados, incluso cerrados).
  with recursive up as (
    select r.id, r.supersedes_recurrence_id, 0 as depth from public.recurrence_rules r where r.id = v_head_id and r.owner_id = v_owner
    union all
    select r.id, r.supersedes_recurrence_id, up.depth + 1 from public.recurrence_rules r join up on r.id = up.supersedes_recurrence_id where r.owner_id = v_owner and up.depth < 200
  ), root as (
    select id from up order by depth desc limit 1
  ), down as (
    select id, 0 as depth from root
    union all
    select r.id, down.depth + 1 from public.recurrence_rules r join down on r.supersedes_recurrence_id = down.id where r.owner_id = v_owner and down.depth < 200
  )
  select array_agg(distinct id) into v_ids from down;

  v_previous := least(v_head.end_date, v_head.series_end_date);
  if v_check and v_previous is distinct from v_expected then
    raise exception 'La serie cambió desde otro dispositivo. Actualizá la pantalla antes de guardar.' using errcode = 'TF001';
  end if;

  if v_end is not null and v_min is not null and v_end < v_min then
    raise exception 'La fecha de finalización no puede ser anterior al inicio del tramo que se edita (%).', to_char(v_min, 'DD/MM/YYYY') using errcode = '22023';
  end if;

  if v_end is not null then
    -- Una clase posterior al límite con registro o cobro no se puede cancelar con las reglas existentes: se rechaza TODA la operación, sin tocar dinero ni historia.
    select count(*), min((timezone(v_tz, cl.start_at))::date) into v_blocked, v_first_blocked
      from public.calendar_lessons cl
      where cl.owner_id = v_owner and cl.recurrence_id = any (v_ids)
        and cl.status in ('scheduled', 'completed', 'rescheduled')
        and (timezone(v_tz, cl.start_at))::date > v_end
        and (exists (select 1 from public.lesson_registrations r where r.owner_id = v_owner and r.calendar_lesson_id = cl.id)
          or exists (select 1 from public.payment_charges p where p.owner_id = v_owner and p.calendar_lesson_id = cl.id and p.voided_at is null));
    if v_blocked > 0 then
      raise exception 'La clase del % ya tiene registro o cobro y quedaría después de la fecha de finalización. Elegí una fecha posterior o resolvé esa clase antes.', to_char(v_first_blocked, 'DD/MM/YYYY') using errcode = 'TF005';
    end if;
  end if;

  -- El límite vive en todo el linaje. El fin propio del tramo vigente (el que se pudo fijar al crear la serie) pasa a ser el de la serie, así que se limpia: el efectivo es el menor de los dos.
  update public.recurrence_rules set series_end_date = v_end where owner_id = v_owner and id = any (v_ids) and series_end_date is distinct from v_end;
  get diagnostics v_rules = row_count;
  -- Sólo si ese fin es el PROPIO de la serie (el que se pudo fijar al crearla o importarla). Si el tramo tiene sucesora, su `end_date` es un corte de «esta y las siguientes» y se conserva
  -- (quitar el límite nunca debe alargar un tramo hasta pisar a su sucesora).
  update public.recurrence_rules set end_date = null
    where id = v_head_id and owner_id = v_owner and end_date is not null
      and not exists (select 1 from public.recurrence_rules s where s.owner_id = v_owner and s.supersedes_recurrence_id = v_head_id);

  perform set_config('tf.series_limit_op', 'on', true);
  if v_end is not null then
    update public.calendar_lessons cl
      set status = 'cancelled', cancelled_by_series_limit = true
      where cl.owner_id = v_owner and cl.recurrence_id = any (v_ids)
        and cl.status in ('scheduled', 'rescheduled')
        and (timezone(v_tz, cl.start_at))::date > v_end
        and public.calendar_lesson_occupies_slot(cl);
    get diagnostics v_cancelled = row_count;
  end if;
  -- Quitar o extender el límite: sólo se restauran las que canceló el propio límite (nunca una cancelación manual).
  update public.calendar_lessons cl
    set status = case when cl.recurrence_original_start is not null and cl.recurrence_occurrence_key is null then 'rescheduled' else 'scheduled' end,
        cancelled_by_series_limit = false
    where cl.owner_id = v_owner and cl.recurrence_id = any (v_ids)
      and cl.status = 'cancelled' and cl.cancelled_by_series_limit
      and (v_end is null or (timezone(v_tz, cl.start_at))::date <= v_end);
  get diagnostics v_restored = row_count;
  perform set_config('tf.series_limit_op', 'off', true);

  return jsonb_build_object('previous_end', v_previous, 'end_date', v_end, 'cancelled', v_cancelled, 'restored', v_restored, 'rules', v_rules);
end;
$$;
revoke all on function public.set_recurrence_series_end(jsonb) from public, anon;
grant execute on function public.set_recurrence_series_end(jsonb) to authenticated;

-- «Editar futuras» + fecha de finalización en UNA transacción: el corte (con la finalización de los tramos que reemplaza) y el límite del linaje resultante.
-- p_payload = { split: <payload del corte>, end_rule_ids: [uuid], end: <payload de set_recurrence_series_end sin head_id>, check: { head_id, expected_end } }
create or replace function public.edit_recurrence_future_with_end(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_successor public.recurrence_rules;
  v_check_head uuid := nullif(p_payload#>>'{check,head_id}', '')::uuid;
  v_expected date := nullif(p_payload#>>'{check,expected_end}', '')::date;
  v_current date;
  v_result jsonb;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if p_payload->'split' is null or p_payload->'end' is null then
    raise exception 'Falta el corte o la fecha de finalización.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 31100000));

  -- La serie debe seguir como la vio la pantalla (se comprueba ANTES de cortar). Un reintento del MISMO corte (respuesta perdida) no se compara: la sucesora ya existe y la operación es idempotente.
  if v_check_head is not null and not exists (
    select 1 from public.recurrence_rules s
    where s.owner_id = v_owner and s.supersedes_recurrence_id = nullif(p_payload#>>'{split,original_recurrence_id}', '')::uuid and s.effective_from_date = nullif(p_payload#>>'{split,effective_date}', '')::date
  ) then
    if not exists (select 1 from public.recurrence_rules where id = v_check_head and owner_id = v_owner) then
      raise exception 'La serie ya no existe.' using errcode = 'P0002';
    end if;
    v_current := public.recurrence_series_current_end(v_check_head);
    if v_current is distinct from v_expected then
      raise exception 'La serie cambió desde otro dispositivo. Actualizá la pantalla antes de guardar.' using errcode = 'TF001';
    end if;
  end if;

  if jsonb_array_length(coalesce(p_payload->'end_rule_ids', '[]'::jsonb)) > 0 then
    v_successor := public.split_recurrence_ending_segments(jsonb_build_object('split', p_payload->'split', 'end_rule_ids', p_payload->'end_rule_ids'));
  else
    v_successor := public.split_recurrence_this_and_future(p_payload->'split');
  end if;

  v_result := public.set_recurrence_series_end((p_payload->'end') || jsonb_build_object('head_id', v_successor.id, 'check_expected', false));
  return jsonb_build_object('head_id', v_successor.id) || v_result;
end;
$$;
revoke all on function public.edit_recurrence_future_with_end(jsonb) from public, anon;
grant execute on function public.edit_recurrence_future_with_end(jsonb) to authenticated;
