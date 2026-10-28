// Puerto VERBATIM del original (`src/shared/backup/restoreExecutor.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type {
  BackupCollectionName,
  PaymentBackupCollectionName,
  PaymentsSchemaVersionEntry,
  TeacherFlowBackupV2,
} from './backupTypes.ts';
import { buildRestorePreview, type RestoreBackupCounts } from './restorePreview.ts';

export interface PreRestoreSnapshot {
  savedAt: string;
  entries: Record<string, string | null>;
}

/**
 * Adaptadores de I/O inyectables: `executeRestore` es la orquestación (qué
 * se hace y en qué orden) separada de cómo se hace cada paso. Permite
 * probar snapshot-antes-de-escribir, escritura, rollback y fallos de
 * sincronización con adaptadores falsos, sin depender de AsyncStorage real
 * ni de una librería de mocks.
 */
export interface RestoreIoAdapters {
  readCurrentEntries: () => Promise<Record<string, string | null>>;
  writeEntries: (entries: Record<string, string | null>) => Promise<void>;
  saveRecoverySnapshot: (snapshot: PreRestoreSnapshot) => Promise<void>;
  syncInMemoryStores: (backup: TeacherFlowBackupV2) => Promise<void> | void;
}

export type RestoreOutcome =
  | { status: 'restored'; counts: RestoreBackupCounts }
  | {
      /**
       * Corrección 2026-09-14, TERCERA ronda (a pedido de Joaquín — revisión
       * INDEPENDIENTE, punto 6: "advertencia de restauración invisible" —
       * `warnings` en `'restored'` no lo consumía ninguna pantalla;
       * `CloudBackupRecoveryGate.tsx` seguía tratando `status: 'restored'`
       * como éxito completo y nunca mostraba la advertencia ni ofrecía un
       * reintento real): estado DISTINTO, nunca `'restored'` — la
       * transacción atómica de las once colecciones de negocio + la versión
       * técnica de pagos SÍ fue exitosa (nunca se revierte por esto), pero
       * una escritura best-effort POSTERIOR financieramente indispensable
       * (la configuración de cuotas de entrenamiento, ver
       * `restoreService.ts`) falló. Como NO es `'restored'`, el consumidor
       * (`CloudBackupRecoveryGate.tsx`) cae automáticamente en su mismo
       * camino real de "no pudimos recuperar tus datos todavía, reintentando"
       * — nunca anuncia "datos recuperados" ni marca la recuperación como
       * ofrecida/completada mientras esto no se resuelva.
       */
      status: 'restored_with_pending_warning';
      counts: RestoreBackupCounts;
      warnings: string[];
    }
  | { status: 'read_failed'; message: string }
  | { status: 'snapshot_failed'; message: string }
  | { status: 'write_failed_rolled_back'; message: string }
  | { status: 'write_failed_rollback_failed'; message: string; rollbackMessage: string }
  | { status: 'sync_failed_storage_rolled_back'; message: string }
  | { status: 'sync_failed_storage_not_rolled_back'; message: string; rollbackMessage: string };

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error ? `${fallback} (${error.message})` : fallback;
}

/**
 * Convierte el backup validado en los valores crudos que se persisten bajo
 * cada clave real: las siete originales + las cuatro financieras de negocio
 * + la versión interna técnica del store de pagos (doce en total).
 * `teacherAvailability` nunca se escribe como `null` literal: si el
 * respaldo no la tenía (por ejemplo, porque el original estaba corrupto al
 * exportar), se usa `fallbackAvailability` para dejar la clave en un
 * estado válido y parseable — igual que si la app nunca la hubiese tocado.
 * Las cuatro colecciones financieras se escriben tal cual vengan (`[]` si
 * el respaldo era v1 y se migró sin datos financieros).
 */
export function buildNextRawEntries(
  backup: TeacherFlowBackupV2,
  keys: Record<BackupCollectionName, string>,
  paymentKeys: Record<PaymentBackupCollectionName, string>,
  fallbackAvailability: TeacherFlowBackupV2['teacherAvailability'],
  paymentsSchemaVersion: PaymentsSchemaVersionEntry
): Record<string, string> {
  return {
    [keys.students]: JSON.stringify(backup.students),
    [keys.profiles]: JSON.stringify(backup.profiles),
    [keys.pedagogicalLessons]: JSON.stringify(backup.pedagogicalLessons),
    [keys.calendarLessons]: JSON.stringify(backup.calendarLessons),
    [keys.recurrenceRules]: JSON.stringify(backup.recurrenceRules),
    [keys.recurrenceExceptions]: JSON.stringify(backup.recurrenceExceptions),
    [keys.teacherAvailability]: JSON.stringify(backup.teacherAvailability ?? fallbackAvailability),
    [paymentKeys.paymentCharges]: JSON.stringify(backup.paymentCharges),
    [paymentKeys.payments]: JSON.stringify(backup.payments),
    [paymentKeys.paymentAllocations]: JSON.stringify(backup.paymentAllocations),
    [paymentKeys.paymentAdjustments]: JSON.stringify(backup.paymentAdjustments),
    [paymentsSchemaVersion.key]: paymentsSchemaVersion.value,
  };
}

