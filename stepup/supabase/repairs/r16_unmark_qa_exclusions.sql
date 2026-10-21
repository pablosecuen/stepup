-- R16 — REVERSIÓN: vuelve a mostrar los datos de prueba en agenda, pendientes y estadísticas. No borra nada: marca como revocadas las exclusiones cargadas por
-- `r16_mark_qa_exclusions.sql` (queda el registro de cuándo estuvieron activas). Volver a ejecutar `r16_mark_qa_exclusions.sql` las reactiva.
update public.test_data_exclusions
   set revoked_at = now()
 where revoked_at is null and reason like 'r16-qa:%';
