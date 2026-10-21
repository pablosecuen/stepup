import { DESTINATION_TABLES, compareTransfer } from "../backup/transfer-compare.ts";
import { validateBackupPayload } from "../backup/validation.ts";
import { readTable } from "../db/read.ts";
import { exportDestination, isMissingTableError, TABLES_ADDED_BY_TRANSFER_MIGRATIONS } from "./export-destination.ts";
import { describeBackupAge } from "./backup-age.ts";
import { diffOrigins } from "./origin-delta.ts";
import { checkImportPreview } from "./import-preview-check.ts";
import { checkStorageCapacity, describeCapacity, MINIMUM_PLAN_QUOTA_BYTES } from "./storage-capacity.ts";
import { verifyStoredFiles, type StorageReadClient } from "./stored-files.ts";
import type { PhoneCopyReport, PhoneProtectionReport } from "./phone-copy-module.ts";

/**
 * Orquestador del traslado (pasos 1 a 7 del plan): UNA sola sesión de la cuenta —las credenciales entran una vez y sólo viven en la memoria del proceso— que encadena
 * respaldo → espera de migraciones → archivo permanente → importación con cotejo y vuelta atrás automática → copia de archivos del teléfono con verificación de integridad
 * → copia final actualizada y cotejo final. Todo es REANUDABLE: cada fase mira primero qué hay en la cuenta (nunca confía sólo en su propio registro), así que repetir la
 * ejecución tras una interrupción no duplica ni pierde datos.
 *
 * Nunca congela el origen, nunca borra respaldos ni archivos del origen y nunca imprime nombres, teléfonos ni importes: sólo identificadores, nombres de campo y cantidades.
 * Las dependencias llegan inyectadas (cliente, reloj, cifrado de copias, teléfono) para probar el circuito completo contra un destino aislado con datos sintéticos.
 */

export type Row = Record<string, unknown>;

export interface TransferClient extends StorageReadClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string; code?: string } | null }> & any;
}

export interface Session {
  client: TransferClient;
  ownerId: string;
  /** Vuelve a iniciar sesión con las credenciales que siguen SÓLO en la memoria del proceso (sin pedirlas otra vez). */
  reauthenticate(): Promise<void>;
}

export interface CopyReceipt {
  file: string;
  bytes: number;
}

export interface PhoneChannel {
  run(mode: "trial" | "full", options: { timeoutMs: number }): Promise<{ state: "listo"; report: PhoneCopyReport } | { state: "error"; error: string } | { state: "sin_respuesta" }>;
  /** Lectura (sólo lectura) del marcador de protección de datos del teléfono: ¿todo lo cargado ya llegó al respaldo de la nube? */
  checkProtection?(options: { timeoutMs: number }): Promise<{ state: "listo"; protection: PhoneProtectionReport } | { state: "error"; error: string } | { state: "sin_respuesta" }>;
}

export interface TransferState {
  version: 1;
  backups: Array<{ label: string; at: string; originChecksum: string }>;
  archive?: { at: string; total: number };
  import?: { runId: string; originChecksum: string; appliedAt: string; verifiedAt?: string };
  files?: { trialVerifiedAt?: string; fullVerifiedAt?: string };
  protection?: { at: string; localRevision: number; lastProtectedRevision: number };
  final?: { at: string; complete: boolean };
}
export interface StateStore {
  read(): TransferState;
  write(state: TransferState): void;
}

export interface TransferDeps {
  session: Session;
  state: StateStore;
  now(): Date;
  log(line: string): void;
  sleep(ms: number): Promise<void>;
  /** Cifra (DPAPI), escribe y comprueba la recuperación desde el disco. Nunca pisa un archivo. */
  saveCopy(kind: "origin" | "destination", label: string, document: unknown): CopyReceipt;
  phone: PhoneChannel;
  schemaWaitMs?: number;
  schemaPollMs?: number;
  phoneTimeoutMs?: number;
  /** Puerta que se abre desde afuera (el despliegue de la web verificado): espera hasta que se abra o se agote el tiempo. Sin puerta, la fase no espera. */
  waitGate?: (name: "despliegue", timeoutMs: number) => Promise<boolean>;
  gateWaitMs?: number;
  protectionWaitMs?: number;
  protectionRetryMs?: number;
  quotaBytes?: number;
  /** Sólo para pruebas: se ejecuta justo después de aplicar la importación; si devuelve un origen distinto, el cotejo inmediato se hace contra ése (simula un defecto de la importación y comprueba la vuelta atrás). */
  afterApplyHook?: (origin: OriginDocument) => Promise<OriginDocument | void>;
}

