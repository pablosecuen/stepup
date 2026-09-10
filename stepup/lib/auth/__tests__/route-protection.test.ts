// Esta misma función (resolvePrivateAreaAccess) la llaman TANTO proxy.ts
// COMO el layout privado — probarla acá cubre "usuario anónimo redirigido
// desde cada ruta privada", "usuario autenticado autorizado" Y
// "protección server-side aunque se intente evitar proxy.ts" (el layout
// nunca confía en que proxy.ts ya corrió; vuelve a llamar a esta misma
// regla de forma independiente).
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePrivateAreaAccess } from "../route-protection.ts";
import { isPrivatePath } from "../safe-redirect.ts";

const PRIVATE_PATHS = ["/inicio", "/alumnos", "/calendario", "/cobros", "/configuracion"];

test("usuario anónimo es redirigido desde cada ruta privada", () => {
  for (const pathname of PRIVATE_PATHS) {
    const decision = resolvePrivateAreaAccess({ configured: true, hasSession: false, pathname });
    assert.equal(decision.kind, "redirect");
    if (decision.kind === "redirect") {
      assert.match(decision.to, /^\/login\?next=/);
      assert.equal(decodeURIComponent(decision.to.split("next=")[1]), pathname);
    }
  }
});

test("usuario autenticado queda autorizado en cada ruta privada", () => {
  for (const pathname of PRIVATE_PATHS) {
    const decision = resolvePrivateAreaAccess({ configured: true, hasSession: true, pathname });
    assert.deepEqual(decision, { kind: "allow" });
  }
});

test("sin configuración: nunca bloquea (igual que AuthGate en móvil — modo local nunca se bloquea)", () => {
  const anonymous = resolvePrivateAreaAccess({ configured: false, hasSession: false, pathname: "/inicio" });
  const authenticated = resolvePrivateAreaAccess({ configured: false, hasSession: true, pathname: "/inicio" });
  assert.deepEqual(anonymous, { kind: "local-only" });
  assert.deepEqual(authenticated, { kind: "local-only" });
});

test("el next de la redirección nunca puede apuntar afuera del sitio", () => {
  const decision = resolvePrivateAreaAccess({
    configured: true,
    hasSession: false,
    pathname: "/inicio",
    search: "?x=https://evil.example.com",
  });
  assert.equal(decision.kind, "redirect");
  if (decision.kind === "redirect") {
    assert.doesNotMatch(decision.to, /evil\.example\.com/);
  }
});

test("isPrivatePath coincide exactamente con las rutas usadas acá", () => {
  for (const pathname of PRIVATE_PATHS) assert.equal(isPrivatePath(pathname), true);
  assert.equal(isPrivatePath("/login"), false);
  assert.equal(isPrivatePath("/"), false);
});
