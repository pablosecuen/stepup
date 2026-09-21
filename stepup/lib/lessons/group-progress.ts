/**
 * Puerto exacto de `groupRegistrationDomain.ts` (móvil). Cada participante
 * se completa de forma independiente; `'omitted'` ("Omitir por ahora") es
 * reversible y NUNCA cuenta como completo — sigue bloqueando la
 * finalización, igual que `'pending'`.
 */
export type ParticipantRegistrationStatus = "pending" | "completed" | "omitted";

export interface GroupRegistrationProgress {
  participantOrder: string[];
  participantStatus: Record<string, ParticipantRegistrationStatus>;
}

export function buildInitialGroupProgress(participantIds: string[]): GroupRegistrationProgress {
  const participantStatus: Record<string, ParticipantRegistrationStatus> = {};
  participantIds.forEach((id) => {
    participantStatus[id] = "pending";
  });
  return { participantOrder: [...participantIds], participantStatus };
}

export function setParticipantStatus(
  progress: GroupRegistrationProgress,
  studentId: string,
  status: ParticipantRegistrationStatus
): GroupRegistrationProgress {
  return { ...progress, participantStatus: { ...progress.participantStatus, [studentId]: status } };
}

/** "Finalizar registro" sólo se habilita cuando TODOS quedaron `completed` — `omitted` nunca cuenta (mismo criterio que `isGroupRegistrationComplete` del móvil). Generaliza sin cambios al caso individual (1 solo participante). */
export function isGroupRegistrationComplete(progress: GroupRegistrationProgress): boolean {
  return progress.participantOrder.every((id) => progress.participantStatus[id] === "completed");
}

export function countCompletedParticipants(progress: GroupRegistrationProgress): number {
  return progress.participantOrder.filter((id) => progress.participantStatus[id] === "completed").length;
}
