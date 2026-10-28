// Puerto VERBATIM del original (`src/features/new-class/types/index.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { StudentModality } from '../../../shared/types.ts';
import type { ActivityKind, CalendarLessonRegistration } from '../../calendar/types/index.ts';

export type EventType =
  | 'clase_dictada'
  | 'alumno_ausente'
  | 'profesora_ausente'
  | 'cancelada_con_aviso'
  | 'cancelada_tarde'
  | 'reprogramada'
  | 'feriado';
// 'clase_de_prueba' deliberadamente fuera de alcance — no aplicable por ahora.

/**
 * Corrección 2026-07-18 (a pedido de Joaquín, tercera ronda — ciclo real de
 * clase y puntualidad): campos TODOS opcionales a propósito — un registro
 * viejo simplemente no los tiene, y eso nunca es un error. `direction` +
 * `minutes` describen el ajuste real (atrasar/adelantar SÓLO esa
 * ocurrencia, nunca la serie completa); `reason` decide si ese atraso
 * perjudica al alumno en el scoring de puntualidad (nunca debe hacerlo si
 * el motivo fue la profesora o un acuerdo mutuo).
 */
export type ScheduleAdjustmentDirection = 'advanced' | 'delayed';
export type ScheduleAdjustmentMinutes = 15 | 20 | 30 | 40 | 50 | 60;
export type ScheduleAdjustmentReason = 'teacher' | 'mutual_agreement';

export interface ScheduleAdjustment {
  direction: ScheduleAdjustmentDirection;
  minutes: ScheduleAdjustmentMinutes;
  reason: ScheduleAdjustmentReason;
  adjustedAt: string; // ISO
}

/**
 * `lateMinutes` siempre se calcula contra `effectiveStartAt` (el horario ya
 * ajustado), nunca contra el horario original — un atraso de la profesora
 * nunca debe leerse como que el alumno llegó tarde. `teacher_delayed` y
 * `mutual_adjustment` existen para excluir esa clase del cálculo negativo
 * de puntualidad, exactamente igual que `unknown`.
 */
export type StudentArrivalStatus =
  | 'on_time'
  | 'within_grace'
  | 'late'
  | 'teacher_delayed'
  | 'mutual_adjustment'
  | 'unknown'
  | 'no_show';

export interface StudentArrival {
  arrivedAt?: string; // ISO
  status: StudentArrivalStatus;
  lateMinutes: number;
  manuallyCorrected: boolean;
}

export type ClassStartSource = 'button' | 'manual_correction';
export type ClassEndSource = 'button' | 'manual_correction';

/**
 * Bundle que viaja desde "Finalizar clase" (Inicio) hasta Nueva clase, para
 * precargar el registro pedagógico con el ciclo real de la sesión sin
 * pedirle a la profesora que recuerde nada. Serializable (sólo primitivos),
 * apto para parámetros de navegación.
 */
export interface ClassSessionMeta {
  scheduledStartAt: string;
  effectiveStartAt: string;
  actualStartedAt: string;
  actualEndedAt: string;
  scheduleAdjustment?: ScheduleAdjustment;
  studentArrival: StudentArrival;
  startSource: ClassStartSource;
}

export type Skill =
  | 'speaking'
  | 'listening'
  | 'reading'
  | 'writing'
  | 'grammar'
  | 'vocabulary'
  | 'pronunciation'
  | 'participation';

export const SKILLS: Skill[] = [
  'speaking',
  'listening',
  'reading',
  'writing',
  'grammar',
  'vocabulary',
  'pronunciation',
  'participation',
];

export type SkillGrades = Partial<Record<Skill, number>>;

export type LateCancellationPolicy =
  | 'cobrar_100'
  | 'cobrar_porcentaje'
  | 'descontar_del_paquete'
  | 'no_cobrar';

