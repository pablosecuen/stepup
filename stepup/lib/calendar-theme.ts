// Paleta y reglas visuales del calendario — copiadas TAL CUAL de TeacherFlow
// móvil (`src/features/calendar/utils/calendarVisualLegend.ts` +
// `src/theme/colors.ts`). Esta escala está CONGELADA en el proyecto móvil —
// esta web la REPLICA, nunca la reinventa ni la modifica.

export type LessonModality = "presencial" | "online" | "mixta";
export type LessonStatus = "scheduled" | "cancelled" | "completed" | "rescheduled";
export type ActivityKind = "class" | "training";

export const MODALITY_COLORS: Record<LessonModality, { bg: string; border: string }> = {
  online: { bg: "#DDEEFF", border: "#2D6F91" },
  presencial: { bg: "#FCE4D2", border: "#A85A2A" },
  mixta: { bg: "#E9DDFC", border: "#67458F" },
};

export const MODALITY_LABELS: Record<LessonModality, string> = {
  presencial: "Presencial",
  online: "Online",
  mixta: "Mixta",
};

export const MODALITY_SHORT_LABELS: Record<LessonModality, string> = {
  presencial: "Pres.",
  online: "Online",
  mixta: "Mixta",
};

// Cancelada: siempre gana sobre cualquier otro color, sin importar si ya pasó.
export const CANCELLED_COLORS = {
  bg: "#FFF1B8",
  border: "#D99100",
  textPrimary: "#7A4B00",
  textSecondary: "#9A6200",
};

// Transcurrida (no cancelada, hora de fin <= ahora): gris fijo, prioridad
// sobre modalidad y sobre reemplazo activo.
export const ELAPSED_COLORS = {
  bg: "#D1D5DB",
  border: "#4B5563",
  textPrimary: "#374151",
  textSecondary: "#4B5563",
};

// Reemplazo activo de una clase cancelada (futuro, válido): coral exclusivo
// — nunca verde/violeta/azul/naranja/rojo de errores.
export const REPLACEMENT_COLORS = { bg: "#FCE8E6", border: "#D96C68" };

export const CURRENT_TIME_COLOR = "#E53935";

export const STATUS_LABELS: Record<LessonStatus, string> = {
  scheduled: "Programada",
  cancelled: "Cancelada",
  completed: "Completada",
  rescheduled: "Reprogramada",
};

/**
 * Resuelve el color de una tarjeta — misma prioridad EXACTA que
 * `resolveLessonCardPalette` en la app móvil:
 *   1) cancelada siempre gana;
 *   2) si no está cancelada y ya transcurrió (fin <= ahora), gris fijo —
 *      incluso un reemplazo activo cuya hora ya pasó se pone gris, nunca
 *      sigue coral;
 *   3) si no, reemplazo activo -> coral; si no, color de modalidad.
 * "Completada"/"Reprogramada" conservan el color de su modalidad real — se
 * diferencian sólo con la etiqueta, nunca con un color propio (regla
 * congelada, ver comentario original en calendarVisualLegend.ts).
 */
export function resolveLessonColors(input: {
  status: LessonStatus;
  modality: LessonModality;
  isElapsed: boolean;
  isActiveReplacement: boolean;
}): { bg: string; border: string; textPrimary?: string; textSecondary?: string } {
  if (input.status === "cancelled") return CANCELLED_COLORS;
  if (input.isElapsed) return ELAPSED_COLORS;
  if (input.isActiveReplacement) return REPLACEMENT_COLORS;
  return MODALITY_COLORS[input.modality];
}
