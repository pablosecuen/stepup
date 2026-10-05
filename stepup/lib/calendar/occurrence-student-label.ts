/**
 * Nombre y nivel que se muestran para una clase de serie — UNA sola regla, la misma para las clases ya materializadas
 * ("congeladas") y para las ocurrencias virtuales:
 *
 *  - alumno PRINCIPAL = el que la serie tiene guardado de verdad (`primary_student_id`); si ese alumno ya no está entre los
 *    conocidos, el primero de los participantes que sí lo esté (mismo respaldo que ya usaba el congelado de
 *    `changeRecurrenceParticipantsFromDate`) — nunca un orden implícito entre varios;
 *  - nombre = nombre del principal; nivel = su PRIMER nivel;
 *  - sin ningún alumno resoluble → nombre y nivel vacíos (recién ahí la UI muestra "Serie sin alumnos").
 *
 * Antes las ocurrencias virtuales nacían con `studentName: ""` aunque la serie tuviera participantes, así que Calendario,
 * Inicio, Registro y Recordatorios mostraban "Serie sin alumnos" / "Sin alumnos" para series con alumnos.
 */
export interface StudentForLabel {
  name: string;
  levels: readonly string[];
}

export interface OccurrenceStudentLabel {
  primaryStudentId: string | null;
  studentName: string;
  level: string;
}

export function resolveOccurrenceStudentLabel(input: {
  primaryStudentId: string | null;
  participantIds: readonly string[];
  students: ReadonlyMap<string, StudentForLabel>;
}): OccurrenceStudentLabel {
  const explicit = input.primaryStudentId ? input.students.get(input.primaryStudentId) : undefined;
  if (explicit && input.primaryStudentId) {
    return { primaryStudentId: input.primaryStudentId, studentName: explicit.name, level: explicit.levels[0] ?? "" };
  }
  for (const id of input.participantIds) {
    const student = input.students.get(id);
    if (student) return { primaryStudentId: id, studentName: student.name, level: student.levels[0] ?? "" };
  }
  return { primaryStudentId: null, studentName: "", level: "" };
}
