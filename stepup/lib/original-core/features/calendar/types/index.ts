// Puerto VERBATIM del original (`src/features/calendar/types/index.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { ScheduleAdjustment } from '../../new-class/types/index.ts';

export type CalendarModality = 'presencial' | 'online' | 'mixta';

export type CalendarLessonStatus =
  | 'scheduled'
  | 'completed'
  | 'cancelled'
  | 'rescheduled';

export type CalendarLessonType = 'individual' | 'group';

/**
 * Corrección 2026-09-05 (a pedido de Joaquín — TeacherFlow también debe
 * permitir gestionar Entrenamientos): tipo de actividad de una clase/serie
 * — nunca otro alumno, otro calendario ni otro sistema de recurrencias, sólo
 * una distinción dentro de la misma arquitectura. `'class'` es el default
 * histórico: toda serie/ocurrencia/registro anterior a esta fase, sin este
 * campo, se interpreta como `'class'` — ver `normalizeActivityKind` en
 * `calendarActivityKind.ts`, la ÚNICA fuente real de esa normalización
 * (nunca comparar contra `undefined`/`'class'` a mano en otro archivo).
 */
export type ActivityKind = 'class' | 'training';

export interface CalendarLessonParticipant {
  studentId: string;
  studentName: string;
  level: string;
}

export interface CalendarLesson {
  id: string;
  studentId: string;
  studentName: string;
  level: string;
  participants: CalendarLessonParticipant[];
  lessonType: CalendarLessonType;
  start: string;
  end: string;
  modality: CalendarModality;
  status: CalendarLessonStatus;
  color: string;
  overlapAllowed: boolean;
  overlapGroupId: string | null;
  notes?: string;
  isRecurring: boolean;
  recurrenceId: string | null;
  recurrenceOccurrenceKey: string | null;
  recurrenceIndex: number | null;
  recurrenceOriginalStart: string | null;
  /**
   * Corrección 2026-07-18 (a pedido de Joaquín, tercera ronda — ciclo real
   * de clase y puntualidad): presente sólo cuando "Ajustar horario" atrasó
   * o adelantó ESTA ocurrencia puntual (nunca la serie completa). Opcional
   * para que una clase anterior a esta fase siga siendo válida tal cual.
   */
  scheduleAdjustment?: ScheduleAdjustment;
  /**
   * Corrección 2026-08-01 (a pedido de Joaquín — nombre editable de la
   * clase): identidad propia de la clase, independiente de sus alumnos —
   * nunca modifica `studentName`/`participants`/el perfil del alumno.
   * Opcional: ausente o `undefined` significa "sin título personalizado",
   * y el título visible se deriva de los alumnos (ver `lessonDisplayTitle`
   * en `calendarParticipants.ts`, la única fuente de verdad para mostrarlo).
   * Un `CalendarLesson` anterior a esta fase sigue siendo válido tal cual.
   * Nunca se usa como id ni clave de relación.
   */
  classTitle?: string;
  /**
   * Corrección 2026-08-18 (a pedido de Joaquín — REUTILIZAR EL HORARIO DE
   * UNA CLASE CANCELADA CON ANTICIPACIÓN): presente sólo en una clase
   * SUSTITUTA creada vía "Usar este horario para otra clase" — el `id` de
   * la clase cancelada (con aviso) que liberó este horario. Puramente
   * informativo/trazabilidad ("indicación discreta de origen"): nunca se
   * usa para identidad, nunca vincula pagos ni registro pedagógico (cada
   * clase mantiene el suyo, completamente independiente), y nunca se lee
   * para decidir conflictos (el horario se evalúa igual que cualquier
   * clase nueva). Opcional: ausente en cualquier clase que no haya surgido
   * de este flujo.
   */
  freedByLessonId?: string | null;
  /**
   * Corrección 2026-09-05 (a pedido de Joaquín — Entrenamientos): heredado
   * de la serie/ocurrencia al materializarse (ver `calendarRecurrenceEngine.ts`).
   * Opcional — ausente en cualquier `CalendarLesson` anterior a esta fase,
   * que se interpreta como `'class'` (ver `normalizeActivityKind`).
   */
  activityKind?: ActivityKind;
}

