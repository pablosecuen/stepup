// Puerto VERBATIM del original (`src/features/dashboard/types/index.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
export type PaymentStatus = 'verde' | 'amarillo' | 'naranja' | 'rojo';

export interface PaymentStatusCounts {
  verde: number;
  amarillo: number;
  naranja: number;
  rojo: number;
}

import type { ActivityKind, CalendarLessonRegistration, CalendarLessonStatus, ScheduleAdjustment } from '../../calendar/types/index.ts';
import type { GroupRegistrationProgress, HomeworkReviewEntry, NewClassFormState } from '../../new-class/types/index.ts';
import type { EmptyClassesSummary } from '../utils/emptyClasses.ts';

export type ClassModality = 'presencial' | 'online' | 'mixta';

export interface TodayLesson {
  id: string;
  studentId: string;
  time: string; // ej. "16:00"
  start: string;
  durationMinutes: number;
  studentNames: string[]; // más de un nombre = clase grupal
  /**
   * Corrección 2026-08-01 (a pedido de Joaquín — nombre editable de la
   * clase): título a mostrar — prioriza `CalendarLesson.classTitle` sobre
   * los nombres de alumnos (ver `lessonDisplayTitle`, la única fuente de
   * verdad). Preferir esto sobre `studentNames.join(', ')` en cualquier UI
   * nueva; `studentNames` se mantiene para quien todavía necesite los
   * nombres individuales (ej. seguimiento en vivo).
   */
  displayTitle: string;
  isGroupClass: boolean;
  modality: ClassModality;
  status: CalendarLessonStatus;
  calendarRegistration: CalendarLessonRegistration;
  /**
   * Corrección 2026-07-18 (a pedido de Joaquín, tercera ronda): horario
   * original antes de "Ajustar horario" — `null` si nunca se ajustó. `start`
   * ya es siempre el horario EFECTIVO (el que corresponde usar para
   * clasificar la puntualidad).
   */
  originalStart: string | null;
  scheduleAdjustment?: ScheduleAdjustment;
}

/**
 * Corrección P0 (a pedido de Joaquín — "PRÓXIMA CLASE" CAMBIA ANTES DE QUE
 * TERMINE LA CLASE EN CURSO): ya NO es "la primera de todayLessons cuya
 * hora no pasó" — esa regla saltaba a la clase siguiente en el instante
 * exacto en que la actual empezaba. Ahora es el resultado de
 * `selectCurrentOrNextOccurrence` (única función real de selección,
 * `calendar/utils/calendarNextClassAt.ts`): la clase EN CURSO si existe una
 * válida (`start <= ahora < end`), si no la próxima futura más cercana.
 */
export interface NextClass extends TodayLesson {
  /** `'in_progress'` mientras `start <= ahora < end`; `'upcoming'` si todavía no empezó. */
  timing: 'in_progress' | 'upcoming';
}

/**
 * Resumen financiero del Home (Fase Pagos 4B.3) — se arma exclusivamente a
 * partir del dominio canónico de pagos (`buildHomeFinancialSummary`), nunca
 * de `paymentStatus` heredado. Nunca se persiste: se recalcula en cada
 * lectura.
 */
export interface FinancialSummary {
  /** Dinero efectivamente cobrado (pagos vigentes, por fecha real de pago) durante el mes actual, huso Buenos Aires. */
  monthlyCollected: number;
  /** Saldo pendiente que todavía está en término (no vencido). */
  pendingOnTimeBalance: number;
  /** Saldo realmente vencido. */
  overdueBalance: number;
  /** Alumnos únicos (no cantidad de pagos) con al menos un pago vigente este mes. */
  uniqueStudentsPaidThisMonth: number;
  /** Alumnos únicos con saldo pendiente (en término o vencido). */
  uniqueStudentsWithDebt: number;
  /** "Facturación prevista este mes" — obligaciones activas cuyo vencimiento cae en el mes actual, sin importar si ya se pagaron. */
  currentMonthGenerated: number;
  /** @deprecated Usar `currentMonthPendingOnTimeBalance` + `currentMonthOverdueBalance` por separado. */
  currentMonthPendingBalance: number;
  /** "Pendiente en término este mes" — saldo del mes actual cuyo vencimiento todavía no pasó. */
  currentMonthPendingOnTimeBalance: number;
  /** "Vencido este mes" — saldo del mes actual cuyo vencimiento ya pasó. */
  currentMonthOverdueBalance: number;
  /** "Deuda de meses anteriores" — saldo positivo de obligaciones de períodos ya cerrados. */
  priorPeriodsDebtBalance: number;
}

export interface DashboardStats {
  activeStudents: number;
  lessonsThisWeek: number;
  hoursTaughtThisMonth: number;
  averageGrade: number | null;
}

