-- R2 — Disponibilidad e integridad con grandes volúmenes de datos.
--
-- RPC aditiva `public.list_open_charge_balances()`: los cargos VIGENTES con saldo pendiente de la profesora autenticada,
-- cada uno con lo ya pagado. Reemplaza, para Inicio / Cobros / Recordatorios, la descarga de TODA la historia de cargos,
-- asignaciones y pagos (que además se truncaba en silencio en `max_rows`) sólo para calcular qué se debe.
--
-- Qué hace exactamente (misma aritmética que `lib/payments/charge-balance.ts`):
--   * cargo no anulado (`voided_at is null`);
--   * pagado = suma de las asignaciones cuyo pago NO está anulado (`payments.voided_at is null`);
--   * abierto = `original_amount - pagado > 0` (el móvil/web lo llaman "no saldado": `balance = max(0, original - pagado)`).
-- Las reglas de vencimiento (etapas, urgencia, "vencido para mostrar") NO se duplican acá: siguen en TypeScript
-- (`lib/payments/due-stage.ts`) y se aplican sobre estas filas.
--
-- Seguridad:
--   * SECURITY INVOKER (alcanza): corre con los permisos de quien llama, así que RLS sigue aplicando.
--   * El propietario sale SIEMPRE de `auth.uid()`; la función no recibe ningún `owner_id`. Sin sesión (`auth.uid()` nulo)
--     devuelve cero filas.
--   * `search_path` vacío y todos los objetos calificados; EXECUTE sólo para `authenticated` (nunca `anon`/`public`).
-- Compatibilidad: sólo AGREGA una función; el web anterior no la usa y sigue funcionando igual durante el despliegue.

create or replace function public.list_open_charge_balances()
returns table (
  charge_id uuid,
  student_id uuid,
  charge_type text,
  due_date date,
  original_amount numeric,
  paid_amount numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.student_id,
    c.charge_type,
    c.due_date,
    c.original_amount,
    coalesce(p.paid, 0)::numeric
  from public.payment_charges c
  left join lateral (
    select sum(a.amount) as paid
    from public.payment_allocations a
    join public.payments pay on pay.id = a.payment_id
    where a.charge_id = c.id
      and a.owner_id = c.owner_id
      and pay.voided_at is null
  ) p on true
  where c.owner_id = (select auth.uid())
    and c.voided_at is null
    and c.original_amount - coalesce(p.paid, 0) > 0
$$;

comment on function public.list_open_charge_balances() is
  'Cargos vigentes con saldo pendiente de la profesora autenticada (owner = auth.uid(), RLS aplica) y lo ya pagado (asignaciones de pagos no anulados). Las reglas de vencimiento se aplican en la web.';

revoke all on function public.list_open_charge_balances() from public;
revoke execute on function public.list_open_charge_balances() from anon;
grant execute on function public.list_open_charge_balances() to authenticated;