export interface CalendarConflict {
  conflictingLesson: CalendarLesson;
  overlapStart: string;
  overlapEnd: string;
  overlapMinutes: number;
  exactSameSchedule: boolean;
  canConvertToGroup: boolean;
}

export interface CalendarAnalytics {
  busiestDay: string;
  busiestHour: number;
  occupationRate: number;
  totalLessons: number;
  totalStudentsServed: number;
  occupiedHours: number;
  freeHours: number;
  onlineLessons: number;
  presencialLessons: number;
  mixedLessons: number;
  groupLessons: number;
  individualLessons: number;
  intentionalOverlaps: number;
}

export type AppWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface RecurrenceSession {
  weekday: AppWeekday;
  hour: number;
  minute: number;
  durationMinutes: number;
}

export interface RecurrenceWeek {
  weekIndex: number;
  sessions: RecurrenceSession[];
}

export type PendingRecurrenceMode = 'single' | 'weekly' | 'custom';

export interface PendingRecurrenceDraft {
  mode: PendingRecurrenceMode;
  cycleLengthWeeks: 1 | 2 | 3 | 4;
  weeks: RecurrenceWeek[];
}

export type RecurrenceRuleStatus = 'active' | 'paused' | 'ended';

export interface RecurrenceRule {
  recurrenceId: string;
  /**
   * Alumno principal/heredado — siempre `participantIds[0]` cuando ese
   * campo está presente (se mantienen sincronizados). Código anterior a la
   * fase "Clase como contenedor" (2026-07-21) sigue funcionando sin tocar
   * nada, porque nunca deja de reflejar al primer participante.
   */
  studentId: string;
  /**
   * Corrección 2026-07-21 (a pedido de Joaquín — clase como contenedor):
   * participantes de TODA la serie, no sólo el alumno principal. Opcional
   * y aditivo — una serie antigua sin este campo se comporta exactamente
   * igual que antes (un único alumno, `studentId`). Cuando está presente,
   * `studentId` siempre es `participantIds[0]`. Nunca se guarda una lista
   * vacía junto a un `studentId` no vacío ni viceversa fuera de sincronía.
   */
  participantIds?: string[];
  type: 'weekly' | 'custom';
  cycleLengthWeeks: 1 | 2 | 3 | 4;
  weeks: RecurrenceWeek[];
  modality: CalendarModality;
  timezone: string;
  startDate: string;
  endDate: string | null;
  status: RecurrenceRuleStatus;
  /** Linaje opcional para redirigir referencias antiguas tras un split. */
  supersedesRecurrenceId?: string | null;
  supersededByRecurrenceId?: string | null;
  effectiveFromDate?: string;
  /**
   * Corrección 2026-08-01 (a pedido de Joaquín — nombre editable de la
   * clase): título propio de "toda la serie" — se copia a cada ocurrencia
   * generada (`GeneratedOccurrence.classTitle`) y de ahí a cada
   * `CalendarLesson` materializada, salvo que esa ocurrencia puntual tenga
   * su propio `classTitle` distinto (alcance "sólo esta clase", que
   * siempre gana sobre el de la serie). Opcional, mismo criterio que
   * `CalendarLesson.classTitle`.
   */
  classTitle?: string;
  /**
   * Corrección 2026-09-05 (a pedido de Joaquín — Entrenamientos): tipo de
   * actividad de TODA la serie — se copia a cada ocurrencia generada
   * (`GeneratedOccurrence.activityKind`) y de ahí a cada `CalendarLesson`
   * materializada, igual criterio que `classTitle` arriba. Opcional: una
   * regla anterior a esta fase, sin este campo, se interpreta como
   * `'class'` (ver `normalizeActivityKind`, `calendarActivityKind.ts`).
   */
  activityKind?: ActivityKind;
  /**
   * Corrección 2026-09-13 (a pedido de Joaquín — COBRO MENSUAL SEPARADO DE
   * ENTRENAMIENTOS): identidad ESTABLE del acuerdo económico de esta serie
   * de entrenamiento — nunca `recurrenceId` (que cambia al dividir la serie,
   * ver `supersedesRecurrenceId`/`splitRecurrenceFromDate` en
   * `calendarRecurrenceSplit.ts`) ni ningún otro id que pueda variar. Se
   * genera UNA sola vez (al crear la serie con `activityKind: 'training'`, o
   * al convertir una serie existente, o al configurar la cuota de una serie
   * histórica) y de ahí en más SOBREVIVE intacto a cualquier mutación real
   * porque cada camino que muta una `RecurrenceRule` lo hace con
   * `{ ...rule, ... }` (spread) sin nombrarlo explícitamente — split
   * ("esta clase y las siguientes"), "editar futuras", cambiar
   * participantes, editar título/horario, todos lo conservan sin código
   * adicional. El motor de cobro (`src/features/payments/utils/trainingBilling.ts`,
   * `trainingChargeGenerationPlan.ts`) es el ÚNICO consumidor real: nunca se
   * lee acá con fines de calendario/UI. Opcional: ausente en cualquier serie
   * de clase, y en una serie de entrenamiento creada antes de esta fase que
   * todavía no tiene cuota configurada (ver "Configurar cuota de
   * entrenamiento").
   */
  trainingBillingAgreementId?: string;
}

