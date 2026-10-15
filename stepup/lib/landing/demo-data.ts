import type { LessonModality } from "@/lib/calendar-theme";
import type { MonthlyCollectedPoint } from "@/lib/reports/monthly-collected";

/**
 * Datos SINTÉTICOS de las maquetas de la landing: nombres inventados, importes redondos, ninguna persona real. Son exclusivamente
 * demostrativos (la landing es pública y no lee ninguna cuenta).
 */

export interface DemoStudent {
  name: string;
  short: string;
  level: string;
  modality: LessonModality;
  tone: number;
}

export const DEMO_STUDENTS: readonly DemoStudent[] = [
  { name: "Lucía Ferrer", short: "Lucía F.", level: "B1", modality: "presencial", tone: 0 },
  { name: "Mateo Sosa", short: "Mateo S.", level: "A2", modality: "online", tone: 3 },
  { name: "Sofía Ibarra", short: "Sofía I.", level: "B2", modality: "mixta", tone: 2 },
  { name: "Tomás Quiroga", short: "Tomás Q.", level: "A1", modality: "online", tone: 5 },
  { name: "Valentina Rey", short: "Valentina R.", level: "C1", modality: "presencial", tone: 4 },
  { name: "Joaquín Paz", short: "Joaquín P.", level: "B1", modality: "mixta", tone: 1 },
];

export type DemoLessonKind = "normal" | "elapsed" | "cancelled" | "replacement" | "rescheduled";

export interface DemoLesson {
  /** Columna: 0 = lunes … 4 = viernes. */
  day: number;
  /** Hora de inicio en horas decimales (9.5 = 9:30). */
  start: number;
  hours: number;
  title: string;
  modality: LessonModality;
  kind: DemoLessonKind;
}

/** Semana del lunes 12 al viernes 16 de octubre (sintética). La grilla muestra de 8:00 a 17:00. */
export const WEEK_FIRST_HOUR = 8;
export const WEEK_HOURS = 9;
export const WEEK_DAYS = [
  { short: "Lun", date: 12 },
  { short: "Mar", date: 13 },
  { short: "Mié", date: 14 },
  { short: "Jue", date: 15 },
  { short: "Vie", date: 16 },
] as const;

export const WEEK_LESSONS: readonly DemoLesson[] = [
  { day: 0, start: 9, hours: 1, title: "Lucía F.", modality: "presencial", kind: "elapsed" },
  { day: 0, start: 11, hours: 1, title: "Grupo B2", modality: "presencial", kind: "normal" },
  { day: 0, start: 15, hours: 1, title: "Mateo S.", modality: "online", kind: "normal" },
  { day: 1, start: 10, hours: 1, title: "Sofía I.", modality: "mixta", kind: "normal" },
  { day: 1, start: 14, hours: 1, title: "Tomás Q.", modality: "online", kind: "cancelled" },
  { day: 1, start: 15.5, hours: 1, title: "Tomás Q.", modality: "online", kind: "replacement" },
  { day: 2, start: 9, hours: 1.5, title: "Valentina R.", modality: "presencial", kind: "normal" },
  { day: 2, start: 11.5, hours: 1, title: "Joaquín P.", modality: "mixta", kind: "normal" },
  { day: 3, start: 10, hours: 1, title: "Lucía F.", modality: "presencial", kind: "rescheduled" },
  { day: 3, start: 12, hours: 1, title: "Mateo S.", modality: "online", kind: "normal" },
  { day: 3, start: 15, hours: 1, title: "Grupo B2", modality: "presencial", kind: "normal" },
  { day: 4, start: 9.5, hours: 1, title: "Sofía I.", modality: "mixta", kind: "normal" },
  { day: 4, start: 13, hours: 1, title: "Joaquín P.", modality: "online", kind: "normal" },
];