export interface PhaseResult {
  ok: boolean;
  /** Motivo por el que se frena el circuito (en lenguaje simple). */
  blocker?: string;
}

const isAuthExpired = (e: unknown): boolean => {
  const o = (e ?? {}) as { status?: number; code?: string; message?: string; kind?: string };
  // `exportDestination` convierte cualquier error de lectura en un ExportAbortError: «permission» cubre una sesión caducada.
  return o.kind === "permission" || o.status === 401 || o.code === "PGRST301" || o.code === "PGRST303" || /jwt (is )?expired|invalid jwt|token is expired/i.test(o.message ?? "");
};

/** Ejecuta una operación; si la sesión caducó, vuelve a iniciar sesión (con las credenciales en memoria) y la repite UNA vez. */
async function withSession<T>(deps: TransferDeps, op: (client: TransferClient, ownerId: string) => Promise<T>): Promise<T> {
  try {
    return await op(deps.session.client, deps.session.ownerId);
  } catch (error) {
    if (!isAuthExpired(error)) throw error;
    deps.log("La sesión caducó: se vuelve a iniciar con las credenciales ya ingresadas (no se piden otra vez).");
    await deps.session.reauthenticate();
    return op(deps.session.client, deps.session.ownerId);
  }
}

function firstRow<T>(data: unknown): T | null {
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as T | null;
}

async function rpc<T = any>(deps: TransferDeps, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  return withSession(deps, async (client) => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw Object.assign(new Error(`${fn}: ${error.message}`), { code: error.code, status: (error as { status?: number }).status });
    return data as T;
  });
}

export interface OriginDocument {
  kind: "origin";
  takenAt: string;
  cloudBackup: { id: string; schemaVersion: number; appVersion: string | null; checksum: string; createdAt: string };
  payload: Record<string, unknown>;
}

export async function fetchOrigin(deps: TransferDeps): Promise<OriginDocument> {
  const row = firstRow<{ id: string; schema_version: number; app_version: string | null; checksum: string; created_at: string; payload: Record<string, unknown> }>(await rpc(deps, "fetch_own_latest_cloud_backup"));
  if (!row) throw new Error("La cuenta no tiene ningún respaldo en la nube.");
  return { kind: "origin", takenAt: deps.now().toISOString(), cloudBackup: { id: row.id, schemaVersion: row.schema_version, appVersion: row.app_version, checksum: row.checksum, createdAt: row.created_at }, payload: row.payload };
}

async function dumpDestination(deps: TransferDeps) {
  return withSession(deps, (client, ownerId) => exportDestination(client, ownerId, DESTINATION_TABLES));
}

const pad = (n: number) => String(n).padStart(2, "0");
export const stampOf = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

