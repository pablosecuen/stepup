// Puerto VERBATIM del original (`src/features/students/types/index.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { StatusColorKey } from '../../../theme/colors.ts';
import type { MonthlyCardDisplayKind } from '../../payments/utils/monthlyPeriodStatus.ts';

// Corrección (a pedido de Joaquín — niveles personalizados): antes una
// unión cerrada de 6 literales CEFR. Ahora acepta también el nombre de
// cualquier nivel personalizado que la profesora haya creado (ver
// `CustomLevel`, más abajo) — los 6 valores estándar siguen siendo
// strings válidos, ningún alumno existente deja de tipar.
export type CEFRLevel = string;

/**
 * Los 6 niveles CEFR estándar reales — la ÚNICA lista real que debe usarse
 * para renderizar esos 6 chips fijos (nunca repetir el array a mano en
 * cada pantalla). Un nivel personalizado NUNCA vive acá — ver
 * `CustomLevel`.
 */
export const STANDARD_CEFR_LEVELS: readonly CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/**
 * Corrección (a pedido de Joaquín — niveles personalizados): un nivel que
 * la propia profesora define y administra (p. ej. "Infantes", "Apoyo
 * escolar"), además de los 6 estándar. `name` es lo que se persiste tal
 * cual en `level` de un alumno (mismo campo, mismo tipo — nunca un id
 * separado que otras pantallas tendrían que resolver): así, en toda otra
 * parte de la app que ya lee/muestra/filtra `level`, un nivel personalizado
 * funciona exactamente igual que uno estándar, sin ningún cambio adicional.
 */
export interface CustomLevel {
  id: string;
  name: string;
  createdAt: string;
}

export type StudentModality = 'presencial' | 'online' | 'mixta';

export type PaymentStatus = 'verde' | 'amarillo' | 'naranja' | 'rojo';

// Corrección 2026-07-16 (a pedido de Joaquín): el comentario original decía
// "nunca se elimina un alumno, solo cambia de estado" — cierto sólo para
// pausar/dar de baja/archivar (cambio de `status`, historial conservado
// siempre). Existe además `deleteStudentPermanently` (students/hooks), una
// operación real y aparte: borra al alumno de forma permanente e
// irreversible de las 6 colecciones pedagógicas/de calendario y las 4
// financieras. `StudentStatus` describe únicamente el primer camino.
export type StudentStatus = 'activo' | 'pausado' | 'inactivo' | 'archivado';

export interface StudentListItem {
  id: string;
  name: string;
  /**
   * Corrección (a pedido de Joaquín — niveles combinables): antes un único
   * `level: string`. Ahora una lista — un alumno puede combinar libremente
   * estándar (A1-C2) y personalizados a la vez (p. ej. `['A1', 'Infantes']`).
   * Nunca vacía en un alumno creado desde la UI actual, pero SÍ puede estarlo
   * en datos muy viejos sin ningún nivel cargado — tratarla siempre como
   * "puede estar vacía", nunca asumir `levels[0]` sin chequear longitud.
   * Todo dato leído de AsyncStorage/un respaldo pasa por
   * `normalizeLevelsList` (`utils/studentLevelsCore.ts`) antes de llegar
   * acá, así que un alumno viejo con el `level` singular de antes de esta
   * corrección se migra solo, sin perder su nivel.
   */
  levels: CEFRLevel[];
  modality: StudentModality;
  status: StudentStatus;
  nextClassAt: string | null; // ISO datetime, null = sin próxima clase agendada
  /**
   * Corrección P0 (a pedido de Joaquín — "PRÓXIMA CLASE" CAMBIA ANTES DE QUE
   * TERMINE LA CLASE EN CURSO): final efectivo de la MISMA ocurrencia que
   * `nextClassAt` — permite distinguir "ya empezó pero sigue en curso" de
   * "ya terminó de verdad" sin volver a consultar clases/recurrencias.
   * `null`/ausente cuando `nextClassAt` también es `null`, o en datos de
   * antes de esta corrección — opcional a propósito, así ningún fixture de
   * prueba existente (docenas, en pagos/respaldos/calendario) necesita
   * tocarse: se trata igual que "sin información de fin" y nunca rompe (ver
   * `resolveDisplayableNextClassAt`).
   */
  nextClassEndAt?: string | null;
  paymentStatus: PaymentStatus;
  averageGrade: number | null; // 1–10; null = sin ninguna calificación explícita todavía
  classesThisMonth: number;
  lastPaymentAt: string | null; // ISO date, null = sin pagos registrados
  isFeatured: boolean; // alumno destacado
  isNew: boolean; // alumno nuevo
  hasOverduePayment: boolean; // pago vencido (independiente del detalle del semáforo)
  hasPendingReport: boolean; // tiene reporte PDF pendiente de generar/enviar
  hasPendingHomework: boolean; // tiene tarea pendiente