/**
 * Corrección 2026-07-21 (a pedido de Joaquín — clase como contenedor,
 * §8): asistencia real de varios estados, no sólo presente/ausente. `tarde`
 * es una marca de asistencia post-hoc (el alumno llegó tarde a una clase
 * ya dictada) — DISTINTO del seguimiento de puntualidad en vivo
 * (`StudentArrival`/`punctualityClassification.ts`), que mide la
 * puntualidad de la PROFESORA al empezar la sesión, nunca la del alumno.
 *
 * Corrección 2026-08-11 (a pedido de Joaquín — corrección urgente de
 * registro de clases): se agrega `ausente_aviso` — el alumno avisó antes
 * que no iba a venir, distinto de una ausencia sin aviso. Nunca cuenta
 * como asistencia (`present: false`, igual que `ausente`) — es sólo una
 * distinción informativa para la profesora, nunca cambia asistencia,
 * cobro ni promedio. `sin_registrar` queda como valor legado (ya no se
 * ofrece como botón en `AttendanceRow`, pero un registro guardado antes
 * de la corrección del 2026-08-07 puede seguir teniéndolo).
 */
export type AttendanceStatus = 'presente' | 'ausente' | 'tarde' | 'ausente_aviso' | 'sin_registrar';

export interface StudentAttendanceEntry {
  studentId: string;
  /**
   * @deprecated Compatibilidad con registros/reportes anteriores a esta
   * fase, que sólo leen este booleano — se mantiene siempre sincronizado
   * con `status` (`true` si es 'presente' o 'tarde', `false` en cualquier
   * otro caso). El código nuevo debe leer/escribir `status`.
   */
  present: boolean;
  /** Opcional para que un registro guardado antes de esta fase siga siendo válido tal cual (sin este campo). */
  status?: AttendanceStatus;
  /** Sólo tiene sentido cuando `status === 'tarde'`. */
  lateMinutes?: number;
}

export interface StudentEvaluationEntry {
  studentId: string;
  generalGrade: number | null;
  skillGrades: SkillGrades;
  strengths: string[];
  areasToImprove: string[];
  /**
   * Corrección 2026-07-21 (a pedido de Joaquín — clase como contenedor,
   * §10/§11): observación pedagógica de ESTE alumno — distinta de
   * `NewClassFormState.internalNotes` (privada, nunca sale de la app).
   * Ésta SÍ puede aparecer en el reporte individual del alumno; opcional,
   * nunca se incluye si queda vacía.
   */
  individualObservation?: string;
  /** Tarea sólo para este alumno, además (o en vez) de la tarea común de la clase. */
  individualHomeworkDescription?: string;
  individualHomeworkDueDate?: string | null; // YYYY-MM-DD
}

// Corrección 2026-07-16 (a pedido de Joaquín): "Contenido pedagógico" pasa de
// dos cajas de texto libre ("Tema planificado" / "Tema realmente visto") a
// una única lista de temas, cada uno tocable para alternar su estado — igual
// idea que "Objetivos" (se agrega y queda en la lista), pero con estado
// propio por ítem en vez de sólo texto.
export type TopicStatus = 'planificado' | 'visto';

export interface TopicEntry {
  id: string;
  text: string;
  status: TopicStatus;
}

// Archivo adjunto local (PDF o foto). Nunca viaja en el respaldo automático a
// la nube — sólo se guarda la ruta local del dispositivo donde se adjuntó, a
// propósito (decisión de Joaquín, 2026-07-16): el respaldo estructurado no
// incluye archivos binarios, sólo los datos de texto/números que ya
// respaldaba antes. Si el archivo deja de existir en el dispositivo (o se
// restaura en uno nuevo), la UI debe mostrarlo como no disponible, nunca
// romper.
//
// Corrección 2026-07-18 (a pedido de Joaquín): "Actividades" pasa a llamarse
// "Evidencias y materiales de la clase" y admite fotos además de PDF —
// `kind`/`mimeType`/`sizeBytes`/`caption` son todos OPCIONALES a propósito:
// un adjunto guardado antes de este cambio no tiene ninguno de estos campos
// y debe seguir funcionando exactamente igual, tratado siempre como PDF
// (`kind` ausente ⇒ 'pdf', ver `resolveAttachmentKind` en
// `utils/lessonAttachments.ts`, único punto que decide ese default).
export type LessonAttachmentKind = 'pdf' | 'image';

export interface LessonAttachment {
  id: string;
  name: string;
  uri: string;
  addedAt: string; // ISO
  kind?: LessonAttachmentKind;
  mimeType?: string;
  sizeBytes?: number;
  caption?: string;
  /**
   * Corrección 2026-07-21 (a pedido de Joaquín — clase como contenedor,
   * §12): si está presente, el adjunto pertenece a ESE alumno únicamente
   * (nunca aparece en el reporte de otro participante). Ausente/undefined
   * significa "común a toda la clase" — comportamiento idéntico al de
   * antes de este campo, para no romper adjuntos ya guardados.
   */
  studentId?: string;
}

