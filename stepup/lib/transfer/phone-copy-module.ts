/**
 * Módulo TEMPORAL de la app para copiar los archivos del teléfono a la cuenta, y validación de lo que el teléfono informa (PURO; el canal real vive en tools/transfer/phone-copy.mjs).
 *
 * El módulo hace lo mismo que la pantalla «Protección de datos» (`runPhoneExtraction`: lee el teléfono sin borrar ni mover nada, sube cada archivo SIN pisar uno existente y lo
 * registra con la sesión de la propia cuenta del teléfono) y devuelve a la computadora SÓLO cantidades. No escribe en consola ni en ningún registro. Se borra solo al terminar.
 */

export const COPY_TEMP_MODULE = "autoCopyTemp.ts";
export const COPY_IMPORT_LINE = "import './autoCopyTemp';";

export type CopyMode = "trial" | "full" | "protection";

/**
 * Módulo temporal de SÓLO LECTURA que informa el marcador de protección de datos de la app (`@teacherflow/protection_state`): si todo lo cargado en el teléfono ya llegó al
 * respaldo de la nube. Devuelve sólo números y una fecha: nada de datos de alumnos, clases ni cobros.
 */
function buildProtectionModule({ targets, token }: { targets: string[]; token: string }): string {
  return `// TEMPORAL — lectura del marcador de protección de datos (sólo lectura). Se borra solo al terminar. Devuelve únicamente números a la computadora local.
import { createPhoneReadDeps } from './phoneExtractionDeps';

const TARGETS: readonly string[] = ${JSON.stringify(targets)};
const TOKEN = ${JSON.stringify(token)};
const MODE: 'trial' | 'full' | 'protection' = "protection";

async function send(body: string): Promise<boolean> {
  for (const base of TARGETS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(base + '/resultado/' + TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: controller.signal });
      if (response.ok) return true;
    } catch {
      // se prueba la siguiente dirección
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}

async function readProtection(): Promise<void> {
  try {
    const raw = await createPhoneReadDeps().readKey('@teacherflow/protection_state');
    const state = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    await send(JSON.stringify({ mode: MODE, protection: state ? { present: true, localRevision: num(state.localRevision), lastProtectedRevision: num(state.lastProtectedRevision), pendingFileUploads: num(state.pendingFileUploads), dirty: state.dirtySince !== null && state.dirtySince !== undefined, lastSuccessfulProtectionAt: typeof state.lastSuccessfulProtectionAt === 'string' ? state.lastSuccessfulProtectionAt : null } : { present: false } }));
  } catch {
    await send(JSON.stringify({ error: 'fallo_en_el_telefono' }));
  }
}

setTimeout(() => {
  void readProtection();
}, 6000);
`;
}

export function buildCopyModule({ targets, token, mode }: { targets: string[]; token: string; mode: CopyMode }): string {
  if (mode === "protection") return buildProtectionModule({ targets, token });
  return `// TEMPORAL — copia de los archivos del teléfono a la cuenta (no destructiva). Se borra sola al terminar. Devuelve únicamente cantidades a la computadora local.
import { runPhoneExtraction } from './phoneExtraction/runner';
import { createPhoneExtractionDeps } from './phoneExtractionDeps';

const TARGETS: readonly string[] = ${JSON.stringify(targets)};
const TOKEN = ${JSON.stringify(token)};
const MODE: 'trial' | 'full' | 'protection' = ${JSON.stringify(mode)};

async function send(path: string, body: string): Promise<boolean> {
  for (const base of TARGETS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(base + path + TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: controller.signal });
      if (response.ok) return true;
    } catch {
      // se prueba la siguiente dirección
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}

async function autoCopy(): Promise<void> {
  try {
    const deps = createPhoneExtractionDeps((done, total) => {
      if (done % 5 === 0 || done === total) void send('/progreso/', JSON.stringify({ done, total }));
    });
    if (!deps) {
      await send('/resultado/', JSON.stringify({ error: 'sin_sesion' }));
      return;
    }
    const summary = await runPhoneExtraction(deps, MODE === 'trial' ? { maxItems: 1, prefer: 'image/heic' } : {});
    await send('/resultado/', JSON.stringify({ ...summary, unreadable: summary.unreadable.length }));
  } catch {
    await send('/resultado/', JSON.stringify({ error: 'fallo_en_el_telefono' }));
  }
}

setTimeout(() => {
  void autoCopy();
}, 6000);
`;
}

