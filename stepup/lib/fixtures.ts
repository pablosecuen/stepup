// Fase A — datos EXCLUSIVAMENTE ficticios, para poblar la vista previa del
// área privada. Ningún nombre, monto ni fecha corresponde a un alumno o
// cuenta real. No se conecta a Supabase ni a ningún backend todavía.

export type FixtureStudentStatus = "Pago pendiente" | "Vence pronto" | "Vence hoy" | "Pago vencido" | "Pagado";

export interface FixtureStudent {
  id: string;
  name: string;
  level: string;
  status: FixtureStudentStatus;
}

export const FIXTURE_STUDENTS: FixtureStudent[] = [
  { id: "demo-1", name: "Alumno de ejemplo 1", level: "B1", status: "Pago pendiente" },
  { id: "demo-2", name: "Alumno de ejemplo 2", level: "A2", status: "Vence pronto" },
  { id: "demo-3", name: "Alumno de ejemplo 3", level: "C1", status: "Pagado" },
  { id: "demo-4", name: "Alumno de ejemplo 4", level: "B2", status: "Pago vencido" },
];

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
