import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { buildFirstSteps, buildGreeting, greetingForHour, greetingName, homeDateLabel, resolveHomeStage } from "../home-welcome.ts";

/** B5 — Inicio: saludo, fecha y primeros pasos, derivados sólo de datos reales. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("etapa: cuenta vacía, con alumnos sin clases, con actividad; el dato desconocido nunca declara 'vacía'", () => {
  assert.equal(resolveHomeStage({ studentCount: 0, hasAnyClass: false }), "empty");
  assert.equal(resolveHomeStage({ studentCount: 3, hasAnyClass: false }), "students-only");
  assert.equal(resolveHomeStage({ studentCount: 3, hasAnyClass: true }), "active");
  assert.equal(resolveHomeStage({ studentCount: 0, hasAnyClass: true }), "active", "clases sin alumnos también es actividad real");
  assert.equal(resolveHomeStage({ studentCount: 0, hasAnyClass: null }), "active", "no se pudo saber → Inicio normal, no bienvenida");
  assert.equal(resolveHomeStage({ studentCount: 5, hasAnyClass: null }), "active");
});

test("saludo según la hora civil: fronteras 5, 12 y 20; hora inválida → 'Hola'", () => {
  for (const [hour, text] of [
    [0, "Buenas noches"], [4, "Buenas noches"], [5, "Buen día"], [11, "Buen día"], [12, "Buenas tardes"],
    [19, "Buenas tardes"], [20, "Buenas noches"], [23, "Buenas noches"],
  ] as const) assert.equal(greetingForHour(hour), text, `${hour} h`);
  assert.equal(greetingForHour(Number.NaN), "Hola");
  assert.equal(greetingForHour(11.9), "Buen día");
});

test("nombre del saludo: primer nombre real; con título abreviado el nombre completo; vacío → sin nombre (nunca del correo)", () => {
  assert.equal(greetingName("María López"), "María");
  assert.equal(greetingName("  Ana   Paula  Gómez "), "Ana");
  assert.equal(greetingName("Prof. Ana López"), "Prof. Ana López");
  assert.equal(greetingName("Joaquín"), "Joaquín");
  assert.equal(greetingName(""), null);
  assert.equal(greetingName("   "), null);
  assert.equal(greetingName(null), null);
  assert.equal(greetingName(undefined), null);
  assert.equal(buildGreeting(9, "María López"), "Buen día, María");
  assert.equal(buildGreeting(15, null), "Buenas tardes");
  assert.equal(buildGreeting(22, "  "), "Buenas noches");
});

test("fecha de hoy: día civil con nombre de día y mes en español, sin año", () => {
  assert.equal(homeDateLabel("2026-10-05"), "lunes, 5 de octubre");
  assert.equal(homeDateLabel("2026-01-01"), "jueves, 1 de enero");
});

test("primeros pasos: sólo pasos reales; la clase exige un alumno ACTIVO y, sin él, se explica en vez de ofrecer un botón muerto", () => {
  const empty = buildFirstSteps({ activeStudentCount: 0, hasAnyClass: false });
  assert.deepEqual(empty.map((s) => s.id), ["add-student", "schedule-class"]);
  assert.deepEqual(empty.map((s) => s.done), [false, false]);
  assert.equal(empty[0].href, "/alumnos/nuevo");
  assert.equal(empty[1].href, null);
  assert.equal(empty[1].blockedReason, "Primero agregá un alumno.");

  const withStudent = buildFirstSteps({ activeStudentCount: 2, hasAnyClass: false });
  assert.deepEqual(withStudent.map((s) => s.done), [true, false]);
  assert.equal(withStudent[1].href, "/calendario/nueva");
  assert.equal(withStudent[1].blockedReason, null);

  const all = buildFirstSteps({ activeStudentCount: 2, hasAnyClass: true });
  assert.deepEqual(all.map((s) => s.done), [true, true]);

  for (const step of empty) {
    assert.notEqual(step.actionLabel, step.title, "el botón no repite el título");
    assert.ok(step.title && step.description && step.actionLabel);
  }
});

test("los destinos de los primeros pasos existen como rutas reales", () => {
  const app = join(ROOT, "app");
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "page.tsx") routes.push("/" + relative(app, dir).split(sep).filter((s) => s && !/^\(.*\)$/.test(s)).join("/"));
    }
  };
  walk(app);
  for (const step of buildFirstSteps({ activeStudentCount: 1, hasAnyClass: false })) {
    assert.ok(step.href && routes.includes(step.href), `${step.href} existe`);
  }
});

test("Inicio: la recuperación B0 y su redirect HTTP real siguen intactos y no hay loading.tsx", () => {
  const page = code("app/(app)/inicio/page.tsx");
  assert.match(page, /if \(sessionNotRecognizedYet && recuperada !== "1"\) redirect\(SESSION_RECOVERY_PATH\);/);
  assert.match(page, /isIssuedAtFutureFailure\(failure\)/);
  assert.equal(existsSync(join(ROOT, "app/(app)/inicio/loading.tsx")), false);
  assert.equal(existsSync(join(ROOT, "app/(app)/loading.tsx")), false);
  // La bienvenida se carga DENTRO del mismo try: un fallo de sesión sigue yendo a la recuperación, nunca a una pantalla rota.
  assert.match(page, /data = await loadHomeData\(ctx\);\s*welcome = await loadHomeWelcome\(ctx, data\);/);
  assert.match(page, /return <HomeView data=\{data\} welcome=\{welcome\} \/>;/);
  assert.doesNotMatch(code("components/dashboard/home-view.tsx"), /redirect\(|supabase|fetch\(|\.rpc\(/, "la vista sólo presenta");
});

test("Inicio: la bienvenida nunca rompe la pantalla y no afirma 'cuenta vacía' ante un fallo", () => {
  const loader = code("lib/dashboard/load-home-welcome.ts");
  assert.match(loader, /\(\) => null,\s*\),\s*data\.hasClassSignal/, "el perfil que falla → saludo sin nombre");
  assert.match(loader, /\(\) => null,\s*\),\s*\]\);/, "la existencia que falla → null (desconocido)");
  assert.match(loader, /data\.hasClassSignal\s*\?\s*Promise\.resolve<boolean \| null>\(true\)/, "con actividad ya cargada no hay consulta extra");
  assert.match(loader, /hasAnyCalendarLesson\(ctx\), hasAnyLessonRegistration\(ctx\)/, "cuenta como actividad también un registro libre");
  assert.doesNotMatch(loader, /\.(insert|update|upsert|delete|rpc)\(/, "sólo lectura");
  assert.doesNotMatch(code("lib/repositories/calendar-lessons.ts").match(/hasAnyCalendarLesson[\s\S]*?\n}\n/)![0], /insert|update|upsert|delete|rpc/);
  assert.doesNotMatch(code("lib/repositories/lesson-registrations.ts").match(/hasAnyLessonRegistration[\s\S]*?\n}\n/)![0], /insert|update|upsert|delete|rpc/);
});

test("Inicio: la etapa decide qué se muestra, sin métricas ni textos inventados", () => {
  const page = code("components/dashboard/home-view.tsx");
  assert.match(page, /resolveHomeStage\(\{ studentCount: data\.studentCount, hasAnyClass: welcome\.hasAnyClass \}\)/);
  assert.match(page, /buildGreeting\(data\.localHour, welcome\.displayName\)/, "saludo con la hora de Argentina y el nombre del perfil");
  assert.match(page, /\{onboarding && <FirstSteps/, "primeros pasos sólo sin clases");
  assert.match(page, /\{!onboarding && \(\s*<section className="mt-8">\s*<h2[^>]*>Clases de hoy/, "sin clases no se muestra una agenda vacía");
  assert.match(page, /\{stage !== "empty" && \(\s*<Link\s+href="\/cobros"/, "sin alumnos no se muestra un 'Cobros 0 · 0' vacío");
  assert.match(page, /\{!onboarding && \(\s*<section className="mt-8">\s*<Link\s+href="\/calendario\/nueva"/, "el acceso rápido lo reemplazan los primeros pasos");
  assert.match(page, /first-letter:uppercase/, "la fecha sólo capitaliza la primera letra (no 'De Octubre')");
  // Un solo <h1> (el saludo) y la campana de recordatorios se conserva.
  assert.equal((page.match(/<h1/g) ?? []).length, 1);
  assert.match(page, /href="\/recordatorios"/);
  // La hora del saludo es la de Argentina, nunca la del servidor.
  const loader = code("lib/dashboard/load-home-data.ts");
  assert.match(loader, /localHour: Math\.floor\(instantMinutesOfDay\(now\.toISOString\(\)\) \/ 60\)/);
  assert.doesNotMatch(code("lib/dashboard/home-welcome.ts") + page, /getHours\(|new Date\(\)\.get/);
});

test("componente de primeros pasos: accesible (texto + ícono, no sólo color), objetivos de 44 px y sin botones muertos", () => {
  const view = code("components/dashboard/first-steps.tsx");
  assert.match(view, /aria-labelledby="first-steps-title"/);
  assert.match(view, /<ol /);
  assert.match(view, /sr-only[^>]*>\{step\.done \? "Listo: " : `Paso \$\{index \+ 1\}: `\}/);
  assert.match(view, /Listo<\/p>/, "el estado hecho se dice con texto");
  assert.match(view, /CheckCircleIcon[^>]*aria-hidden/);
  assert.match(view, /min-h-11/);
  assert.match(view, /step\.href \?[\s\S]*PrivateLink[\s\S]*:\s*\(\s*<p[^>]*>\{step\.blockedReason\}/, "bloqueado: explica el motivo, no es un enlace");
  assert.doesNotMatch(view, /<button|onClick|supabase|fetch\(/);
  assert.doesNotMatch(view, /text-statusVerde">Listo/, "el texto 'Listo' no usa el verde de estado (contraste)");
});
