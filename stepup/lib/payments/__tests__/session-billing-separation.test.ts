import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { generatesPerClassCharge, resolveSessionBilling, type ParticipantBillingDecision, type SavedBillingResolution, type SessionBillingInput } from "../training-coverage.ts";
import { buildBillingRows } from "../../registro/billing-rows.ts";

/**
 * Separación financiera entre entrenamientos, series y clases sueltas. La misma alumna («ana») puede tener un entrenamiento mensual (acuerdo A), otro distinto (acuerdo B) y clases
 * sueltas: cada actividad usa EXCLUSIVAMENTE sus obligaciones. Lo que no está declarado no se supone: queda «pendiente de asociar» y no genera ni cubre nada.
 */
const members = (entries: Record<string, string[]>): ReadonlyMap<string, ReadonlySet<string>> => new Map(Object.entries(entries).map(([id, agreements]) => [id, new Set(agreements)]));
const resolve = (overrides: Partial<SessionBillingInput> & Pick<SessionBillingInput, "participantIds">): Map<string, ParticipantBillingDecision> =>
  resolveSessionBilling({ activityKind: "training", sessionAgreementId: null, membership: new Map(), saved: new Map(), ...overrides });

test("una clase común SIEMPRE se cobra por el régimen propio del alumno: ningún entrenamiento la cubre, aunque tenga serie y cuota", () => {
  const decisions = resolve({ activityKind: "class", sessionAgreementId: "A", participantIds: ["ana"], membership: members({ ana: ["A"] }) });
  assert.deepEqual(decisions.get("ana"), { kind: "own_regime", source: "class" });
  // ni siquiera una decisión guardada por error puede cubrir una clase común
  const saved = new Map<string, SavedBillingResolution>([["ana", { agreementId: "A" }]]);
  assert.deepEqual(resolve({ activityKind: "class", participantIds: ["ana"], saved }).get("ana"), { kind: "own_regime", source: "class" });
});

test("un entrenamiento de una serie con acuerdo está cubierto por ESE acuerdo y no genera cobro por clase", () => {
  const decision = resolve({ sessionAgreementId: "A", participantIds: ["ana"], membership: members({ ana: ["A", "B"] }) }).get("ana");
  assert.deepEqual(decision, { kind: "covered", agreementId: "A", source: "series" });
  assert.equal(generatesPerClassCharge(decision as ParticipantBillingDecision), false);
});

test("dos entrenamientos de la misma alumna permanecen separados: cada sesión usa SU acuerdo, nunca el del otro", () => {
  const membership = members({ ana: ["A", "B"] });
  assert.deepEqual(resolve({ sessionAgreementId: "A", participantIds: ["ana"], membership }).get("ana"), { kind: "covered", agreementId: "A", source: "series" });
  assert.deepEqual(resolve({ sessionAgreementId: "B", participantIds: ["ana"], membership }).get("ana"), { kind: "covered", agreementId: "B", source: "series" });
});

test("un entrenamiento que no declara su acuerdo NO se asocia por ser de la misma alumna: queda pendiente (con acuerdos posibles) y no genera ni cubre nada", () => {
  const decision = resolve({ participantIds: ["ana"], membership: members({ ana: ["A", "B"] }) }).get("ana");
  assert.deepEqual(decision, { kind: "needs_association", candidateAgreementIds: ["A", "B"], suggestedAgreementId: null });
  assert.equal(generatesPerClassCharge(decision as ParticipantBillingDecision), false, "no se cobra por clase en silencio");
  // con un solo acuerdo posible se preselecciona, pero sigue sin asociarse hasta que se confirme
  const single = resolve({ participantIds: ["ana"], membership: members({ ana: ["A"] }) }).get("ana");
  assert.deepEqual(single, { kind: "needs_association", candidateAgreementIds: ["A"], suggestedAgreementId: "A" });
  // la sugerencia por grupo igual (loose) sólo se acepta si es un candidato del alumno
  assert.equal((resolve({ participantIds: ["ana"], membership: members({ ana: ["A", "B"] }), looseSuggestionAgreementId: "B" }).get("ana") as { suggestedAgreementId: string | null }).suggestedAgreementId, "B");
  assert.equal((resolve({ participantIds: ["ana"], membership: members({ ana: ["A", "B"] }), looseSuggestionAgreementId: "Z" }).get("ana") as { suggestedAgreementId: string | null }).suggestedAgreementId, null);
});