// Alumno tal como lo necesita el selector — subconjunto de StudentListItem,
// se recibe desde afuera (useStudentsList de Lista de alumnos), no se
// redefine acá.
export interface SelectableStudent {
  id: string;
  name: string;
  level: string;
  modality: StudentModality;
  status: string;
}

export interface NewClassFormState {
  eventType: EventType;
  /**
   * Corrección 2026-09-05 (a pedido de Joaquín — TeacherFlow también debe
   * permitir gestionar Entrenamientos): tipo de actividad de ESTA
   * ocurrencia — se inicializa desde la clase/serie de Calendario al abrir
   * el registro (`CalendarLesson.activityKind`, ver `RegisterPendingClassSheet.tsx`)
   * y, al guardarse dentro de `SavedLesson.form`, queda como una FOTOGRAFÍA
   * fija del tipo que tenía en ese momento — cambiar después el tipo de la
   * serie nunca reescribe este valor ya persistido. Opcional: un formulario
   * anterior a esta fase, sin este campo, se interpreta como `'class'` (ver
   * `normalizeActivityKind`, `calendarActivityKind.ts` — única fuente,
   * nunca comparar contra `'training'`/`undefined` a mano).
   */
  activityKind?: ActivityKind;
  studentIds: string[]; // uno o más (grupal)
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  scheduledDurationMinutes: number;
  actualDurationMinutes: number | null;
  modality: StudentModality;

  attendance: StudentAttendanceEntry[];

  topics: TopicEntry[];
  objectives: string[];
  activities: string[];
  // Corrección 2026-07-16 (a pedido de Joaquín): "Actividades" suma notas
  // de texto libre y archivos adjuntos (PDF) además de la lista de chips
  // ya existente — la profesora puede anotar qué se hizo y/o subir lo que
  // repartió en esa clase puntual.
  activityNotes: string;
  activityAttachments: LessonAttachment[];
  // "Material utilizado" pasa de nombres de texto libre a IDs de la
  // biblioteca reutilizable de materiales (`materialsLibraryStore.ts`) — se
  // sube un PDF o se anota un material una sola vez y se reutiliza en
  // cualquier clase futura, de cualquier alumno. Se resuelve el nombre real
  // contra la biblioteca al mostrarlo (nunca se duplica el texto acá).
  materialIds: string[];

  evaluations: StudentEvaluationEntry[];
  internalNotes: string;

  homeworkDescription: string;
  homeworkDueDate: string | null; // YYYY-MM-DD

  isBillable: boolean;
  lateCancellationPolicy: LateCancellationPolicy | null;
  lateCancellationPercentage: number | null; // solo si policy = cobrar_porcentaje
  consumesMonthlyPackage: boolean; // para alumnos mensuales: ¿consume una clase de la cuota?

  holidayException: boolean; // "igual se dictó/cobró" pese al feriado

  rescheduledFromLessonId: string | null; // si eventType = reprogramada
}

export interface SavedLesson {
  id: string;
  createdAt: string;
  form: NewClassFormState;
  countsAsClass: boolean; // si suma a horas/clases/asistencia/promedio
  billedAmount: number | null;
  /**
   * Desglose del importe facturado por alumno (Fase Pagos 4B.1) — opcional
   * para que los respaldos/registros anteriores a esta fase sigan siendo
   * válidos tal cual (sin este campo). Se completa al crear una clase
   * NUEVA (ver `computeLessonBilledAmountByStudent`); los registros viejos
   * quedan sin él. Es lo que permite crear un `PaymentCharge` por clase con
   * el importe correcto de CADA alumno en una clase grupal, en vez de
   * inventar una división del total. Un registro individual (un solo
   * alumno) puede seguir usando `billedAmount` como compatibilidad aunque
   * no tenga este campo.
   */
  billedAmountByStudent?: Record<string, number>;
  appliedPolicy: LateCancellationPolicy | null;
  calendarReservationKey?: string;
  calendarLessonId?: string;
  calendarRegistration?: CalendarLessonRegistration;
  profileAppliedAt?: string | null;

