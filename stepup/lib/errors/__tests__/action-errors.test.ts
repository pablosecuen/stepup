import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { PostgrestError } from "@supabase/postgrest-js";
import { actionErrorMessage } from "../action-error.ts";
import { GENERIC_ERROR_MESSAGE } from "../domain-error-message.ts";

/**
 * R1 — errores normalizados. Parte 1: comportamiento (errores reales de PostgREST: 23514, 22007, ...). Parte 2: guarda
 * estructural — ninguna Server Action puede devolver `error.message` ni un mensaje crudo de Postgres/PostgREST.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

function captureLogs<T>(fn: () => T): { result: T; logs: string[] } {
  const logs: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  try {
    return { result: fn(), logs };
  } finally {
    console.error = original;
  }
}

const postgrest = (code: string, message: string, details = "", hint = "") => new PostgrestError({ message, details, hint, code });

const INTERNAL = /payments|calendar_lessons|students|check constraint|violates|_check|relation|column|syntax for type|no-fecha|public\.|[0-9a-f]{8}-[0-9a-f]{4}-/i;

test("23514 (check constraint) de PostgREST: mensaje genérico sin tabla ni constraint", () => {
  const error = postgrest("23514", 'new row for relation "payments" violates check constraint "payments_method_check"', "Failing row contains (a0000000-0000-4000-8000-00000000000a, x)");
  assert.ok(error instanceof Error, "en supabase-js 2.x un PostgrestError ES un Error: antes se devolvía su message tal cual");
  const { result, logs } = captureLogs(() => actionErrorMessage("payments", error));
  assert.equal(result, "Los datos enviados no son válidos.");
  assert.doesNotMatch(result, INTERNAL);
  assert.deepEqual(logs, [], "un código conocido se traduce sin registrar nada");
});

test("22007 (fecha inválida) y 22003 (número fuera de rango): textos útiles sin el valor enviado", () => {
  const date = actionErrorMessage("payments", postgrest("22007", 'invalid input syntax for type date: "no-fecha"'));
  assert.equal(date, "Hay una fecha con un formato inválido.");
  assert.doesNotMatch(date, INTERNAL);
  const number = actionErrorMessage("payments", postgrest("22003", "numeric field overflow"));
  assert.equal(number, "Hay un número fuera de rango.");
});

test("otros errores de PostgREST/Postgres: genérico, y el log guarda sólo categoría, código y nombre (nunca el mensaje)", () => {
  const error = postgrest("PGRST116", 'The result contains 0 rows for table "students" id a0000000-0000-4000-8000-00000000000a', 'JSON object requested for relation "students"');
  const { result, logs } = captureLogs(() => actionErrorMessage("scope.read", error));
  assert.equal(result, GENERIC_ERROR_MESSAGE);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^\[action-error\] /);
  const logged = JSON.parse(logs[0].replace("[action-error] ", ""));
  assert.deepEqual(Object.keys(logged).sort(), ["code", "kind", "name", "scope"]);
  assert.equal(logged.code, "PGRST116");
  assert.equal(logged.scope, "scope.read");
  assert.doesNotMatch(logs[0], INTERNAL);
});

test("un Error de JavaScript o de red (no de dominio) nunca se muestra: genérico o de red", () => {
  const { result } = captureLogs(() => actionErrorMessage("x", new TypeError("Cannot read properties of undefined (reading 'name')")));
  assert.equal(result, GENERIC_ERROR_MESSAGE);
  assert.equal(captureLogs(() => actionErrorMessage("x", new Error("ENOTFOUND foo.supabase.co"))).result, GENERIC_ERROR_MESSAGE);
  assert.match(captureLogs(() => actionErrorMessage("x", new TypeError("fetch failed"))).result, /conexión/i);
});

test("cada tipo de mensaje interno de JavaScript/Node cae al genérico, uno por uno", () => {
  for (const message of ["Cannot read properties of null (reading 'name')", "students.map is not a function", "foo is not defined", "x is not iterable", "ECONNREFUSED 127.0.0.1:5432", "connect ETIMEDOUT 10.0.0.1:443", "getaddrinfo ENOTFOUND db.interno", "Module not found: ./lib/repositories/students.ts", "falló en node_modules/pkg/index"]) {
    assert.equal(captureLogs(() => actionErrorMessage("x", new Error(message))).result, GENERIC_ERROR_MESSAGE, message);
  }
});

test("un mensaje de dominio con un id dentro (RPC «La serie <uuid> es primario…») cae al genérico", () => {
  const error = postgrest("22023", "La serie 9719f9cf-272c-4fb6-b98e-7e8da9b1e1b0 es primario sin otros participantes — debe terminarse.");
  assert.equal(captureLogs(() => actionErrorMessage("calendar", error)).result, GENERIC_ERROR_MESSAGE);
});

test("los mensajes de dominio útiles se conservan (validaciones propias y raise exception de nuestras RPC)", () => {
  assert.equal(captureLogs(() => actionErrorMessage("students", new Error("Ya existe un nivel con ese nombre."))).result, "Ya existe un nivel con ese nombre.");
  assert.equal(captureLogs(() => actionErrorMessage("payments", postgrest("22023", "El importe supera el saldo pendiente de este cobro. Todavía no se admite saldo a favor."))).result, "El importe supera el saldo pendiente de este cobro. Todavía no se admite saldo a favor.");
  assert.equal(captureLogs(() => actionErrorMessage("payments", postgrest("P0002", "El pago no existe o no te pertenece."))).result, "El pago no existe o no te pertenece.");
});

// ---------------------------------------------------------------------------------------------------------------
// Guarda estructural
// ---------------------------------------------------------------------------------------------------------------
function sources(dirs: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === "__tests__") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(relative(ROOT, full).split(sep).join("/"));
    }
  };
  for (const dir of dirs) walk(join(ROOT, dir));
  return out;
}

const serverActionFiles = () => sources(["app", "components", "lib"]).filter((file) => /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(read(file)));

/** El texto de cada bloque `catch (...) { ... }` (con llaves balanceadas). */
function catchBlocks(source: string): string[] {
  const blocks: string[] = [];
  const re = /catch\s*(?:\([^)]*\))?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") depth -= 1;
      i += 1;
    }
    blocks.push(source.slice(m.index + m[0].length, i - 1));
  }
  return blocks;
}

