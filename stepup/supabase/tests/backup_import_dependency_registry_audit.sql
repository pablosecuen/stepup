-- Fase 9 — auditoría real (no pgTAP, corre de verdad vía
-- `supabase db query --linked --file`) de que
-- `import_undo_dependency_registry` (tabla, ver la migración de Fase 9)
-- sigue reflejando EXACTAMENTE las FKs reales de `pg_constraint` hacia las
-- tablas que Fase 9 puede insertar. Si una migración futura agrega una FK
-- entrante nueva hacia cualquiera de esas tablas y no se agrega también acá
-- (dato) y en `_external_dependency_blockers` (código, ramas tipadas), esta
-- prueba debe fallar — así el cierre de dependencias del undo nunca queda
-- obsoleto en silencio (exigencia explícita de Joaquín).
--
-- Alcance: se auditan FKs reales hacia las tablas de negocio que Fase 9
-- puede insertar (`students`, `training_billing_agreements`,
-- `recurrence_rules`, `calendar_lessons`, `lesson_registrations`,
-- `package_purchases`, `payment_charges`, `payments`), incluyendo tablas
-- operativas de fases previas que las referencian (ej.
-- `report_draft_claims`, Fase 7 — real, encontrada por esta misma
-- auditoría). Quedan fuera a propósito sólo las tablas TÉCNICAS propias de
-- esta misma Fase 9 (`import_preview_duplicate_candidates` y el resto de
-- `import_*`) — son bookkeeping efímero de la propia función de
-- importación, nunca datos de negocio creados independientemente por la
-- profesora, así que no tiene sentido que bloqueen su propio undo.

do $$
declare
  v_parent_tables text[] := array['students','training_billing_agreements','recurrence_rules','calendar_lessons','lesson_registrations','package_purchases','payment_charges','payments'];
  v_own_technical_tables text[] := array['import_previews','import_preview_row_fingerprints','import_preview_duplicate_candidates','import_runs','import_run_row_snapshots','import_undo_previews','import_undo_dependency_registry'];
  v_missing record;
  v_missing_count int := 0;
  v_stale record;
  v_stale_count int := 0;
begin
  -- 1) Toda FK real (pg_constraint) hacia una tabla padre de la lista, que
  -- referencia otra tabla del schema `public` (salvo las técnicas propias
  -- de Fase 9), debe estar en el registro.
  for v_missing in
    select
      pt.relname as parent_table,
      ct.relname as child_table,
      a.attname as fk_column
    from pg_constraint c
    join pg_class pt on pt.oid = c.confrelid
    join pg_class ct on ct.oid = c.conrelid
    join pg_namespace pn on pn.oid = pt.relnamespace and pn.nspname = 'public'
    join pg_namespace cn on cn.oid = ct.relnamespace and cn.nspname = 'public'
    join unnest(c.conkey) as k(attnum) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.contype = 'f'
      and pt.relname = any(v_parent_tables)
      and not (ct.relname = any(v_own_technical_tables))
      and not exists (
        select 1 from public.import_undo_dependency_registry r
          where r.parent_table = pt.relname and r.child_table = ct.relname and r.fk_column = a.attname
      )
  loop
    v_missing_count := v_missing_count + 1;
    raise warning 'FK real NO cubierta por el registro de undo: %.% -> %.%', v_missing.child_table, v_missing.fk_column, v_missing.parent_table, 'id';
  end loop;

  -- 2) Nada en el registro debe apuntar a una FK que ya no existe de verdad
  -- (registro obsoleto por una columna/constraint eliminada).
  for v_stale in
    select r.parent_table, r.child_table, r.fk_column
      from public.import_undo_dependency_registry r
      where not exists (
        select 1
          from pg_constraint c
          join pg_class pt on pt.oid = c.confrelid
          join pg_class ct on ct.oid = c.conrelid
          join unnest(c.conkey) as k(attnum) on true
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
          where c.contype = 'f' and pt.relname = r.parent_table and ct.relname = r.child_table and a.attname = r.fk_column
      )
  loop
    v_stale_count := v_stale_count + 1;
    raise warning 'Entrada del registro de undo sin FK real correspondiente (obsoleta): %.% -> %', v_stale.child_table, v_stale.fk_column, v_stale.parent_table;
  end loop;

  if v_missing_count > 0 or v_stale_count > 0 then
    raise exception 'Auditoría de dependencias de undo FALLÓ: % FK real(es) sin cubrir, % entrada(s) obsoleta(s) — ver warnings arriba.', v_missing_count, v_stale_count;
  end if;

  raise notice 'Auditoría de dependencias de undo OK: el registro cubre exactamente las FKs reales hacia las % tablas padre de Fase 9.', array_length(v_parent_tables, 1);
end $$;
