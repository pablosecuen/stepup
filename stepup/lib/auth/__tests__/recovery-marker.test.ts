import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { RECOVERY_MARKER_MAX_AGE_SECONDS, RecoveryMarkerUnavailableError, createRecoveryMarker, isValidRecoveryMarker, type RecoverySecrets } from "../recovery-marker.ts";
import { evaluateRecoverySecrets, getRecoverySecrets } from "../recovery-secret.ts";

const USER = "03e8e8f0-ce45-4730-93ae-31dad3666195";
const OTHER = "11111111-2222-3333-4444-555555555555";
const NOW = 1_790_000_000_000;
const SECRETS: RecoverySecrets = { current: "k3y-de-prueba-0123456789-abcdefghijklmnop-QRSTUV" };
const OTHER_SECRETS: RecoverySecrets = { current: "otro-secreto-de-prueba-9876543210-zyxwvutsrqponm" };
const make = (userId = USER, at = NOW, secrets: RecoverySecrets | null = SECRETS) => createRecoveryMarker(userId, at, secrets);
const valid = (raw: string | null | undefined, userId = USER, now = NOW, secrets: RecoverySecrets | null = SECRETS) => isValidRecoveryMarker(raw, userId, now, secrets);
/** Lo que podía fabricar quien sólo conoce el id de usuario (el formato anterior, sin firma). */
const forgedLegacy = (userId = USER, at = NOW) => `${userId}.${at}`;

test("marcador recién emitido para el mismo usuario es válido", () => {
  assert.equal(valid(make()), true);
  assert.equal(valid(make(), USER, NOW + 60_000), true);
});

test("el marcador de OTRO usuario no vale (sesión vieja de otra cuenta en el dispositivo)", () => {
  assert.equal(valid(make(OTHER)), false);
});

test("vence a los 15 minutos exactos y no antes", () => {
  const marker = make();
  const limit = RECOVERY_MARKER_MAX_AGE_SECONDS * 1000;
  assert.equal(valid(marker, USER, NOW + limit), true);
  assert.equal(valid(marker, USER, NOW + limit + 1), false);
});

test("un marcador del futuro (más de 1 minuto de desfase) no vale", () => {
  assert.equal(valid(make(USER, NOW + 120_000)), false);
  assert.equal(valid(make(USER, NOW + 30_000)), true, "desfase menor de reloj tolerado");
});

test("marcadores ausentes, vacíos, manipulados o con otra forma se rechazan", () => {
  const good = make();
  const [v, id, at, sig] = good.split(".");
  for (const raw of [undefined, null, "", "x", `${USER}`, `${USER}.`, `${USER}.abc`, `.${NOW}`, `${USER};${NOW}`, `<script>.${NOW}`, `${USER}.-5`, `${good}.extra`, `${v}.${id}.${at}`, `${v}.${id}.${at}.`, `v2.${id}.${at}.${sig}`, `${v}.${id}.${at}.${sig}x`, `${v}.${id}.${at}.${sig.slice(1)}`]) {
    assert.equal(valid(raw), false, String(raw));
  }
  assert.equal(valid(good, ""), false, "sin usuario");
});

test("R4: el formato anterior (sin firma) YA NO vale: quien sólo conoce el id de usuario no puede fabricar el marcador", () => {
  assert.equal(valid(forgedLegacy()), false);
  assert.equal(valid(`v1.${USER}.${NOW}.`), false);
  assert.equal(valid(`v1.${USER}.${NOW}.${"A".repeat(43)}`), false, "firma con la forma correcta pero inventada");
});

test("R4: la firma cubre usuario y hora — cambiar cualquiera la invalida", () => {
  const [v, id, at, sig] = make().split(".");
  assert.equal(valid(`${v}.${id}.${Number(at) + 1}.${sig}`), false, "hora cambiada (alargar la vigencia)");
  assert.equal(valid(`${v}.${OTHER}.${at}.${sig}`, OTHER), false, "firma de un usuario copiada a otro");
  assert.equal(valid(`${v}.${id}.${at}.${sig}`), true, "control: el original sigue valiendo");
});

test("R4: una firma hecha con OTRO secreto no vale (fabricada fuera del servidor)", () => {
  assert.equal(valid(make(USER, NOW, OTHER_SECRETS)), false);
  const handmade = `v1.${USER}.${NOW}.${createHmac("sha256", "adivinado").update(`tf-recovery-marker|v1|${USER}|${NOW}`).digest("base64url")}`;
  assert.equal(valid(handmade), false);
});