export interface PhoneCopyReport {
  trial: boolean;
  complete: boolean;
  counts: Record<"lesson_attachment" | "material" | "report_pdf", { total: number; uploaded: number; alreadyThere: number; missingAtOrigin: number; failed: number }>;
  missingAtOrigin: string[];
  failed: Array<{ key: string; reason: string }>;
  actualFormats: Record<string, number>;
  gates: { pendingOperations: number; activeClassSession: boolean };
}

/** Lo que llega del teléfono es un dato externo: sólo se acepta con la forma esperada; `error` indica que el teléfono no pudo empezar. */
export function parsePhoneCopyReport(value: unknown): { ok: true; report: PhoneCopyReport } | { ok: false; error: string } {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object") return { ok: false, error: "respuesta_invalida" };
  if (typeof v.error === "string") return { ok: false, error: v.error.slice(0, 40) };
  const counts = v.counts as Record<string, Record<string, unknown>> | undefined;
  const kinds = ["lesson_attachment", "material", "report_pdf"] as const;
  if (!counts || typeof v.complete !== "boolean" || typeof v.trial !== "boolean" || !Array.isArray(v.failed) || !Array.isArray(v.missingAtOrigin)) return { ok: false, error: "respuesta_invalida" };
  for (const kind of kinds) {
    const c = counts[kind];
    if (!c || ["total", "uploaded", "alreadyThere", "missingAtOrigin", "failed"].some((k) => typeof c[k] !== "number")) return { ok: false, error: "respuesta_invalida" };
  }
  return {
    ok: true,
    report: {
      trial: v.trial,
      complete: v.complete,
      counts: counts as PhoneCopyReport["counts"],
      missingAtOrigin: (v.missingAtOrigin as unknown[]).filter((x): x is string => typeof x === "string"),
      failed: (v.failed as Array<Record<string, unknown>>).map((f) => ({ key: String(f.key ?? "?"), reason: String(f.reason ?? "?") })),
      actualFormats: (v.actualFormats as Record<string, number>) ?? {},
      gates: (v.gates as PhoneCopyReport["gates"]) ?? { pendingOperations: 0, activeClassSession: false },
    },
  };
}

export interface PhoneProtectionReport {
  /** ¿El teléfono tiene marcador de protección? (una app sin cambios guardados todavía puede no tenerlo). */
  present: boolean;
  localRevision: number;
  lastProtectedRevision: number;
  pendingFileUploads: number;
  /** Hay una racha de cambios todavía sin confirmar por el servidor. */
  dirty: boolean;
  lastSuccessfulProtectionAt: string | null;
}

/** Informe del marcador de protección del teléfono (dato externo: sólo se acepta con la forma esperada). */
export function parsePhoneProtectionReport(value: unknown): { ok: true; report: PhoneProtectionReport } | { ok: false; error: string } {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object") return { ok: false, error: "respuesta_invalida" };
  if (typeof v.error === "string") return { ok: false, error: v.error.slice(0, 40) };
  const p = v.protection as Record<string, unknown> | undefined;
  if (!p || typeof p.present !== "boolean") return { ok: false, error: "respuesta_invalida" };
  if (!p.present) return { ok: true, report: { present: false, localRevision: 0, lastProtectedRevision: 0, pendingFileUploads: 0, dirty: false, lastSuccessfulProtectionAt: null } };
  const nums = ["localRevision", "lastProtectedRevision", "pendingFileUploads"] as const;
  if (nums.some((k) => typeof p[k] !== "number") || typeof p.dirty !== "boolean") return { ok: false, error: "respuesta_invalida" };
  return {
    ok: true,
    report: {
      present: true,
      localRevision: p.localRevision as number,
      lastProtectedRevision: p.lastProtectedRevision as number,
      pendingFileUploads: p.pendingFileUploads as number,
      dirty: p.dirty as boolean,
      lastSuccessfulProtectionAt: typeof p.lastSuccessfulProtectionAt === "string" ? p.lastSuccessfulProtectionAt : null,
    },
  };
}
