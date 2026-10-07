-- R4 — Diagnóstico de SÓLO LECTURA: PDF de reportes huérfanos (cuya cuenta ya no existe).
--
-- Cuándo pasa: la eliminación de cuenta DESDE LA WEB borra los PDF antes de eliminar la cuenta (R4), pero `delete_own_account` lo puede llamar
-- también la app móvil, que no sabe nada de Storage: una cuenta eliminada desde el móvil puede dejar sus PDF de reportes en el bucket
-- (`storage.objects` no tiene ninguna relación con la cascada de `auth.users`).
--
-- Esta consulta NO borra nada y NO devuelve rutas ni nombres: sólo cantidades (objetos huérfanos, cuentas distintas y bytes). Se ejecuta con
-- `supabase db query --linked -f supabase/repairs/r4_orphan_report_pdfs.sql`. Si devuelve filas, el borrado hay que hacerlo con la API de
-- Storage (la base lo impide con `storage.protect_delete`) y una clave de servicio, decisión del dueño del proyecto; no se hace desde la web.
select count(*)::int as objetos_huerfanos,
       count(distinct (storage.foldername(o.name))[1])::int as cuentas_distintas,
       coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint as bytes
  from storage.objects o
 where o.bucket_id = 'report-pdfs'
   and not exists (select 1 from auth.users u where u.id::text = (storage.foldername(o.name))[1]);
