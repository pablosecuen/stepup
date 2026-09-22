// Fase A — datos EXCLUSIVAMENTE ficticios, para poblar la vista previa del
// área privada. Ningún nombre, monto ni fecha corresponde a un alumno o
// cuenta real. No se conecta a Supabase ni a ningún backend todavía.

// Corrección Fase 2 (a pedido explícito — "eliminar el uso de
// FIXTURE_STUDENTS en /alumnos"): `FIXTURE_STUDENTS`/`FixtureStudent` se
// quitaron por completo — `/alumnos` ya lee datos reales de Supabase (ver
// `lib/repositories/students.ts`). Corrección Fase 5: `FixtureCharge`/
// `FIXTURE_CHARGES`/`FixtureStudentStatus`/`StatusPill` se quitaron
// completos por el mismo motivo — `/cobros` ya lee datos reales
// (`lib/repositories/payments.ts`, `lib/payments/collections-center.ts`).

export interface FixtureLesson {
  id: string;
  studentName: string;
  time: string;
  modality: "Presencial" | "Online";
}

export const FIXTURE_TODAY_LESSONS: FixtureLesson[] = [
  { id: "clase-demo-1", studentName: "Alumno de ejemplo 1", time: "16:00", modality: "Online" },
  { id: "clase-demo-2", studentName: "Alumno de ejemplo 3", time: "18:30", modality: "Presencial" },
];
