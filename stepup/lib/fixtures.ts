// Fase A — datos EXCLUSIVAMENTE ficticios, para poblar la vista previa del
// área privada. Ningún nombre, monto ni fecha corresponde a un alumno o
// cuenta real. No se conecta a Supabase ni a ningún backend todavía.

// Corrección Fase 2 (a pedido explícito — "eliminar el uso de
// FIXTURE_STUDENTS en /alumnos"): `FIXTURE_STUDENTS`/`FixtureStudent` se
// quitaron por completo — `/alumnos` ya lee datos reales de Supabase (ver
// `lib/repositories/students.ts`). `FixtureStudentStatus` se conserva:
// sigue siendo el tipo real de `FixtureCharge.status` (`/cobros`, todavía
// ficticio, Fase 5) y de `StatusPill`, ninguno de los dos tocado en esta
// fase.
export type FixtureStudentStatus = "Pago pendiente" | "Vence pronto" | "Vence hoy" | "Pago vencido" | "Pagado";

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

export interface FixtureCharge {
  id: string;
  studentName: string;
  amount: number;
  status: FixtureStudentStatus;
}

export const FIXTURE_CHARGES: FixtureCharge[] = [
  { id: "cargo-demo-1", studentName: "Alumno de ejemplo 2", amount: 15000, status: "Vence pronto" },
  { id: "cargo-demo-2", studentName: "Alumno de ejemplo 4", amount: 12000, status: "Pago vencido" },
];