// Los únicos `.message` permitidos en una Server Action: el texto YA traducido por el adaptador de autenticación
// (`translateAuthError`/`CALLBACK_ERROR_MESSAGES`), nunca el de una excepción.
const ALLOWED_MESSAGE_ACCESS = /\bresult\.error\.message\b|\btranslated\.message\b/g;

test("la guarda ve todas las Server Actions (si cambia la detección, esta prueba avisa)", () => {
  const files = serverActionFiles();
  for (const expected of ["lib/actions/students.ts", "lib/actions/payments.ts", "lib/actions/reports.ts", "lib/actions/account.ts", "lib/actions/calendar.ts", "lib/actions/lesson-registrations.ts", "lib/actions/backup.ts", "lib/auth/actions.ts"]) {
    assert.ok(files.includes(expected), `${expected} figura como Server Action`);
  }
});

test("ninguna Server Action devuelve `error.message` ni mensajes crudos: todo pasa por actionErrorMessage", () => {
  const offenders: string[] = [];
  for (const file of serverActionFiles()) {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const stripped = source.replace(ALLOWED_MESSAGE_ACCESS, "<traducido>");
    const checks: [RegExp, string][] = [
      [/\b(?:error|err|e|caught|failure|cause)\.message\b/, "`.message` de una excepción"],
      [/\(\s*(?:error|err|e)\s+as\s+[^)]*\)\.message\b/, "`(error as …).message`"],
      [/error instanceof Error\s*\?/, "`error instanceof Error ? … : …`"],
      [/String\(\s*(?:error|err|e)\s*\)/, "`String(error)`"],
      [/JSON\.stringify\(\s*(?:error|err|e)\s*\)/, "`JSON.stringify(error)`"],
      [/\$\{\s*(?:error|err|e)(?:\.[a-z]+)?\s*\}/i, "interpolación del error en un texto"],
      [/\.details\b|\.hint\b/, "`details`/`hint` de PostgREST"],
    ];
    for (const [pattern, label] of checks) if (pattern.test(stripped)) offenders.push(`${file}: ${label}`);

    // Todo `return { error: <expresión> }` dentro de un `catch` debe salir de una de las funciones seguras.
    for (const block of catchBlocks(source)) {
      for (const m of block.matchAll(/return\s*\{\s*error:\s*([^,}]+)/g)) {
        const expression = m[1].trim();
        if (!/^(?:friendlyErrorMessage|friendlyPaymentError|actionErrorMessage)\(/.test(expression) && !/^["'`]/.test(expression) && !/^[A-Z_]+_MESSAGE\b|^NETWORK_ERROR_MESSAGE\b|^AUTH_ERROR_MESSAGES\./.test(expression)) {
          offenders.push(`${file}: catch devuelve { error: ${expression} }`);
        }
      }
      for (const m of block.matchAll(/return\s+(failure)\(/g)) void m; // `failure()` traduce con actionErrorMessage (ver backup.ts)
    }
  }
  assert.deepEqual(offenders, []);
});

test("las funciones `friendly…` de cada archivo de acciones delegan en actionErrorMessage", () => {
  for (const file of sources(["lib/actions"]).filter((f) => !/network-guard|use-guarded/.test(f))) {
    const source = read(file);
    for (const m of source.matchAll(/function (friendly\w+)\(error: unknown\): string \{([\s\S]*?)\n\}/g)) {
      assert.match(m[2], /actionErrorMessage\("[\w.-]+", error\)/, `${file}: ${m[1]}`);
    }
  }
  assert.match(read("lib/actions/backup.ts"), /translateImportError\(actionErrorMessage\("backup", error\), context\)/);
});
