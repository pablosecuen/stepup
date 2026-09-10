import type { ActivityKind, LessonModality, LessonStatus } from "./calendar-theme";

// Fase A/revisión visual — datos EXCLUSIVAMENTE ficticios para demostrar la
// grilla semanal. `dayOffset` es relativo al lunes de la semana MOSTRADA
// (0=lunes...6=domingo) — la misma plantilla se reubica cada vez que se
// navega de semana, para poder demostrar navegación sin depender de datos
// reales. Elapsed/"hoy" se calculan siempre contra la hora real del
// navegador en el momento de ver la página, nunca hardcodeados.
export interface CalendarFixtureLesson {
  id: string;
  title: string;
  dayOffset: number;
  startHour: number;
  startMinute: number;
  durationMinutes: number;
  modality: LessonModality;
  status: LessonStatus;
  activityKind: ActivityKind;
  participantCount: number;
  isRecurring: boolean;
  /** Sólo para una clase de reemplazo — id de la clase cancelada cuyo horario ocupa. */
  freedByLessonId?: string;
}

export const CALENDAR_FIXTURE_LESSONS: CalendarFixtureLesson[] = [
  {
    id: "demo-lu-1",
    title: "Alumno de ejemplo 1",
    dayOffset: 0,
    startHour: 9,
    startMinute: 0,
    durationMinutes: 60,
    modality: "presencial",
    status: "scheduled",
    activityKind: "class",
    participantCount: 1,
    isRecurring: true,
  },
  {
    id: "demo-lu-2",
    title: "Clase grupal · 3 alumnos",
    dayOffset: 0,
    startHour: 16,
    startMinute: 0,
    durationMinutes: 45,
    modality: "online",
    status: "scheduled",
    activityKind: "class",
    participantCount: 3,
    isRecurring: true,
  },
  {
    // Primera de un par exactamente consecutivo (termina 11:00, ver
    // demo-ma-2 abajo, que empieza 11:00) — prueba de "dos clases
    // consecutivas, no superpuestas" pedida en la corrección 2026-09-10.
    id: "demo-ma-1",
    title: "Alumno de ejemplo 2",
    dayOffset: 1,
    startHour: 10,
    startMinute: 0,
    durationMinutes: 60,
    modality: "online",
    status: "scheduled",
    activityKind: "training",
    participantCount: 1,
    isRecurring: false,
  },
  {
    // Exactamente consecutiva con demo-ma-1 (termina 11:00, esta empieza
    // 11:00) — corrección 2026-09-10: antes se superponía 30 minutos con
    // demo-ma-1 y forzaba el diseño de carriles paralelos ya eliminado.
    id: "demo-ma-2",
    title: "Alumno de ejemplo 3",
    dayOffset: 1,
    startHour: 11,
    startMinute: 0,
    durationMinutes: 45,
    modality: "presencial",
    status: "scheduled",
    activityKind: "class",
    participantCount: 1,
    isRecurring: true,
  },
  {
    id: "demo-mi-1",
    title: "Alumno de ejemplo 4",
    dayOffset: 2,
    startHour: 14,
    startMinute: 0,
    durationMinutes: 60,
    modality: "mixta",
    status: "scheduled",
    activityKind: "class",
    participantCount: 1,
    isRecurring: false,
  },
  {
    id: "demo-mi-2",
    title: "Clase grupal · 4 alumnos",
    dayOffset: 2,
    startHour: 18,
    startMinute: 0,
    durationMinutes: 90,
    modality: "presencial",
    status: "scheduled",
    activityKind: "training",
    participantCount: 4,
    isRecurring: true,
  },
  {
    id: "demo-ju-cancelada",
    title: "Alumno de ejemplo 5",
    dayOffset: 3,
    startHour: 9,
    startMinute: 30,
    durationMinutes: 60,
    modality: "online",
    status: "cancelled",
    activityKind: "class",
    participantCount: 1,
    isRecurring: false,
  },
  {
    id: "demo-ju-reemplazo",
    title: "Alumno de ejemplo 6",
    dayOffset: 3,
    startHour: 9,
    startMinute: 30,
    durationMinutes: 60,
    modality: "online",
    status: "scheduled",
    activityKind: "class",
    participantCount: 1,
    isRecurring: false,
    freedByLessonId: "demo-ju-cancelada",
  },
  {
    id: "demo-vi-completada",
    title: "Alumno de ejemplo 7",
    dayOffset: 4,
    startHour: 11,
    startMinute: 0,
    durationMinutes: 45,
    modality: "presencial",
    status: "completed",
    activityKind: "class",
    participantCount: 1,
    isRecurring: true,
  },
  {
    id: "demo-vi-reprogramada",
    title: "Alumno de ejemplo 8",
    dayOffset: 4,
    startHour: 17,
    startMinute: 0,
    durationMinutes: 60,
    modality: "online",
    status: "rescheduled",
    activityKind: "class",
    participantCount: 1,
    isRecurring: false,
  },
  {
    id: "demo-sa-1",
    title: "Alumno de ejemplo 9",
    dayOffset: 5,
    startHour: 10,
    startMinute: 0,
    durationMinutes: 60,
    modality: "presencial",
    status: "scheduled",
    activityKind: "class",
    participantCount: 1,
    isRecurring: true,
  },
  {
    // Cancelada SIN reemplazo — la única forma de demostrar el color ámbar
    // de "Cancelada" (el otro caso cancelado del fixture, demo-ju-cancelada,
    // tiene reemplazo activo y por regla congelada se oculta de la grilla).
    id: "demo-sa-cancelada",
    title: "Alumno de ejemplo 10",
    dayOffset: 5,
    startHour: 15,
    startMinute: 0,
    durationMinutes: 60,
    modality: "online",
    status: "cancelled",
    activityKind: "class",
    participantCount: 1,
    isRecurring: false,
  },
  {
    // Nombre ficticio largo, en un día sin ninguna otra actividad — así su
    // alto puede crecer libremente sin riesgo de invadir una clase vecina
    // (domingo queda deliberadamente aislado para esta prueba).
    id: "demo-do-nombre-largo",
    title: "Alumna Rodríguez Fernández de la Torre",
    dayOffset: 6,
    startHour: 11,
    startMinute: 0,
    durationMinutes: 60,
    modality: "presencial",
    status: "scheduled",
    activityKind: "class",
    participantCount: 1,
    isRecurring: false,
  },
];
