-- R3 — Cuotas y límites de uso por cuenta (infraestructura). Aditiva e idempotente: sólo crea tablas, funciones y datos de configuración;
-- NO toca ninguna tabla, función, política ni dato existente. Los disparadores que aplican estos límites van en la migración siguiente
-- (20261007110000), para poder retirarlos por separado si hiciera falta.
--
-- Qué resuelve: hoy una sesión autenticada (la web, un script directo a PostgREST o una cuenta descartable) puede crear filas sin tope
-- en ~25 tablas con INSERT directo y en ~27 RPC. Estas cuotas viven en la BASE (mismo statement/transacción que crea el recurso) para
-- que valgan también para llamadas que no pasan por la web.
--
-- Diseño:
--   * Tope TOTAL por cuenta y categoría, y tope por HORA sólo donde la operación es costosa (reportes/PDF, importaciones, claims).
--   * Se aplican con disparadores AFTER INSERT por sentencia (transition tables): una fila que `ON CONFLICT DO NOTHING` descarta (el
--     reintento idempotente) no dispara nada, así que un reintento con la misma clave NUNCA consume cuota ni falla aunque la cuenta
--     esté en el tope. Se cuenta después de insertar y se rechaza si el total supera el límite: toda la transacción (la RPC completa)
--     se revierte.
--   * Una cuenta que YA está por encima de un límite nuevo no queda bloqueada por lo que tiene: las lecturas, las ediciones y las
--     demás categorías siguen igual; sólo no puede crear más filas de esa categoría hasta volver a estar dentro del límite.
--   * Concurrencia: un lock de aviso transaccional POR CUENTA (`pg_advisory_xact_lock('tf-quota:'||owner)`) serializa el chequeo de
--     una misma cuenta; dos cuentas distintas nunca comparten lock ni contador. Una única clave de lock por cuenta (no una por
--     categoría) evita ciclos de bloqueo entre categorías.
--   * Excepciones por cuenta: `account_quota_overrides` (sin ninguna API pública: RLS activa sin políticas y sin permisos para
--     anon/authenticated; sólo se edita con SQL privilegiado). Los valores por defecto viven en `quota_defaults` (editables igual).
--   * Errores: SQLSTATE 53400 con mensajes estables (`quota_exceeded`, `quota_rate_exceeded`, `quota_row_too_large`) y la categoría en
--     `detail`; la web los traduce a un texto claro sin revelar tablas, SQL ni cifras internas.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1) Configuración (nadie de la API puede leerla ni escribirla)
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.quota_defaults (
  quota_key text primary key,
  max_total integer check (max_total is null or max_total > 0),
  max_per_hour integer check (max_per_hour is null or max_per_hour > 0),
  max_row_bytes integer check (max_row_bytes is null or max_row_bytes > 0),
  rationale text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.account_quota_overrides (
  owner_id uuid not null references auth.users(id) on delete cascade,
  quota_key text not null, -- clave de quota_defaults, o 'action:<acción>' para los límites por ventana de acciones de la web
  max_total integer check (max_total is null or max_total > 0),
  max_per_hour integer check (max_per_hour is null or max_per_hour > 0),
  max_row_bytes integer check (max_row_bytes is null or max_row_bytes > 0),
  note text,
  created_at timestamptz not null default now(),
  primary key (owner_id, quota_key)
);

create table if not exists public.action_quota_defaults (
  action_key text primary key,
  max_per_window integer not null check (max_per_window > 0),
  window_seconds integer not null check (window_seconds > 0),
  rationale text not null
);

-- Eventos de acciones costosas de la web (ver `consume_action_quota`). Se limpian solos: cada consumo borra los vencidos de su cuenta
-- y acción, y una cuenta no puede acumular más de `max_per_window` por acción.
create table if not exists public.account_action_events (
  owner_id uuid not null references auth.users(id) on delete cascade,
  action_key text not null,
  occurred_at timestamptz not null default now()
);
create index if not exists account_action_events_owner_action_idx on public.account_action_events (owner_id, action_key, occurred_at);

alter table public.quota_defaults enable row level security;
alter table public.account_quota_overrides enable row level security;
alter table public.action_quota_defaults enable row level security;
alter table public.account_action_events enable row level security;
revoke all on public.quota_defaults from public, anon, authenticated;
revoke all on public.account_quota_overrides from public, anon, authenticated;
revoke all on public.action_quota_defaults from public, anon, authenticated;
revoke all on public.account_action_events from public, anon, authenticated;

comment on table public.quota_defaults is 'R3: límites por defecto por cuenta y categoría (total, por hora, bytes por fila). Sin acceso desde la API.';
comment on table public.account_quota_overrides is 'R3: excepciones por cuenta. Se editan sólo con SQL privilegiado (nunca desde la API). Un valor nulo hereda el por defecto.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 2) Valores por defecto — justificados con uso real (Production: 1 cuenta con datos, 6 alumnos, 12 clases, 7 registros) y crecimiento
--    esperado de una profesora grande (~150 alumnos activos, ~40 clases por semana, 10+ años de historia porque nunca se borra nada).
--    Margen ≥ 3x sobre el caso extremo realista; los topes protegen la base, no limitan el uso normal.
-- ---------------------------------------------------------------------------------------------------------------------
insert into public.quota_defaults (quota_key, max_total, max_per_hour, max_row_bytes, rationale) values
  ('students', 2000, null, 65536, 'Profesora grande: ~600 alumnos en 15 años (activos + archivados, nunca se borran). Margen ≥ 3x.'),
  ('student_creation_claims', 20000, 300, 65536, 'Un claim por alta o reintento; ≈ alumnos x altas repetidas. 300/h cubre cargas manuales intensas (60/h) con margen.'),
  ('student_creation_claims_pending', 50, null, null, 'Altas "pendientes de confirmar duplicado" (vencen a los 30 min): una persona abre pocas a la vez.'),
  ('calendar_lessons', 50000, null, 65536, '~2.000 clases materializadas por año x 10 años = 20.000; margen 2,5x.'),
  ('calendar_lessons_future', 6000, null, null, 'Clases futuras programadas: ~2.100 por año completas; 6.000 ≈ 3 años por adelantado.'),
  ('calendar_lesson_participants', 150000, null, 65536, 'Hasta ~3 integrantes promedio por clase en 50.000 clases.'),
  ('recurrence_rules', 5000, null, 65536, 'Series activas, pausadas, terminadas y sucesoras por cambios: 100 series activas x ~10 versiones, con margen amplio.'),
  ('recurrence_rule_participants', 20000, null, 65536, 'Integrantes de series: 5.000 series x ~4.'),
  ('recurrence_exceptions', 100000, null, 65536, 'Una excepción por ocurrencia cancelada/reprogramada: ~20.000 en 10 años.'),
  ('lesson_registrations', 100000, null, 65536, 'Un registro por clase dictada: ~21.000 en 10 años; incluye libres (ad-hoc).'),
  ('lesson_registration_students', 200000, null, 65536, 'Un integrante por alumno y registro.'),
  ('lesson_registration_attendance', 200000, null, 65536, 'Una asistencia por alumno y registro.'),
  ('lesson_registration_evaluations', 200000, null, 65536, 'Una evaluación por alumno y registro.'),
  ('lesson_registration_homework_reviews', 300000, null, 65536, 'Revisión de tareas por alumno y registro (puede haber varias por registro).'),
  ('lesson_registration_edit_history', 100000, null, 262144, 'Una auditoría por edición de registro finalizado; snapshot de hasta 1 MB.'),
  ('payments', 50000, null, 65536, '~150 alumnos x 12 pagos por año x 10 años = 18.000; margen ≈ 3x.'),
  ('payment_charges', 50000, null, 65536, 'Un cargo por alumno y período (+ por clase/entrenamiento): ~20.000 en 10 años.'),
  ('payment_allocations', 100000, null, 65536, 'Asignaciones pago-cargo (pagos parciales, varios cargos por pago).'),
  ('payment_adjustments', 20000, null, 65536, 'Condonaciones/ajustes: raros.'),
  ('training_billing_agreements', 1000, null, 65536, 'Acuerdos de cuota de entrenamiento: una profesora tiene pocos.'),
  ('pending_training_billing_operations', 200, null, 262144, 'Operaciones de facturación pendientes de reconciliar: normalmente 0-1.'),
  ('package_purchases', 20000, null, 65536, 'Paquetes de clases (funcionalidad del móvil).'),
  ('package_credit_movements', 100000, null, 65536, 'Movimientos de crédito de paquetes.'),
  ('first_month_proration_decisions', 20000, null, 65536, 'Decisión por alumno/período inicial.'),
  ('monthly_amount_corrections', 20000, null, 65536, 'Correcciones de importe mensual: raras.'),
  ('initial_paid_surcharge_corrections', 20000, null, 65536, 'Correcciones de recargo inicial: raras.'),
  ('student_status_history', 50000, null, 65536, 'Cambios de estado por alumno: ~600 alumnos x ~10 cambios x margen.'),
  ('student_level_history', 50000, null, 65536, 'Cambios de nivel por alumno.'),
  ('student_price_history', 50000, null, 65536, 'Cambios de precio por alumno.'),
  ('custom_levels', 200, null, 65536, 'Niveles personalizados: una profesora usa unos pocos.'),
  ('report_records', 10000, 60, 524288, 'Reportes: 150 alumnos x 12 por año x 10 años = 18.000 máx. teórico; 10.000 deja margen real. 60/h: cada reporte renderiza un PDF. Fila real ≈ decenas de KB (snapshot de un mes).'),
  ('report_pdf_cleanup_jobs', 5000, null, 65536, 'Limpiezas de PDF pendientes (se resuelven solas): normalmente 0.'),
  ('import_previews', 100, 20, 26214400, 'Vistas previas de importación (cada una guarda el respaldo normalizado; el respaldo de la nube admite hasta 20 MB y el real ronda 250 KB). Uso real: unas pocas en toda la vida de la cuenta; 20/h es mucho más. Sin limpieza automática hasta R4, el tope total acota lo que puede quedar guardado.'),
  ('import_previews_pending', 10, null, null, 'Vistas previas vigentes (vencen a los 30 min): una o dos a la vez en la práctica.'),
  ('import_runs', 100, null, 26214400, 'Importaciones aplicadas: eventos raros (alta inicial, recuperación); guardan una copia del respaldo para poder deshacer.'),
  ('import_undo_previews', 100, null, 8388608, 'Vistas previas de deshacer importación.'),
  ('import_undo_previews_pending', 10, null, null, 'Vistas previas de deshacer vigentes.')
on conflict (quota_key) do nothing;

insert into public.action_quota_defaults (action_key, max_per_window, window_seconds, rationale) values
  ('report_preview', 120, 3600, 'Vista previa de reporte: cálculo sobre el historial del alumno; una profesora previsualiza pocas veces por alumno.'),
  ('report_pdf', 60, 3600, 'Generar o regenerar un PDF (CPU del servidor): 150 alumnos en un cierre mensual = 150/mes, no por hora.'),
  ('cloud_backup_analyze', 20, 3600, 'Descarga y análisis del respaldo de la nube (hasta 20 MB): uso real ≈ 1-2 por importación.'),
  ('password_change_email', 5, 3600, 'Correo de cambio de contraseña de una sesión iniciada (consume cuota de correos del proveedor).')
on conflict (action_key) do nothing;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3) Funciones de disparador (no ejecutables por la API)
-- ---------------------------------------------------------------------------------------------------------------------

