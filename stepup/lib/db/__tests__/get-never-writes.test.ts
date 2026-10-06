import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// R2 — Ninguna ruta de LECTURA (GET / precarga / RSC) escribe. Guarda estructural:
//   1. Se clasifica cada función de `lib/repositories/*` como mutante (escribe en la base o en Storage, directo o a través de
//      otra función mutante).
//   2. Ninguna página, layout, loading ni cargador de datos que se ejecuta al renderizar puede nombrar una función mutante ni
//      llamar `.insert/.update/.upsert/.delete/.rpc` (salvo RPC de sólo lectura de la lista).
// Antes de R2, `/inicio`, `/cobros`, `/recordatorios` y la pestaña Cobros del alumno generaban cargos al renderizarse, y la
// pestaña Reportes barría (borraba) PDFs de Storage: cualquier GET/precarga/escáner podía escribir.

const READ_ONLY_RPCS = ["list_open_charge_balances", "fetch_own_latest_cloud_backup"];

function walk(dir: string, accept: (path: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "__tests__") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, accept, out);
    else if (accept(path)) out.push(path);
  }
  return out;
}

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

interface RepoFunction {
  name: string;
  file: string;
  body: string;
}

function repositoryFunctions(): RepoFunction[] {
  const out: RepoFunction[] = [];
  for (const file of walk("lib/repositories", (p) => /\.ts$/.test(p) && !/-mapping\.ts$/.test(p))) {
    const source = stripComments(read(file));
    const starts = [...source.matchAll(/^(?:export )?async function (\w+)\(/gm)];
    starts.forEach((match, index) => {
      const begin = match.index ?? 0;
      const end = index + 1 < starts.length ? (starts[index + 1].index ?? source.length) : source.length;
      out.push({ name: match[1], file, body: source.slice(begin, end) });
    });
  }
  return out;
}

const DIRECT_WRITE = /\.(insert|update|upsert|delete)\(|\.storage\b/;

function writesDirectly(body: string): boolean {
  if (DIRECT_WRITE.test(body)) return true;
  for (const match of body.matchAll(/\.rpc\(\s*["'`](\w+)["'`]/g)) {
    if (!READ_ONLY_RPCS.includes(match[1])) return true;
  }
  return false;
}

export function mutatingFunctionNames(functions: RepoFunction[]): Set<string> {
  const mutating = new Set(functions.filter((fn) => writesDirectly(fn.body)).map((fn) => fn.name));
  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of functions) {
      if (mutating.has(fn.name)) continue;
      for (const name of mutating) {
        if (new RegExp(String.raw`\b${name}\(`).test(fn.body)) {
          mutating.add(fn.name);
          changed = true;
          break;
        }
      }
    }
  }
  return mutating;
}

/** Archivos que se ejecutan al RENDERIZAR (GET, precarga, RSC): páginas, layouts, loading y cargadores de datos. */
function renderPathFiles(): string[] {
  const files = [
    ...walk("app", (p) => /[\\/](page|layout|loading|not-found|error)\.tsx$/.test(p)),
    ...walk("lib/dashboard", (p) => /[\\/]load-[\w-]+\.ts$/.test(p)),
    ...walk("lib/students", (p) => /[\\/]load-[\w-]+\.ts$/.test(p)),
    "lib/calendar/view.ts",
  ];
  return files.filter((file) => existsSync(file));
}

test("la clasificación no es vacía: reconoce como mutantes las funciones que escriben (control positivo)", () => {
  const mutating = mutatingFunctionNames(repositoryFunctions());
  for (const name of [
    "registerPayment",
    "voidPayment",
    "ensureMonthlyCharges",
    "ensureCurrentMonthlyCharges", // indirecta: llama a ensureMonthlyCharges
    "ensureTrainingCharges", // indirecta: llama a ensureTrainingChargesRpc
    "sweepPendingReportPdfCleanupJobs", // borra objetos de Storage
    "createStudent",
    "startLessonRegistration",
  ]) {
    assert.ok(mutating.has(name), `${name} debería clasificarse como mutante`);
  }
  for (const name of ["listStudents", "listOpenChargeBalances", "listAllCharges", "listCalendarLessonsInRange", "listRecurrenceRules"]) {
    assert.ok(!mutating.has(name), `${name} es de lectura`);
  }
});

test("ninguna página, layout ni cargador de datos que se ejecuta al renderizar escribe (ni nombra una función que escribe)", () => {
  const mutating = [...mutatingFunctionNames(repositoryFunctions())];
  const files = renderPathFiles();
  assert.ok(files.length >= 15, `se esperaban muchos archivos de render, hay ${files.length}`);
  const offenders: string[] = [];
  for (const file of files) {
    const source = stripComments(read(file));
    for (const name of mutating) {
      if (new RegExp(String.raw`\b${name}\b`).test(source)) offenders.push(`${file}: usa ${name}`);
    }
    if (/\.(insert|update|upsert|delete)\(/.test(source)) offenders.push(`${file}: escribe directo`);
    for (const match of source.matchAll(/\.rpc\(\s*["'`](\w+)["'`]/g)) {
      if (!READ_ONLY_RPCS.includes(match[1])) offenders.push(`${file}: rpc ${match[1]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("la generación de cobros y el barrido de PDFs sólo se alcanzan desde Server Actions (POST)", () => {
  const payments = read("lib/actions/payments.ts");
  assert.match(payments, /^"use server";/);
  assert.match(payments, /export async function ensureCurrentChargesAction\(\)/);
  assert.match(payments, /ensureCurrentMonthlyCharges\(ctx, currentPeriod\), ensureTrainingCharges\(ctx, currentPeriod\)/);
  assert.match(read("components/payments/charge-generation-trigger.tsx"), /^"use client";/);
  assert.match(read("components/students/profile/report-cleanup-trigger.tsx"), /retryPendingReportCleanupAction/);
  // Las cuatro pantallas que antes escribían al renderizarse siguen generando los cargos del período, ahora vía el disparador.
  for (const page of ["app/(app)/cobros/page.tsx", "app/(app)/recordatorios/page.tsx", "app/(app)/inicio/page.tsx", "app/(app)/alumnos/[id]/page.tsx"]) {
    assert.match(read(page), /<ChargeGenerationTrigger \/>/, `${page} dispara la generación de cargos`);
  }
  // Los disparadores corren dentro de un efecto (cliente), nunca durante el render del servidor.
  assert.match(read("components/payments/charge-generation-trigger.tsx"), /useEffect\(/);
  assert.match(read("components/students/profile/report-cleanup-trigger.tsx"), /useEffect\(/);
});

test("los enlaces del área privada nunca precargan (prefetch={false}) y las páginas públicas sólo apuntan a rutas públicas", () => {
  // (sin comentarios: el texto `prefetch={false}` también aparece en la documentación del componente)
  assert.match(stripComments(read("components/nav/private-link.tsx")), /<NextLink \{\.\.\.props\} prefetch=\{false\} \/>/);
  const publicLinks = [
    "app/page.tsx",
    "app/login/login-form.tsx",
    "app/crear-cuenta/signup-form.tsx",
    "app/recuperar-contrasena/forgot-password-form.tsx",
    "app/auth/confirmado/page.tsx",
    "components/auth/auth-shell.tsx",
  ];
  const PRIVATE = /href=["'{`]\s*["'`]?\/(inicio|alumnos|calendario|cobros|recordatorios|registro|resumen-financiero|configuracion)/;
  for (const file of publicLinks) assert.doesNotMatch(read(file), PRIVATE, `${file} no enlaza a rutas privadas con precarga`);
  // Ningún componente llama a router.prefetch ni usa next/link directo en el área privada.
  for (const file of [...walk("app/(app)", (p) => /\.tsx$/.test(p)), ...walk("components", (p) => /\.tsx$/.test(p))]) {
    const source = read(file);
    assert.doesNotMatch(source, /router\.prefetch\(/, `${file}: router.prefetch`);
    const normalized = file.replace(/\\/g, "/");
    // `components/auth/*` es el envoltorio de las pantallas PÚBLICAS (enlaza sólo a rutas públicas).
    if (!normalized.endsWith("components/nav/private-link.tsx") && !normalized.startsWith("components/auth/")) {
      assert.doesNotMatch(source, /from "next\/link"/, `${file}: usa next/link directo (debe ser PrivateLink)`);
    }
  }
});
