/**
 * Módulo TEMPORAL de la app para copiar los archivos del teléfono a la cuenta, y validación de lo que el teléfono informa (PURO; el canal real vive en tools/transfer/phone-copy.mjs).
 *
 * El módulo hace lo mismo que la pantalla «Protección de datos» (`runPhoneExtraction`: lee el teléfono sin borrar ni mover nada, sube cada archivo SIN pisar uno existente y lo
 * registra con la sesión de la propia cuenta del teléfono) y devuelve a la computadora SÓLO cantidades. No escribe en consola ni en ningún registro. Se borra solo al terminar.
 */

export const COPY_TEMP_MODULE = "autoCopyTemp.ts";
export const COPY_IMPORT_LINE = "import './autoCopyTemp';";

export type CopyMode = "trial" | "full" | "protection" | "diagnostic";

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

function describeError(error: unknown): string {
  const e = error as { name?: unknown; message?: unknown } | null;
  return (String(e?.name ?? 'Error') + ': ' + String(e?.message ?? error)).replace(/file:[^ ]*/g, '<ruta>').slice(0, 200);
}

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
  } catch (error) {
    await send(JSON.stringify({ error: 'fallo_en_el_telefono', detail: describeError(error) }));
  }
}

setTimeout(() => {
  void readProtection();
}, 6000);
`;
}

/**
 * Módulo temporal de DIAGNÓSTICO (no sube ni cambia nada): ejecuta uno por uno los pasos de la copia sobre el primer archivo (sesión, usuario, plan, lista de reportes, lectura del archivo, formato,
 * huella SHA-256 y una función de lectura de la cuenta) y devuelve, por paso, si funcionó o el mensaje del error (sin rutas ni datos).
 */
function buildDiagnosticModule({ targets, token }: { targets: string[]; token: string }): string {
  return `// TEMPORAL — diagnóstico de la copia (no sube ni cambia nada). Se borra solo al terminar.
import { buildExtractionPlan, DEVICE_LOCAL_KEYS, KEYS } from './phoneExtraction/plan';
import { sniffKind } from './phoneExtraction/sniff';
import { createPhoneExtractionDeps } from './phoneExtractionDeps';

const TARGETS: readonly string[] = ${JSON.stringify(targets)};
const TOKEN = ${JSON.stringify(token)};
const MODE: 'trial' | 'full' | 'protection' | 'diagnostic' = "diagnostic";

function describeError(error: unknown): string {
  const e = error as { name?: unknown; message?: unknown } | null;
  return (String(e?.name ?? 'Error') + ': ' + String(e?.message ?? error)).replace(/file:[^ ]*/g, '<ruta>').slice(0, 200);
}

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

