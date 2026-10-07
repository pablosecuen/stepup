import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

/**
 * Alta de alumno: la CARGA de /alumnos/nuevo es de sólo lectura y el claim nace únicamente al enviar.
 * Defecto que motivó esto (2026-10-05): el GET llamaba `claimStudentCreation()` (RPC con INSERT) y redirigía a `?draft=`,
 * dejando una fila huérfana en `student_creation_claims` por cada visita/prefetch/pestaña abandonada.
 * No hay DOM ni base en este runner: se fijan los invariantes del código real; el comportamiento SQL (recarga, doble envío,
 * respuesta perdida, rollback sin huérfanos) se ejecutó contra el esquema real en PGlite (supabase/tests/pglite).
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

/** Código sin comentarios: las reglas hablan del comportamiento, no de lo que explica un comentario. */
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "__tests__" || entry === "node_modules" || entry === ".next") continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry)) out.push(relative(ROOT, full).split(sep).join("/"));
    }
  };
  walk(join(ROOT, dir));
  return out;
}

const page = code("app/(app)/alumnos/nuevo/page.tsx");
const form = code("app/(app)/alumnos/nuevo/new-student-form.tsx");
const actions = code("lib/actions/students.ts");
const repo = read("lib/repositories/students.ts");
const migration = read("supabase/migrations/20261005160000_student_creation_operation_id.sql");

