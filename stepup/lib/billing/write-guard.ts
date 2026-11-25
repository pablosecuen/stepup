/**
 * Guarda de ESCRITURAS del modo limitado — PURA (sin entorno ni red). Es la regla que el SERVIDOR aplica a cada pedido que la aplicación hace a Supabase
 * cuando el control de acceso está encendido (`BILLING_ENFORCEMENT_ENABLED`): la cuenta limitada puede ver, exportar, pagar, cancelar, contactar a soporte,
 * iniciar sesión y eliminar su cuenta, pero NO crear ni modificar información operativa (alumnos, clases, cobros a alumnos, reportes…).
 *
 * Por qué acá y no sólo en la interfaz: ocultar un botón no protege nada (una acción del servidor se puede invocar sin pasar por la pantalla). Todos los
 * cambios de datos de la web salen por el cliente de Supabase del servidor (`createSupabaseServerClient`), así que se decide en UN solo punto: el
 * `fetch` de ese cliente (ver `enforcement.ts`). El navegador no habla con Supabase para datos (sólo la sesión), así que no hay otro camino.
 *
 * Reglas (FALLA CERRADO: lo que no se reconoce como lectura o como una escritura permitida se bloquea):
 *   - `GET`/`HEAD`/`OPTIONS`: lectura, siempre pasa.
 *   - `/auth/v1/…`: la sesión (ingresar, renovar, cambiar clave, cerrar sesión) siempre pasa.
 *   - `/rest/v1/rpc/<función>`: sólo pasan las funciones de `LIMITED_MODE_RPC` (lecturas que PostgREST expone como POST, la sesión del dispositivo y la
 *     eliminación de la propia cuenta). Cualquier otra —incluida una nueva que nadie clasificó— se bloquea.
 *   - `/rest/v1/<tabla>` con `POST/PATCH/PUT/DELETE`: sólo pasan las tablas de `LIMITED_MODE_TABLE_WRITES` (preferencias de uso).
 *   - `/storage/v1/…`: pasan las URL firmadas de DESCARGA, el listado y el borrado (eliminar la cuenta limpia sus archivos); subir se bloquea.
 *   - cualquier otro origen o ruta que no es de Supabase no es asunto de esta guarda.
 * Las funciones `billing_*` usan el cliente de servicio del almacén de facturación (otro cliente): no pasan por acá.
 */

import { LIMITED_MODE_USER_MESSAGE } from "../errors/limited-mode-message.ts";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Lecturas que PostgREST expone como POST, sesión del dispositivo, cuota de acciones y eliminación de la propia cuenta. */
export const LIMITED_MODE_RPC: ReadonlySet<string> = new Set([
  // lecturas / vistas previas (no escriben)
  "calendar_agenda_stamp",
  "list_open_charge_balances",
  "list_pending_report_pdf_cleanup_jobs",
  "fetch_own_latest_cloud_backup",
  "financial_reconciliation_snapshot",
  "get_transfer_state",
  "preview_backup_import",
  "preview_student_deletion",
  "preview_undo_backup_import",
  // sesión del dispositivo (sin esto no se puede ni entrar)
  "claim_web_device",
  "touch_web_device",
  "end_web_device",
  "end_active_session",
  // cuota de acciones (limitador; no es información operativa) y eliminar la propia cuenta
  "consume_action_quota",
  "delete_own_account",
]);

/** Funciones que la web llama pero que se definen FUERA de las migraciones de este repositorio (el proyecto de Supabase conserva funciones de una etapa anterior, la app Expo del repositorio original). */
export const RPC_DEFINED_OUTSIDE_THIS_REPO: ReadonlySet<string> = new Set(["end_active_session", "delete_own_account"]);

/** Tablas donde una cuenta limitada puede seguir escribiendo: preferencias de uso (no es información operativa). */
export const LIMITED_MODE_TABLE_WRITES: ReadonlySet<string> = new Set(["teacher_interaction_preferences"]);