async function diagnose(): Promise<void> {
  const steps: Array<{ step: string; ok: boolean; detail: string }> = [];
  const run = async (step: string, fn: () => Promise<string>) => {
    try {
      steps.push({ step, ok: true, detail: await fn() });
    } catch (error) {
      steps.push({ step, ok: false, detail: describeError(error) });
    }
  };
  const deps = createPhoneExtractionDeps();
  steps.push({ step: 'sesion', ok: deps !== null, detail: deps ? 'hay cliente de la cuenta' : 'no hay cliente de la cuenta en el teléfono' });
  if (deps) {
    await run('usuario', async () => ((await deps.ownerId()) ? 'sesión con usuario' : 'SIN usuario'));
    await run('funcion_de_lectura', async () => {
      const r = await deps.rpc('get_transfer_state', {});
      return r.error ? 'error: ' + r.error.message.slice(0, 120) : 'responde';
    });
    await run('reportes', async () => String((await deps.listReports()).length) + ' reportes');
    let first: { uri: string; mimeType: string } | null = null;
    await run('plan', async () => {
      const device: Record<string, string | null> = {};
      for (const key of DEVICE_LOCAL_KEYS) device[key] = await deps.readKey(key);
      const plan = buildExtractionPlan({ lessonsRaw: await deps.readKey(KEYS.lessons), reportsRaw: await deps.readKey(KEYS.reports), materialsRaw: await deps.readKey(KEYS.materials), deviceLocal: device });
      first = plan.items.find((i) => i.mimeType === 'image/heic') ?? plan.items[0] ?? null;
      return String(plan.items.length) + ' archivos en el plan';
    });
    if (first) {
      const item = first as { uri: string; mimeType: string };
      let bytes: Uint8Array | null = null;
      await run('info_del_archivo', async () => {
        const info = await deps.fileInfo(item.uri);
        return info.exists ? 'existe, ' + String(info.size) + ' bytes' : 'NO existe';
      });
      await run('lectura_del_archivo', async () => {
        bytes = await deps.readBytes(item.uri);
        return String(bytes.length) + ' bytes leídos, formato ' + sniffKind(bytes);
      });
      if (bytes) {
        const read = bytes as Uint8Array;
        await run('huella_sha256', async () => {
          const hex = await deps.sha256Hex(read);
          return 'huella de ' + String(hex.length) + ' caracteres';
        });
        await run('copia_para_subir', async () => {
          const copy = read.buffer.slice(read.byteOffset, read.byteOffset + read.byteLength);
          return 'ArrayBuffer de ' + String(copy.byteLength) + ' bytes';
        });
      }
    }
  }
  await send(JSON.stringify({ mode: MODE, diagnostic: steps }));
}

setTimeout(() => {
  void diagnose();
}, 6000);
`;
}

export function buildCopyModule({ targets, token, mode }: { targets: string[]; token: string; mode: CopyMode }): string {
  if (mode === "diagnostic") return buildDiagnosticModule({ targets, token });
  if (mode === "protection") return buildProtectionModule({ targets, token });
  return `// TEMPORAL — copia de los archivos del teléfono a la cuenta (no destructiva). Se borra sola al terminar. Devuelve únicamente cantidades a la computadora local.
import { runPhoneExtraction } from './phoneExtraction/runner';
import { createPhoneExtractionDeps } from './phoneExtractionDeps';

const TARGETS: readonly string[] = ${JSON.stringify(targets)};
const TOKEN = ${JSON.stringify(token)};
const MODE: 'trial' | 'full' | 'protection' = ${JSON.stringify(mode)};

function describeError(error: unknown): string {
  const e = error as { name?: unknown; message?: unknown } | null;
  return (String(e?.name ?? 'Error') + ': ' + String(e?.message ?? error)).replace(/file:[^ ]*/g, '<ruta>').slice(0, 200);
}

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
  } catch (error) {
    await send('/resultado/', JSON.stringify({ error: 'fallo_en_el_telefono', detail: describeError(error) }));
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
  if (typeof v.error === "string") return { ok: false, error: v.error.slice(0, 40) + (typeof v.detail === "string" ? ` (${v.detail.slice(0, 200)})` : "") };
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
  if (typeof v.error === "string") return { ok: false, error: v.error.slice(0, 40) + (typeof v.detail === "string" ? ` (${v.detail.slice(0, 200)})` : "") };
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

export interface PhoneDiagnosticStep {
  step: string;
  ok: boolean;
  detail: string;
}

/** Informe del diagnóstico del teléfono (dato externo: sólo se acepta con la forma esperada). */
export function parsePhoneDiagnosticReport(value: unknown): { ok: true; steps: PhoneDiagnosticStep[] } | { ok: false; error: string } {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object") return { ok: false, error: "respuesta_invalida" };
  if (typeof v.error === "string") return { ok: false, error: v.error.slice(0, 40) };
  if (!Array.isArray(v.diagnostic)) return { ok: false, error: "respuesta_invalida" };
  return { ok: true, steps: (v.diagnostic as Array<Record<string, unknown>>).map((x) => ({ step: String(x.step ?? "?").slice(0, 40), ok: x.ok === true, detail: String(x.detail ?? "").slice(0, 240) })) };
}
