/**
 * Lógica PURA del contenido propio de una clase registrada (temas, objetivos, actividades, notas, materiales y archivos adjuntos): lo que la profesora
 * cargó en la clase y que la importación del traslado lleva a la web. Separada del I/O (`lesson-content.ts`) para probarse con `node --test`.
 */

export interface LessonContentRegistrationRow {
  topics?: unknown;
  objectives?: unknown;
  activities?: unknown;
  activity_notes?: string | null;
  internal_notes?: string | null;
  material_ids?: unknown;
  is_billable?: boolean | null;
  consumes_monthly_package?: boolean | null;
}

export interface LessonAttachmentRow {
  id: string;
  name: string;
  kind: string;
  caption: string | null;
  student_id: string | null;
  size_bytes: number | null;
  file_status: string;
}

export interface MaterialRow {
  id: string;
  legacy_mobile_id: string;
  name: string;
  note: string | null;
  attachment_name: string | null;
  attachment_kind: string | null;
  file_status: string;
}

/** Una fila de la biblioteca de materiales (para elegir y agregar materiales en el registro de una clase). */
export interface LibraryMaterial {
  id: string;
  legacyId: string;
  name: string;
  note: string | null;
  hasFile: boolean;
  availability: FileAvailability | "sin_archivo";
}

export interface LibraryMaterialRow extends MaterialRow {
  created_at: string | null;
}

export type FileAvailability = "disponible" | "pendiente" | "no_disponible";

export interface LessonTopic {
  id: string | null;
  text: string;
  status: "planificado" | "visto";
}

export interface LessonContentAttachment {
  id: string;
  name: string;
  kind: "pdf" | "image";
  caption: string | null;
  /** null = común a toda la clase; si no, el alumno al que pertenece. */
  studentId: string | null;
  availability: FileAvailability;
}

export interface LessonContentMaterial {
  /** Identificador del material en la web (para abrir su archivo); null si todavía no está en la biblioteca. */
  id: string | null;
  legacyId: string;
  name: string;
  note: string | null;
  hasFile: boolean;
  availability: FileAvailability | "sin_archivo";
  /** Material que la clase usó pero que no está en la biblioteca (todavía no se trasladó). */
  inLibrary: boolean;
}

export interface LessonContent {
  topics: LessonTopic[];
  objectives: string[];
  activities: string[];
  activityNotes: string;
  internalNotes: string;
  materials: LessonContentMaterial[];
  attachments: LessonContentAttachment[];
  isBillable: boolean;
  consumesMonthlyPackage: boolean;
}

const textList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);

function availabilityOf(status: string): FileAvailability {
  return status === "disponible" ? "disponible" : status === "no_disponible" ? "no_disponible" : "pendiente";
}

function toTopics(value: unknown): LessonTopic[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (entry === null || typeof entry !== "object") return [];
    const t = entry as Record<string, unknown>;
    const text = typeof t.text === "string" ? t.text.trim() : "";
    if (text === "") return [];
    return [{ id: typeof t.id === "string" ? t.id : null, text, status: t.status === "visto" ? ("visto" as const) : ("planificado" as const) }];
  });
}

/** `null` si la clase no tiene nada de este contenido (así la pantalla no muestra una tarjeta vacía). */
export function toLessonContent(row: LessonContentRegistrationRow, attachments: LessonAttachmentRow[], materialsInLibrary: MaterialRow[]): LessonContent | null {
  const library = new Map(materialsInLibrary.map((m) => [m.legacy_mobile_id, m]));
  const materials: LessonContentMaterial[] = textList(row.material_ids).map((legacyId) => {
    const m = library.get(legacyId);
    if (!m) return { id: null, legacyId, name: "Material sin identificar", note: null, hasFile: false, availability: "pendiente" as const, inLibrary: false };
    const hasFile = m.attachment_name !== null && m.file_status !== "sin_archivo";
    return { id: m.id, legacyId, name: m.name, note: m.note && m.note.trim() !== "" ? m.note : null, hasFile, availability: hasFile ? availabilityOf(m.file_status) : ("sin_archivo" as const), inLibrary: true };
  });
  const content: LessonContent = {
    topics: toTopics(row.topics),
    objectives: textList(row.objectives),
    activities: textList(row.activities),
    activityNotes: (row.activity_notes ?? "").trim(),
    internalNotes: (row.internal_notes ?? "").trim(),
    materials,
    attachments: attachments.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind === "image" ? ("image" as const) : ("pdf" as const),
      caption: a.caption && a.caption.trim() !== "" ? a.caption : null,
      studentId: a.student_id,
      availability: availabilityOf(a.file_status),
    })),
    isBillable: row.is_billable !== false,
    consumesMonthlyPackage: row.consumes_monthly_package !== false,
  };
  const empty =
    content.topics.length === 0 &&
    content.objectives.length === 0 &&
    content.activities.length === 0 &&
    content.activityNotes === "" &&
    content.internalNotes === "" &&
    content.materials.length === 0 &&
    content.attachments.length === 0 &&
    content.isBillable &&
    content.consumesMonthlyPackage;
  return empty ? null : content;
}

/** Biblioteca en el orden en que se fue armando (igual que la app anterior): primero los materiales más antiguos. */
export function toMaterialLibrary(rows: readonly LibraryMaterialRow[]): LibraryMaterial[] {
  return [...rows]
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.name.localeCompare(b.name))
    .map((m) => {
      const hasFile = m.attachment_name !== null && m.file_status !== "sin_archivo";
      return { id: m.id, legacyId: m.legacy_mobile_id, name: m.name, note: m.note && m.note.trim() !== "" ? m.note : null, hasFile, availability: hasFile ? availabilityOf(m.file_status) : ("sin_archivo" as const) };
    });
}

/** Texto en lenguaje simple del estado de un archivo (nunca sólo un color). */
export function availabilityLabel(a: FileAvailability | "sin_archivo"): string {
  switch (a) {
    case "disponible":
      return "Archivo disponible";
    case "pendiente":
      return "El archivo todavía no se trasladó";
    case "no_disponible":
      return "El archivo ya no existía en el origen";
    case "sin_archivo":
      return "Sólo texto, sin archivo";
  }
}