  /**
   * Ciclo real de clase y puntualidad (2026-07-18, tercera ronda) — todos
   * opcionales para que un registro anterior a esta fase siga siendo
   * válido tal cual, sin migración destructiva. Nunca se usan campos
   * financieros ni `paymentStatus` para nada de esto.
   */
  scheduledStartAt?: string; // ISO — horario originalmente agendado
  effectiveStartAt?: string; // ISO — horario tras un ajuste (igual a scheduledStartAt si no se ajustó)
  actualStartedAt?: string; // ISO — cuándo se tocó "Comenzar clase" (o corrección manual)
  actualEndedAt?: string; // ISO
  scheduleAdjustment?: ScheduleAdjustment;
  studentArrival?: StudentArrival;
  startSource?: ClassStartSource;
  endSource?: ClassEndSource;
  /** Última vez que se corrigió algo de esta sección manualmente. */
  sessionUpdatedAt?: string;

  /**
   * Corrección 2026-08-07 (a pedido de Joaquín — PROBLEMA 2: editar una
   * clase ya registrada): `updatedAt` es opcional a propósito — un
   * registro que nunca se editó no lo tiene (nunca `undefined` es un
   * error). Sólo lo escribe `useEditRegisteredLesson`, nunca el flujo de
   * creación original.
   */
  updatedAt?: string;
  /**
   * Auditoría append-only de ediciones — nunca se borra ni se sobrescribe
   * una entrada existente, sólo se agrega una nueva por cada edición
   * guardada. Cada entrada conserva el `form`/`billedAmount`/`billedAmountByStudent`/
   * `countsAsClass`/`appliedPolicy` EXACTOS de antes de esa edición
   * puntual, para poder reconstruir qué decía el registro en cualquier
   * momento de su historia. Opcional: un registro nunca editado no tiene
   * este campo (ni falta hace).
   */
  editHistory?: LessonEditAuditEntry[];

  /**
   * Corrección 2026-08-11 (a pedido de Joaquín — FASE 3: ciclo real de
   * tareas pendientes): revisiones registradas EN ESTA clase de tareas
   * asignadas en clases anteriores (comunes o individuales, de cualquier
   * alumno de ESTA clase). Opcional a propósito — un registro anterior a
   * esta fase, o una clase donde nunca hubo tarea pendiente que revisar,
   * simplemente no lo tiene. Nunca se guarda acá la tarea que ESTA MISMA
   * clase asigna para la próxima (eso sigue viviendo en
   * `form.homeworkDescription`/`form.evaluations[].individualHomeworkDescription`,
   * sin cambios) — sólo el resultado de revisar tareas de origen anterior.
   */
  homeworkReviews?: HomeworkReviewEntry[];

  /**
   * Corrección 2026-08-12 (a pedido de Joaquín — REDISEÑO SEGURO E
   * INTUITIVO DEL REGISTRO DE CLASES, regla "progreso parcial grupal"):
   * ausente o `'completed'` (siempre el caso de un registro individual, o
   * de cualquier registro creado ANTES de esta fase — compatibilidad total,
   * nunca una migración destructiva) significa que el registro está
   * terminado, exactamente el comportamiento de siempre.
   * `'partially_registered'` es EXCLUSIVO de una clase grupal a mitad de
   * completar: `buildPendingClasses` debe seguir mostrándola como
   * pendiente (nunca tratarla como ya registrada sólo porque existe un
   * `SavedLesson` con esta reserva) y `useSaveClass.ts` nunca debe aplicar
   * perfiles/tareas/cobros a partir de un registro en este estado — sólo
   * al pasar a `'completed'` (acción real "Finalizar registro de la
   * clase").
   */
  registrationStatus?: 'partially_registered' | 'completed';

  /**
   * Progreso alumno por alumno de un registro grupal todavía sin terminar.
   * Ausente en un registro individual (siempre atómico, un solo paso) y en
   * cualquier registro `'completed'` ya aplicado — sólo tiene sentido
   * mientras `registrationStatus === 'partially_registered'`. Nunca
   * duplica los datos propios de cada alumno (asistencia, evaluación,
   * tarea individual siguen viviendo exclusivamente en `form.attendance[]`/
   * `form.evaluations[]`, igual que siempre) — sólo agrega el ESTADO de
   * avance (pendiente/completado/omitido) y el orden estable en el que la
   * profesora los va completando.
   */
  groupProgress?: GroupRegistrationProgress;
}