test("GET /alumnos/nuevo es de SÓLO LECTURA: ninguna RPC, escritura, redirect ni claim", () => {
  assert.doesNotMatch(page, /\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  assert.doesNotMatch(page, /redirect|searchParams|claim|draft/i, "ni redirige a ?draft= ni lee/crea borradores");
  assert.doesNotMatch(page, /student-drafts/);
  assert.match(page, /listCustomLevels\(ctx\)/, "sólo lee los niveles personalizados");
  assert.match(page, /<NewStudentForm customLevels=\{customLevels\} \/>/, "el formulario ya no recibe ningún claimId del servidor");
  assert.match(page, /export const dynamic = "force-dynamic"/);
});

test("el prefetch tampoco escribe: la página no tiene efectos y los enlaces a ella no precargan", () => {
  // Sin escrituras en la página (arriba) + todo enlace privado usa PrivateLink (prefetch={false}); ver lib/nav.
  for (const file of [...sourceFiles("app/(app)"), ...sourceFiles("components")]) {
    if (file.startsWith("components/auth/") || file === "components/nav/private-link.tsx") continue;
    assert.doesNotMatch(read(file), /from "next\/link"/, `${file} no importa next/link directo`);
  }
  assert.match(read("components/nav/private-link.tsx"), /prefetch=\{false\}/);
});

test("ningún código de la aplicación vuelve a reclamar borradores en una carga", () => {
  const offenders: string[] = [];
  for (const file of [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")]) {
    const source = code(file);
    if (/claim_student_creation|claimStudentCreation|getStudentCreationClaim|create_student_via_web/.test(source)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], "las RPC viejas (en desuso) no las llama nadie");
  assert.throws(() => read("lib/repositories/student-drafts.ts"), "el repositorio que escribía en el GET ya no existe");
});

test("contrato TS ↔ SQL: la RPC y sus parámetros coinciden con la migración", () => {
  const signature = migration.match(/create or replace function public\.create_student_with_operation\(([\s\S]*?)\)\s*returns table/);
  assert.ok(signature, "firma de create_student_with_operation");
  const sqlParams = [...signature[1].matchAll(/\b(p_[a-z_]+)\s+(uuid|jsonb|boolean)/g)].map((m) => m[1]);
  assert.deepEqual(sqlParams, ["p_operation_id", "p_payload", "p_confirm_duplicate"]);

  const call = repo.match(/rpc\("create_student_with_operation", \{([\s\S]*?)\}\);/);
  assert.ok(call, "el repositorio llama a create_student_with_operation");
  const tsParams = [...call[1].matchAll(/\b(p_[a-z_]+):/g)].map((m) => m[1]);
  assert.deepEqual(tsParams, sqlParams, "mismos parámetros y mismo orden");
  assert.match(call[1], /p_operation_id: options\.operationId/);
});

test("la acción: la clave viene del NAVEGADOR (se valida, nunca se inventa) y el éxito NO usa redirect()", () => {
  const start = actions.indexOf("export async function createStudentAction");
  const end = actions.indexOf("export async function updateStudentAction");
  assert.ok(start > 0 && end > start);
  const body = actions.slice(start, end);
  assert.match(body, /parseOperationId\(readString\(formData, "operationId"\)\)/);
  assert.match(body, /if \(!operationId\) \{\n\s+return \{ error: MISSING_OPERATION_ID_MESSAGE \};/, "sin clave válida se rechaza");
  assert.doesNotMatch(body, /randomUUID|crypto\./, "la acción nunca fabrica la clave");
  assert.doesNotMatch(body, /redirect\(/, "navegar antes de rotar dejaría la clave vieja en sessionStorage");
  assert.match(body, /return \{ createdOperationId: operationId, createdStudentId: result\.student\.id \}/);
  assert.match(body, /createStudent\(ctx, input, \{ operationId, confirmDuplicate \}\)/);
  assert.doesNotMatch(body, /claimId/);
});

test("el formulario: clave por borrador (sessionStorage), envío bloqueado hasta tenerla y ROTA antes de navegar", () => {
  assert.match(form, /useDraftOperationId\(NEW_STUDENT_OPERATION_STORAGE_KEY\)/);
  assert.match(form, /const NEW_STUDENT_OPERATION_STORAGE_KEY = "teacherflow:alumnos:nuevo:operacion"/);
  assert.match(form, /<input type="hidden" name="operationId" value=\{operationId \?\? ""\} \/>/);
  assert.match(form, /<SubmitButton disabled=\{!operationId\} \/>/);
  assert.match(form, /disabled=\{pending \|\| disabled\}/, "doble clic: bloqueado mientras envía");
  assert.doesNotMatch(form, /claimId/);

  const effect = form.slice(form.indexOf("useEffect(() => {"));
  assert.match(effect, /shouldRotateOperationId\(state\.createdOperationId, operationId\)/, "sólo rota con la confirmación de ESTA clave");
  assert.ok(effect.indexOf("rotateOperationId()") > 0 && effect.indexOf("rotateOperationId()") < effect.indexOf("router.push("), "rota ANTES de navegar");
  assert.match(effect, /router\.push\(`\/alumnos\/\$\{state\.createdStudentId\}`\)/);
});

test("el hook usa la lógica pura probada y NO limpia/rota por su cuenta ante un error", () => {
  const hook = read("lib/lessons/use-draft-operation-id.ts");
  assert.match(hook, /resolveDraftOperationId\(browserStorage, storageKey, newId\)/);
  assert.match(hook, /rotateDraftOperationId\(browserStorage, storageKey, newId\)/);
  assert.match(hook, /clearDraftOperationId\(browserStorage, storageKey\)/);
});

test("SQL: el claim se crea SÓLO al enviar, dentro de la función atómica, después de validar el payload", () => {
  assert.equal((migration.match(/insert into public\.student_creation_claims/g) ?? []).length, 1, "un único INSERT de claim en toda la migración");
  const fn = migration.slice(migration.indexOf("create or replace function public.create_student_with_operation"));
  const validate = fn.indexOf("_validate_new_student_payload(p_payload)");
  const insertClaim = fn.indexOf("insert into public.student_creation_claims");
  const insertStudent = fn.indexOf("insert into public.students");
  assert.ok(validate > 0 && validate < insertClaim && insertClaim < insertStudent, "validar → claim → alumno, todo en la misma transacción");
  assert.match(fn, /pg_advisory_xact_lock\(hashtext\('backup_import:' \|\| v_owner::text\)\)/, "mismo lock por profesora que apply_backup_import");
  assert.match(fn, /where scc\.owner_id = v_owner and scc\.operation_id = p_operation_id\s+for update/, "la clave sólo identifica la operación DENTRO de la profesora");
  assert.match(fn, /if v_existing and v_claim\.status = 'created' then\s+return query select 'created'::text, v_claim\.student_id, true/, "reintento → alumno canónico");
  assert.match(migration, /create unique index if not exists student_creation_claims_owner_operation_uidx\s+on public\.student_creation_claims \(owner_id, operation_id\)\s+where operation_id is not null/);
  assert.match(migration, /revoke all on function public\.create_student_with_operation\(uuid, jsonb, boolean\) from anon;/);
  assert.doesNotMatch(migration, /create or replace function public\.(claim_student_creation|create_student_via_web)/, "esta migración (R5 de alta) no redefine las funciones viejas: las retira R8, en su propia migración");
});