export interface DemoDayLesson {
  time: string;
  end: string;
  title: string;
  modality: LessonModality;
  state?: "Pasada" | "En curso" | "Sigue" | "Cancelada" | "Reprogramada";
}

export const DAY_LESSONS: readonly DemoDayLesson[] = [
  { time: "09:00", end: "10:00", title: "Lucía Ferrer", modality: "presencial", state: "Pasada" },
  { time: "10:30", end: "11:30", title: "Sofía Ibarra", modality: "mixta", state: "En curso" },
  { time: "11:30", end: "12:30", title: "Grupo B2 · 3 alumnos", modality: "presencial", state: "Sigue" },
  { time: "14:00", end: "15:00", title: "Tomás Quiroga", modality: "online", state: "Cancelada" },
  { time: "15:00", end: "16:00", title: "Mateo Sosa", modality: "online" },
  { time: "17:30", end: "18:30", title: "Valentina Rey", modality: "presencial" },
];

export type DemoChargeState = "Vence hoy" | "Vencido" | "Vence pronto" | "Pendiente" | "Pago parcial" | "Pagado";

export interface DemoCharge {
  student: string;
  tone: number;
  concept: string;
  due: string;
  amount: number;
  balance: number;
  state: DemoChargeState;
}

export const DEMO_CHARGES: readonly DemoCharge[] = [
  { student: "Joaquín Paz", tone: 1, concept: "Mensualidad octubre", due: "05/10/2026", amount: 48000, balance: 48000, state: "Vencido" },
  { student: "Mateo Sosa", tone: 3, concept: "Mensualidad octubre", due: "12/10/2026", amount: 42000, balance: 42000, state: "Vence hoy" },
  { student: "Sofía Ibarra", tone: 2, concept: "Mensualidad octubre", due: "15/10/2026", amount: 54000, balance: 54000, state: "Vence pronto" },
  { student: "Tomás Quiroga", tone: 5, concept: "Mensualidad octubre", due: "20/10/2026", amount: 36000, balance: 18000, state: "Pago parcial" },
  { student: "Valentina Rey", tone: 4, concept: "Mensualidad octubre", due: "10/10/2026", amount: 60000, balance: 0, state: "Pagado" },
];

export const DEMO_PAYMENTS = [
  { student: "Valentina Rey", tone: 4, date: "10/10/2026", amount: 60000, concept: "Mensualidad octubre" },
  { student: "Lucía Ferrer", tone: 0, date: "08/10/2026", amount: 48000, concept: "Mensualidad octubre" },
  { student: "Tomás Quiroga", tone: 5, date: "06/10/2026", amount: 18000, concept: "Pago parcial · octubre" },
] as const;

/** Evolución de cobros (sintética): seis meses de mayo a octubre de 2026. */
export const DEMO_COLLECTED: readonly MonthlyCollectedPoint[] = [
  { month: "2026-05", amount: 186000 },
  { month: "2026-06", amount: 214000 },
  { month: "2026-07", amount: 198000 },
  { month: "2026-08", amount: 236000 },
  { month: "2026-09", amount: 262000 },
  { month: "2026-10", amount: 226000 },
];

export const DEMO_COLLECTED_THIS_MONTH = 226000;
export const DEMO_BUDGET = [
  { key: "needs", label: "Necesidades", percent: 50 },
  { key: "wants", label: "Gustos", percent: 30 },
  { key: "savings", label: "Ahorro", percent: 20 },
] as const;

export const DEMO_HISTORY = [
  { date: "mié 14/10", time: "09:00", note: "Present perfect: ejercicios 1 a 4", state: "Dictada" },
  { date: "vie 09/10", time: "09:00", note: "Lectura y vocabulario de viajes", state: "Dictada" },
  { date: "mié 07/10", time: "09:00", note: "Clase reprogramada al jueves", state: "Reprogramada" },
  { date: "vie 02/10", time: "09:00", note: "Repaso de tiempos del pasado", state: "Dictada" },
] as const;
