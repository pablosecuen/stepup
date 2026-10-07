/**
 * Límites por importación — fuente de verdad en la base: `public._import_limits()` (migración `20261010100000_r6_import_limits_and_helpers.sql`).
 * Esta web repite EXACTAMENTE los mismos números para rechazar ANTES de llamar a la base (una prueba los compara con la migración); la RPC los vuelve
 * a controlar como defensa en profundidad y nunca confía en que el cliente ya validó.
 *
 * Origen de cada número (medido en Postgres 17.6, ver `docs/R6_IMPORTACIONES_GRANDES.md`):
 *  - `MAX_PAYLOAD_BYTES`: igual al límite REAL ya vigente en `upload_cloud_backup` (app móvil).
 *  - `MAX_WORK_UNITS` (filas contadas + anidadas): la medida real de trabajo. La aplicación cuesta ≈ 0,22–0,28 ms por unidad en el peor perfil
 *    medido; con 7.500 unidades el peor caso tarda ≈ 2 s sin carga, el 25 % del `statement_timeout` de 8 s del rol `authenticated` (la base cancela y
 *    revierte todo lo que pase de 8 s: no se puede ampliar desde la función). `MAX_ROWS_TOTAL` y `MAX_NESTED_ROWS` acotan cada parte por separado
 *    al mismo número: ninguna de las dos puede, sola, pasar el presupuesto.
 *  - `MAX_ROWS_PER_COLLECTION`: ninguna colección de una cuenta real se acerca (las cuotas de R3 son más bajas para alumnos, niveles y acuerdos).
 *  - `MAX_FIELD_OVERRIDES` / `MAX_DUPLICATE_DECISIONS`: cada decisión cuesta una actualización + una instantánea (≈ 0,5 ms); 2.000 caben holgadas.
 *  - `MAX_JSON_DEPTH` / `MAX_FREE_TEXT_LENGTH`: la forma real más anidada del respaldo no pasa de 4-5 niveles; 10.000 caracteres sobran para cualquier nota.
 */
export const BACKUP_IMPORT_LIMITS = {
  /** Igual al límite REAL ya vigente en `upload_cloud_backup` (móvil). */
  MAX_PAYLOAD_BYTES: 20 * 1024 * 1024,
  /** Filas de UNA colección del respaldo. */
  MAX_ROWS_PER_COLLECTION: 5_000,
  /** Filas de las 17 colecciones que cuenta la validación (alumnos, clases, registros, cobros…). */
  MAX_ROWS_TOTAL: 7_500,
  /** Filas anidadas que esa cuenta no ve: integrantes, roster, asistencias, evaluaciones, revisiones de tarea, historial de niveles. */
  MAX_NESTED_ROWS: 7_500,
  /** Filas contadas + anidadas: lo que de verdad se escribe en una importación. */
  MAX_WORK_UNITS: 7_500,
  /** La forma real más anidada del backup no supera 4-5 niveles; da margen generoso. */
  MAX_JSON_DEPTH: 12,
  /** Generoso para cualquier nota/observación real. */
  MAX_FREE_TEXT_LENGTH: 10_000,
  /** Reemplazos de campos que se pueden confirmar de una vez. */
  MAX_FIELD_OVERRIDES: 2_000,
  /** Decisiones sobre posibles duplicados que se pueden confirmar de una vez. */
  MAX_DUPLICATE_DECISIONS: 2_000,
  /** Vigencia de un preview (de importación o de undo) antes de considerarse vencido. */
  PREVIEW_TTL_MINUTES: 30,
  /** Retención del payload conservado en `import_runs` y de los snapshots de undo. */
  RUN_RETENTION_DAYS: 30,
} as const;
