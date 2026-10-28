// Puerto VERBATIM del original (`src/shared/backup/restorePreview.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { TeacherFlowBackupV2 } from './backupTypes.ts';
import { analyzeDataIntegrity, type IntegrityReport } from './dataIntegrity.ts';

export interface RestoreBackupCounts {
  students: number;
  profiles: number;
  pedagogicalLessons: number;
  calendarLessons: number;
  recurrenceRules: number;
  recurrenceExceptions: number;
  availabilityWeeklyBlocks: number;
  availabilityExceptions: number;
  paymentCharges: number;
  payments: number;
  paymentAllocations: number;
  paymentAdjustments: number;
  /** 0 si el respaldo es anterior a esta fase (campo opcional) — nunca un error. */
  reportRecords: number;
  /** 0 si el respaldo es anterior a esta fase (campo opcional) — nunca un error. */
  packagePurchases: number;
  packageCreditMovements: number;
  /** 0 si el respaldo es anterior a esta fase (campo opcional) — nunca un error. */
  monthlyAmountCorrections: number;
  /** 0 si el respaldo es anterior a esta fase (campo opcional) — nunca un error. */
  initialPaidSurchargeCorrections: number;
}

export interface RestoreBackupPreview {
  exportedAt: string;
  appVersion: string | null;
  counts: RestoreBackupCounts;
  /** Mismo analizador que "Revisar consistencia" — nunca repara nada, sólo informa. */
  integrityReport: IntegrityReport;
}

/**
 * Sólo lectura: arma la vista previa a partir de un backup ya validado
 * (siempre v2 — un respaldo v1 llega acá ya migrado con las colecciones
 * financieras vacías, ver `restoreValidation.ts`). Nunca modifica `backup`
 * ni escribe nada.
 */
export function buildRestorePreview(backup: TeacherFlowBackupV2): RestoreBackupPreview {
  return {
    exportedAt: backup.exportedAt,
    appVersion: backup.appVersion,
    counts: {
      students: backup.students.length,
      profiles: Object.keys(backup.profiles).length,
      pedagogicalLessons: backup.pedagogicalLessons.length,
      calendarLessons: backup.calendarLessons.length,
      recurrenceRules: backup.recurrenceRules.length,
      recurrenceExceptions: backup.recurrenceExceptions.length,
      availabilityWeeklyBlocks: backup.teacherAvailability?.weeklyBlocks.length ?? 0,
      availabilityExceptions: backup.teacherAvailability?.exceptions.length ?? 0,
      paymentCharges: backup.paymentCharges.length,
      payments: backup.payments.length,
      paymentAllocations: backup.paymentAllocations.length,
      paymentAdjustments: backup.paymentAdjustments.length,
      reportRecords: backup.reportRecords?.length ?? 0,
      packagePurchases: backup.packagePurchases?.length ?? 0,
      packageCreditMovements: backup.packageCreditMovements?.length ?? 0,
      monthlyAmountCorrections: backup.monthlyAmountCorrections?.length ?? 0,
      initialPaidSurchargeCorrections: backup.initialPaidSurchargeCorrections?.length ?? 0,
    },
    integrityReport: analyzeDataIntegrity(backup),
  };
}
