import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { planRecurrenceSplit } from "../split.ts";
import { buildSplitRpcPayload } from "../split-rpc-payload.ts";
import { buildParticipantFreezePayload } from "../participants-freeze-payload.ts";
import { recurrenceSeriesInputToPayload } from "../../repositories/recurrence-rules-mapping.ts";
import type { RecurrenceWeek } from "../types.ts";

/**
 * CONTRATO TypeScript ↔ SQL de los RPC de Calendario (frontera `supabase.rpc(..., { p_payload })`).
 *
 * Defecto que motivó este test (2026-10-04): el cliente enviaba `original_patch: { status, endDate }` (camelCase, el plan de
 * dominio) y el SQL leía `original_patch->>'end_date'`, así que el fin de la serie original llegaba siempre NULL. Los tests
 * existentes sólo probaban el plan TypeScript, nunca el payload contra la función real. Acá se arma el payload con los
 * constructores REALES y se compara, clave por clave, contra las claves que la versión VIGENTE de cada función SQL lee.
 */
const MIGRATIONS = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));

/** Cuerpo de la versión vigente de una función: la última migración (por nombre) que la define con `create or replace`. */
function latestFunction(name: string): { file: string; body: string } {
  let latest: { file: string; body: string } | null = null;
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const start = sql.search(new RegExp(`create or replace function public\\.${name}\\(`, "i"));
    if (start < 0) continue;
    const end = sql.indexOf("$$;", sql.indexOf("$$", start) + 2);
    latest = { file, body: sql.slice(start, end + 3) };
  }
  assert.ok(latest, `no se encontró ${name}`);
  return latest;
}

/** Claves que el SQL lee de una variable/parámetro jsonb: `variable->>'clave'` o `variable->'clave'`. */
function keysRead(body: string, variable: string): Set<string> {
  const keys = new Set<string>();
  for (const match of body.matchAll(new RegExp(`${variable}\\s*->>?\\s*'([A-Za-z_]+)'`, "g"))) keys.add(match[1]);
  return keys;
}

const WEEKS: RecurrenceWeek[] = [{ weekIndex: 0, sessions: [{ weekday: 1, hour: 18, minute: 0, durationMinutes: 60 }] }];

function sampleSplitPayload() {
  // El caso real: serie original lunes desde 28/09, cambio desde el lunes 12/10 (hoy 04/10).
  const plan = planRecurrenceSplit({
    originalRecurrenceId: "r1",
    originalStartDate: "2026-09-28",
    originalEndDate: null,
    effectiveDate: "2026-10-12",
    todayDate: "2026-10-04",
  });
  return buildSplitRpcPayload({
    originalRecurrenceId: "r1",
    effectiveDate: "2026-10-12",
    plan,
    successorId: "r3",
    excludedOccurrenceKeys: [],
    ruleType: "weekly",
    cycleLengthWeeks: 1,
    weeks: WEEKS,
    modality: null,
    classTitle: null,
    activityKind: null,
    participantIds: ["s1", "s2"],
    primaryStudentId: "s1",
  });
}

/** Todas las claves de un valor JSON anidado, SIN descender en `weeks` (jsonb del motor, camelCase por diseño). */
function collectKeys(value: unknown, path = "", out: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, path, out));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      out.push(path ? `${path}.${key}` : key);
      if (key !== "weeks") collectKeys(child, path ? `${path}.${key}` : key, out);
    }
  }
  return out;
}

test("split: el payload TypeScript usa EXACTAMENTE las claves de nivel superior que lee la versión vigente del SQL", () => {
  const sql = latestFunction("split_recurrence_this_and_future");
  const sqlKeys = keysRead(sql.body, "p_payload");
  const tsKeys = new Set(Object.keys(sampleSplitPayload()));
  assert.deepEqual([...tsKeys].sort(), [...sqlKeys].sort(), `claves del payload vs. las que lee ${sql.file}`);
});

test("split: original_patch cruza la frontera en snake_case — end_date, nunca endDate (el defecto de 2026-10-04)", () => {
  const payload = sampleSplitPayload();
  assert.deepEqual(payload.original_patch, { status: "active", end_date: "2026-10-11" }, "la original termina el día anterior a la fecha efectiva");
  assert.ok(!("endDate" in payload.original_patch), "el plan de dominio (camelCase) nunca se envía tal cual");

  const sql = latestFunction("split_recurrence_this_and_future");
  const patchKeys = keysRead(sql.body, "v_original_patch");
  for (const key of Object.keys(payload.original_patch)) {
    assert.ok(patchKeys.has(key), `${sql.file} lee original_patch.${key}`);
  }
});

test("split: ninguna clave del payload (salvo el contenido de `weeks`) es camelCase", () => {
  const camel = collectKeys(sampleSplitPayload()).filter((key) => /[a-z][A-Z]/.test(key.split(".").pop() as string));
  assert.deepEqual(camel, [], "toda clave anidada del payload es snake_case");
});

