// M1 — Mutaciones del dominio de facturación (lib/billing). Rompe a propósito cada regla (estado, importe, moneda, plan, propietaria,
// orden temporal, idempotencia, gracia, cancelación, acceso, verificación de avisos, secretos…) en una COPIA del código y exige que la
// batería de pruebas unitarias falle. Una mutación que sobrevive es una regla sin prueba.
//
//   node supabase/tests/billing/domain_mutations.mjs            (todas las mutaciones; debe detectarlas a todas)
//   node supabase/tests/billing/domain_mutations.mjs --list     (sólo lista)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const TESTS = ["plans-money", "state-machine", "ledger", "access", "reconcile", "webhook-ingest", "mobbex-adapter", "commands", "log", "rpc-store"].map((name) => `lib/billing/__tests__/${name}.test.ts`);

/** [descripción, archivo, texto a buscar, reemplazo] */
export const MUTATIONS = [
  // Gracia, períodos y fechas civiles de Argentina
  ["la gracia dura 6 días en lugar de 5", "lib/billing/periods.ts", "export const GRACE_DAYS = 5;", "export const GRACE_DAYS = 6;"],
  ["el fin de la gracia se corre un día (D+5 en lugar de D+6)", "lib/billing/periods.ts", "addDaysToDateKey(civilDayOf(dueAtIso), GRACE_DAYS + 1)", "addDaysToDateKey(civilDayOf(dueAtIso), GRACE_DAYS)"],
  ["el día civil se toma de UTC (el texto del instante recortado)", "lib/billing/periods.ts", "() => getLocalDateKey(instantIso, BILLING_TIME_ZONE)", "() => instantIso.slice(0, 10)"],
  ["la memoización del día civil mezcla instantes distintos (la clave es sólo el mes)", "lib/billing/periods.ts", "memoized(dayOfCache, instantIso,", "memoized(dayOfCache, instantIso.slice(0, 7),"],
  ["la memoización de las 00:00 mezcla días distintos", "lib/billing/periods.ts", "memoized(dayStartCache, dateKey,", "memoized(dayStartCache, dateKey.slice(0, 7),"],
  ["se pierde el ajuste de fin de mes (31/01 + 1 mes)", "lib/billing/periods.ts", "const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));", "const targetDay = day;"],
  ["un período dura un mes de más", "lib/billing/periods.ts", "civilDayStartIso(addMonthsToDateKey(startKey, months))", "civilDayStartIso(addMonthsToDateKey(startKey, months + 1))"],
  ["una fecha civil inexistente (30/02) se acepta", "lib/billing/periods.ts", "parts.day > daysInMonth(parts.year, parts.month)", "parts.day > 31"],
  // Catálogo e importes
  ["el precio mensual cambia por un centavo", "lib/billing/plans.ts", "amountMinor: 2_490_000,", "amountMinor: 2_490_001,"],
  ["el plan anual usa un intervalo de proveedor equivocado", "lib/billing/plans.ts", 'providerInterval: "1y",', 'providerInterval: "12m",'],
  ["el plan trimestral compra 2 meses de acceso", "lib/billing/plans.ts", "monthsOfAccess: 3,", "monthsOfAccess: 2,"],
  ["la validación contra el catálogo ignora la moneda", "lib/billing/plans.ts", 'if (input.currency !== plan.currency) return { ok: false, reason: "currency_mismatch" };', ""],
  ["la validación contra el catálogo ignora el importe", "lib/billing/plans.ts", " || input.amountMinor !== plan.amountMinor", ""],
  ["se acepta un código de plan con cualquier mayúscula/prototipo", "lib/billing/plans.ts", 'return typeof value === "string" && (PLAN_CODES as readonly string[]).includes(value);', 'return typeof value === "string" && value.length > 0;'],
  ["los centavos pierden el relleno (5 → 0.5)", "lib/billing/money.ts", 'String(cents).padStart(2, "0")', "String(cents)"],
  ["el importe del proveedor admite 3 decimales", "lib/billing/money.ts", "(?:\\.(\\d{1,2}))?", "(?:\\.(\\d{1,3}))?"],
  ["la comisión efectiva usa 3,9 % sin IVA", "lib/billing/commission.ts", "export const EFFECTIVE_FEE_PER_100_000 = 4_719;", "export const EFFECTIVE_FEE_PER_100_000 = 3_900;"],
  // Máquina de estados
  ["una cuenta cancelada puede revivir con un cobro", "lib/billing/state-machine.ts", "canceled: {\n    checkout_started: [\"pending\"],", "canceled: {\n    payment_confirmed: [\"active\"],\n    checkout_started: [\"pending\"],"],
  ["se puede cambiar de plan desde limited", "lib/billing/state-machine.ts", "limited: {\n    payment_confirmed: [\"active\"],", "limited: {\n    plan_change_requested: [\"limited\"],\n    payment_confirmed: [\"active\"],"],
  ["una suscripción activa puede abrir otro checkout (duplicaría la suscripción)", "lib/billing/state-machine.ts", "active: {\n    renewal_due: [\"past_due\"],", "active: {\n    checkout_started: [\"pending\"],\n    renewal_due: [\"past_due\"],"],
  ["grandfathered se puede bloquear por reloj", "lib/billing/state-machine.ts", "grandfathered: {\n    payment_confirmed: [\"active\"],", "grandfathered: {\n    renewal_due: [\"past_due\"],\n    payment_confirmed: [\"active\"],"],
  ["limited puede volver a la gracia", "lib/billing/state-machine.ts", 'payment_rejected: ["limited"],', 'payment_rejected: ["grace_period"],'],
  ["la reactivación admite un destino cualquiera", "lib/billing/state-machine.ts", 'reactivate_requested: ["active", "past_due", "grace_period"],', 'reactivate_requested: ["active", "past_due", "grace_period", "limited"],'],
  // Libro de cobros: orden, idempotencia, gracia y cancelación
  ["el resultado MÁS VIEJO de una ejecución gana", "lib/billing/ledger.ts", "fact.occurredAt > current.occurredAt ||", "fact.occurredAt < current.occurredAt ||"],
  ["los cobros se encadenan en el orden de llegada (no por vencimiento)", "lib/billing/ledger.ts", "for (const fact of [...approved].sort(byDueThenId)) {", "for (const fact of [...approved]) {"],
  ["el último segundo de la gracia ya es modo limitado", "lib/billing/ledger.ts", "const inGrace = nowIso < graceEnd;", "const inGrace = nowIso < graceEnd && false;"],
  ["la gracia incluye el instante exacto del fin", "lib/billing/ledger.ts", "const inGrace = nowIso < graceEnd;", "const inGrace = nowIso <= graceEnd;"],
  ["el período pagado incluye su instante de fin", "lib/billing/ledger.ts", 'if (nowIso < end) return "active";', 'if (nowIso <= end) return "active";'],
  ["cancelar da cinco días de gracia extra", "lib/billing/ledger.ts", "return fields.cancelRequestedAt < end ? end : (fields.graceEndsAt ?? graceEndsAtFor(end));", "return fields.graceEndsAt ?? graceEndsAtFor(end);"],
  ["se acepta cualquier transición, aun las imposibles", "lib/billing/ledger.ts", "if (status !== snapshot.status && !isReachable(snapshot.status, status, DERIVATION_TRIGGERS)) {", "if (false) {"],
  ["un pago posterior a la cancelación no se informa", "lib/billing/ledger.ts", "fact.dueAt > snapshot.cancelRequestedAt", 'fact.dueAt > "9999"'],
  ["el período anterior sigue contando tras volver a suscribirse", "lib/billing/ledger.ts", "(!fields.restartedAt || fields.currentPeriodEnd > fields.restartedAt)", "true"],
  ["un pago tardío nunca reinicia el período", "lib/billing/ledger.ts", "const late = fact.occurredAt >= graceEndsAtFor(cursorEnd);", "const late = false;"],
  ["el cambio de plan programado nunca se resuelve", "lib/billing/ledger.ts", "const pendingResolved = snapshot.pendingPlanCode !== null && fields.planCode === snapshot.pendingPlanCode;", "const pendingResolved = false;"],
  ["un rechazo viejo genera gracia", "lib/billing/ledger.ts", "if (fact.outcome !== \"rejected\" || civilDayOf(fact.dueAt) < endDay) continue;", "if (fact.outcome !== \"rejected\") continue;"],
  ["la próxima revisión de una cuenta activa se pierde", "lib/billing/ledger.ts", "case \"active\":\n      return snapshot.currentPeriodEnd;", "case \"active\":\n      return null;"],
  // Acceso
  ["el control de acceso se aplica con enforcement apagado", "lib/billing/access.ts", "if (!flags.enabled || !flags.enforcement) return access(", "if (!flags.enabled) return access("],
  ["el modo limitado deja crear datos", "lib/billing/access.ts", "const LIMITED_CAPABILITIES: AccessCapabilities = Object.freeze({\n  viewOperationalData: true,\n  createOperationalData: false,", "const LIMITED_CAPABILITIES: AccessCapabilities = Object.freeze({\n  viewOperationalData: true,\n  createOperationalData: true,"],
  ["el modo limitado no permite exportar", "lib/billing/access.ts", "  exportData: true,\n  deleteAccount: true,\n});\n\nfunction access", "  exportData: false,\n  deleteAccount: true,\n});\n\nfunction access"],
  ["sin estado conocido se bloquea a la cuenta", "lib/billing/access.ts", 'return access("full", "billing_state_unavailable", "none", null, null);', 'return access("limited", "billing_state_unavailable", "none", null, null);'],
  ["la gracia no muestra aviso", "lib/billing/access.ts", 'access("full_with_notice", "payment_failed_grace"', 'access("full", "payment_failed_grace"'],
  ["la gracia limita el acceso", "lib/billing/access.ts", 'access("full_with_notice", "payment_failed_grace"', 'access("limited", "payment_failed_grace"'],
  ["la resolución confía en el estado guardado y no en el reloj", "lib/billing/access.ts", "const status = projectStatus(snapshot, now);", "const status = snapshot.status;"],
  // Conciliación
  ["se acepta un aviso que mezcla la propietaria", "lib/billing/reconcile.ts", 'if (context.hintedReference && operation.subscriberReference && context.hintedReference !== operation.subscriberReference) return anomaly("owner_mismatch", null);', ""],
  ["se acepta un plan que la cuenta no tiene", "lib/billing/reconcile.ts", 'if (!record.acceptablePlans.includes(validation.plan.code)) return anomaly("plan_not_expected", ownerId);', ""],
  ["una operación de prueba activa la cuenta", "lib/billing/reconcile.ts", 'if (context.expectLive && !operation.livemode) return { kind: "ignore", reason: "test_operation" };', ""],
  ["la conciliación usa el plan del aviso sin validarlo contra el catálogo", "lib/billing/reconcile.ts", "if (!validation.ok) {", "if (false) {"],
  ["un pago pendiente cuenta como cobro", "lib/billing/reconcile.ts", 'if (operation.outcome === "pending") return { kind: "ignore", reason: "non_final_status" };', ""],
  ["un suscriptor ajeno se acepta", "lib/billing/reconcile.ts", 'if (record.subscriberUid && operation.subscriberUid && record.subscriberUid !== operation.subscriberUid) return anomaly("subscriber_mismatch", ownerId);', ""],
  ["un reembolso se ignora sin revisión", "lib/billing/reconcile.ts", 'if (operation.outcome === "refunded") return anomaly("refund_review", ownerId);', 'if (operation.outcome === "refunded") return { kind: "ignore", reason: "unsupported_status" };'],
  // Recepción de avisos
  ["se acepta un aviso sin verificar", "lib/billing/webhook-ingest.ts", "if (!verification.verified) {", "if (false) {"],
  ["la recepción ignora el interruptor de facturación", "lib/billing/webhook-ingest.ts", "if (!deps.flags.enabled) return { status: 404, body: { ok: false } };", ""],
  ["la recepción no limita el tamaño del cuerpo", "lib/billing/webhook-ingest.ts", "if (Buffer.byteLength(request.rawBody, \"utf8\") > MAX_BODY_BYTES) return { status: 413, body: { ok: false } };", ""],
  ["la recepción devuelve 200 aunque la base falle", "lib/billing/webhook-ingest.ts", "return { status: 503, body: { ok: false } };", "return { status: 200, body: { ok: true } };"],
  ["el aviso guarda el cuerpo completo", "lib/billing/webhook-ingest.ts", "normalized: { operation: event.operation, subscriberUid: event.subscriberUid, subscriberReference: event.subscriberReference },", "normalized: { operation: event.operation, subscriberUid: event.subscriberUid, subscriberReference: event.subscriberReference, rawBody: request.rawBody } as never,"],
  ["la identidad del aviso incluye la fecha de recepción (los duplicados dejan de serlo)", "lib/billing/providers/mobbex-normalize.ts", 'operation?.occurredAt ?? "", operation?.executionUid ?? "", subscriberUid ?? ""', 'operation?.occurredAt ?? "", operation?.executionUid ?? "", subscriberUid ?? "", receivedAt'],
  ["el estado 201 (validada) cuenta como cobro aprobado", "lib/billing/providers/mobbex-normalize.ts", 'const APPROVED_CODES = new Set(["200", "299", "300", "301", "302", "303"]);', 'const APPROVED_CODES = new Set(["200", "201", "299", "300", "301", "302", "303"]);'],
  ["el importe ambiguo se acepta", "lib/billing/providers/mobbex-normalize.ts", "paymentAmount !== null && (executionAmount === null || executionAmount === paymentAmount) ? paymentAmount : null", "paymentAmount"],
  ["el análisis de formularios admite __proto__", "lib/billing/providers/mobbex-normalize.ts", 'path.some((part) => part === "__proto__" || part === "constructor" || part === "prototype")', "false"],
  // Adaptador de Mobbex
  ["el adaptador de Mobbex verifica avisos", "lib/billing/providers/mobbex.ts", 'return { verified: false, reason: "mechanism_not_documented" };', "return { verified: true, events: [] };"],
  ["la redirección acepta cualquier host", "lib/billing/providers/mobbex.ts", 'url.protocol !== "https:" || !(url.hostname === "mobbex.com" || url.hostname.endsWith(".mobbex.com"))', "false"],
  ["el adaptador llama a la red sin credenciales", "lib/billing/providers/mobbex.ts", 'if (!config) return providerFail("not_configured"); // sin credenciales: nunca se llega a la red', ""],
  ["el total se envía en centavos", "lib/billing/providers/mobbex.ts", "total: minorToProviderDecimal(plan.amountMinor), // «XXX.xx», con punto decimal", "total: plan.amountMinor,"],
  ["todos los planes usan el intervalo mensual", "lib/billing/providers/mobbex.ts", "interval: plan.providerInterval, // 1m · 3m · 6m · 1y", 'interval: "1m",'],
  ["se omite el token de acceso", "lib/billing/providers/mobbex.ts", '"x-access-token": config.accessToken', '"x-access-token": ""'],
  ["el adaptador sigue redirecciones", "lib/billing/providers/mobbex.ts", 'redirect: "error"', 'redirect: "follow"'],
  ["el adaptador expone el cuerpo de un error", "lib/billing/providers/mobbex.ts", 'if (response.status >= 500) return providerFail("unavailable");', 'if (response.status >= 500) return { ok: false, error: { kind: "unavailable", retryable: true, body: await response.text() } as never };'],
  // Comandos
  ["el proveedor puede fallar sin impedir el cambio en la base", "lib/billing/commands.ts", "if (providerFailure) return fail(providerFailure);", ""],
  ["cancelar de nuevo vuelve a escribir y a llamar al proveedor", "lib/billing/commands.ts", 'if (current === "cancel_at_period_end" || current === "canceled") return { ok: true, kind: "noop" };', ""],
  ["un conflicto de versión no se reintenta", "lib/billing/commands.ts", "const MAX_CONFLICT_RETRIES = 3;", "const MAX_CONFLICT_RETRIES = 1;"],
  ["los comandos ignoran el interruptor de facturación", "lib/billing/commands.ts", 'if (!deps.flags.enabled) return fail("billing_disabled");', ""],
  ["una falla de la base no cierra el cambio", "lib/billing/commands.ts", 'return fail("billing_unavailable"); // Supabase caído: falla cerrado, no se cambia nada', "return { ok: true, changed: true };"],
  ["el checkout reutiliza la clave de la pestaña actual (duplica suscriptores)", "lib/billing/commands.ts", "idempotencyKey: opened.attempt.idempotencyKey });", "idempotencyKey: input.idempotencyKey });"],
  ["un plan desconocido se acepta en el checkout", "lib/billing/commands.ts", 'if (!plan || !plan.active) return failure("plan_invalid");', ""],
  ["el cambio de plan se permite fuera de active", "lib/billing/commands.ts", 'if (!canApplyTrigger(current, "plan_change_requested")) return REJECT("not_allowed");', ""],
  // Interruptores, mensajes y registro
  ["enforcement se enciende sin facturación", "lib/billing/flags.ts", "const enforcement = enabled && isOn(env.BILLING_ENFORCEMENT_ENABLED);", "const enforcement = isOn(env.BILLING_ENFORCEMENT_ENABLED);"],
  ["cualquier texto no vacío enciende un interruptor", "lib/billing/flags.ts", 'value.trim().toLowerCase() === "true"', 'value.trim() !== ""'],
  ["un mensaje de error muestra el código interno", "lib/billing/safe-errors.ts", "unknown: \"No pudimos completar la acción y no se hizo ningún cambio. Probá de nuevo; si vuelve a pasar, contactanos.\",", "unknown: \"Falló billing_commit_batch (23505). Probá de nuevo.\","],
  ["el registro admite cualquier texto", "lib/billing/log.ts", "if (typeof value === \"string\") clean[key] = SAFE_CODE.test(value) ? value : \"redacted\";", "if (typeof value === \"string\") clean[key] = value;"],
  ["el registro admite campos no listados", "lib/billing/log.ts", "for (const key of ALLOWED_KEYS) {", "for (const key of Object.keys(fields) as Array<(typeof ALLOWED_KEYS)[number]>) {"],
  // Almacén
  ["las lecturas por lotes usan tandas de 5.000", "lib/billing/rpc-store.ts", "for (const part of chunk(ownerIds, 500)) {\n      for (const row of rows(await this.rpc(\"billing_get_subscriptions\"", "for (const part of chunk(ownerIds, 5000)) {\n      for (const row of rows(await this.rpc(\"billing_get_subscriptions\""],
  ["la escritura de una suscripción no lleva la versión esperada", "lib/billing/rpc-store.ts", "expected_version: expectedVersion,", "expected_version: 0,"],
  ["las fechas con huso se interpretan sin normalizar", "lib/billing/rpc-store.ts", "return date.toISOString();\n}", "return String(value);\n}"],
  ["un estado desconocido de la base se acepta", "lib/billing/rpc-store.ts", "throw new TypeError(\"Estado de facturación desconocido.\");", "return value as BillingStatus;"],
  ["el cursor de vencimientos se informa aunque la página no esté llena", "lib/billing/rpc-store.ts", "result.length >= input.limit", "result.length >= 0"],
];

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  }
}

