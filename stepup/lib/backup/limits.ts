/**
 * Fase 9 — límites centrales compartidos por la validación pura (cliente y
 * Server Action), la UI y la RPC de Postgres (`preview_backup_import`
 * repite estos mismos números como defensa en profundidad — nunca confía
 * en que el cliente ya validó). Todos conservadores y explícitos: el único
 * derivado de un límite REAL ya vigente es `MAX_PAYLOAD_BYTES` (igual al
 * límite real de `upload_cloud_backup`, ver `supabase/migrations` del repo
 * móvil). El resto son propuestas conservadoras documentadas como tales,
 * no medidas de uso real.
 */
export const BACKUP_IMPORT_LIMITS = {
  /** Igual al límite REAL ya vigente en `upload_cloud_backup` (móvil). */
  MAX_PAYLOAD_BYTES: 20 * 1024 * 1024,
  /** Conservador, sin evidencia real de volumen típico. */
  MAX_ROWS_PER_COLLECTION: 5_000,
  /** Margen sobre ~10 colecciones importables x 5.000. */
  MAX_ROWS_TOTAL: 50_000,
  /** La forma real más anidada del backup no supera 4-5 niveles; da margen generoso. */
  MAX_JSON_DEPTH: 12,
  /** Generoso para cualquier nota/observación real. */
  MAX_FREE_TEXT_LENGTH: 10_000,
  /** Volumen razonable de revisión humana en una sola sesión de confirmación. */
  MAX_FIELD_OVERRIDES: 2_000,
  /** Vigencia de un preview (de importación o de undo) antes de considerarse vencido. */
  PREVIEW_TTL_MINUTES: 30,
  /** Retención del payload conservado en `import_runs` y de los snapshots de undo. */
  RUN_RETENTION_DAYS: 30,
} as const;
