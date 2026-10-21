/**
 * Exclusión REVERSIBLE de datos de prueba (R16) de la agenda, los pendientes y las estadísticas. La lista son alumnos de prueba confirmados por la usuaria (`test_data_exclusions`); nada se borra ni se
 * modifica. Una serie, una clase o un registro se oculta SÓLO si TODOS sus participantes están en la lista: nunca se oculta algo compartido con un alumno real. Sin alumnos excluidos, todo devuelve
 * exactamente lo que recibe. PURO.
 */
export const NO_EXCLUDED_STUDENTS: ReadonlySet<string> = new Set();

/** ¿Todos los participantes están excluidos? Una fila sin participantes nunca se considera de prueba. */
export function isFullyExcluded(participantIds: readonly string[], excludedStudentIds: ReadonlySet<string>): boolean {
  return excludedStudentIds.size > 0 && participantIds.length > 0 && participantIds.every((id) => excludedStudentIds.has(id));
}

/** Los participantes de una serie o clase incluyen al alumno principal (que siempre está entre ellos, pero se suma por si el dato viene incompleto). */
export function participantsOf(primaryStudentId: string | null, participantIds: readonly string[]): string[] {
  return primaryStudentId && !participantIds.includes(primaryStudentId) ? [primaryStudentId, ...participantIds] : [...participantIds];
}

export function withoutExcludedRules<T extends { primaryStudentId: string | null; participantIds: readonly string[] }>(rules: readonly T[], excludedStudentIds: ReadonlySet<string>): T[] {
  if (excludedStudentIds.size === 0) return [...rules];
  return rules.filter((rule) => !isFullyExcluded(participantsOf(rule.primaryStudentId, rule.participantIds), excludedStudentIds));
}

export function withoutExcludedLessons<T extends { primaryStudentId: string | null; participantIds: readonly string[] }>(lessons: readonly T[], excludedStudentIds: ReadonlySet<string>): T[] {
  if (excludedStudentIds.size === 0) return [...lessons];
  return lessons.filter((lesson) => !isFullyExcluded(participantsOf(lesson.primaryStudentId, lesson.participantIds), excludedStudentIds));
}

/** Registros: se ocultan los que tienen al menos un alumno y TODOS son de prueba. */
export function withoutExcludedRegistrations<T extends { id: string }>(registrations: readonly T[], studentIdsByRegistration: ReadonlyMap<string, readonly string[]>, excludedStudentIds: ReadonlySet<string>): T[] {
  if (excludedStudentIds.size === 0) return [...registrations];
  return registrations.filter((registration) => !isFullyExcluded(studentIdsByRegistration.get(registration.id) ?? [], excludedStudentIds));
}

/** Alumnos de prueba fuera de los conteos de alumnos (activos, nuevos, incorporación mensual). */
export function withoutExcludedStudents<T extends { id: string }>(students: readonly T[], excludedStudentIds: ReadonlySet<string>): T[] {
  if (excludedStudentIds.size === 0) return [...students];
  return students.filter((student) => !excludedStudentIds.has(student.id));
}