export function runMutation([description, file, find, replacement]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m1-dom-"));
  try {
    copyDir(path.join(REPO, "lib", "billing"), path.join(dir, "lib", "billing"));
    copyDir(path.join(REPO, "lib", "calendar"), path.join(dir, "lib", "calendar"));
    fs.mkdirSync(path.join(dir, "supabase", "migrations"), { recursive: true });
    fs.copyFileSync(path.join(REPO, "supabase/migrations/20261014100000_m1_billing_core.sql"), path.join(dir, "supabase/migrations/20261014100000_m1_billing_core.sql"));
    const target = path.join(dir, file);
    const source = fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n");
    if (!source.includes(find)) return { description, status: "inaplicable" };
    fs.writeFileSync(target, source.split(find).join(replacement));
    const run = spawnSync(process.execPath, ["--test", ...TESTS], { cwd: dir, encoding: "utf8", timeout: 240_000 });
    const failing = [...(run.stdout ?? "").matchAll(/^✖ (.+?) \(/gm)].map((m) => m[1]).filter((name) => !/\.test\.ts$/.test(name));
    return { description, status: run.status === 0 ? "sobrevive" : "detectada", by: failing[0] ?? "(error de carga)" };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--list")) {
    for (const [description] of MUTATIONS) console.log(description);
    process.exit(0);
  }
  let bad = 0;
  const onlyIndex = process.argv.indexOf("--only");
  const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : null; // --only <texto>: corre sólo las mutaciones cuya descripción lo contiene
  const selected = only ? MUTATIONS.filter(([description]) => description.includes(only)) : MUTATIONS;
  for (const mutation of selected) {
    const result = runMutation(mutation);
    const good = result.status === "detectada";
    if (!good) bad += 1;
    console.log(`${good ? "✔ detectada " : result.status === "sobrevive" ? "✖ SOBREVIVE  " : "✖ INAPLICABLE"}  ${result.description}${good ? `  ← ${String(result.by).slice(0, 80)}` : ""}`);
  }
  console.log(`\n${selected.length} mutaciones, ${bad} sin detectar`);
  process.exit(bad === 0 ? 0 : 1);
}
