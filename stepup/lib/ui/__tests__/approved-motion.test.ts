import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LOGIN_MOTION_DURATION_MS, LOGIN_MOTION_MAX_AGE_SECONDS, vortexBoundary } from "../login-motion.ts";
import { resolveScreen } from "../../nav/screens.ts";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("el vórtice parte de dos mitades y no tiene singularidades en el centro ni en los extremos", () => {
  for (const radius of [0, 0.01, 1, 200, 799, 800]) {
    assert.equal(vortexBoundary(radius, 800, 0, 0), Math.PI / 2);
    for (const progress of [-1, 0, 0.25, 0.5, 1, 2]) {
      const a = vortexBoundary(radius, 800, progress, 0), b = vortexBoundary(radius, 800, progress, 1);
      assert.ok(Number.isFinite(a));
      assert.ok(Math.abs(b - a - Math.PI) < 1e-12, "los dos bordes siempre separan mitades opuestas");
    }
  }
  assert.equal(vortexBoundary(800, 800, 1, 0), Math.PI / 2, "el borde exterior conserva su origen");
  assert.ok(LOGIN_MOTION_DURATION_MS <= 1700);
  assert.ok(LOGIN_MOTION_MAX_AGE_SECONDS <= 30);
});

test("el aviso de bienvenida sólo se emite después de credenciales válidas y no cambia el destino de acceso", () => {
  const action = read("lib/auth/actions.ts").split("export async function signInAction")[1].split("export interface SignUpFormState")[0];
  assert.ok(action.indexOf("if (!result.ok) return") < action.indexOf("set(LOGIN_MOTION_COOKIE"));
  assert.ok(action.indexOf("set(LOGIN_MOTION_COOKIE") < action.indexOf("redirect(sanitizeNextPath(nextParam))"));
  const layout = read("app/(app)/layout.tsx");
  assert.ok(layout.indexOf('access.kind !== "authorized"') < layout.indexOf("<LoginWelcome"), "la animación no sustituye los permisos del dispositivo");
  const welcome = read("components/auth/login-welcome.tsx");
  assert.match(welcome, /setTimeout\(finish, reduced \? 180 : LOGIN_MOTION_DURATION_MS\)/, "un fotograma o una promesa de animación nunca bloquea el acceso");
  assert.match(action, /httpOnly: true/);
  assert.match(read("app/api/auth/welcome/route.ts"), /delete\(LOGIN_MOTION_COOKIE\)/);
  assert.doesNotMatch(welcome, /document\.cookie/);
  assert.doesNotMatch(welcome, /password|signInWithPassword|service_role/);
});

test("los cobros del alumno tienen URL propia, permanecen en Cobros y conservan el aislamiento de la sesión", () => {
  assert.equal(resolveScreen("/cobros/alumnos/qa")?.key, "alumno");
  const page = read("app/(app)/cobros/alumnos/[id]/page.tsx");
  assert.match(page, /requireAuthenticatedDbContext\(\)/);
  assert.match(page, /getStudent\(ctx, id\)/);
  assert.doesNotMatch(page, /createAdminClient|service_role/);
  assert.match(page, /ProfileTabBody ctx=\{ctx\} student=\{student\} tab=\{tab\} fromPayments/);
  assert.match(read("components/payments/collections-view.tsx"), /href=\{`\/cobros\/alumnos\/\$\{entry.studentId\}\?tab=cobros`\}/);
  assert.match(read("components/students/profile/profile-header.tsx"), /<BackLink href="\/cobros">Volver a Cobros/);
  assert.match(read("components/students/profile/profile-tabs-nav.tsx"), /fromPayments \? "\/cobros\/alumnos" : "\/alumnos"/);
});

test("los pendientes usan el mismo dominio y ventana que Registro, sin escribir durante GET", () => {
  const api = read("app/api/registro/pendientes/route.ts");
  assert.match(api, /requireAuthenticatedDbContext\(\)/);
  assert.match(api, /90 \* 86400000/);
  assert.match(api, /buildPendingLessons\(\{ calendarItems: items, now, registrations, legacyRegisteredOccurrences \}\)/);
  assert.match(api, /private, no-store/);
  assert.doesNotMatch(api, /\.insert\(|\.update\(|\.delete\(|\.rpc\(|createAdminClient/);
  const badge = read("components/nav/registration-nav-badge.tsx");
  assert.match(badge, /value == null \|\| value === 0/);
  assert.match(badge, /generation !== requestGeneration/, "la respuesta de una sesión anterior no puede publicar su cantidad");
});

test("los movimientos no ocultan datos por defecto y respetan movimiento reducido", () => {
  const finance = read("components/finance/finance-motion.tsx");
  assert.match(finance, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(finance, /setInterval|textContent|innerHTML|formatMoney|Math\.round/);
  assert.match(finance, /observer\.disconnect\(\)/);
  const shared = read("components/nav/shared-name-transition.tsx");
  assert.match(shared, /event\.ctrlKey \|\| event\.metaKey \|\| event\.shiftKey \|\| event\.altKey/);
  assert.match(shared, /element\.style\.viewTransitionName = snapshot\.transitionName/);
  assert.doesNotMatch(shared, /createElement|MutationObserver|target\.style\.opacity/, "el nombre no aparece tarde como una copia después de cargar");
  assert.match(read("app/(app)/layout.tsx"), /<ViewTransition name="tf-route-content" default="none" update=\{\{ default: "none", "tf-navigation": "tf-content-swap" \}\}>/);
  assert.doesNotMatch(shared, /preventDefault\(|stopPropagation\(/, "no sustituye la navegación nativa");
});
