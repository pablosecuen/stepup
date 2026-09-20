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

/** Sólo `'class'` admite el sistema de tareas académicas — un entrenamiento nunca. */
export function activityKindSupportsHomework(value: ActivityKind | string | null | undefined): boolean {
  return normalizeActivityKind(value) === "class";
}

export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  class: "Clase",
  training: "Entrenamiento",
};
