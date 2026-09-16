-- TeacherFlow Web — Fase 1 (arquitectura de base de datos)
-- Extensiones y funciones auxiliares compartidas por todas las migraciones
-- siguientes. Idempotente: puede re-ejecutarse sin error.

create extension if not exists pgcrypto;

-- updated_at automático — usado por cualquier tabla mutable (nunca por
-- tablas de sólo-auditoría append-only, que no tienen updated_at).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger BEFORE UPDATE compartido: mantiene updated_at sincronizado en cualquier tabla mutable de TeacherFlow.';
