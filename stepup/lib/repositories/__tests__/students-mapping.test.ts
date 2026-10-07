import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toStudentRecord,
  validateNewStudentInput,
  studentInputToRowPatch,
  studentInputToRpcPayload,
  updateInputToRowPatch,
} from "../students-mapping.ts";
import type { StudentRow } from "../../db/database.types.ts";

function baseRow(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    owner_id: "22222222-2222-2222-2222-222222222222",
    legacy_mobile_id: null,
    name: "Ana Pérez",
    phone: null,
    whatsapp: null,
    email: null,
    usual_days: [],
    usual_time: null,
    notes: null,
    birth_date: null,
    levels: ["B1"],
    initial_level: "A2",
    modality: "presencial",
    status: "activo",
    category: "adulto_interes_personal",
    billing_type: "mensual",
    billing_plan: null,
    date_joined: "2026-01-10",
    last_reactivated_at: null,
    status_change_date: null,
    usual_duration_minutes: 60,
    weekly_frequency: 1,
    price: 20000,
    pending_homework: null,
    alerts: [],
    current_goals: [],
    strengths: [],
    areas_to_improve: [],
    is_featured: false,
    is_new: true,
    created_at: "2026-01-10T12:00:00.000Z",
    updated_at: "2026-01-10T12:00:00.000Z",
    ...overrides,
  };
}

test("toStudentRecord: mapea cada columna snake_case a su campo camelCase real, sin perder ninguna", () => {
  const row = baseRow({ phone: "1122334455", levels: ["B1", "Infantes"] });
  const record = toStudentRecord(row);
  assert.equal(record.id, row.id);
  assert.equal(record.name, "Ana Pérez");
  assert.equal(record.phone, "1122334455");
  assert.deepEqual(record.levels, ["B1", "Infantes"]);
  assert.equal(record.initialLevel, "A2");
  assert.equal(record.billingType, "mensual");
  assert.equal(record.usualDurationMinutes, 60);
  assert.equal(record.isFeatured, false);
  assert.equal(record.createdAt, row.created_at);
});

test("toStudentRecord: nunca inventa un campo calculado (nextClassAt/paymentStatus/averageGrade no existen en StudentRecord)", () => {
  const record = toStudentRecord(baseRow());
  assert.equal("nextClassAt" in record, false, "nextClassAt se deriva por SQL en fases posteriores, nunca se guarda en students");
  assert.equal("paymentStatus" in record, false, "paymentStatus se deriva de payment_charges, nunca se guarda en students");
  assert.equal("averageGrade" in record, false, "averageGrade se deriva de las evaluaciones, nunca se guarda en students");
});

test("validateNewStudentInput: nombre vacío o sólo espacios es inválido", () => {
  const errors = validateNewStudentInput({
    name: "   ",
    modality: "presencial",
    category: "otro",
    billingType: "mensual",
    dateJoined: "2026-09-16",
    price: 1000,
  });
  assert.ok(errors.some((e) => e.field === "name"));
});

test("validateNewStudentInput: precio negativo o NaN es inválido — nunca se acepta un precio inventado", () => {
  const negative = validateNewStudentInput({
    name: "Juan",
    modality: "online",
    category: "otro",
    billingType: "por_clase",
    dateJoined: "2026-09-16",
    price: -1,
  });
  assert.ok(negative.some((e) => e.field === "price"));

  const notANumber = validateNewStudentInput({
    name: "Juan",
    modality: "online",
    category: "otro",
    billingType: "por_clase",
    dateJoined: "2026-09-16",
    price: Number.NaN,
  });
  assert.ok(notANumber.some((e) => e.field === "price"));
});

test("validateNewStudentInput: precio cero es válido (clase de cortesía / complimentary)", () => {
  const errors = validateNewStudentInput({
    name: "Juan",
    modality: "online",
    category: "otro",
    billingType: "por_clase",
    dateJoined: "2026-09-16",
    price: 0,
  });
  assert.equal(errors.some((e) => e.field === "price"), false);
});

test("validateNewStudentInput: formulario completo y válido no produce ningún error", () => {
  const errors = validateNewStudentInput({
    name: "María López",
    modality: "mixta",
    category: "universitario",
    billingType: "mensual",
    dateJoined: "2026-09-16",
    price: 15000,
    usualDurationMinutes: 45,
    weeklyFrequency: 2,
  });
  assert.deepEqual(errors, []);
});

test("studentInputToRowPatch: recorta espacios del nombre y aplica los valores por defecto reales (60 min, frecuencia 1, nivel inicial vacío)", () => {
  const patch = studentInputToRowPatch(
    {
      name: "  Pedro Gómez  ",
      modality: "presencial",
      category: "secundaria",
      billingType: "mensual",
      dateJoined: "2026-09-16",
      price: 18000,
    },
    "owner-abc"
  );
  assert.equal(patch.owner_id, "owner-abc");
  assert.equal(patch.name, "Pedro Gómez");
  assert.equal(patch.usual_duration_minutes, 60);
  assert.equal(patch.weekly_frequency, 1);
  assert.equal(patch.initial_level, "");
  assert.deepEqual(patch.levels, []);
});

test("studentInputToRowPatch: owner_id siempre viene del segundo argumento (la sesión real), nunca del input del formulario", () => {
  const patch = studentInputToRowPatch(
    {
      name: "Pedro",
      modality: "presencial",
      category: "otro",
      billingType: "por_clase",
      dateJoined: "2026-09-16",
      price: 1000,
    },
    "real-session-owner"
  );
  assert.equal(patch.owner_id, "real-session-owner");
  assert.equal("ownerId" in patch, false, "el input nunca puede inyectar su propio owner_id");
});

test("studentInputToRpcPayload: mismos defaults reales que studentInputToRowPatch, en camelCase para la RPC create_student_with_operation", () => {
  const payload = studentInputToRpcPayload({
    name: "  Pedro Gómez  ",
    modality: "presencial",
    category: "secundaria",
    billingType: "mensual",
    dateJoined: "2026-09-16",
    price: 18000,
  });
  assert.equal(payload.name, "Pedro Gómez");
  assert.equal(payload.usualDurationMinutes, 60);
  assert.equal(payload.weeklyFrequency, 1);
  assert.equal(payload.initialLevel, "");
  assert.deepEqual(payload.levels, []);
  assert.equal("ownerId" in payload, false, "owner_id nunca viaja en el payload — lo resuelve auth.uid() en el servidor");
});

test("updateInputToRowPatch: sólo incluye los campos realmente provistos — un patch parcial nunca sobrescribe el resto con undefined", () => {
  const patch = updateInputToRowPatch({ price: 25000 });
  assert.deepEqual(patch, { price: 25000 });
});

test("updateInputToRowPatch: permite explícitamente volver un campo a null (ej. quitar la tarea pendiente)", () => {
  const patch = updateInputToRowPatch({ pendingHomework: null });
  assert.deepEqual(patch, { pending_homework: null });
});

test("updateInputToRowPatch: patch vacío produce un objeto vacío, nunca toca ninguna columna", () => {
  assert.deepEqual(updateInputToRowPatch({}), {});
});
