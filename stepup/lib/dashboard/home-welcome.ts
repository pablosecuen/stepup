import { formatCivilDayLabelShort } from "../calendar/civil-calendar.ts";

/**
 * Bienvenida de Inicio (B5): saludo, fecha y "primeros pasos". Todo se deriva de datos REALES de la cuenta (nombre del
 * perfil, cantidad de alumnos, existencia de clases): nunca inventa métricas ni acciones, y ante un dato desconocido
 * prefiere NO afirmar nada (muestra el Inicio normal) antes que decirle a alguien con actividad que su cuenta está vacía.
 */

export type HomeStage = "empty" | "students-only" | "active";

export interface HomeStageInput {
  /** Todos los alumnos de la cuenta (cualquier estado). */
  studentCount: number;
  /** `null` = no se pudo determinar (no se asume que la cuenta esté vacía). */
  hasAnyClass: boolean | null;
}

/**
 * - `empty`: sin alumnos ni clases (cuenta recién creada).
 * - `students-only`: hay alumnos pero ninguna clase (ni serie) creada alguna vez.
 * - `active`: cualquier otro caso, incluido el dato desconocido y las clases sin alumnos (también es actividad real).
 */
export function resolveHomeStage({ studentCount, hasAnyClass }: HomeStageInput): HomeStage {
  if (hasAnyClass !== false) return "active";
  return studentCount > 0 ? "students-only" : "empty";
}

/** Hora civil (0-23) en Argentina → saludo. "Buen día" hasta el mediodía, "Buenas tardes" hasta las 20, luego "Buenas noches". */
export function greetingForHour(hour: number): string {
  if (!Number.isFinite(hour)) return "Hola";
  const h = Math.floor(hour);
  if (h >= 5 && h < 12) return "Buen día";
  if (h >= 12 && h < 20) return "Buenas tardes";
  return "Buenas noches";
}

/**
 * Cómo nombrar a la profesora: su primer nombre. Si lo cargó con un título abreviado ("Prof. Ana López") se usa el nombre
 * completo en vez de quedar en "Prof.". Vacío → `null` (el saludo va sin nombre; nunca se deriva del correo).
 */
export function greetingName(displayName: string | null | undefined): string | null {
  const clean = (displayName ?? "").trim().replace(/\s+/g, " ");
  if (!clean) return null;
  const [first] = clean.split(" ");
  return first.endsWith(".") ? clean : first;
}

export function buildGreeting(hour: number, displayName: string | null | undefined): string {
  const name = greetingName(displayName);
  const base = greetingForHour(hour);
  return name ? `${base}, ${name}` : base;
}

/** "lunes, 5 de octubre" del día civil de hoy. */
export function homeDateLabel(todayDateKey: string): string {
  return formatCivilDayLabelShort(todayDateKey);
}

export interface FirstStep {
  id: "add-student" | "schedule-class";
  title: string;
  description: string;
  /** Texto del botón (distinto del título para no repetirlo). */
  actionLabel: string;
  done: boolean;
  /** Ruta existente, o `null` si el paso todavía no se puede hacer (se explica en `blockedReason`). */
  href: string | null;
  blockedReason: string | null;
}

export interface FirstStepsInput {
  /** Alumnos ACTIVOS: la pantalla de nueva clase sólo ofrece alumnos activos. */
  activeStudentCount: number;
  hasAnyClass: boolean;
}

/**
 * Los pasos reales para empezar. Programar una clase exige al menos un alumno activo (el formulario sólo ofrece
 * activos), por eso ese paso queda bloqueado —con el motivo— hasta que exista uno.
 */
export function buildFirstSteps({ activeStudentCount, hasAnyClass }: FirstStepsInput): FirstStep[] {
  const hasActiveStudent = activeStudentCount > 0;
  return [
    {
      id: "add-student",
      title: "Agregá tu primer alumno",
      description: "Cargá sus datos y cómo le cobrás.",
      actionLabel: "Agregar alumno",
      done: hasActiveStudent,
      href: "/alumnos/nuevo",
      blockedReason: null,
    },
    {
      id: "schedule-class",
      title: "Programá una clase",
      description: "Una clase única o una serie semanal en el calendario.",
      actionLabel: "Programar clase",
      done: hasAnyClass,
      href: hasActiveStudent ? "/calendario/nueva" : null,
      blockedReason: hasActiveStudent ? null : "Primero agregá un alumno.",
    },
  ];
}

export interface HomeWelcome {
  /** Nombre cargado en el perfil, o `null` (saludo sin nombre). */
  displayName: string | null;
  /** `null` = no se pudo determinar: Inicio no afirma que la cuenta esté vacía. */
  hasAnyClass: boolean | null;
}