/**
 * Orquesta una restauración completa, validando cada paso antes de avanzar
 * al siguiente para no dejar nunca un reemplazo parcial:
 *  1. lee un snapshot de las claves actuales (las doce técnicas de v2: las
 *     once de `buildNextRawEntries` + la versión interna del store de
 *     pagos) — si falla, no se toca nada;
 *  2. lo guarda como copia de recuperación (para una futura "deshacer
 *     última restauración") — si esto falla, tampoco se escribe nada más;
 *  3. escribe las doce claves nuevas como una única operación coordinada;
 *  4. si esa escritura falla, intenta revertir automáticamente al snapshot
 *     leído en el paso 1 (las doce claves, incluida la versión interna de
 *     pagos);
 *  5. recién si la escritura tuvo éxito, sincroniza los stores en memoria
 *     (incluido el de pagos); si la sincronización falla, intenta revertir
 *     también el almacenamiento (los datos ya estaban escritos) para no
 *     dejar almacenamiento y memoria desincronizados de forma permanente.
 * Nunca informa éxito si algún paso falló. No muta `backup` en ningún paso.
 */
export async function executeRestore(
  backup: TeacherFlowBackupV2,
  keys: Record<BackupCollectionName, string>,
  paymentKeys: Record<PaymentBackupCollectionName, string>,
  fallbackAvailability: TeacherFlowBackupV2['teacherAvailability'],
  paymentsSchemaVersion: PaymentsSchemaVersionEntry,
  adapters: RestoreIoAdapters,
  now: Date = new Date()
): Promise<RestoreOutcome> {
  let previousEntries: Record<string, string | null>;
  try {
    previousEntries = await adapters.readCurrentEntries();
  } catch (readError) {
    return {
      status: 'read_failed',
      message: describeError(readError, 'No se pudo leer el estado actual de la app. No se modificó ningún dato.'),
    };
  }

  try {
    await adapters.saveRecoverySnapshot({ savedAt: now.toISOString(), entries: previousEntries });
  } catch (snapshotError) {
    return {
      status: 'snapshot_failed',
      message: describeError(
        snapshotError,
        'No se pudo guardar la copia de recuperación previa. No se modificó ningún dato.'
      ),
    };
  }

  const nextEntries = buildNextRawEntries(backup, keys, paymentKeys, fallbackAvailability, paymentsSchemaVersion);

  try {
    await adapters.writeEntries(nextEntries);
  } catch (writeError) {
    try {
      await adapters.writeEntries(previousEntries);
      return {
        status: 'write_failed_rolled_back',
        message: describeError(
          writeError,
          'No se pudo restaurar el respaldo. Se revirtieron los datos anteriores; no se perdió información.'
        ),
      };
    } catch (rollbackError) {
      return {
        status: 'write_failed_rollback_failed',
        message: describeError(writeError, 'No se pudo restaurar el respaldo.'),
        rollbackMessage: describeError(
          rollbackError,
          'Además, no se pudo revertir automáticamente a los datos anteriores.'
        ),
      };
    }
  }

  // A partir de acá el almacenamiento persistente ya tiene los datos
  // nuevos. Si la sincronización en memoria falla, ese cambio ya no es
  // invisible: hay que intentar revertir también el almacenamiento para no
  // dejar la app mostrando datos viejos con un almacenamiento que ya tiene
  // datos nuevos.
  try {
    await adapters.syncInMemoryStores(backup);
  } catch (syncError) {
    try {
      await adapters.writeEntries(previousEntries);
      return {
        status: 'sync_failed_storage_rolled_back',
        message: describeError(
          syncError,
          'No se pudo actualizar la aplicación con los datos restaurados. Se revirtió el almacenamiento; no se perdió información. Cerrá y volvé a abrir la app antes de continuar para actualizar correctamente el calendario en pantalla.'
        ),
      };
    } catch (rollbackError) {
      return {
        status: 'sync_failed_storage_not_rolled_back',
        message: describeError(syncError, 'No se pudo actualizar la aplicación con los datos restaurados.'),
        rollbackMessage: describeError(
          rollbackError,
          'Además, no se pudo revertir el almacenamiento. Cerrá y volvé a abrir la app antes de seguir usándola: lo guardado puede no coincidir con lo que ves en pantalla.'
        ),
      };
    }
  }

  return { status: 'restored', counts: buildRestorePreview(backup).counts };
}