/**
 * Corrección 2026-08-12 (a pedido de Joaquín — rediseño del registro de
 * clases, §6/§7/§8): estado de avance de CADA participante de una clase
 * grupal todavía sin terminar de registrar.
 * - `pending`: todavía no se completó ni se omitió.
 * - `completed`: la profesora ya cargó y confirmó sus datos.
 * - `omitted`: "Omitir por ahora" — nunca se inventa asistencia; sigue
 *   contando como pendiente a los efectos de habilitar "Finalizar registro"
 *   (§8: sólo se habilita cuando TODOS quedaron `completed`), la profesora
 *   puede volver a abrirlo cuantas veces haga falta.
 */
export type ParticipantRegistrationStatus = 'pending' | 'completed' | 'omitted';

export interface GroupRegistrationProgress {
  /** Orden estable de `studentId` — se fija la primera vez y nunca se reordena solo, ni siquiera al reabrir. */
  participantOrder: string[];
  participantStatus: Record<string, ParticipantRegistrationStatus>;
}

/**
 * Corrección 2026-08-11 (a pedido de Joaquín — FASE 3: ciclo real de
 * tareas pendientes): cuatro resultados posibles al revisar, en la
 * siguiente clase del alumno, una tarea asignada en una clase anterior.
 * "realizada" y "ya_no_corresponde" CIERRAN la tarea (deja de aparecer
 * como pendiente); "parcial" y "no_realizada" la CONSERVAN pendiente para
 * la próxima clase — la profesora puede volver a revisarla las veces que
 * haga falta hasta que se cierre.
 */
export type HomeworkReviewOutcome = 'realizada' | 'parcial' | 'no_realizada' | 'ya_no_corresponde';

/**
 * Revisión de UNA tarea asignada en una clase ANTERIOR, registrada en la
 * `SavedLesson` donde efectivamente se revisó (nunca en la clase de
 * origen). `taskId` identifica la tarea de forma estable y determinística
 * — nunca por posición ni por texto — para poder reconocerla entre
 * clases sin depender de una serie recurrente ni de un store aparte:
 *   - tarea común de la clase:      `common:<savedLessonId de origen>`
 *   - tarea individual de un alumno: `individual:<savedLessonId de origen>:<studentId>`
 * Ver `homeworkPendingDomain.ts` (`commonHomeworkTaskId`/`individualHomeworkTaskId`)
 * — nunca construir este id a mano en otro lugar.
 */
export interface HomeworkReviewEntry {
  taskId: string;
  studentId: string;
  outcome: HomeworkReviewOutcome;
  reviewedAt: string; // ISO
}

export interface LessonEditAuditEntry {
  editedAt: string; // ISO
  previousForm: NewClassFormState;
  previousCountsAsClass: boolean;
  previousBilledAmount: number | null;
  previousBilledAmountByStudent?: Record<string, number>;
  previousAppliedPolicy: LateCancellationPolicy | null;
}

export const DEFAULT_FORM_STATE: Omit<NewClassFormState, 'studentIds' | 'date' | 'time' | 'modality'> = {
  eventType: 'clase_dictada',
  scheduledDurationMinutes: 60,
  actualDurationMinutes: 60,
  attendance: [],
  topics: [],
  objectives: [],
  activities: [],
  activityNotes: '',
  activityAttachments: [],
  materialIds: [],
  evaluations: [],
  internalNotes: '',
  homeworkDescription: '',
  homeworkDueDate: null,
  isBillable: true,
  lateCancellationPolicy: null,
  lateCancellationPercentage: null,
  consumesMonthlyPackage: true,
  holidayException: false,
  rescheduledFromLessonId: null,
};

// Corrección 2026-07-16 (a pedido de Joaquín): biblioteca reutilizable de
// materiales — se sube/anota una sola vez ("Unidad 3 - verbos irregulares")
// y se reutiliza en cualquier clase futura de cualquier alumno, en vez de
// subir el mismo PDF una y otra vez. Vive en `materialsLibraryStore.ts`,
// persistida aparte (`@teacherflow/materials_library`), fuera del
// respaldo automático a la nube por ahora (mismo límite que
// `LessonAttachment`: sólo datos de texto se respaldan, nunca archivos).
export interface MaterialLibraryItem {
  id: string;
  name: string;
  note?: string;
  attachment: LessonAttachment | null;
  createdAt: string; // ISO
}