test("R4: rotación — el marcador firmado con el secreto anterior vale mientras esté configurado como anterior; el nuevo siempre se firma con el vigente", () => {
  const oldMarker = make(USER, NOW, SECRETS);
  const rotated: RecoverySecrets = { current: OTHER_SECRETS.current, previous: SECRETS.current };
  assert.equal(valid(oldMarker, USER, NOW, rotated), true, "en curso durante la rotación");
  assert.equal(valid(oldMarker, USER, NOW, { current: OTHER_SECRETS.current }), false, "sin el anterior ya no vale");
  const fresh = make(USER, NOW, rotated);
  assert.equal(valid(fresh, USER, NOW, { current: OTHER_SECRETS.current }), true, "se firmó con el vigente");
  assert.equal(valid(fresh, USER, NOW, SECRETS), false, "y no con el anterior");
});

test("R4: sin secreto configurado no se emite ni se valida nada (falla cerrado)", () => {
  assert.throws(() => createRecoveryMarker(USER, NOW, null), (error: unknown) => error instanceof RecoveryMarkerUnavailableError);
  assert.equal(valid(make(), USER, NOW, null), false);
  assert.equal(valid(forgedLegacy(), USER, NOW, null), false, "ni el formato anterior sin firma cuando falta el secreto");
});

test("R4: la firma se compara COMPLETA: cambiar sólo el último carácter la invalida", () => {
  const [v, id, at, sig] = make().split(".");
  const last = sig.endsWith("A") ? "B" : "A";
  assert.equal(valid(`${v}.${id}.${at}.${sig.slice(0, -1)}${last}`), false);
  const first = sig.startsWith("A") ? "B" : "A";
  assert.equal(valid(`${v}.${id}.${at}.${first}${sig.slice(1)}`), false);
});

// ---- Configuración del secreto ----

test("secreto: en Production falta o es inválido => sin firma posible; nunca un valor de desarrollo", () => {
  const prod = { NODE_ENV: "production" } as const;
  assert.deepEqual(evaluateRecoverySecrets({ ...prod }), { state: "missing", secrets: null });
  assert.deepEqual(evaluateRecoverySecrets({ ...prod, RECOVERY_MARKER_SECRET: "   " }), { state: "missing", secrets: null });
  for (const bad of ["corto", "x".repeat(40), "changeme-changeme-changeme-changeme-1234", "example-secret-example-secret-example", "a".repeat(64), "0000000000000000000000000000000000000000"]) {
    assert.deepEqual(evaluateRecoverySecrets({ ...prod, RECOVERY_MARKER_SECRET: bad }), { state: "invalid", secrets: null }, bad.slice(0, 12));
  }
  assert.deepEqual(evaluateRecoverySecrets({ ...prod, RECOVERY_MARKER_SECRET: "abcdefghijklmnopqrstuvwxyz01234" }), { state: "invalid", secrets: null }, "31 caracteres variados: corto de todos modos (mínimo 32)");
  assert.equal(evaluateRecoverySecrets({ ...prod, RECOVERY_MARKER_SECRET: "abcdefghijklmnopqrstuvwxyz012345" }).state, "ok", "32 caracteres variados: alcanza");
  assert.deepEqual(evaluateRecoverySecrets({ ...prod, RECOVERY_MARKER_SECRET: SECRETS.current, RECOVERY_MARKER_SECRET_PREVIOUS: "corto" }), { state: "invalid", secrets: null }, "el anterior también se valida");
  assert.equal(getRecoverySecrets({ ...prod }), null);
});

test("secreto: válido en Production; el anterior es opcional; en desarrollo hay un valor local fijo", () => {
  assert.deepEqual(evaluateRecoverySecrets({ NODE_ENV: "production", RECOVERY_MARKER_SECRET: SECRETS.current }), { state: "ok", secrets: { current: SECRETS.current } });
  assert.deepEqual(
    evaluateRecoverySecrets({ NODE_ENV: "production", RECOVERY_MARKER_SECRET: SECRETS.current, RECOVERY_MARKER_SECRET_PREVIOUS: OTHER_SECRETS.current }),
    { state: "ok", secrets: { current: SECRETS.current, previous: OTHER_SECRETS.current } }
  );
  const dev = evaluateRecoverySecrets({ NODE_ENV: "development" });
  assert.equal(dev.state, "ok");
  assert.ok(dev.secrets && dev.secrets.current.length >= 32);
  assert.equal(evaluateRecoverySecrets({ NODE_ENV: "test" }).state, "ok");
  assert.equal(evaluateRecoverySecrets({ NODE_ENV: "production", NEXT_PUBLIC_RECOVERY_MARKER_SECRET: SECRETS.current }).state, "missing", "una variable pública no cuenta");
});
