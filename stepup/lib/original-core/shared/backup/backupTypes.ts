// Puerto VERBATIM del original (`src/shared/backup/backupTypes.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CustomLevel, StudentListItem } from '../../features/students/types/index.ts';
import type { StudentProfile } from '../../features/student-profile/types/index.ts';
import type { SavedLesson } from '../../features/new-class/types/index.ts';
import type {
  CalendarLesson,
  RecurrenceException,
  RecurrenceRule,
} from '../../features/calendar/types/index.ts';
import type { TeacherAvailability } from '../../features/calendar/types/teacherAvailability.ts';
import type {
  Payment,
  PaymentAdjustment,
  PaymentAllocation,
  PaymentCharge,
  PackageCreditMovement,
  PackagePurchase,
  MonthlyAmountCorrectionEntry,
  InitialPaidSurchargeCorrectionEntry,
  FirstMonthProrationDecision,
  TrainingBillingAgreement,
} from '../../features/payments/types/index.ts';
import type { ReportRecord } from '../../features/reportes/types/index.ts';
import type { TeacherProfile } from '../../features/account/hooks/teacherProfileStore.ts';
import type { SurchargeSettings } from '../../features/payments/utils/surchargeSettings.ts';
import type { BudgetDistributionSettings } from '../../features/payments/utils/budgetDistribution.ts';

/**
 * `BACKUP_SCHEMA_VERSION` (1) se conserva sin cambios a propósito: es lo
 * que usa `buildTeacherFlowBackup` (v1, en `buildBackup.ts`) y sus pruebas
 * existentes. La Fase 4A no reescribe el pipeline v1; agrega un pipeline v2
 * nuevo (`buildBackupV2.ts`) que lo envuelve y le suma las colecciones
 * financieras. `BACKUP_SCHEMA_VERSION_V2` es la versión que exportan los
 * respaldos nuevos desde esta fase en adelante.
 */
export const BACKUP_SCHEMA_VERSION = 1;
export const BACKUP_SCHEMA_VERSION_V2 = 2;

/**
 * Fase 1 de seguridad de datos: sólo exportación. No incluir aquí campos de
 * importación/restauración/sincronización hasta que esas fases existan.
 */
export interface TeacherFlowBackupV1 {
  schemaVersion: 1;
  /** Instante ISO en el que se generó el respaldo. */
  exportedAt: string;
  /** Versión de `package.json` en el momento de exportar, o null si no se pudo leer. */
  appVersion: string | null;
  students: StudentListItem[];
  /** Indexado por studentId, igual que `@teacherflow/profiles` en AsyncStorage. */
  profiles: Record<string, StudentProfile>;
  /** Clases pedagógicas registradas (`@teacherflow/lessons`). */
  pedagogicalLessons: SavedLesson[];
  /** Reservas/materializaciones del calendario (`@teacherflow/calendar_lessons`). */
  calendarLessons: CalendarLesson[];
  recurrenceRules: RecurrenceRule[];
  recurrenceExceptions: RecurrenceException[];
  /**
   * Disponibilidad de la profesora: incluye vacaciones/licencias
   * (`exceptions`) y bloqueos semanales de trabajo/estudio (`weeklyBlocks`).
   * TeacherFlow no persiste esas dos colecciones bajo claves separadas, así
   * que tampoco se separan acá. Null sólo si la clave está corrupta.
   */
  teacherAvailability: TeacherAvailability | null;
}

/** Nombres lógicos de cada colección respaldada, usados para mensajes de error legibles. */
export type BackupCollectionName =
  | 'students'
  | 'profiles'
  | 'pedagogicalLessons'
  | 'calendarLessons'
  | 'recurrenceRules'
  | 'recurrenceExceptions'
  | 'teacherAvailability';

/** Nombres lógicos de las cuatro colecciones financieras nuevas de la Fase 4A. */
export type PaymentBackupCollectionName = 'paymentCharges' | 'payments' | 'paymentAllocations' | 'paymentAdjustments';

/**
 * La versión interna del store de pagos (`PAYMENTS_STORAGE_KEYS.schemaVersion`
 * en `paymentsStore.ts`) es una clave TÉCNICA, no una colección de negocio:
 * nunca aparece como campo de `TeacherFlowBackupV2` ni en el JSON exportado.
 * Aun así debe participar del snapshot previo, la escritura, el rollback y
 * la sincronización de una restauración v2 (ver `restoreExecutor.ts`), para
 * que el store de pagos nunca quede con datos financieros nuevos pero una
 * versión interna vieja o inexistente.
 */
export interface PaymentsSchemaVersionEntry {
  key: string;
  value: string;
}

/**
 * Respaldo v2: exactamente `TeacherFlowBackupV1` más las cuatro colecciones
 * financieras. Un respaldo v1 restaurado se sube a esta forma con las
 * cuatro colecciones vacías (ver `restoreValidation.ts`); nunca se pierde
 * ni se inventa nada del contenido v1 original al hacerlo.
 */