test("split: el SQL acepta end_date como canónica y endDate sólo como compatibilidad temporal, y rechaza una original activa sin fin", () => {
  const sql = latestFunction("split_recurrence_this_and_future");
  assert.equal(sql.file, "20261004120000_split_original_patch_end_date_contract.sql", "la versión vigente es la migración del contrato");
  const patchKeys = keysRead(sql.body, "v_original_patch");
  assert.deepEqual([...patchKeys].sort(), ["endDate", "end_date", "status"], "claves aceptadas de original_patch");
  assert.match(sql.body, /coalesce\(\s*nullif\(v_original_patch->>'end_date', ''\),\s*nullif\(v_original_patch->>'endDate', ''\)\s*\)::date/, "end_date primero, endDate sólo como respaldo");
  assert.match(sql.body, /if v_patch_end_date is null then\s+raise exception 'No se puede determinar la fecha de fin[^;]*errcode = '22023'/, "una original active sin fecha de fin se rechaza (22023), con la condición real");
  assert.match(sql.body, /v_patch_end_date >= v_effective_date[\s\S]*?anterior a la fecha efectiva/, "el fin debe ser anterior a la fecha efectiva");
  assert.match(sql.body, /v_patch_end_date < v_original\.start_date/, "el fin no puede ser anterior al inicio de la original");
  assert.match(sql.body, /v_patch_status not in \('active', 'ended'\)/, "status sólo active|ended");
  const validation = sql.body.indexOf("No se puede determinar la fecha de fin");
  const firstWrite = sql.body.indexOf("update public.recurrence_rules");
  assert.ok(validation > 0 && firstWrite > validation, "se valida ANTES de escribir cualquier cosa");
  assert.match(readFileSync(join(MIGRATIONS, sql.file), "utf8"), /revoke execute on function public\.split_recurrence_this_and_future\(jsonb\) from anon;/, "regla de proyecto: anon sin EXECUTE");
});

test("split: el repositorio arma el payload SÓLO con buildSplitRpcPayload (nunca pasa el plan de dominio tal cual)", () => {
  const source = readFileSync(fileURLToPath(new URL("../../repositories/recurrence-split.ts", import.meta.url)), "utf8");
  assert.match(source, /buildSplitRpcPayload\(/);
  assert.doesNotMatch(source, /original_patch:\s*plan\.originalPatch/, "el plan camelCase nunca cruza la frontera");
  assert.match(source, /rpc\("split_recurrence_this_and_future", \{ p_payload: payload \}\)/);
});

test("apply_recurrence_participants_from_date: payload de nivel superior, elementos de freeze_occurrences y participants coinciden con el SQL", () => {
  const sql = latestFunction("apply_recurrence_participants_from_date");
  const topLevel = keysRead(sql.body, "p_payload");
  const repo = readFileSync(fileURLToPath(new URL("../../repositories/recurrence-rules.ts", import.meta.url)), "utf8");
  const sent = ["rule_id", "new_participant_ids", "primary_student_id", "freeze_occurrences"];
  assert.deepEqual([...topLevel].sort(), [...sent].sort(), "claves de nivel superior que lee el SQL");
  for (const key of sent) assert.ok(new RegExp(`\\b${key}:`).test(repo), `el repositorio envía ${key}`);

  const students = new Map([
    ["s1", { id: "s1", name: "Ana", levels: ["B1"] }],
    ["s2", { id: "s2", name: "Beto", levels: ["A2"] }],
  ]);
  const [element] = buildParticipantFreezePayload({
    occurrences: [{ occurrenceKey: "k", recurrenceIndex: 3, start: "2026-10-12T21:00:00Z", end: "2026-10-12T22:00:00Z" }],
    rule: { primaryStudentId: "s1", participantIds: ["s1", "s2"], modality: "presencial", classTitle: null, activityKind: "class" },
    students,
  });
  const freezeRead = keysRead(sql.body, "v_freeze");
  const participantRead = keysRead(sql.body, "v_participant");
  const { participants, ...rest } = element;
  assert.deepEqual(Object.keys(rest).sort(), [...freezeRead].filter((key) => key !== "participants").sort(), "claves de cada ocurrencia congelada");
  assert.ok(freezeRead.has("participants"));
  assert.deepEqual(Object.keys(participants[0]).sort(), [...participantRead].sort(), "claves de cada participante");
  assert.equal(element.lesson_type, "group");
  assert.equal(element.student_name, "Ana", "el principal es el que la serie tiene guardado");
  assert.equal(element.level, "B1");
});

test("create_recurrence_series: el payload TypeScript usa exactamente las claves que lee el SQL", () => {
  const sql = latestFunction("create_recurrence_series");
  const payload = recurrenceSeriesInputToPayload({
    operationId: "11111111-1111-4111-8111-111111111111",
    primaryStudentId: "s1",
    ruleType: "weekly",
    cycleLengthWeeks: 1,
    weeks: WEEKS,
    modality: "presencial",
    timezone: "America/Argentina/Buenos_Aires",
    startDate: "2026-10-05",
    endDate: null,
    classTitle: null,
    activityKind: "class",
    participantIds: ["s1"],
  } as never);
  assert.deepEqual(Object.keys(payload).sort(), [...keysRead(sql.body, "p_payload")].sort());
});
