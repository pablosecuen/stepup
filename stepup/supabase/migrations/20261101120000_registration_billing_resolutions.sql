-- Separación financiera entre entrenamientos, series y clases sueltas.
-- Una sesión de ENTRENAMIENTO sólo está cubierta por la cuota de SU acuerdo cuando eso es explícito. Cuando la sesión no declara su acuerdo (sesión suelta, o un
-- participante que no pertenece al acuerdo de la serie) la profesora lo resuelve UNA vez, por participante, y la decisión queda guardada: guardar, finalizar, editar o
-- reintentar el registro vuelve a leer la misma decisión (nunca se vuelve a inferir). Aditiva: no toca cargos, pagos, asignaciones ni registros existentes.
begin;

create table if not exists public.lesson_registration_billing_resolutions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lesson_registration_id uuid not null references public.lesson_registrations(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  decision text not null check (decision in ('covered', 'own_regime')),
  training_billing_agreement_id uuid references public.training_billing_agreements(id) on delete restrict,
  decided_at timestamptz not null default now(),
  constraint lesson_registration_billing_resolutions_unique unique (lesson_registration_id, student_id),
  constraint lesson_registration_billing_resolutions_agreement_matches_decision check ((decision = 'covered') = (training_billing_agreement_id is not null))
);

create index if not exists lesson_registration_billing_resolutions_owner_idx on public.lesson_registration_billing_resolutions (owner_id);
create index if not exists lesson_registration_billing_resolutions_agreement_idx on public.lesson_registration_billing_resolutions (training_billing_agreement_id) where training_billing_agreement_id is not null;

comment on table public.lesson_registration_billing_resolutions is
  'Decisión explícita, por participante, de cómo se cobra una sesión de entrenamiento: "covered" = cubierta por la cuota del acuerdo indicado; "own_regime" = se cobra por el régimen propio del alumno (clase suelta). Sólo la escribe resolve_registration_billing.';

alter table public.lesson_registration_billing_resolutions enable row level security;
drop policy if exists lesson_registration_billing_resolutions_owner_select on public.lesson_registration_billing_resolutions;
create policy lesson_registration_billing_resolutions_owner_select on public.lesson_registration_billing_resolutions
  for select to authenticated using (owner_id = auth.uid());
revoke all on public.lesson_registration_billing_resolutions from anon, authenticated;
grant select on public.lesson_registration_billing_resolutions to authenticated;

create or replace function public.resolve_registration_billing(p_registration_id uuid, p_student_id uuid, p_decision text, p_agreement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_registration public.lesson_registrations;
  v_current public.lesson_registration_billing_resolutions;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if p_decision is null or p_decision not in ('covered', 'own_regime') or (p_decision = 'covered') <> (p_agreement_id is not null) then
    raise exception 'La decisión de cobro no es válida.' using errcode = '22023';
  end if;

  select * into v_registration from public.lesson_registrations where id = p_registration_id and owner_id = v_owner for update;
  if not found then
    raise exception 'El registro no existe o no te pertenece.' using errcode = 'P0002';
  end if;
  if v_registration.activity_kind <> 'training' then
    raise exception 'Sólo una sesión de entrenamiento necesita esta decisión.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.lesson_registration_students s
    where s.lesson_registration_id = v_registration.id and s.student_id = p_student_id and s.owner_id = v_owner
  ) then
    raise exception 'El alumno no participa de este registro.' using errcode = 'P0002';
  end if;
  if p_agreement_id is not null and not exists (
    select 1 from public.training_billing_agreements a where a.id = p_agreement_id and a.owner_id = v_owner
  ) then
    raise exception 'El entrenamiento elegido no existe o no te pertenece.' using errcode = 'P0002';
  end if;

  select * into v_current from public.lesson_registration_billing_resolutions where lesson_registration_id = v_registration.id and student_id = p_student_id;
  if found and v_current.decision = p_decision and v_current.training_billing_agreement_id is not distinct from p_agreement_id then
    -- Mismo pedido repetido (doble toque, reintento): no cambia nada.
    return jsonb_build_object('registration_id', v_registration.id, 'student_id', p_student_id, 'decision', p_decision, 'agreement_id', p_agreement_id, 'changed', false);
  end if;

  insert into public.lesson_registration_billing_resolutions (owner_id, lesson_registration_id, student_id, decision, training_billing_agreement_id)
  values (v_owner, v_registration.id, p_student_id, p_decision, p_agreement_id)
  on conflict (lesson_registration_id, student_id) do update
    set decision = excluded.decision, training_billing_agreement_id = excluded.training_billing_agreement_id, decided_at = now();

  return jsonb_build_object('registration_id', v_registration.id, 'student_id', p_student_id, 'decision', p_decision, 'agreement_id', p_agreement_id, 'changed', true);
end;
$$;

revoke all on function public.resolve_registration_billing(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.resolve_registration_billing(uuid, uuid, text, uuid) to authenticated;

commit;