test("un entrenamiento cuyo participante no pertenece a ningún acuerdo se cobra por el régimen propio del alumno (no hay otra obligación que lo cubra)", () => {
  assert.deepEqual(resolve({ participantIds: ["ana"], membership: new Map() }).get("ana"), { kind: "own_regime", source: "no_agreement" });
});

test("un participante que no pertenece al acuerdo de la serie NO queda cubierto por él: se le pide asociar (el plan de uno no se aplica a los demás)", () => {
  const decisions = resolve({ sessionAgreementId: "A", participantIds: ["ana", "invitada"], membership: members({ ana: ["A"] }) });
  assert.deepEqual(decisions.get("ana"), { kind: "covered", agreementId: "A", source: "series" });
  assert.deepEqual(decisions.get("invitada"), { kind: "needs_association", candidateAgreementIds: ["A"], suggestedAgreementId: "A" });
});

test("grupo con situaciones distintas por participante: cada uno se resuelve por SU acuerdo", () => {
  const decisions = resolve({
    sessionAgreementId: "A",
    participantIds: ["ana", "bea", "caro", "dani"],
    membership: members({ ana: ["A", "B"], bea: ["B"], dani: [] }),
    saved: new Map([["caro", { agreementId: null }]]),
  });
  assert.equal(decisions.get("ana")?.kind, "covered");
  assert.equal(decisions.get("bea")?.kind, "needs_association", "pertenece a B pero la sesión es de A");
  assert.deepEqual(decisions.get("caro"), { kind: "own_regime", source: "explicit" });
  assert.equal(decisions.get("dani")?.kind, "needs_association", "no pertenece a A: la sesión declara A y hay que decidir");
});

test("una decisión explícita guardada manda sobre todo y no cambia al volver a resolver (guardar, finalizar, editar, reintentar)", () => {
  const saved = new Map<string, SavedBillingResolution>([["ana", { agreementId: "B" }]]);
  const first = resolve({ sessionAgreementId: "A", participantIds: ["ana"], membership: members({ ana: ["A", "B"] }), saved });
  assert.deepEqual(first.get("ana"), { kind: "covered", agreementId: "B", source: "explicit" });
  const again = resolve({ sessionAgreementId: "A", participantIds: ["ana"], membership: members({ ana: ["A", "B"] }), saved });
  assert.deepEqual([...again], [...first]);
  assert.deepEqual(resolve({ participantIds: ["ana"], membership: members({ ana: ["A", "B"] }), saved: new Map([["ana", { agreementId: null }]]) }).get("ana"), { kind: "own_regime", source: "explicit" });
});

test("el panel del registro muestra una fila por participante CON cobro por clase, con su acuerdo, y las opciones de lo que falta asociar", () => {
  const decisions = new Map<string, ParticipantBillingDecision>([
    ["ana", { kind: "covered", agreementId: "A", source: "series" }],
    ["bea", { kind: "needs_association", candidateAgreementIds: ["A", "B"], suggestedAgreementId: "A" }],
    ["caro", { kind: "own_regime", source: "explicit" }],
    ["mensual", { kind: "own_regime", source: "no_agreement" }],
  ]);
  const participants = [
    { studentId: "ana", name: "Ana", billsPerClass: true },
    { studentId: "bea", name: "Bea", billsPerClass: true },
    { studentId: "caro", name: "Caro", billsPerClass: true },
    { studentId: "mensual", name: "Mensual", billsPerClass: false },
  ];
  const rows = buildBillingRows({ activityKind: "training", participants, decisions, agreementLabels: new Map([["A", "Entrenamiento lunes"], ["B", "Entrenamiento jueves"]]) });
  assert.deepEqual(rows.map((row) => [row.studentId, row.kind]), [["ana", "covered"], ["bea", "needs_association"], ["caro", "own_regime"]], "quien no cobra por clase no tiene nada que aclarar");
  assert.deepEqual(rows[0], { studentId: "ana", studentName: "Ana", kind: "covered", agreementLabel: "Entrenamiento lunes" });
  assert.deepEqual((rows[1] as { options: unknown }).options, [{ agreementId: "A", label: "Entrenamiento lunes" }, { agreementId: "B", label: "Entrenamiento jueves" }]);
  assert.deepEqual(buildBillingRows({ activityKind: "class", participants, decisions, agreementLabels: new Map() }), [], "una clase común no tiene panel");
});

