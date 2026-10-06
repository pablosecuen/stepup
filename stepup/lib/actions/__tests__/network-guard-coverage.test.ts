import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Guarda estructural (no hay React Testing Library en el proyecto): todo
// componente cliente que invoque un Server Action debe hacerlo a través de
// `guardNetwork(() => accion(...))` o de `useGuardedActionState(accion, ...)`.
// Una invocación "pelada" vuelve a abrir el hueco real encontrado en
// producción: una falla de red rompe la pantalla (la captura `app/error.tsx`
// y se pierde el formulario) o queda como rechazo silencioso sin manejar.

const ROOTS = ["app", "components"];
const ACTION_IMPORT = /import\s*\{([^}]*)\}\s*from\s*"@\/lib\/(?:actions\/[\w-]+|auth\/actions)";/g;
const ALLOWED_BEFORE = [/guardNetwork\(\(\) => $/, /useGuardedActionState(<[^>]*>)?\($/];

// R2: disparadores de FONDO (sin formulario ni texto escrito que conservar). Invocan una acción idempotente una sola vez al
// montarse y se protegen con su propio try/catch: una falla de red nunca rompe la pantalla ni deja nada bloqueado. Usar
// `guardNetwork` ahí sería incorrecto: reclama el "envío fresco" del formulario y restauraría valores ajenos.
const BACKGROUND_TRIGGERS = ["components/payments/charge-generation-trigger.tsx", "components/students/profile/report-cleanup-trigger.tsx"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "__tests__") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

function importedActionNames(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(ACTION_IMPORT)) {
    for (const part of match[1].split(",")) {
      const name = part.trim();
      if (!name || name.startsWith("type ")) continue;
      if (name === "useGuardedActionState" || name === "guardNetwork") continue;
      names.push(name.split(/\s+as\s+/).pop()!);
    }
  }
  return names;
}

test("todo componente cliente invoca los Server Actions a través de guardNetwork / useGuardedActionState", () => {
  const offenders: string[] = [];
  let guardedSites = 0;

  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      if (!/^\s*["']use client["']/.test(source)) continue;

      const names = importedActionNames(source);
      const body = source
        .replace(/import\s*\{[^}]*\}\s*from\s*"[^"]+";/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
        .replace(/(^|[^:])\/\/[^\n]*/g, (_m, lead: string) => lead);

      if (/\buseActionState\(/.test(body)) {
        offenders.push(`${file}: usa useActionState directo (debe ser useGuardedActionState)`);
      }

      for (const name of names) {
        for (const match of body.matchAll(new RegExp(String.raw`\b${name}\b`, "g"))) {
          const before = body.slice(Math.max(0, match.index - 60), match.index);
          if (ALLOWED_BEFORE.some((pattern) => pattern.test(before))) {
            guardedSites++;
            continue;
          }
          // `accion.bind(null, id)` se pasa después a useGuardedActionState (se verifica abajo).
          const after = body.slice(match.index + name.length, match.index + name.length + 6);
          if (after === ".bind(" && /\buseGuardedActionState\(/.test(body)) continue;
          // Disparador de fondo declarado: la invocación debe estar DENTRO de un try con catch (nunca un rechazo sin manejar).
          const normalized = file.replace(/\\/g, "/");
          if (BACKGROUND_TRIGGERS.some((trigger) => normalized.endsWith(trigger)) && /\btry\s*\{[\s\S]*\bawait\s+\w+\([\s\S]*\}\s*catch\b/.test(body)) {
            guardedSites++;
            continue;
          }
          // `dispatchAction` de new-lesson-form elige entre dos acciones y es lo que
          // recibe `useGuardedActionState` (vía `boundAction`): ya protegidas ahí.
          if (file.endsWith("new-lesson-form.tsx") && /\buseGuardedActionState\(boundAction/.test(body)) continue;
          const line = body.slice(0, match.index).split("\n").length;
          offenders.push(`${file}:${line}: ${name} sin guard`);
        }
      }
    }
  }

  assert.deepEqual(offenders, []);
  assert.ok(guardedSites >= 30, `se esperaban muchos sitios protegidos, hay ${guardedSites}`);
});

test("existe una última defensa de App Router (app/error.tsx) con mensaje humano y reintento", () => {
  // Desde B4 el mensaje y el reintento viven en la vista compartida `RouteErrorView` (la usan app/error.tsx y app/(app)/error.tsx).
  const boundary = readFileSync("app/error.tsx", "utf8");
  assert.match(boundary, /["']use client["']/);
  assert.match(boundary, /RouteErrorView/);
  assert.match(boundary, /reset=\{reset\}/);
  const source = readFileSync("components/ui/route-error.tsx", "utf8");
  assert.match(source, /reset\(\)/);
  assert.match(source, /Reintentar/);
  assert.match(source, /Algo salió mal/);
});
