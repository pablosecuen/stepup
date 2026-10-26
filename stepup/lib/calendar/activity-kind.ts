import type { ActivityKind } from "./types.ts";

/**
 * Puerto de `calendarActivityKind.ts` (móvil) — única fuente real de
 * normalización de `ActivityKind`. Nunca se infiere de título, nivel ni
 * color en ningún otro archivo — siempre se lee el campo real
 * (`recurrence_rules.activity_kind`/`calendar_lessons.activity_kind`) y se
 * normaliza acá.
 */
export function normalizeActivityKind(value: ActivityKind | string | null | undefined): ActivityKind {
  return value === "training" ? "training" : "class";
}

/** Sólo `'class'` REVISA tareas anteriores (y por eso sólo una clase puede quedar bloqueada por una tarea sin revisar): un entrenamiento nunca bloquea. */
export function activityKindSupportsHomework(value: ActivityKind | string | null | undefined): boolean {
  return normalizeActivityKind(value) === "class";
}

/**
 * Clases Y entrenamientos pueden ASIGNAR una «Tarea para la próxima clase» (común y, en un grupo, personalizada por alumno). La tarea de un entrenamiento se
 * consulta y se revisa después igual que la de una clase (ficha del alumno y próxima clase), pero un entrenamiento sigue sin bloquearse por tareas pendientes.
 */
export function activityKindAssignsHomework(value: ActivityKind | string | null | undefined): boolean {
  return normalizeActivityKind(value) === "class" || normalizeActivityKind(value) === "training";
}

export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  class: "Clase",
  training: "Entrenamiento",
};