/** Funciones de la base que la aplicación llama y que CAMBIAN datos operativos: se bloquean en modo limitado. Existe para que una prueba estructural obligue a clasificar toda función nueva. */
export const WRITE_RPC: ReadonlySet<string> = new Set([
  "add_lesson_attachment", "add_material_library_item", "adjust_calendar_schedule", "apply_backup_import", "apply_financial_reconciliation",
  "apply_recurrence_participants_from_date", "apply_undo_backup_import", "archive_legacy_cloud_backups", "archive_student_and_prune_future",
  "cancel_calendar_occurrence", "change_calendar_lesson_participants", "change_lesson_registration_outcome", "change_student_monthly_amount",
  "change_student_status", "claim_report_draft", "configure_training_billing", "convert_calendar_activity", "correct_live_class_start",
  "correct_registered_session", "create_calendar_lesson", "create_recurrence_series", "create_recurrence_series_replacing", "create_student_with_operation",
  "delete_cancelled_calendar_lesson", "delete_report_record", "delete_student_permanently", "discard_import_undo", "discard_live_class",
  "dismiss_calendar_replacement_notice", "edit_calendar_lesson", "edit_completed_lesson_registration", "edit_recurrence_class_title",
  "edit_recurrence_future_with_end", "edit_training_billing_fee", "end_recurrence_series_from_date", "ensure_monthly_charges", "ensure_periodic_charges",
  "ensure_training_charges", "extend_calendar_lesson_duration", "finalize_lesson_registration", "finish_live_class", "import_phone_extraction",
  "mark_current_month_paid", "mark_transfer_file_unavailable", "reactivate_student_with_billing", "record_phone_extraction_result",
  "record_student_level_achievement", "register_payment", "register_transfer_file", "remove_lesson_attachment", "rename_custom_level",
  "reschedule_calendar_occurrence", "reschedule_calendar_replacing", "resolve_registration_billing", "resolve_report_pdf_cleanup_job",
  "restore_calendar_occurrence", "resume_monthly_billing", "save_lesson_content_draft", "save_participant_registration", "set_lesson_attachment_caption",
  "set_recurrence_series_end", "set_student_billing_plan", "split_recurrence_ending_segments", "split_recurrence_this_and_future", "start_lesson_registration",
  "start_live_class", "start_new_report_draft", "swap_recurrence_patterns", "sync_per_class_charge", "void_charge", "void_payment",
]);

/** Funciones internas de la base (ayudantes SQL, facturación con cliente de servicio) que aparecen nombradas en el código pero NO pasan por el cliente de la persona. */
export const NOT_USER_CLIENT_RPC_PREFIXES: readonly string[] = ["billing_"];
export const NOT_USER_CLIENT_RPC: ReadonlySet<string> = new Set(["_import_check_payload", "calendar_lesson_occupies_slot", "lesson_billed_amount", "lesson_hourly_amount"]);

/**
 * CUENTA BLOQUEADA (terminó la prueba o el período pagado sin un pago aprobado): NO es sólo lectura. Con la cuenta bloqueada el servidor tampoco LEE datos operativos: sólo pasan la
 * sesión, lo imprescindible para entrar y salir (dispositivo, cuota de acciones, eliminar la propia cuenta), el perfil y las preferencias de uso (la pantalla de Configuración),
 * la propia facturación y el listado/borrado de archivos (eliminar la cuenta los limpia). Todo lo demás —incluida una tabla o función nueva que nadie clasificó— se bloquea.
 */
export const BLOCKED_MODE_RPC: ReadonlySet<string> = new Set(["claim_web_device", "touch_web_device", "end_web_device", "end_active_session", "consume_action_quota", "delete_own_account"]);
export const BLOCKED_MODE_READ_TABLES: ReadonlySet<string> = new Set(["teacher_profiles", "teacher_interaction_preferences", "web_device_sessions", "billing_subscriptions", "billing_periods", "billing_plans"]);
export const BLOCKED_MODE_WRITE_TABLES: ReadonlySet<string> = new Set(["teacher_interaction_preferences"]);

