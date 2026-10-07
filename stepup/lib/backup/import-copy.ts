/**
 * Textos del asistente de importación en lenguaje simple (PURO: sin React, sin red).
 *
 * El análisis y la importación hablan en términos internos (filas, tablas, componentes, ids de la app móvil, nombres de
 * columnas, «preview», «invariante»). Este módulo es la única puerta entre esos términos y lo que lee la profesora: traduce
 * etiquetas, valores, motivos y errores. Nunca deja pasar un nombre de tabla/columna, un id ni un mensaje de Postgres; lo
 * único técnico que se muestra es un código corto y estable para soporte (`Código para soporte: …`).
 */
import { formatCivilDate } from "../format/date-format.ts";
import { formatCount, formatMoney, formatPercent } from "../format/number-format.ts";
import { BACKUP_IMPORT_LIMITS } from "./limits.ts";
import { isQuotaMessage } from "../errors/quota-message.ts";

// ---------------------------------------------------------------------------
// Cantidades
// ---------------------------------------------------------------------------

/** «1 alumno» / «3 alumnos» (0 → «0 alumnos»). */
export function countOf(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Vocabulario común: las cinco palabras que se usan SIEMPRE con el mismo significado.
// ---------------------------------------------------------------------------

export const IMPORT_GLOSSARY: ReadonlyArray<{ term: string; meaning: string }> = [
  { term: "Agregar", meaning: "se crea en la web algo que todavía no existe." },
  { term: "Conservar", meaning: "ya existe en la web y queda tal cual está." },
  { term: "Reemplazar", meaning: "se cambia un dato de la web por el de la copia. Solo pasa si lo marcás vos." },
  { term: "No importar", meaning: "se deja afuera y no cambia nada." },
  { term: "Deshacer", meaning: "se revierte esta importación, por un tiempo limitado y solo si nada de lo importado se modificó ni se usó después." },
];

export const PREVIEW_VALIDITY_MINUTES = BACKUP_IMPORT_LIMITS.PREVIEW_TTL_MINUTES;

/**
 * El máximo por importación, dicho ANTES de empezar (R6): una copia más grande se rechaza al analizar, sin tocar nada. El número es el máximo de
 * `BACKUP_IMPORT_LIMITS.MAX_WORK_UNITS` (alumnos, clases, registros, cobros y sus detalles), nunca otra cifra.
 */
export const IMPORT_SIZE_LIMIT_NOTICE = {
  lead: "Hay un máximo por importación.",
  body: `Se importa de una vez una copia de hasta ${formatCount(BACKUP_IMPORT_LIMITS.MAX_WORK_UNITS)} elementos entre alumnos, clases, registros, cobros y sus detalles. Si la tuya es más grande, te lo decimos al analizar y no se cambia nada.`,
} as const;

// ---------------------------------------------------------------------------
// Datos que se pueden reemplazar: etiquetas y valores legibles
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  name: "Nombre",
  phone: "Teléfono",
  whatsapp: "WhatsApp",
  email: "Correo",
  notes: "Notas",
  birth_date: "Fecha de nacimiento",
  current_goals: "Objetivos actuales",
  strengths: "Fortalezas",
  areas_to_improve: "Aspectos a mejorar",
  alerts: "Alertas",
  usual_days: "Días habituales",
  usual_time: "Horario habitual",
  display_name: "Nombre visible",
  needs_percent: "Porcentaje para necesidades",
  wants_percent: "Porcentaje para gustos",
  savings_percent: "Porcentaje para ahorro",
  savings_goal_enabled: "Meta de ahorro activada",
  savings_goal_target_amount: "Monto de la meta de ahorro",
  savings_goal_target_date: "Fecha de la meta de ahorro",
  timezone: "Zona horaria",
  weekly_blocks: "Bloqueos semanales",
  exceptions: "Excepciones de disponibilidad",
};

const FIELD_LABEL_BY_TABLE: Record<string, Record<string, string>> = {
  custom_levels: { name: "Nombre del nivel" },
  students: { name: "Nombre del alumno" },
};