// ---------- cableado: lo que el formulario ya no ofrece, y que el resolvedor no usa nombres ni coincidencias ----------
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const full = join(ROOT, dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__" || entry === ".next") continue;
      out.push(...sourceFiles(relative(ROOT, full).split(sep).join("/")));
    } else if (/\.(tsx?|css)$/.test(entry)) out.push(relative(ROOT, full).split(sep).join("/"));
  }
  return out;
}

test("el formulario de registro ya no ofrece «¿Es cobrable?» ni «¿Consume una clase de la cuota mensual?» (individual, grupal ni entrenamiento) y no envía esos valores", () => {
  for (const file of [...sourceFiles("app"), ...sourceFiles("components")]) {
    const text = read(file);
    assert.doesNotMatch(text, /¿Es cobrable\?|¿Consume una clase de la cuota mensual\?|showPerClassBillingControls/, file);
  }
  const workspace = read("app/(app)/registro/[calendarLessonId]/registration-workspace.tsx");
  assert.doesNotMatch(workspace, /isBillable|consumesMonthlyPackage|Cobro de esta clase/, "el estado del contenido no incluye las banderas: el valor guardado se conserva");
  assert.doesNotMatch(workspace, /role="switch"[^>]*isBillable/, "ningún interruptor residual");
  // el contrato de guardado sigue admitiendo las banderas SÓLO como opcionales (importaciones y excepciones históricas), sin inventar un valor por defecto
  const content = read("lib/lessons/pedagogical-content.ts");
  assert.match(content, /content\.isBillable !== undefined \? \{ is_billable: content\.isBillable \} : \{\}/);
  assert.match(content, /content\.consumesMonthlyPackage !== undefined \? \{ consumes_monthly_package: content\.consumesMonthlyPackage \} : \{\}/);
  // una excepción histórica (no cobrable) se sigue respetando al sincronizar el cobro
  assert.match(read("lib/actions/lesson-registrations.ts"), /detail\.registration\.isBillable === false \|\| decision\.kind === "covered"/);
});

test("el resolvedor sólo usa identidades explícitas: ni nombres, ni títulos, ni «mismo alumno» deciden la cobertura", () => {
  const repo = read("lib/repositories/training-coverage.ts");
  const pure = read("lib/payments/training-coverage.ts");
  for (const text of [repo.replace(/\/\*[\s\S]*?\*\//g, ""), pure.replace(/\/\*[\s\S]*?\*\//g, "")]) {
    assert.doesNotMatch(text, /toLowerCase|includes\(.*(name|title)|similar|startsWith/i, "ninguna comparación por nombre");
  }
  assert.match(repo, /classTitle && !labels\.has\(agreementId\)\) labels\.set/, "el título sólo rotula la opción, no decide");
  assert.match(repo, /readSavedResolutions\(ctx, input\.registrationId\)/, "las decisiones guardadas se leen por registro");
  assert.match(repo, /isMissingTable/, "sin la tabla nueva (migración pendiente) el registro sigue abriendo");
});

test("la decisión explícita sólo se guarda desde una acción propia que valida el entrenamiento elegido y sincroniza el cobro sin tocar pagos", () => {
  const action = read("lib/actions/lesson-registrations.ts");
  assert.match(action, /export async function resolveRegistrationBillingAction\(/);
  assert.match(action, /candidatesByStudent\.get\(input\.studentId\) \?\? \[\]\)\.includes\(input\.agreementId\)\) return \{ error: "Ese entrenamiento no corresponde a este alumno\." \}/);
  assert.match(action, /Esta clase ya tenía un cobro con pagos registrados: no se modificó\./, "con pagos nunca se anula ni se reasigna");
  const sql = read("supabase/migrations/20261101120000_registration_billing_resolutions.sql");
  assert.match(sql, /unique \(lesson_registration_id, student_id\)/, "una decisión por participante y registro");
  assert.match(sql, /check \(\(decision = 'covered'\) = \(training_billing_agreement_id is not null\)\)/);
  assert.match(sql, /security definer\s+set search_path = ''/);
  assert.match(sql, /revoke all on public\.lesson_registration_billing_resolutions from anon, authenticated;\s+grant select on/);
  assert.doesNotMatch(sql, /payment_charges|payment_allocations|payments\b/, "la migración no toca cargos, pagos ni asignaciones");
});