/** ¿Un pedido a Supabase puede hacerlo una cuenta BLOQUEADA? Falla cerrado. Lo que no es de Supabase o es de la sesión (`/auth/v1/`) siempre pasa. */
export function allowedWhenBlocked(input: { readonly method: string; readonly url: string; readonly supabaseOrigin: string }): boolean {
  let url: URL;
  let origin: URL;
  try {
    url = new URL(input.url);
    origin = new URL(input.supabaseOrigin);
  } catch {
    return true;
  }
  if (url.origin !== origin.origin) return true;
  const method = input.method.toUpperCase();
  const path = url.pathname;
  if (path.startsWith("/auth/v1/")) return true;
  const rpc = /^\/rest\/v1\/rpc\/([A-Za-z0-9_]+)\/?$/.exec(path);
  if (rpc) return BLOCKED_MODE_RPC.has(rpc[1]);
  const table = /^\/rest\/v1\/([A-Za-z0-9_]+)\/?$/.exec(path);
  if (table) return READ_METHODS.has(method) ? BLOCKED_MODE_READ_TABLES.has(table[1]) : BLOCKED_MODE_WRITE_TABLES.has(table[1]);
  if (path.startsWith("/storage/v1/")) return method === "DELETE" || /^\/storage\/v1\/object\/list\//.test(path) || path === "/storage/v1/object/list";
  return false;
}

export interface RequestVerdict {
  /** ¿Cambia datos (o no se puede asegurar que no los cambie)? */
  readonly writes: boolean;
  /** ¿Puede hacerlo una cuenta en modo limitado? */
  readonly allowedInLimitedMode: boolean;
  readonly reason: string;
}

const PASS: RequestVerdict = { writes: false, allowedInLimitedMode: true, reason: "pass" };

export function classifyRequest(input: { readonly method: string; readonly url: string; readonly supabaseOrigin: string }): RequestVerdict {
  let url: URL;
  let origin: URL;
  try {
    url = new URL(input.url);
    origin = new URL(input.supabaseOrigin);
  } catch {
    return PASS; // no es un pedido a una dirección interpretable: no es de Supabase
  }
  if (url.origin !== origin.origin) return PASS;
  const method = input.method.toUpperCase();
  const path = url.pathname;
  if (path.startsWith("/auth/v1/")) return { ...PASS, reason: "auth" };
  if (READ_METHODS.has(method)) return { ...PASS, reason: "read" };

  const rpc = /^\/rest\/v1\/rpc\/([A-Za-z0-9_]+)\/?$/.exec(path);
  if (rpc) {
    const name = rpc[1];
    return LIMITED_MODE_RPC.has(name) ? { writes: false, allowedInLimitedMode: true, reason: `rpc_allowed:${name}` } : { writes: true, allowedInLimitedMode: false, reason: `rpc_blocked:${name}` };
  }
  const table = /^\/rest\/v1\/([A-Za-z0-9_]+)\/?$/.exec(path);
  if (table) {
    return LIMITED_MODE_TABLE_WRITES.has(table[1]) ? { writes: true, allowedInLimitedMode: true, reason: `table_allowed:${table[1]}` } : { writes: true, allowedInLimitedMode: false, reason: `table_blocked:${table[1]}` };
  }
  if (path.startsWith("/storage/v1/")) {
    if (method === "DELETE") return { writes: true, allowedInLimitedMode: true, reason: "storage_delete" };
    if (/^\/storage\/v1\/object\/(sign|list|info)\//.test(path) || path === "/storage/v1/object/list" || path === "/storage/v1/object/sign") return { writes: false, allowedInLimitedMode: true, reason: "storage_read" };
    return { writes: true, allowedInLimitedMode: false, reason: "storage_blocked" };
  }
  return { writes: true, allowedInLimitedMode: false, reason: "unknown_write" }; // falla cerrado
}

/** Mensaje que ve la persona (y que viaja en la respuesta 403 simulada). Lenguaje simple, sin términos técnicos; fuente única en `lib/errors/limited-mode-message.ts`. */
export const LIMITED_MODE_MESSAGE = LIMITED_MODE_USER_MESSAGE;