  /**
   * Corrección 2026-08-03 (a pedido de Joaquín — generación mensual y
   * tarjetas de Alumnos): estado financiero COMPLETO del mes actual
   * (`resolveStudentMonthlyCardStatus`) — nunca el semáforo de gravedad
   * (`paymentStatus`, arriba), que a propósito da verde tanto sin
   * obligaciones como con una obligación todavía en término (día 1–10).
   * Opcionales para no romper los fixtures/tests existentes que construyen
   * un `StudentListItem` a mano sin pasar por `projectStudentListPaymentStatus`
   * — en la app real, `useStudentsList` siempre los completa.
   */
  monthlyStatusLabel?: string | null;
  monthlyStatusColorKey?: StatusColorKey;
  monthlyStatusBalance?: number;
  /**
   * Corrección 2026-09-03 (a pedido de Joaquín — ERROR VISUAL: "Septiembre
   * pendiente" desborda/superpone en la lista de Alumnos): el `kind`
   * canónico (nunca un texto) detrás de `monthlyStatusLabel` — `StudentCard.tsx`
   * lo usa para mostrar su propia pastilla COMPACTA (nunca el mes; el
   * detalle completo del período sigue viviendo en `monthlyStatusLabel`,
   * usado por el perfil/otras pantallas). `undefined` = mismo caso que
   * `monthlyStatusLabel` ausente (sin `resolvePlan`/plan no encontrado).
   */
  monthlyStatusKind?: MonthlyCardDisplayKind;

  /**
   * Corrección 2026-08-04 (a pedido de Joaquín — "Pago vencido" fantasma
   * tras saldar julio): texto específico de la deuda vencida real
   * (`summarizeOverdueDebt`), p. ej. "Julio vencido" o "2 meses vencidos",
   * en vez del genérico "Pago vencido" — para que sea evidente que la
   * profesora sigue debiendo un período DISTINTO al que acaba de pagar, no
   * que el pago recién registrado no se reflejó. `null`/`undefined` cuando
   * `hasOverduePayment` es `false`: `StudentBadges` cae al texto genérico
   * "Pago vencido" sólo si `hasOverduePayment` es `true` y este campo no
   * vino (mismo motivo de opcionalidad que los campos de arriba).
   */
  overdueDebtLabel?: string | null;
}

export type StudentBadgeKind =
  | 'destacado'
  | 'nuevo'
  | 'pago_vencido'
  | 'reporte_pendiente'
  | 'tarea_pendiente'
  | 'pausado'
  | 'inactivo'
  | 'archivado';

export type StudentCardAction =
  | 'registrar_clase'
  | 'registrar_pago'
  | 'reprogramar_clase'
  | 'ver_perfil'
  | 'enviar_pdf'
  | 'editar_alumno'
  | 'archivar_alumno'
  // Corrección 2026-07-24 (tutorial rápido salteable + acciones por
  // deslizamiento en Alumnos): antes "Eliminar" sólo existía dentro del
  // Perfil — ahora también se dispara desde el swipe/menú de la lista.
  | 'eliminar_alumno'
  | 'restaurar_alumno';

export type SortOption = 'nombre' | 'proxima_clase' | 'ultimo_pago';

export type LevelFilter = CEFRLevel | 'todos';
export type ModalityFilter = StudentModality | 'todos';
export type PaymentStatusFilter = PaymentStatus | 'todos';
export type StatusFilter = StudentStatus | 'todos';

export interface StudentsFilterState {
  search: string;
  level: LevelFilter;
  modality: ModalityFilter;
  paymentStatus: PaymentStatusFilter;
  status: StatusFilter;
  sortBy: SortOption;
}

// Por defecto se muestran solo los alumnos Activos, según lo pedido.
export const DEFAULT_FILTER_STATE: StudentsFilterState = {
  search: '',
  level: 'todos',
  modality: 'todos',
  paymentStatus: 'todos',
  status: 'activo',
  sortBy: 'nombre',
};
