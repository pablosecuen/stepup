import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = "supabase/migrations/20261022400000_inactive_student_prunes_future_agenda.sql";

test("dar de baja (inactivo) quita al alumno de la agenda futura SIEMPRE: la acción no ofrece conservarla y no deja pasar fechas pasadas", () => {
  const action = read("lib/actions/students.ts");
  assert.match(action, /status === "archivado" \|\| status === "inactivo"/);
  assert.match(action, /if \(status === "inactivo"\) \{\s*removeFromFuture = true;/);
  assert.match(action, /removeFromFuture && occurredOn < todayInArgentina\(\)/, "nunca modifica clases pasadas");
  // Pausar y restaurar siguen por el cambio de estado simple.
  assert.match(action, /await changeStudentStatus\(ctx, studentId, \{ status, occurredOn, reason, internalNote \}\);/);
});

test("el formulario de baja explica qué pasa y pide la fecha de baja (por defecto hoy); archivar conserva su elección explícita", () => {
  const form = read("components/students/change-status-form.tsx");
  assert.match(form, /label="Fecha de baja"/);
  assert.match(form, /defaultValue=\{today\}/);
  assert.match(form, /Las clases dictadas, los registros, tareas, fotos, reportes y cobros nunca se borran/);
  assert.match(form, /const canSubmit = !isArchiving \|\| removeFromFuture !== "";/);
});

test("la migración es aditiva (sólo create or replace de las dos funciones), exige la poda para la baja y cierra la vía alternativa", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /create or replace function public\.archive_student_and_prune_future\(p_payload jsonb\)/);
  assert.match(sql, /create or replace function public\.change_student_status\(/);
  assert.match(sql, /v_remove_from_future and v_status not in \('archivado', 'inactivo'\)/);
  assert.match(sql, /v_status = 'inactivo' and not v_remove_from_future/);
  assert.match(sql, /if p_status = 'inactivo' then\s+raise exception 'Para dar de baja a un alumno usá archive_student_and_prune_future/);
  assert.match(sql, /security definer\s+set search_path = ''/);
  assert.doesNotMatch(sql, /\bdrop\s+(table|function|column)\b|\btruncate\b/i, "nunca borra estructuras");
  // Lo único que se borra son filas de participantes FUTUROS (quitar al alumno del grupo); nunca clases, registros, pagos ni reportes.
  const deletes = [...sql.matchAll(/delete\s+from\s+public\.(\w+)/gi)].map((match) => match[1]);
  assert.ok(deletes.length > 0 && deletes.every((table) => table === "recurrence_rule_participants" || table === "calendar_lesson_participants"), `sólo participantes: ${deletes.join(", ")}`);
  // La autoridad real (plan vivo recalculado) sigue intacta.
  assert.match(sql, /El plan de poda de series está incompleto, desactualizado/);
  for (const signature of ["archive_student_and_prune_future(jsonb)", "change_student_status(uuid, text, date, text, text)"]) {
    assert.ok(sql.includes(`revoke execute on function public.${signature} from anon;`), `anon sin EXECUTE: ${signature}`);
    assert.ok(sql.includes(`grant execute on function public.${signature} to authenticated;`), `authenticated con EXECUTE: ${signature}`);
  }
});

test("no se editó la migración original ya aplicada", () => {
  const original = read("supabase/migrations/20260928110000_archive_student_prune_future.sql");
  assert.match(original, /if v_remove_from_future and v_status <> 'archivado' then/);
});