export interface TeacherFlowBackupV2 extends Omit<TeacherFlowBackupV1, 'schemaVersion'> {
  schemaVersion: 2;
  paymentCharges: PaymentCharge[];
  payments: Payment[];
  paymentAllocations: PaymentAllocation[];
  paymentAdjustments: PaymentAdjustment[];
  /**
   * Corrección 2026-07-18 (a pedido de Joaquín, segunda ronda): historial de
   * reportes generados — SÓLO el registro estructurado (título, meses,
   * fechas, snapshot de datos usados) y NUNCA el archivo PDF binario en sí
   * (ese sigue siendo local al dispositivo, se regenera desde el snapshot
   * si falta tras una restauración). Campo OPCIONAL a propósito: un
   * respaldo v2 anterior a esta fase no lo tiene — se trata como lista
   * vacía, nunca como error. Se restaura por fuera de la transacción
   * atómica de `restoreExecutor.ts` (ver `restoreService.ts`), como
   * escritura best-effort separada — no participa del snapshot/rollback
   * atómico de las demás colecciones.
   */
  reportRecords?: ReportRecord[];
  /**
   * Corrección 2026-07-21 (a pedido de Joaquín — clase como contenedor,
   * auditoría de backup): paquetes de clases — mismo criterio que
   * `reportRecords` (opcional, se trata como lista vacía si falta, se
   * restaura best-effort fuera de la transacción atómica principal).
   */
  packagePurchases?: PackagePurchase[];
  packageCreditMovements?: PackageCreditMovement[];
  /**
   * Corrección 2026-07-22 (a pedido de Joaquín — autenticación, teclado,
   * correo y nombre de la profesora, ítem G): nombre de la profesora —
   * mismo criterio best-effort que `reportRecords`/`packagePurchases`.
   * Campo OPCIONAL: un respaldo v2 anterior a esta fase no lo tiene, se
   * trata como ausente, nunca como error. `null` significa "este
   * dispositivo armó el respaldo sin tener todavía un nombre guardado" —
   * al restaurar, eso NUNCA borra un nombre válido que ya exista en el
   * dispositivo que recibe la restauración (ver `replaceTeacherProfileFromBackup`,
   * que ignora valores `null`/inválidos y jamás sobrescribe con vacío).
   */
  teacherProfile?: TeacherProfile | null;
  /**
   * Corrección 2026-07-30 (a pedido de Joaquín — editar monto mensual):
   * registro de auditoría de correcciones de importe mensual — mismo
   * criterio best-effort que `reportRecords`/`packagePurchases`. Campo
   * OPCIONAL: un respaldo anterior a esta fase no lo tiene, se trata como
   * lista vacía, nunca como error. No es la fuente de verdad del saldo
   * (eso sigue siendo `PaymentCharge.originalAmount`, que SÍ participa de
   * la transacción atómica vía `paymentCharges`) — es sólo el historial de
   * auditoría de esas correcciones.
   */
  monthlyAmountCorrections?: MonthlyAmountCorrectionEntry[];
  /**
   * Corrección 2026-08-02 (a pedido de Joaquín — alta financiera de
   * alumnos nuevos): registro de auditoría de la reparación de recargos
   * incorrectos originados por el bug de fecha de alta — mismo criterio
   * best-effort/opcional que `monthlyAmountCorrections`.
   */
  initialPaidSurchargeCorrections?: InitialPaidSurchargeCorrectionEntry[];
  /**
   * Corrección 2026-08-11 (a pedido de Joaquín — "convertir los recargos
   * automáticos en una configuración opcional de la profesora"): días/
   * porcentajes configurados y si los recargos están activados — mismo
   * criterio best-effort/opcional que `teacherProfile`. Un respaldo v2
   * anterior a esta fase no lo tiene: se trata como ausente, nunca como
   * error, y al restaurar NO se sobrescribe con un valor vacío/default (ver
   * `restoreService.ts`) — el valor migrado (comportamiento actual) sigue
   * vigente en el dispositivo que restaura si el respaldo no trae nada.
   */
  surchargeSettings?: SurchargeSettings | null;
  /**
   * Fase financiera — Plan de distribución 50/30/20: distribución elegida
   * (y objetivo de ahorro opcional) — mismo criterio best-effort/opcional
   * que `surchargeSettings`. Un respaldo v2 anterior a esta fase no lo
   * tiene: se trata como ausente, nunca como error, y al restaurar NO se
   * sobrescribe con un valor vacío/default si el respaldo no trae nada
   * (ver `restoreService.ts`).
   */
  budgetDistribution?: BudgetDistributionSettings | null;
  /**
   * Corrección (a pedido de Joaquín — niveles personalizados): niveles
   * creados por la propia profesora — mismo criterio best-effort/opcional
   * que `reportRecords`. Un respaldo v2 anterior a esta fase no lo tiene:
   * se trata como lista vacía, nunca como error.
   */
  customLevels?: CustomLevel[];
  /**
   * Corrección (a pedido de Joaquín — primer mes proporcional al agregar un
   * alumno a una serie): registro de decisiones del panel "Primer mes de
   * [alumno]" — mismo criterio best-effort/opcional que
   * `monthlyAmountCorrections`. Un respaldo anterior a esta fase no lo
   * tiene: se trata como lista vacía, nunca como error.
   */
  firstMonthProrationDecisions?: FirstMonthProrationDecision[];
  /**
   * Corrección 2026-09-13 (a pedido de Joaquín — COBRO MENSUAL SEPARADO DE
   * ENTRENAMIENTOS): configuración financiera de cada serie de
   * entrenamiento (cuota, vigencia de cambio de precio, primer período
   * facturable) — mismo criterio best-effort/opcional que
   * `firstMonthProrationDecisions`. Un respaldo anterior a esta fase no lo
   * tiene: se trata como lista vacía, nunca como error. Los `PaymentCharge`
   * de tipo `'entrenamiento'` ya generados SÍ participan de la transacción
   * atómica principal (vía `paymentCharges`, igual que cualquier otro
   * cargo) — esta colección es sólo la configuración, nunca la fuente de
   * verdad de un cargo ya emitido.
   */
  trainingBillingAgreements?: TrainingBillingAgreement[];
}