export type OccurrenceMaterializationStatus =
  | 'virtual'
  | 'materialized'
  | 'cancelled'
  | 'rescheduled';

export interface GeneratedOccurrence {
  occurrenceKey: string;
  recurrenceId: string;
  studentId: string;
  /** Todos los participantes de la serie (`rule.participantIds ?? [rule.studentId]`, sin vacíos). */
  participantIds: string[];
  absoluteWeekNumber: number;
  weekIndexInCycle: number;
  weekday: AppWeekday;
  sessionIndex: number;
  hour: number;
  minute: number;
  durationMinutes: number;
  modality: CalendarModality;
  start: string;
  end: string;
  materializationStatus: OccurrenceMaterializationStatus;
  materializedLessonId: string | null;
  /** Copiado de `RecurrenceRule.classTitle` al generar — ver `CalendarLesson.classTitle`. */
  classTitle?: string;
  /** Copiado de `RecurrenceRule.activityKind` al generar — ver `CalendarLesson.activityKind`. */
  activityKind?: ActivityKind;
}

export type RecurrenceExceptionType =
  | 'cancelled'
  | 'rescheduled'
  | 'excluded';

export interface RecurrenceException {
  occurrenceKey: string;
  recurrenceId: string;
  type: RecurrenceExceptionType;
  replacementLessonId?: string;
  createdAt: string;
}

export interface CalendarDay {
  date: string;
  lessons: CalendarLesson[];
}

export interface WeeklyCalendar {
  weekStart: string;
  weekEnd: string;
  days: CalendarDay[];
}

export interface PendingSlotDraft {
  date: string;
  hour: number;
  minute: number;
  durationMinutes: number;
  modality: CalendarModality;
}

export interface PendingLessonDraft extends PendingSlotDraft {
  studentId: string;
  requestId: string;
  recurrence: PendingRecurrenceDraft;
}

export interface CalendarLessonRegistration {
  reservationKey: string;
  lessonId: string;
  studentId: string;
  start: string;
  end: string;
  modality: CalendarModality;
  recurrenceId: string | null;
  recurrenceOccurrenceKey: string | null;
}

export interface PendingLessonCompletion {
  requestId: string;
  registration: CalendarLessonRegistration;
  savedLessonId: string;
}

export type {
  AvailabilityException,
  ConflictKind,
  DetectedConflict,
  TeacherAvailability,
  WeeklyAvailabilityBlock,
} from './teacherAvailability.ts';

export type { ScheduleAdjustment } from '../../new-class/types/index.ts';
