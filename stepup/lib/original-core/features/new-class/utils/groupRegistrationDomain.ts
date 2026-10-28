// Puerto VERBATIM del original (`src/features/new-class/utils/groupRegistrationDomain.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { GroupRegistrationProgress, ParticipantRegistrationStatus } from '../types/index.ts';

/**
 * Corrección 2026-08-12 (a pedido de Joaquín — REDISEÑO SEGURO E INTUITIVO
 * DEL REGISTRO DE CLASES): dominio PURO del progreso alumno por alumno de
 * una clase grupal — nunca toca AsyncStorage/React, mismo patrón que
 * `lessonRegistrationDomain.ts`. La persistencia real (cuándo se escribe
 * como borrador vs. registro terminado) vive en `useSaveClass.ts`.
 */

/**
 * Arranca (o rehidrata) el progreso de una clase grupal. El orden de
 * participantes se fija UNA sola vez — si ya existe un progreso guardado
 * (la profesora reabrió el panel), se conserva ese orden y esos estados tal
 * cual, nunca se reinicia ni se reordena. Un `studentId` nuevo (agregado al
 * grupo después de empezar el borrador) se agrega al final, como
 * `'pending'`; uno que ya no está entre `studentIds` actuales se quita —
 * nunca se pierde silenciosamente el progreso de los que siguen.
 */
export function buildInitialGroupProgress(
  studentIds: string[],
  existing?: GroupRegistrationProgress
): GroupRegistrationProgress {
  if (!existing) {
    return {
      participantOrder: [...studentIds],
      participantStatus: Object.fromEntries(studentIds.map((id) => [id, 'pending' as const])),
    };
  }

  const currentIds = new Set(studentIds);
  const preservedOrder = existing.participantOrder.filter((id) => currentIds.has(id));
  const newIds = studentIds.filter((id) => !preservedOrder.includes(id));
  const participantOrder = [...preservedOrder, ...newIds];

  const participantStatus: Record<string, ParticipantRegistrationStatus> = {};
  participantOrder.forEach((id) => {
    participantStatus[id] = existing.participantStatus[id] ?? 'pending';
  });

  return { participantOrder, participantStatus };
}

/** Nunca muta el progreso recibido — devuelve uno nuevo, mismo criterio que el resto del dominio. */
export function setParticipantStatus(
  progress: GroupRegistrationProgress,
  studentId: string,
  status: ParticipantRegistrationStatus
): GroupRegistrationProgress {
  return {
    participantOrder: progress.participantOrder,
    participantStatus: { ...progress.participantStatus, [studentId]: status },
  };
}

/**
 * Próximo participante a abrir automáticamente: el primer `pending` en el
 * orden estable; si no queda ninguno `pending`, el primer `omitted` (la
 * profesora puede volver a intentarlo); si todos están `completed`, no hay
 * a quién abrir (la clase ya puede finalizarse).
 */
export function firstOpenParticipant(progress: GroupRegistrationProgress): string | null {
  const pending = progress.participantOrder.find((id) => progress.participantStatus[id] === 'pending');
  if (pending) return pending;
  const omitted = progress.participantOrder.find((id) => progress.participantStatus[id] === 'omitted');
  return omitted ?? null;
}

/** §8: "Finalizar registro" sólo se habilita cuando TODOS quedaron `completed` — `omitted` nunca cuenta. */
export function isGroupRegistrationComplete(progress: GroupRegistrationProgress): boolean {
  return progress.participantOrder.every((id) => progress.participantStatus[id] === 'completed');
}

export interface GroupProgressSummary {
  total: number;
  completed: number;
  omitted: number;
  pending: number;
}

export function summarizeGroupProgress(progress: GroupRegistrationProgress): GroupProgressSummary {
  const counts: GroupProgressSummary = { total: progress.participantOrder.length, completed: 0, omitted: 0, pending: 0 };
  progress.participantOrder.forEach((id) => {
    const status = progress.participantStatus[id];
    if (status === 'completed') counts.completed += 1;
    else if (status === 'omitted') counts.omitted += 1;
    else counts.pending += 1;
  });
  return counts;
}

/** "2 de 5 alumnos completados" — texto exacto pedido en §2. */
export function formatGroupProgressLabel(progress: GroupRegistrationProgress): string {
  const { total, completed } = summarizeGroupProgress(progress);
  return `${completed} de ${total} alumnos completados`;
}

// ===========================================================================
// Identidad y título (§2) — nunca usa el nombre del primer alumno para un
// grupo; el nombre personalizado YA es un campo real del dominio
// (`CalendarLesson.classTitle`/`RecurrenceRule.classTitle`, editable desde
// `EditClassTitleSheet.tsx`) — este helper sólo resuelve cómo se ve en el
// panel de registro, deliberadamente SIN el sufijo "· N alumnos" que sí usa
// `lessonDisplayTitle` en Calendario (esa cuenta se muestra aparte, en el
// subtítulo, junto con el progreso — no se toca `lessonDisplayTitle` para
// no romper sus consumidores/pruebas existentes en Calendario).
// ===========================================================================

export interface RegistrationPanelIdentity {
  isGroup: boolean;
  title: string;
  participantCount: number;
}

export function resolveRegistrationPanelIdentity(params: {
  isGroupClass: boolean;
  classTitle?: string;
  participants: Array<{ studentId: string; studentName: string }>;
}): RegistrationPanelIdentity {
  const trimmedTitle = params.classTitle?.trim();
  if (!params.isGroupClass) {
    return {
      isGroup: false,
      title: params.participants[0]?.studentName ?? 'Clase individual',
      participantCount: params.participants.length,
    };
  }
  return {
    isGroup: true,
    title: trimmedTitle && trimmedTitle.length > 0 ? trimmedTitle : 'Clase grupal',
    participantCount: params.participants.length,
  };
}

// ===========================================================================
// Tarea única (§9) — decide si un alumno usa la tarea común tal cual o su
// propia tarea personalizada. Nunca dos tareas visibles para el mismo
// alumno: en clase individual, la tarea común ES la tarea del único
// alumno (nunca se ofrece personalizar aparte); en grupo, personalizar es
// una acción explícita por alumno.
// ===========================================================================

export interface ResolvedStudentHomework {
  /** `true` si este alumno tiene una tarea personalizada activa (distinta de la común). */
  isPersonalized: boolean;
  description: string;
  dueDate: string | null;
}

/**
 * Un alumno está "personalizado" si su entrada de evaluación ya trae una
 * descripción individual no vacía — señal real y determinística (nunca un
 * booleano nuevo separado que pudiera desincronizarse del dato real).
 */
export function isStudentHomeworkPersonalized(individualHomeworkDescription: string | undefined): boolean {
  return Boolean(individualHomeworkDescription && individualHomeworkDescription.trim().length > 0);
}

export function resolveStudentHomework(params: {
  isGroup: boolean;
  commonDescription: string;
  commonDueDate: string | null;
  individualHomeworkDescription?: string;
  individualHomeworkDueDate?: string | null;
}): ResolvedStudentHomework {
  if (!params.isGroup) {
    return { isPersonalized: false, description: params.commonDescription, dueDate: params.commonDueDate };
  }
  const personalized = isStudentHomeworkPersonalized(params.individualHomeworkDescription);
  if (!personalized) {
    return { isPersonalized: false, description: params.commonDescription, dueDate: params.commonDueDate };
  }
  return {
    isPersonalized: true,
    description: params.individualHomeworkDescription ?? '',
    dueDate: params.individualHomeworkDueDate ?? null,
  };
}