-- Predicados sobre la fila NUEVA para las categorías con filtro: una fila fuera del filtro no cambia ese conteo, así que no se chequea
-- (una cuenta por encima del tope de "clases futuras" puede igual registrar una clase pasada).
create or replace function public.tf_quota_row_applies(p_key text, p_row jsonb)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case p_key
    when 'student_creation_claims_pending' then p_row ->> 'status' = 'pending' and (p_row ->> 'expires_at')::timestamptz > now()
    when 'import_previews_pending' then p_row ->> 'status' = 'pending' and (p_row ->> 'expires_at')::timestamptz > now()
    when 'import_undo_previews_pending' then p_row ->> 'status' = 'pending' and (p_row ->> 'expires_at')::timestamptz > now()
    when 'calendar_lessons_future' then p_row ->> 'status' = 'scheduled' and (p_row ->> 'start_at')::timestamptz > now()
    else true
  end
$$;

-- Mismo criterio para contar lo que YA existe (constantes de confianza: nunca texto de la API).
create or replace function public.tf_quota_count_filter(p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_key
    when 'student_creation_claims_pending' then 'status = ''pending'' and expires_at > now()'
    when 'import_previews_pending' then 'status = ''pending'' and expires_at > now()'
    when 'import_undo_previews_pending' then 'status = ''pending'' and expires_at > now()'
    when 'calendar_lessons_future' then 'status = ''scheduled'' and start_at > now()'
    else 'true'
  end
$$;

-- AFTER INSERT por sentencia. Argumentos: lista de "clave" o "clave:columna_de_fecha" (la fecha sólo si hay tope por hora).
create or replace function public.tf_quota_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_arg text;
  v_key text;
  v_ts text;
  v_owner uuid;
  v_max_total integer;
  v_max_hour integer;
  v_applies boolean;
  v_count bigint;
  v_i integer;
begin
  for v_owner in select distinct owner_id from new_rows loop
    -- Un único lock por cuenta (todas las categorías): dos cuentas distintas nunca se bloquean entre sí y no hay ciclos entre categorías.
    perform pg_advisory_xact_lock(hashtextextended('tf-quota:' || v_owner::text, 0));

    for v_i in 0 .. tg_nargs - 1 loop
      v_arg := tg_argv[v_i];
      v_key := split_part(v_arg, ':', 1);
      v_ts := nullif(split_part(v_arg, ':', 2), '');

      select coalesce(o.max_total, d.max_total), coalesce(o.max_per_hour, d.max_per_hour)
        into v_max_total, v_max_hour
        from public.quota_defaults d
        left join public.account_quota_overrides o on o.owner_id = v_owner and o.quota_key = d.quota_key
       where d.quota_key = v_key;
      if not found then continue; end if;

      -- ¿Alguna de las filas recién insertadas de esta cuenta entra en esta categoría?
      execute 'select exists (select 1 from new_rows n where n.owner_id = $1 and public.tf_quota_row_applies($2, to_jsonb(n)))'
        into v_applies using v_owner, v_key;
      if not v_applies then continue; end if;

      if v_max_total is not null then
        execute format('select count(*) from public.%I where owner_id = $1 and (%s)', tg_table_name, public.tf_quota_count_filter(v_key))
          into v_count using v_owner;
        if v_count > v_max_total then
          raise exception 'quota_exceeded' using errcode = '53400', detail = v_key;
        end if;
      end if;

      if v_max_hour is not null and v_ts is not null then
        execute format('select count(*) from public.%I where owner_id = $1 and %I > now() - interval ''1 hour''', tg_table_name, v_ts)
          into v_count using v_owner;
        if v_count > v_max_hour then
          raise exception 'quota_rate_exceeded' using errcode = '53400', detail = v_key;
        end if;
      end if;
    end loop;
  end loop;
  return null;
end;
$$;

-- BEFORE INSERT OR UPDATE por fila: tamaño máximo de una fila (jsonb/texto enormes). En UPDATE sólo rechaza si la fila CRECE por encima del
-- tope: una fila antigua que ya lo superaba nunca queda bloqueada para ediciones que no la agrandan.
create or replace function public.tf_quota_row_size()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_size integer;
  v_old_size integer := 0;
begin
  -- La clave de la categoría "total" de cada tabla coincide con su nombre y lleva el tope de bytes por fila.
  select coalesce(o.max_row_bytes, d.max_row_bytes)
    into v_limit
    from public.quota_defaults d
    left join public.account_quota_overrides o on o.owner_id = new.owner_id and o.quota_key = d.quota_key
   where d.quota_key = tg_table_name;
  if v_limit is null then return new; end if;
  v_size := pg_column_size(new);
  if tg_op = 'UPDATE' then v_old_size := pg_column_size(old); end if;
  if v_size > v_limit and (tg_op = 'INSERT' or v_size > v_old_size) then
    raise exception 'quota_row_too_large' using errcode = '53400', detail = tg_table_name;
  end if;
  return new;
end;
$$;

revoke all on function public.tf_quota_row_applies(text, jsonb) from public, anon, authenticated;
revoke all on function public.tf_quota_count_filter(text) from public, anon, authenticated;
revoke all on function public.tf_quota_after_insert() from public, anon, authenticated;
revoke all on function public.tf_quota_row_size() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4) Límite por ventana para acciones costosas de la web (la web lo llama ANTES del trabajo costoso)
-- ---------------------------------------------------------------------------------------------------------------------
-- El propietario sale siempre de auth.uid(); los límites salen de la base (action_quota_defaults/overrides): el cliente sólo elige UNA
-- acción de una lista cerrada y no puede cambiar ningún valor. Una llamada rechazada no inserta nada (no hay forma de inflar la tabla).
create or replace function public.consume_action_quota(p_action text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_window integer;
  v_max integer;
  v_count integer;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  select coalesce(o.max_total, d.max_per_window), d.window_seconds
    into v_max, v_window
    from public.action_quota_defaults d
    left join public.account_quota_overrides o on o.owner_id = v_owner and o.quota_key = 'action:' || d.action_key
   where d.action_key = p_action;
  if not found then
    raise exception 'Acción no reconocida.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tf-action:' || v_owner::text || ':' || p_action, 0));

  delete from public.account_action_events
   where owner_id = v_owner and action_key = p_action and occurred_at < now() - make_interval(secs => v_window);

  select count(*) into v_count from public.account_action_events where owner_id = v_owner and action_key = p_action;
  if v_count >= v_max then
    raise exception 'quota_rate_exceeded' using errcode = '53400', detail = p_action;
  end if;

  insert into public.account_action_events (owner_id, action_key) values (v_owner, p_action);
end;
$$;

revoke all on function public.consume_action_quota(text) from public;
revoke execute on function public.consume_action_quota(text) from anon;
grant execute on function public.consume_action_quota(text) to authenticated;

comment on function public.consume_action_quota(text) is
  'R3: consume una unidad del límite por ventana de una acción costosa de la web (propietario = auth.uid()). Falla con 53400 quota_rate_exceeded al agotarse.';