function patchState(deps: TransferDeps, patch: (s: TransferState) => void): TransferState {
  const state = deps.state.read();
  patch(state);
  deps.state.write(state);
  return state;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Paso 1 y paso 7 (copia final): copias cifradas del ORIGEN (último respaldo de la nube) y del DESTINO (lo que tiene la web). Sólo lectura.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function backupPhase(deps: TransferDeps, label: "previa" | "final" | "importada"): Promise<PhaseResult & { origin?: OriginDocument }> {
  const origin = await fetchOrigin(deps);
  const exported = await dumpDestination(deps);
  const destination = { kind: "destination", takenAt: deps.now().toISOString(), schema: exported.schema, unavailable: exported.unavailable, tables: exported.tables };
  const o = deps.saveCopy("origin", label, origin);
  const d = deps.saveCopy("destination", label, destination);
  const rows = Object.values(exported.tables).reduce((n, r) => n + r.length, 0);
  deps.log(`Copias ${label} verificadas (cifradas, recuperación comprobada desde el disco): origen ${o.bytes} bytes · destino ${rows} filas en ${Object.keys(exported.tables).length} tablas (esquema ${exported.schema}).`);
  const age = describeBackupAge(origin.cloudBackup.createdAt, deps.now());
  if (age) deps.log(age.message);
  patchState(deps, (s) => s.backups.push({ label, at: deps.now().toISOString(), originChecksum: origin.cloudBackup.checksum }));
  return { ok: true, origin };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Espera de las migraciones (pasos 2 a 4 los hace quien despliega): se detecta que el esquema ya tiene todo lo del traslado.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Sólo funciones SIN argumentos y de sólo lectura: el servicio real responde «no existe» (PGRST202) a una función con argumentos obligatorios llamada sin ellos, aunque exista. Las demás funciones
// del traslado se crean en las mismas migraciones que las tablas que ya se comprueban arriba (el resto de las fases falla con un mensaje claro si alguna faltara).
const REQUIRED_RPCS = ["get_transfer_state"];

export async function probeSchema(deps: TransferDeps): Promise<{ ready: boolean; missing: string[] }> {
  const missing: string[] = [];
  for (const table of [...TABLES_ADDED_BY_TRANSFER_MIGRATIONS, "legacy_cloud_backup_archive", "account_transfer_state"]) {
    const { error } = await withSession(deps, async (client) => client.from(table).select("*").limit(1));
    if (error && isMissingTableError(error)) missing.push(table);
  }
  for (const fn of REQUIRED_RPCS) {
    // Una llamada SIN argumentos: si la función existe, falla por sus argumentos (o responde); si NO existe, el servicio dice que no la encuentra (PGRST202 / 42883).
    const { error } = await withSession(deps, async (client) => client.rpc(fn, {}));
    const code = (error as { code?: string } | null)?.code;
    if (error && (code === "PGRST202" || code === "42883" || /could not find the function|does not exist/i.test(error.message))) missing.push(`función ${fn}`);
  }
  return { ready: missing.length === 0, missing };
}

export async function waitSchemaPhase(deps: TransferDeps): Promise<PhaseResult> {
  const deadline = deps.now().getTime() + (deps.schemaWaitMs ?? 3 * 3_600_000);
  let last = "";
  for (;;) {
    const probe = await probeSchema(deps);
    if (probe.ready) {
      deps.log("El esquema de la cuenta ya tiene todo lo del traslado (migraciones aplicadas).");
      return { ok: true };
    }
    const message = `Esperando las migraciones del traslado (faltan: ${probe.missing.join(", ")}).`;
    if (message !== last) deps.log(message);
    last = message;
    if (deps.now().getTime() >= deadline) return { ok: false, blocker: `Pasó el tiempo de espera y todavía faltan migraciones: ${probe.missing.join(", ")}.` };
    await deps.sleep(deps.schemaPollMs ?? 15_000);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Paso 3: archivo permanente de los respaldos de la nube (sólo agrega). Se repite en el paso 7 para incluir el último.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function archivePhase(deps: TransferDeps): Promise<PhaseResult> {
  const origin = await fetchOrigin(deps);
  const archived = await rpc<{ archived_now: number; archived_total: number }>(deps, "archive_legacy_cloud_backups");
  const rows = await withSession(deps, (client, ownerId) => readTable<{ checksum: string }>(client, "legacy_cloud_backup_archive", { columns: "id, checksum", filter: (q) => q.eq("owner_id", ownerId) }));
  if (!rows.some((r) => r.checksum === origin.cloudBackup.checksum)) return { ok: false, blocker: "El último respaldo de la nube no quedó en el archivo permanente." };
  patchState(deps, (s) => (s.archive = { at: deps.now().toISOString(), total: archived.archived_total }));
  deps.log(`Archivo permanente de los respaldos: ${archived.archived_now} nuevo(s) · ${archived.archived_total} en total · el último respaldo ya está archivado.`);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Pausa de carga: antes de tomar la copia que se importa (y la final) se comprueba, LEYENDO EL TELÉFONO (sólo lectura), que todo lo cargado ya llegó al respaldo de la nube.
// La app lleva un marcador persistente: «revisión local» (crece con cada cambio) y «última revisión protegida» (la que el servidor confirmó). Se exige que sean iguales.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function protectionPhase(deps: TransferDeps): Promise<PhaseResult> {
  if (!deps.phone.checkProtection) return { ok: true };
  const deadline = deps.now().getTime() + (deps.protectionWaitMs ?? 30 * 60_000);
  let last = "";
  for (;;) {
    const r = await deps.phone.checkProtection({ timeoutMs: 90_000 });
    let message = "";
    if (r.state === "listo") {
      const p = r.protection;
      if (!p.present) {
        deps.log("El teléfono no tiene marcador de protección (no registra cambios sin respaldar): se sigue con el último respaldo de la nube.");
        patchState(deps, (s) => (s.protection = { at: deps.now().toISOString(), localRevision: 0, lastProtectedRevision: 0 }));
        return { ok: true };
      }
      if (p.localRevision > p.lastProtectedRevision || p.dirty) message = `El teléfono tiene cambios todavía SIN respaldar en la nube (revisión ${p.localRevision}, respaldada hasta la ${p.lastProtectedRevision}). Dejá Expo Go abierto y desbloqueado: TeacherFlow sube solo el respaldo; no cargues nada nuevo.`;
      else {
        deps.log(`Pausa de carga verificada: el teléfono confirma que todo lo cargado ya está respaldado en la nube (revisión ${p.localRevision}${p.pendingFileUploads > 0 ? `; ${p.pendingFileUploads} archivo(s) por subir, que se copian en el paso 6` : ""}).`);
        patchState(deps, (s) => (s.protection = { at: deps.now().toISOString(), localRevision: p.localRevision, lastProtectedRevision: p.lastProtectedRevision }));
        return { ok: true };
      }
    } else if (r.state === "error") message = `No se pudo leer el estado de protección del teléfono (${r.error}). Abrí Expo Go con el teléfono desbloqueado.`;
    else message = "Abrí Expo Go en el teléfono (desbloqueado y en pantalla) para confirmar que todo lo cargado ya está respaldado en la nube.";
    if (message !== last) deps.log(message);
    last = message;
    if (deps.now().getTime() >= deadline) return { ok: false, blocker: `No se pudo confirmar que el respaldo de la nube tenga TODO lo cargado en el teléfono. ${message} No se importó nada; se puede repetir.` };
    await deps.sleep(deps.protectionRetryMs ?? 10_000);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Paso 5: importación con la copia MÁS RECIENTE, cotejo inmediato y vuelta atrás automática si algo no coincide.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface RunRow {
  id: string;
  status: string;
  undone_at: string | null;
  created_at: string;
}

async function appliedRuns(deps: TransferDeps): Promise<RunRow[]> {
  const rows = await withSession(deps, (client, ownerId) => readTable<RunRow>(client, "import_runs", { columns: "id, status, undone_at, created_at", filter: (q) => q.eq("owner_id", ownerId) }));
  return rows.filter((r) => r.status === "applied" && !r.undone_at);
}

export async function undoImport(deps: TransferDeps, runId: string): Promise<{ ok: boolean; reason?: string }> {
  const preview = firstRow<{ undo_preview_id: string; is_safe: boolean; unsafe_rows?: Array<{ table_name?: string; reason?: string }> }>(await rpc(deps, "preview_undo_backup_import", { p_import_run_id: runId }));
  if (!preview?.is_safe) {
    const kinds = [...new Set((preview?.unsafe_rows ?? []).map((r) => `${r.table_name ?? "?"}: ${r.reason ?? "?"}`))].slice(0, 6);
    return { ok: false, reason: `Deshacer la importación NO es seguro (hay datos nuevos que dependen de ella${kinds.length ? `; ${kinds.join("; ")}` : ""}): no se toca nada.` };
  }
  await rpc(deps, "apply_undo_backup_import", { p_undo_preview_id: preview.undo_preview_id });
  return { ok: true };
}

export interface Verification {
  ok: boolean;
  differences: number;
  balanced: boolean;
  fieldChecks: number;
  mismatchedFields: number;
  reasons: string[];
  filesPending: number;
  absentVerified: boolean;
  complete: boolean;
}

/** Cotejo origen ↔ destino ACTUAL (lectura nueva de la cuenta). «Defectos» = todo lo que no sea archivos del teléfono. */
export async function verifyAgainstOrigin(deps: TransferDeps, origin: OriginDocument): Promise<Verification> {
  const validation = validateBackupPayload(origin.payload);
  const omitted = validation.adaptation?.omitted ?? [];
  const exported = await dumpDestination(deps);
  const result = compareTransfer(origin.payload, exported.tables, { adapterOmitted: omitted });
  const reasons = result.verdict.reasons.filter((r) => !r.startsWith("Archivos"));
  const rc = result.reconciliation;
  const balanced = rc.balanced && rc.sourceRows === rc.omittedByAdapter + rc.expectedRows && rc.expectedRows === rc.foundRows + rc.missingRows;
  const mismatched = result.fields.filter((f) => f.mismatched > 0).length;
  const pending = result.files.reduce((n, f) => n + f.pending, 0);
  return { ok: reasons.length === 0 && balanced && exported.unavailable.length === 0, differences: reasons.length, balanced, fieldChecks: result.summary.fieldChecks, mismatchedFields: mismatched, reasons, filesPending: pending, absentVerified: Boolean(result.verdict.absentAtOriginVerified), complete: result.verdict.complete };
}

export async function importPhase(deps: TransferDeps, options: { redo?: boolean } = {}): Promise<PhaseResult> {
  let runs = await appliedRuns(deps);
  if (runs.length > 0 && options.redo) {
    const reportsWithPdf = (await withSession(deps, (client, ownerId) => readTable<{ pdf_url: string | null }>(client, "report_records", { columns: "id, pdf_url", filter: (q) => q.eq("owner_id", ownerId) }))).filter((r) => r.pdf_url).length;
    for (const run of runs) {
      const undone = await undoImport(deps, run.id);
      if (!undone.ok) return { ok: false, blocker: undone.reason };
    }
    deps.log("Importación anterior deshecha (la cuenta quedó sin lo importado) para volver a importar con la copia más reciente.");
    // Los PDF de reportes se guardan bajo el identificador del reporte, que es NUEVO al reimportar: se vuelven a subir y la copia anterior queda como archivo huérfano (inofensivo; no se borra nada).
    if (reportsWithPdf > 0) deps.log(`AVISO: ${reportsWithPdf} PDF de reporte(s) se volverán a subir con su identificador nuevo; las copias anteriores quedan en el almacenamiento como archivos huérfanos (no se borran; el reparador de huérfanos las limpia más adelante).`);
    runs = [];
  }
  const fresh = await backupPhase(deps, "importada");
  const origin = fresh.origin as OriginDocument;
  if (runs.length > 0) {
    // Reanudación: ya hay una importación aplicada (p. ej. el proceso se cortó antes de anotarla). NO se vuelve a importar: se comprueba contra la copia más reciente.
    deps.log("Ya hay una importación aplicada en la cuenta: no se importa de nuevo; se comprueba contra el último respaldo.");
    const check = await verifyAgainstOrigin(deps, origin);
    if (!check.ok) return { ok: false, blocker: `La cuenta ya tiene una importación, pero NO coincide con el último respaldo (${check.reasons.slice(0, 3).join(" · ") || "balance que no cierra"}). Rehacerla con la copia más reciente requiere --rehacer.` };
    patchState(deps, (s) => (s.import = { runId: runs[0].id, originChecksum: origin.cloudBackup.checksum, appliedAt: runs[0].created_at, verifiedAt: deps.now().toISOString() }));
    return { ok: true };
  }

  const validation = validateBackupPayload(origin.payload);
  if (!validation.ok) return { ok: false, blocker: `El respaldo no valida (${[...new Set(validation.errors.map((e) => e.code))].join(", ")}).` };
  const omitted = validation.adaptation?.omitted.length ?? 0;
  const preview = firstRow<{ preview_id: string; classification: unknown }>(await rpc(deps, "preview_backup_import", { p_payload: validation.backup, p_excluded_collections: validation.excludedCollections }));
  if (!preview) return { ok: false, blocker: "La vista previa de la importación no devolvió nada." };
  const check = checkImportPreview(preview.classification, omitted);
  deps.log(`Vista previa: ${check.studentsToAdd} alumno(s) a agregar · ${check.conflicts} conflicto(s) · ${check.duplicates} posible(s) duplicado(s) · ${check.notInsertable.length} fila(s) que no se agregan · ${omitted} omitida(s) por el adaptador.`);
  if (!check.ok) return { ok: false, blocker: `La vista previa no está limpia: ${check.reasons.join(" ")}` };

  const applied = firstRow<{ import_run_id: string; summary: { total_rows_written?: number } }>(await rpc(deps, "apply_backup_import", { p_preview_id: preview.preview_id, p_field_overrides: [], p_duplicate_decisions: [] }));
  if (!applied) return { ok: false, blocker: "La importación no devolvió su identificador." };
  deps.log(`Importación aplicada: ${applied.summary?.total_rows_written ?? "?"} filas escritas.`);
  patchState(deps, (s) => (s.import = { runId: applied.import_run_id, originChecksum: origin.cloudBackup.checksum, appliedAt: deps.now().toISOString() }));
  const hooked = await deps.afterApplyHook?.(origin);

  const verification = await verifyAgainstOrigin(deps, hooked ?? origin);
  deps.log(`Cotejo inmediato: ${verification.fieldChecks} campos comparados · ${verification.mismatchedFields} con diferencias · balance ${verification.balanced ? "CIERRA" : "NO CIERRA"} · ${verification.differences} defecto(s).`);
  if (!verification.ok) {
    const undone = await undoImport(deps, applied.import_run_id);
    patchState(deps, (s) => delete s.import);
    return { ok: false, blocker: `El cotejo encontró diferencias (${verification.reasons.slice(0, 3).join(" · ") || "balance que no cierra"}). ${undone.ok ? "La importación se DESHIZO automáticamente: la cuenta quedó como estaba." : `NO se pudo deshacer: ${undone.reason}`}` };
  }
  patchState(deps, (s) => {
    if (s.import) s.import.verifiedAt = deps.now().toISOString();
  });
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Paso 6: copia de los archivos del teléfono (1 archivo → todos), capacidad de almacenamiento y verificación de integridad desde la computadora.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function capacityPhase(deps: TransferDeps): Promise<PhaseResult> {
  const attachments = await withSession(deps, (client, ownerId) => readTable<{ size_bytes: number | string | null; stored_size_bytes: number | string | null; file_status: string }>(client, "lesson_attachments", { columns: "id, size_bytes, stored_size_bytes, file_status", filter: (q) => q.eq("owner_id", ownerId) }));
  const materials = await withSession(deps, (client, ownerId) => readTable<{ attachment_size_bytes: number | string | null; stored_size_bytes: number | string | null; file_status: string }>(client, "material_library_items", { columns: "id, attachment_size_bytes, stored_size_bytes, file_status", filter: (q) => q.eq("owner_id", ownerId) }));
  const reports = await withSession(deps, (client, ownerId) => readTable<{ pdf_url: string | null }>(client, "report_records", { columns: "id, pdf_url", filter: (q) => q.eq("owner_id", ownerId) }));
  const pendingSizes = [...attachments.filter((a) => a.file_status === "pendiente").map((a) => Number(a.size_bytes ?? 0)), ...materials.filter((m) => m.file_status === "pendiente").map((m) => Number(m.attachment_size_bytes ?? 0))];
  const used = attachments.filter((a) => a.file_status === "disponible").reduce((n, a) => n + Number(a.stored_size_bytes ?? 0), 0) + materials.filter((m) => m.file_status === "disponible").reduce((n, m) => n + Number(m.stored_size_bytes ?? 0), 0) + reports.filter((r) => r.pdf_url).length * 10 * 1024 * 1024;
  const verdict = checkStorageCapacity({ requiredBytes: pendingSizes.reduce((n, x) => n + x, 0), usedBytes: used, largestFileBytes: pendingSizes.reduce((m, x) => Math.max(m, x), 0), quotaBytes: deps.quotaBytes ?? MINIMUM_PLAN_QUOTA_BYTES });
  deps.log(describeCapacity(verdict));
  return verdict.ok ? { ok: true } : { ok: false, blocker: verdict.reasons.join(" ") };
}

async function integrityStep(deps: TransferDeps, label: string): Promise<{ ok: boolean; line: string; pending: number; absent: number }> {
  const result = await withSession(deps, (client, ownerId) => verifyStoredFiles(client, ownerId));
  const line = `Integridad (${label}): ${result.registered} archivo(s) registrados · ${result.verified} verificados por huella, tamaño y formato · ${result.problems.length} con problemas · ${result.pending.length} pendientes · ${result.absent.length} ausentes declarados · ${result.duplicateIds.length} identificadores repetidos.`;
  deps.log(line);
  return { ok: result.problems.length === 0 && result.duplicateIds.length === 0, line, pending: result.pending.length, absent: result.absent.length };
}

export async function filesPhase(deps: TransferDeps): Promise<PhaseResult> {
  const timeoutMs = deps.phoneTimeoutMs ?? 30 * 60_000;
  const capacity = await capacityPhase(deps);
  if (!capacity.ok) return capacity;

  if (!deps.state.read().files?.trialVerifiedAt) {
    deps.log("Prueba previa en el teléfono con UN archivo (se prefieren las fotos HEIC)…");
    const trial = await deps.phone.run("trial", { timeoutMs });
    if (trial.state === "sin_respuesta") return { ok: false, blocker: "El teléfono no respondió a la prueba con un archivo (¿bloqueado o sin conexión?). No se subió nada de más: se puede repetir." };
    if (trial.state === "error") return { ok: false, blocker: `El teléfono no pudo hacer la prueba (${trial.error}).` };
    const r = trial.report;
    const copied = r.counts.lesson_attachment.uploaded + r.counts.lesson_attachment.alreadyThere + r.counts.material.uploaded + r.counts.material.alreadyThere;
    if (!r.trial || r.failed.length > 0 || copied !== 1) return { ok: false, blocker: `La prueba con un archivo no salió bien (${r.failed.map((f) => f.reason).join(", ") || `copiados: ${copied}`}).` };
    const integrity = await integrityStep(deps, "prueba");
    if (!integrity.ok) return { ok: false, blocker: "El archivo de prueba no pasó la verificación de integridad." };
    patchState(deps, (s) => (s.files = { ...(s.files ?? {}), trialVerifiedAt: deps.now().toISOString() }));
  } else deps.log("La prueba con un archivo ya estaba verificada: se sigue con la copia completa.");

  deps.log("Copia completa de los archivos del teléfono (tiene que seguir desbloqueado y con Expo Go abierto)…");
  const full = await deps.phone.run("full", { timeoutMs });
  if (full.state === "sin_respuesta") return { ok: false, blocker: "El teléfono dejó de responder durante la copia. Lo ya copiado quedó a salvo y NO se duplica: al repetir sigue donde quedó." };
  if (full.state === "error") return { ok: false, blocker: `El teléfono no pudo hacer la copia (${full.error}).` };
  const r = full.report;
  const total = (k: "uploaded" | "alreadyThere" | "missingAtOrigin" | "failed") => r.counts.lesson_attachment[k] + r.counts.material[k] + r.counts.report_pdf[k];
  deps.log(`El teléfono informa: ${total("uploaded")} subidos · ${total("alreadyThere")} que ya estaban · ${total("missingAtOrigin")} ausentes · ${total("failed")} fallidos.`);
  if (r.trial || r.failed.length > 0) return { ok: false, blocker: `La copia no terminó bien: ${r.failed.slice(0, 5).map((f) => `${f.key} (${f.reason})`).join(", ")}. Se puede repetir: lo ya copiado no se duplica.` };
  const integrity = await integrityStep(deps, "copia completa");
  if (!integrity.ok) return { ok: false, blocker: "Algún archivo copiado NO pasó la verificación de integridad (ver arriba)." };
  if (integrity.pending > 0) return { ok: false, blocker: `Quedan ${integrity.pending} archivo(s) pendientes que no se copiaron ni se declararon ausentes.` };
  patchState(deps, (s) => (s.files = { ...(s.files ?? {}), fullVerifiedAt: deps.now().toISOString() }));
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Paso 7: copia final actualizada + archivo permanente + cambios posteriores a la copia importada + cotejo final. NO congela nada.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface FinalReport extends PhaseResult {
  complete: boolean;
  lines: string[];
}

export async function finalPhase(deps: TransferDeps): Promise<FinalReport> {
  const lines: string[] = [];
  const say = (line: string) => {
    lines.push(line);
    deps.log(line);
  };
  // La copia final sólo vale si TODO lo cargado en el teléfono ya llegó al respaldo de la nube.
  const protectedNow = await protectionPhase(deps);
  if (!protectedNow.ok) return { ok: false, complete: false, blocker: protectedNow.blocker, lines };
  const fresh = await backupPhase(deps, "final");
  const origin = fresh.origin as OriginDocument;
  const archived = await archivePhase(deps);
  if (!archived.ok) return { ok: false, complete: false, blocker: archived.blocker, lines };

  const imported = deps.state.read().import;
  if (imported && imported.originChecksum !== origin.cloudBackup.checksum) {
    const before = await withSession(deps, (client, ownerId) => readTable<{ payload: Record<string, unknown> }>(client, "legacy_cloud_backup_archive", { columns: "id, payload", filter: (q) => q.eq("owner_id", ownerId).eq("checksum", imported.originChecksum) }));
    const delta = before[0] ? diffOrigins(before[0].payload, origin.payload) : null;
    // La app puede subir un respaldo nuevo sin que haya datos nuevos (cambia la huella, no el contenido): sólo importa si el CONTENIDO cambió.
    if (!delta || delta.hasChanges) {
      say(`CAMBIOS POSTERIORES: TeacherFlow anterior subió un respaldo nuevo después de la copia importada${delta ? ` (${delta.totals.added} nuevos, ${delta.totals.changed} cambiados, ${delta.totals.removed} quitados)` : " y no se pudo comparar con la copia importada"}.`);
      return { ok: false, complete: false, blocker: "Se cargaron datos en TeacherFlow anterior DESPUÉS de la copia importada. Hay que incorporarlos antes de cerrar: repetir con --rehacer (deshace la importación y vuelve a importar la copia más reciente). Nada se congeló ni se borró.", lines };
    }
    say("Hay un respaldo más nuevo en la nube pero con los MISMOS datos que la copia importada: no hay nada que incorporar.");
  }

  const verification = await verifyAgainstOrigin(deps, origin);
  say(`Cotejo final con la copia final: ${verification.fieldChecks} campos comparados · ${verification.mismatchedFields} con diferencias · balance ${verification.balanced ? "CIERRA" : "NO CIERRA"} · ${verification.differences} defecto(s).`);
  const integrity = await integrityStep(deps, "final");
  lines.push(integrity.line);
  const complete = verification.complete && verification.ok && integrity.ok && integrity.pending === 0 && verification.absentVerified;
  say(`VEREDICTO: ${complete ? "COMPLETO" : "NO COMPLETO"}${integrity.absent > 0 ? ` · ${integrity.absent} archivo(s) AUSENTES declarados (el teléfono ya no los tenía), nunca contados como migrados` : ""}${!verification.absentVerified ? " · ausentes sin comprobar (falta el resultado del teléfono)" : ""}.`);
  for (const reason of verification.reasons) say(`  - ${reason}`);
  patchState(deps, (s) => (s.final = { at: deps.now().toISOString(), complete }));
  say("El origen NO se congeló ni se borró nada. Congelarlo requiere tu confirmación posterior.");
  return { ok: verification.ok && integrity.ok, complete, lines };
}

export type PhaseName = "backup" | "esquema" | "archivo" | "despliegue" | "proteccion" | "importar" | "archivos" | "final";
export const ALL_PHASES: PhaseName[] = ["backup", "esquema", "archivo", "despliegue", "proteccion", "importar", "archivos", "final"];

/** Paso 4: no se importa hasta que quien despliega la web confirma que quedó funcionando (la importación sigue al despliegue, como en el plan). */
export async function deployGatePhase(deps: TransferDeps): Promise<PhaseResult> {
  if (!deps.waitGate) return { ok: true };
  deps.log("Esperando la confirmación de que la web quedó desplegada y verificada…");
  const open = await deps.waitGate("despliegue", deps.gateWaitMs ?? 3 * 3_600_000);
  return open ? { ok: true } : { ok: false, blocker: "Pasó el tiempo de espera sin la confirmación del despliegue de la web. No se importó nada; se puede repetir." };
}

/** Corre las fases en orden y se detiene en la primera que no pueda continuar. */
export async function runTransfer(deps: TransferDeps, options: { phases?: PhaseName[]; redo?: boolean } = {}): Promise<{ ok: boolean; completed: PhaseName[]; blocker?: string; final?: FinalReport }> {
  const completed: PhaseName[] = [];
  let final: FinalReport | undefined;
  for (const phase of options.phases ?? ALL_PHASES) {
    deps.log(`── ${phase} ──`);
    let result: PhaseResult;
    if (phase === "backup") result = await backupPhase(deps, "previa");
    else if (phase === "esquema") result = await waitSchemaPhase(deps);
    else if (phase === "archivo") result = await archivePhase(deps);
    else if (phase === "despliegue") result = await deployGatePhase(deps);
    else if (phase === "proteccion") result = await protectionPhase(deps);
    else if (phase === "importar") result = await importPhase(deps, { redo: options.redo });
    else if (phase === "archivos") result = await filesPhase(deps);
    else {
      final = await finalPhase(deps);
      result = final;
    }
    if (!result.ok) return { ok: false, completed, blocker: result.blocker, final };
    completed.push(phase);
  }
  return { ok: true, completed, final };
}