/**
 * Corrección 2026-07-19 (a pedido de Joaquín — Home/navegación/búsqueda):
 * una clase queda "pendiente de registrar" cuando su horario efectivo ya
 * terminó y todavía no tiene un registro pedagógico completo (nunca se
 * confunde con `TodayLesson`, que sólo cubre el día de hoy y no filtra por
 * "¿ya se registró?"). Ver `utils/pendingClasses.ts`.
 */
export interface PendingClass {
  /** Identificador estable de la ocurrencia — mismo criterio que `SavedLesson.calendarReservationKey`. */
  reservationKey: string;
  calendarLessonId: string;
  studentId: string;
  studentNames: string[];
  /**
   * Corrección 2026-08-03 (a pedido de Joaquín — RegisterPendingClassSheet):
   * `studentId`/`studentNames` sólo alcanzan para el primer participante
   * (limitación ya documentada del flujo viejo hacia "Nueva clase"). El
   * nuevo panel necesita el id REAL de cada participante para poder
   * marcar asistencia/evaluación por alumno en una clase grupal, nunca
   * sólo del primero.
   */
  participants: Array<{ studentId: string; studentName: string }>;
  /** Corrección 2026-08-01 — mismo criterio que `TodayLesson.displayTitle`. */
  displayTitle: string;
  isGroupClass: boolean;
  start: string;
  end: string;
  durationMinutes: number;
  modality: ClassModality;
  calendarRegistration: CalendarLessonRegistration;
  /**
   * Corrección 2026-08-03 (a pedido de Joaquín — RegisterPendingClassSheet):
   * el encabezado del nuevo panel necesita distinguir "Serie recurrente" de
   * "Clase suelta" sin volver a consultar el motor de recurrencias — mismo
   * criterio ya usado en `calendarRegistration.recurrenceId`.
   */
  isRecurring: boolean;
  /** Estado real de la ocurrencia (para distinguir una clase ya reprogramada de una todavía agendada). */
  status: CalendarLessonStatus;
  /**
   * Corrección 2026-08-12 (a pedido de Joaquín — rediseño del registro de
   * clases, §2): nombre personalizado real de la clase/serie
   * (`CalendarLesson.classTitle`), sin resolver — el panel de registro
   * decide cómo mostrarlo (`resolveRegistrationPanelIdentity`), nunca usa
   * `displayTitle` (que agrega "· N alumnos", pensado para Calendario).
   */
  classTitle?: string;
  /**
   * Corrección 2026-09-05 (a pedido de Joaquín — Entrenamientos): tipo de
   * actividad real de la clase/serie de Calendario — ausente = `'class'`
   * (ver `normalizeActivityKind`, `calendarActivityKind.ts`). Home lo usa
   * para mostrar "Entrenamiento por registrar" en vez de "Clase por
   * registrar"; `RegisterPendingClassSheet.tsx` lo usa para inicializar el
   * formulario (nunca para decidir nada financiero).
   */
  activityKind?: ActivityKind;
  /**
   * Corrección 2026-08-12 (a pedido de Joaquín — progreso parcial grupal):
   * presente sólo si ya existe un borrador de registro grupal sin terminar
   * para esta ocurrencia — permite mostrar "2 de 5 completados" en Inicio y
   * reabrir el panel exactamente donde quedó, sin recalcular nada.
   */
  groupProgress?: GroupRegistrationProgress;
  /**
   * Corrección 2026-08-12 (a pedido de Joaquín — "al reabrir: recuperar
   * profundamente todos los datos"): copia profunda del formulario ya
   * guardado en el borrador (`SavedLesson.form`), presente sólo junto con
   * `groupProgress`. Sin esto, reabrir un registro grupal a mitad de
   * camino perdería asistencia/evaluación/tarea ya cargadas — el panel
   * volvería a arrancar de un formulario vacío.
   */
  draftForm?: NewClassFormState;
  /**
   * Corrección P0 (a pedido de Joaquín — TAREAS PENDIENTES SIN RESPUESTA
   * PRESELECCIONADA): revisiones de tareas pendientes YA respondidas y
   * guardadas en este mismo borrador parcial (`SavedLesson.homeworkReviews`),
   * presente sólo junto con `draftForm`/`groupProgress`. Sin esto, reabrir
   * un borrador grupal a mitad de camino perdía las respuestas de tareas ya
   * elegidas — el panel volvía a mostrarlas sin responder, obligando a
   * elegir de nuevo (o peor: arriesgando que se completara sin elegir
   * porque ya se había hecho antes).
   */
  homeworkReviews?: HomeworkReviewEntry[];
}

export interface DashboardData {
  nextClass: NextClass | null;
  todayLessons: TodayLesson[];
  pendingClasses: PendingClass[];
  stats: DashboardStats;
  /** "Clases sin alumnos" agrupado (§16) — un aviso por serie vacía, nunca uno por ocurrencia futura. */
  emptyClasses: EmptyClassesSummary;
}