/** Nunca devuelve el nombre de la columna: lo desconocido es «Otro dato». */
export function fieldLabel(tableName: string, field: string): string {
  return FIELD_LABEL_BY_TABLE[tableName]?.[field] ?? FIELD_LABELS[field] ?? "Otro dato";
}

const EMPTY_VALUE = "vacío";
const MAX_VALUE_LENGTH = 120;

const DATE_FIELDS = new Set(["birth_date", "savings_goal_target_date"]);
const PERCENT_FIELDS = new Set(["needs_percent", "wants_percent", "savings_percent"]);

function truncate(text: string): string {
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH - 1).trimEnd()}…` : text;
}

/** Valor tal como lo lee una persona: sin JSON, sin `null`, con las fechas y los porcentajes de la app. */
export function formatFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number") {
    if (PERCENT_FIELDS.has(field)) return formatPercent(value);
    if (field === "savings_goal_target_amount") return formatMoney(value);
    return String(value);
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "") return EMPTY_VALUE;
    if (DATE_FIELDS.has(field)) return formatCivilDate(text, text);
    if (field === "savings_goal_target_amount" && Number.isFinite(Number(text))) return formatMoney(Number(text));
    if (PERCENT_FIELDS.has(field) && Number.isFinite(Number(text))) return formatPercent(Number(text));
    return truncate(text);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return EMPTY_VALUE;
    if (field === "weekly_blocks") return countOf(value.length, "bloque", "bloques");
    if (field === "exceptions") return countOf(value.length, "excepción", "excepciones");
    if (value.every((item) => typeof item === "string" || typeof item === "number")) return truncate(value.join(", "));
    return countOf(value.length, "elemento", "elementos");
  }
  return "datos con varios campos";
}

// ---------------------------------------------------------------------------
// Señales de coincidencia entre alumnos
// ---------------------------------------------------------------------------

const MATCH_SIGNAL_LABELS: Record<string, string> = { name: "el nombre", email: "el correo", phone: "el teléfono" };

/** «el nombre y el teléfono». Una señal desconocida se omite (nunca se muestra cruda). */
export function describeMatchSignals(signals: readonly string[]): string {
  const labels = signals.map((s) => MATCH_SIGNAL_LABELS[s]).filter((s): s is string => Boolean(s));
  if (labels.length === 0) return "otros datos";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} y ${labels[labels.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Series, clases, registros y cobros
// ---------------------------------------------------------------------------

/** Motivos que genera el análisis → una frase clara. Lo no reconocido cae en una frase genérica (sin ids ni tablas). */
export function translateOmissionReason(reason: string | null | undefined): string {
  const text = (reason ?? "").toLowerCase();
  if (/alumno inexistente|alumno que no|referencia a alumno/.test(text)) return "se refiere a un alumno que no está en la web ni en la copia";
  if (/acuerdo de entrenamiento/.test(text)) return "se refiere a un acuerdo de entrenamiento que no existe";
  if (/serie que no se import/.test(text)) return "pertenece a una serie que no se importa";
  if (/clase de calendario/.test(text)) return "se refiere a una clase del calendario que no existe o no se importa";
  if (/registro de clase inexistente/.test(text)) return "se refiere a un registro de clase que no existe";
  if (/ya existe en la web/.test(text)) return "ya existe en la web";
  if (/no existe ni en el backup ni en la web/.test(text)) return "depende de un dato que no está en la web ni en la copia";
  return "no se puede relacionar con el resto de los datos";
}

const FINANCIAL_LABELS: Record<string, [one: string, many: string]> = {
  payments: ["pago", "pagos"],
  payment_charges: ["cobro", "cobros"],
  payment_allocations: ["asignación de un pago a un cobro", "asignaciones de pagos a cobros"],
  payment_adjustments: ["ajuste de cobro", "ajustes de cobro"],
  initial_paid_surcharge_corrections: ["corrección de recargo", "correcciones de recargo"],
  first_month_proration_decisions: ["decisión de primer mes proporcional", "decisiones de primer mes proporcional"],
  package_purchases: ["compra de paquete", "compras de paquetes"],
  package_credit_movements: ["movimiento de paquete", "movimientos de paquetes"],
};

/** «2 pagos, 1 cobro»: el contenido de un grupo de cobros por tipo, sin ids ni nombres de tabla. */
export function describeFinancialMembers(members: ReadonlyArray<{ tableName: string }>): string {
  const counts = new Map<string, number>();
  for (const m of members) counts.set(m.tableName, (counts.get(m.tableName) ?? 0) + 1);
  const parts: string[] = [];
  let other = 0;
  for (const [table, n] of counts) {
    const label = FINANCIAL_LABELS[table];
    if (label) parts.push(countOf(n, label[0], label[1]));
    else other += n;
  }
  if (other > 0) parts.push(countOf(other, "otro dato de cobros", "otros datos de cobros"));
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Lo que no se importa en esta versión
// ---------------------------------------------------------------------------

export const EXCLUDED_COLLECTION_LABELS = {
  studentStatusHistory: "Historial de cambios de estado de los alumnos",
  studentPriceHistory: "Historial de cambios de precio de los alumnos",
  lessonRegistrationEditHistory: "Historial de ediciones de los registros de clase",
} as const;

export const EXCLUDED_COLLECTION_REASON = "Todavía no se puede importar a la web.";

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

export type ImportErrorContext = "analyze" | "apply" | "undoPreview" | "undo" | "discard" | "history";

export interface TranslatedImportError {
  /** Frase para la persona: qué pasó, qué pasó con sus datos y qué hacer. */
  message: string;
  /** Código corto y estable para soporte. Nunca contiene datos personales, ids ni nombres de tablas. */
  code: string;
}

const SESSION_ERROR = "Tu sesión venció. Volvé a iniciar sesión y probá de nuevo. No se cambió nada.";
const NETWORK_PREFIX = /^No se pudo conectar con el servidor/;
const SERVICE_MESSAGE =
  /^(No tenés permiso|Ese registro ya existe|No se pudo completar porque|Faltan datos|Los datos enviados|Hay un dato|Hay una fecha|Hay un número|Hubo un conflicto)/;

function networkMessage(context: ImportErrorContext): string {
  if (context === "apply") {
    return "Se cortó la conexión con el servidor y no sabemos si la importación llegó a completarse. Mirá el historial de importaciones antes de reintentar; si volvés a confirmar, no se duplica nada.";
  }
  if (context === "undo") {
    return "Se cortó la conexión con el servidor y no sabemos si se llegó a deshacer. Mirá el historial de importaciones antes de reintentar.";
  }
  return "No se pudo conectar con el servidor. Revisá tu conexión y volvé a intentar. No se cambió nada.";
}

/**
 * La base cortó la operación por tardar más de lo permitido (SQLSTATE 57014). Postgres revierte TODO lo que esa operación hubiera escrito y suelta
 * sus bloqueos, así que al ANALIZAR, DESHACER o REVISAR no se cambió nada; al IMPORTAR tampoco se importó nada, pero por si el corte llegó justo al
 * confirmar se manda a mirar el historial (mismo criterio que una falla de red).
 */
export function translateImportTimeout(context: ImportErrorContext): TranslatedImportError {
  if (context === "apply") {
    return {
      message:
        "La importación tardó más de lo permitido y se detuvo; no se importó nada a medias. Mirá el historial de importaciones: si no figura ahí, podés volver a intentar (si volvés a confirmar, no se duplica nada). Si se repite, avisá a soporte con el código.",
      code: "operation_timeout",
    };
  }
  if (context === "undo") {
    return {
      message: "Deshacer tardó más de lo permitido y se detuvo; no se tocó nada a medias. Mirá el historial para ver su estado antes de reintentar. Si se repite, avisá a soporte con el código.",
      code: "operation_timeout",
    };
  }
  return {
    message: "La operación tardó más de lo permitido y se detuvo. No se cambió nada. Probá de nuevo en unos minutos; si se repite, avisá a soporte con el código.",
    code: "operation_timeout",
  };
}

const GENERIC_BY_CONTEXT: Record<ImportErrorContext, string> = {
  analyze: "No pudimos analizar la copia por un problema inesperado. No se cambió nada. Probá de nuevo en unos minutos.",
  apply:
    "La importación no se completó por un problema inesperado. Mirá el historial de importaciones: si no figura ahí, no se importó nada y podés volver a intentar.",
  undoPreview: "No pudimos revisar si se puede deshacer. No se cambió nada. Probá de nuevo.",
  undo: "No pudimos deshacer la importación. Mirá el historial para ver su estado antes de reintentar.",
  discard: "No pudimos quitar la opción de deshacer. Sigue disponible: no se cambió nada.",
  history: "No pudimos cargar el historial de importaciones. No se cambió nada. Probá de nuevo en unos minutos.",
};

/**
 * Traduce el mensaje que ya normalizó `domainErrorMessage` (frases de las RPC con ids y palabras internas) a una frase útil
 * más un código de soporte. Lo que no se reconoce nunca se muestra tal cual: cae en una frase genérica del paso donde ocurrió.
 */
export function translateImportError(raw: string, context: ImportErrorContext): TranslatedImportError {
  const text = raw.trim();
  if (NETWORK_PREFIX.test(text)) return { message: networkMessage(context), code: "network_unreachable" };
  if (/No hay una sesión autenticada/i.test(text)) return { message: SESSION_ERROR, code: "session_required" };
  if (isQuotaMessage(text)) return { message: text, code: "quota_exceeded" }; // límite de cuenta (R3): el texto ya es claro
  if (/No encontramos ningún respaldo en la nube/i.test(text)) {
    return {
      message:
        "Todavía no hay una copia de seguridad en la nube para tu cuenta. Abrí la app móvil con esta misma cuenta y dejá que haga su copia automática; después volvé a intentar.",
      code: "no_cloud_backup",
    };
  }
  if (/El backup supera el tamaño máximo/i.test(text)) return validationMessage("backup_too_large");
  // R6: límites por importación que la base repite como defensa en profundidad (la web ya los controló antes de llamarla).
  if (/demasiados datos para importar de una vez/i.test(text)) return validationMessage("backup_too_many_rows");
  if (/El backup no tiene el formato esperado/i.test(text)) return validationMessage("backup_format_invalid");
  if (/El backup tiene datos repetidos/i.test(text)) return validationMessage("backup_duplicate_items");
  if (/demasiadas decisiones para confirmar/i.test(text)) {
    return {
      message:
        "Marcaste demasiadas opciones para confirmar de una vez. No se importó nada. Confirmá primero una parte (por ejemplo, los reemplazos más importantes), después analizá la copia otra vez para ver el resto.",
      code: "selection_too_large",
    };
  }

  if (/Esta importación ya fue deshecha|ya no puede deshacerse/i.test(text)) {
    return { message: "Esta importación ya fue deshecha. No hay nada más que revertir.", code: "undo_already_done" };
  }
  if (/plazo para deshacer.*venci/i.test(text)) {
    return { message: "El plazo para deshacer esta importación ya venció. Lo importado se queda como está.", code: "undo_expired" };
  }
  if (/deshacer bloqueado|tiene dependencias creadas después/i.test(text)) {
    return {
      message: "No se pudo deshacer: hay datos importados que se modificaron o se usaron después. No se cambió nada.",
      code: "undo_blocked",
    };
  }
  if (/preview de undo/i.test(text)) {
    return { message: "La revisión para deshacer venció o ya se usó. No se cambió nada: volvé a revisar si se puede deshacer.", code: "undo_review_expired" };
  }
  if (/Importación no encontrada/i.test(text)) return { message: "No encontramos esa importación. No se cambió nada.", code: "import_not_found" };

  if (/El preview (ya no es válido|no existe)/i.test(text)) {
    return {
      message: `Esta revisión ya no sirve: venció (dura ${PREVIEW_VALIDITY_MINUTES} minutos) o ya se usó. No se importó nada nuevo. Analizá la copia otra vez para ver el estado actual.`,
      code: "review_expired",
    };
  }
  if (SERVICE_MESSAGE.test(text)) return { message: text, code: "service_error" };
  if (/desactualizad|cambió desde|ya existe|Apareció una coincidencia|No se encontró en el backup/i.test(text)) {
    return {
      message:
        "Mientras revisabas, cambiaron datos en la web, y para no pisar nada la importación se frenó. No se importó nada. Analizá la copia otra vez y volvé a decidir.",
      code: "review_outdated",
    };
  }
  if (/Invariante violada/i.test(text)) {
    return {
      message: "La importación se frenó porque algunos importes o cantidades de la copia no cuadran entre sí. No se cambió nada en la web. Avisá a soporte con el código.",
      code: "integrity_check_failed",
    };
  }
  if (/Tabla |Campo |Decisión de duplicado|candidate_student_id|candidato de duplicado|no está clasificada|Override|no admite overrides/i.test(text)) {
    return {
      message: "Hubo un problema con las opciones que elegiste. No se importó nada. Analizá la copia otra vez; si se repite, avisá a soporte con el código.",
      code: "selection_invalid",
    };
  }
  return { message: GENERIC_BY_CONTEXT[context], code: "unexpected_error" };
}

function validationMessage(code: string): TranslatedImportError {
  switch (code) {
    case "backup_too_large":
      return {
        message: `La copia de seguridad es demasiado grande para importarla (el límite es ${BACKUP_IMPORT_LIMITS.MAX_PAYLOAD_BYTES / (1024 * 1024)} MB). No se cambió nada.`,
        code,
      };
    case "backup_too_many_rows":
      return {
        message: `Tu copia tiene más datos de los que se pueden importar de una sola vez (el límite es de ${formatCount(BACKUP_IMPORT_LIMITS.MAX_WORK_UNITS)} elementos entre alumnos, clases, registros, cobros y sus detalles). No se cambió nada y tu copia en la nube sigue intacta. Avisá a soporte con el código y la pasamos a la web por partes.`,
        code,
      };
    case "backup_duplicate_items":
      return {
        message:
          "La copia tiene datos repetidos y no se puede importar tal como está. No se cambió nada. Abrí la app móvil para que genere una copia nueva y volvé a intentar; si sigue igual, avisá a soporte con el código.",
        code,
      };
    case "backup_text_too_long":
      return { message: "La copia tiene un texto demasiado largo (por ejemplo, una nota). No se cambió nada. Avisá a soporte con el código.", code };
    case "backup_version_unknown":
      return {
        message: "La copia fue creada por una versión de la app que esta web todavía no reconoce. No se cambió nada. Actualizá la app móvil y esperá su próxima copia.",
        code,
      };
    default:
      return {
        message:
          "La última copia de la nube no tiene el formato esperado, así que no se puede analizar. No se cambió nada. Abrí la app móvil para que genere una copia nueva; si sigue igual, avisá a soporte con el código.",
        code: "backup_format_invalid",
      };
  }
}

const VALIDATION_CODE_MAP: Record<string, string> = {
  too_large: "backup_too_large",
  too_many_rows: "backup_too_many_rows",
  too_many_rows_total: "backup_too_many_rows",
  too_many_nested_rows: "backup_too_many_rows",
  too_much_work: "backup_too_many_rows",
  string_too_long: "backup_text_too_long",
  unknown_schema_version: "backup_version_unknown",
};

/**
 * Errores de la validación del respaldo (por su `code`, nunca por su texto ni su `path`, que nombra colecciones internas).
 * Varios errores se resumen en una sola frase; el código de soporte lista los distintos, separados por coma.
 */
export function translateValidationErrors(errors: ReadonlyArray<{ code: string }>): TranslatedImportError {
  const mapped = [...new Set(errors.map((e) => VALIDATION_CODE_MAP[e.code] ?? "backup_format_invalid"))];
  const first = validationMessage(mapped[0] ?? "backup_format_invalid");
  const extra = mapped.length > 1 ? " Además hay otros problemas en la copia: el código para soporte los lista." : "";
  return { message: `${first.message}${extra}`, code: mapped.join(", ") || first.code };
}
