import type { LessonTopic } from "../repositories/lesson-content-mapping.ts";

export interface PedagogicalContentInput {
  topics: LessonTopic[];
  objectives: string[];
  activities: string[];
  activityNotes: string;
  internalNotes: string;
  /** Materiales de la biblioteca usados en la clase (por su identificador de biblioteca). Si falta, el guardado no toca los materiales. */
  materialIds?: string[];
  isBillable?: boolean;
  consumesMonthlyPackage?: boolean;
}

export function validatePedagogicalContent(value: unknown): value is PedagogicalContentInput {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return Array.isArray(c.topics) && c.topics.every((t) =>
    t && typeof t === "object" && typeof t.text === "string" && t.text.trim() !== "" &&
    (t.id === null || typeof t.id === "string") && (t.status === "planificado" || t.status === "visto")
  ) && [c.objectives, c.activities].every((list) => Array.isArray(list) && list.every((s) => typeof s === "string" && s.trim() !== "")) &&
    typeof c.activityNotes === "string" && typeof c.internalNotes === "string" &&
    (c.materialIds === undefined || (Array.isArray(c.materialIds) && c.materialIds.every((m) => typeof m === "string" && m.trim() !== "" && m.length <= 80))) &&
    (c.isBillable === undefined || typeof c.isBillable === "boolean") &&
    (c.consumesMonthlyPackage === undefined || typeof c.consumesMonthlyPackage === "boolean");
}

/** The RPC payload used by both first registration and audited editing. */
export function pedagogicalContentPayload(content: PedagogicalContentInput): Record<string, unknown> {
  if (!validatePedagogicalContent(content)) throw new Error("Revisá el contenido pedagógico de la clase.");
  return {
    topics: content.topics.map((t) => ({ ...t })),
    objectives: [...content.objectives],
    activities: [...content.activities],
    activity_notes: content.activityNotes,
    internal_notes: content.internalNotes,
    ...(content.materialIds !== undefined ? { material_ids: [...new Set(content.materialIds)] } : {}),
    ...(content.isBillable !== undefined ? { is_billable: content.isBillable } : {}),
    ...(content.consumesMonthlyPackage !== undefined ? { consumes_monthly_package: content.consumesMonthlyPackage } : {}),
  };
}
