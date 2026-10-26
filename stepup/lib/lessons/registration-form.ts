import type { AttendanceStatus } from "./attendance.ts";
import type { ParticipantRegistrationStatus } from "./group-progress.ts";

/**
 * Reglas PURAS de cómo se arma el formulario de registro de una clase — puerto de la app anterior (`groupRegistrationDomain.ts`,
 * `RegisterPendingClassSheet.tsx`, `calendarParticipants.ts`): quién encabeza el formulario, qué se muestra en una clase individual
 * y en una grupal, y qué cuenta el resumen del grupo. Sin React ni I/O, para probarlo con `node --test`.
 */

/** Una clase es grupal cuando tiene más de un participante; individual en cualquier otro caso. */
export function isGroupRegistration(participantCount: number): boolean {
  return participantCount > 1;
}

/** «Ana, Beto y Carla» / «Ana y Beto» / «Ana, Beto, Carla y +2 alumnos» (igual que el Calendario de la app). */
export function formatParticipantNamesSentence(names: readonly string[], maxNames = 3): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length > maxNames) {
    const remaining = names.length - maxNames;
    return `${names.slice(0, maxNames).join(", ")} y +${remaining} alumno${remaining === 1 ? "" : "s"}`;
  }
  if (names.length === 2) return `${names[0]} y ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

export interface RegistrationHeader {
  /** Individual: el nombre del alumno. Grupal: el nombre de la clase (o «Clase grupal»), nunca el del primer alumno. */
  title: string;
  /** «Clase individual · Clase suelta», «Entrenamiento grupal · Serie recurrente». */
  typeLine: string;
  /** Sólo en un grupo: quiénes participan. */
  participantsLine: string | null;
}

export function resolveRegistrationHeader(params: { participantNames: readonly string[]; classTitle?: string | null; kindLabel: string; isRecurring: boolean }): RegistrationHeader {
  const isGroup = isGroupRegistration(params.participantNames.length);
  const trimmedTitle = params.classTitle?.trim() ?? "";
  const title = isGroup ? (trimmedTitle !== "" ? trimmedTitle : "Clase grupal") : (params.participantNames[0] ?? "Clase individual");
  return {
    title,
    typeLine: `${params.kindLabel} ${isGroup ? "grupal" : "individual"} · ${params.isRecurring ? "Serie recurrente" : "Clase suelta"}`,
    participantsLine: isGroup ? formatParticipantNamesSentence(params.participantNames) : null,
  };
}

/** «3 de 5 alumnos completados». */
export function formatGroupProgressLabel(completed: number, total: number): string {
  return `${completed} de ${total} alumnos completados`;
}

/** «Faltan 2 alumnos por completar» (la app dice siempre «Faltan N alumno(s)», también con uno). */
export function formatMissingParticipants(missing: number): string {
  return `Faltan ${missing} alumno${missing === 1 ? "" : "s"} por completar`;
}

/**
 * El alumno que se abre al terminar con otro: primero el próximo pendiente, después el próximo omitido; ninguno si ya están todos
 * completos (mismo criterio que `firstOpenParticipant` de la app: «Omitir por ahora» nunca cuenta como completo).
 */
export function firstOpenParticipant(order: readonly string[], statusById: Record<string, ParticipantRegistrationStatus | undefined>): string | null {
  const pending = order.find((id) => (statusById[id] ?? "pending") === "pending");
  if (pending) return pending;
  return order.find((id) => statusById[id] === "omitted") ?? null;
}

export interface GroupSummary {
  present: number;
  late: number;
  absentWithNotice: number;
  absent: number;
  total: number;
  personalizedHomework: number;
}

/** Los números de «Resumen» del grupo: sólo cuenta lo que ya se marcó. */
export function summarizeGroupRegistration(forms: readonly { attendanceStatus: AttendanceStatus | null; homeworkDescription: string }[]): GroupSummary {
  return {
    present: forms.filter((f) => f.attendanceStatus === "presente").length,
    late: forms.filter((f) => f.attendanceStatus === "tarde").length,
    absentWithNotice: forms.filter((f) => f.attendanceStatus === "ausente_aviso").length,
    absent: forms.filter((f) => f.attendanceStatus === "ausente").length,
    total: forms.length,
    personalizedHomework: forms.filter((f) => f.homeworkDescription.trim().length > 0).length,
  };
}

/** «Personalizar tarea» arranca replegado salvo que el alumno ya tenga una tarea propia cargada (reabrir nunca esconde datos guardados). */
export function isStudentHomeworkPersonalized(description: string | null | undefined): boolean {
  return Boolean(description && description.trim().length > 0);
}

/**
 * Asistencia inicial de un participante. En una clase INDIVIDUAL realizada la asistencia nunca se pregunta: el registro la guarda como
 * «presente» (la app anterior hace lo mismo, para no romper estadísticas ni reportes). Un valor ya guardado nunca se pisa; en un grupo
 * arranca sin elegir.
 */
export function initialAttendanceStatus(saved: AttendanceStatus | null, isGroup: boolean): AttendanceStatus | null {
  if (saved) return saved;
  return isGroup ? null : "presente";
}

/**
 * Tareas que la profesora puede cargar en el formulario. UNA sola «Tarea para la próxima clase» (común) en una clase individual — es
 * la tarea del único alumno, nunca una segunda caja; en un grupo, además, cada alumno puede tener una personalizada (acción explícita).
 */
export function homeworkFieldsFor(params: { /** Revisa tareas anteriores (sólo una clase). */ supportsHomework: boolean; /** Puede asignar tarea (clase o entrenamiento). */ assignsHomework: boolean; isGroup: boolean }): { common: boolean; personalizedPerStudent: boolean; pendingReview: boolean } {
  return { common: params.assignsHomework, personalizedPerStudent: params.assignsHomework && params.isGroup, pendingReview: params.supportsHomework };
}

/** En un grupo, la revisión de la tarea anterior de un alumno sólo aparece cuando su asistencia es «presente» o «tarde» (si faltó, la tarea queda pendiente sin pedir nada). */
export function showsPendingHomeworkReview(params: { isGroup: boolean; attendanceStatus: AttendanceStatus | null }): boolean {
  if (!params.isGroup) return true;
  return params.attendanceStatus === "presente" || params.attendanceStatus === "tarde";
}

/**
 * Duración real inicial en minutos: la real si el registro ya tiene inicio y fin reales (un registro finalizado o un progreso guardado);
 * si no, la programada; y 60 sólo como último recurso.
 */
export function initialDurationMinutes(params: { actualStartedAt: string | null; actualEndedAt: string | null; scheduledStartAt: string; scheduledEndAt: string }): number {
  const minutesBetween = (from: string, to: string) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000);
  if (params.actualStartedAt && params.actualEndedAt) {
    const actual = minutesBetween(params.actualStartedAt, params.actualEndedAt);
    if (actual > 0) return actual;
  }
  const scheduled = minutesBetween(params.scheduledStartAt, params.scheduledEndAt);
  return scheduled > 0 ? scheduled : 60;
}
