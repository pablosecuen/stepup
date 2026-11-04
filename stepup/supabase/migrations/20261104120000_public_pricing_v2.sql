-- Nuevos precios aprobados. Las versiones v1 y su historial se conservan.
-- Sólo se agregan cuatro filas de catálogo; no se crean cargos ni suscripciones.
begin;
insert into public.billing_plans (code, name, currency, amount_minor, interval_months, months_of_access, provider_interval, active, price_version) values
  ('tf_monthly_ars_v2', 'Mensual', 'ARS', 2590000, 1, 1, '1m', true, 2),
  ('tf_quarterly_ars_v2', 'Trimestral', 'ARS', 6990000, 3, 3, '3m', true, 2),
  ('tf_semiannual_ars_v2', 'Semestral', 'ARS', 13140000, 6, 6, '6m', true, 2),
  ('tf_annual_ars_v2', 'Anual', 'ARS', 23880000, 12, 12, '1y', true, 2)
on conflict (code) do nothing;
commit;
