import { test } from "node:test";
import assert from "node:assert/strict";
import { applyStudentFilters, DEFAULT_FILTER_STATE, paginate, type StudentsFilterState } from "../filters.ts";
import type { StudentRecord } from "../../repositories/students-mapping.ts";

function student(overrides: Partial<StudentRecord> & { id: string; name: string }): StudentRecord {
  return {
    phone: null,
    whatsapp: null,
    email: null,
    usualDays: [],
    usualTime: null,
    notes: null,
    birthDate: null,
    levels: [],
    initialLevel: "",
    modality: "presencial",
    status: "activo",
    category: "otro",
    billingType: "por_clase",
    billingPlan: null,
    dateJoined: "2026-01-01",
    lastReactivatedAt: null,
    statusChangeDate: null,
    usualDurationMinutes: 60,
    weeklyFrequency: 1,
    price: 10000,
    pendingHomework: null,
    alerts: [],
    currentGoals: [],
    strengths: [],
    areasToImprove: [],
    isFeatured: false,
    isNew: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const ROSTER: StudentRecord[] = [
  student({ id: "1", name: "Zulema Torres", status: "activo", levels: ["B1"], modality: "presencial" }),
  student({ id: "2", name: "Ana Pérez", status: "activo", levels: ["A2"], modality: "online" }),
  student({ id: "3", name: "Bruno Gómez", status: "pausado", levels: ["B1"], modality: "presencial" }),
  student({ id: "4", name: "Carla Ruiz", status: "archivado", levels: ["C1"], modality: "mixta" }),
];

test("DEFAULT_FILTER_STATE: status por defecto es 'activo' (regla confirmada, no 'todos')", () => {
  assert.equal(DEFAULT_FILTER_STATE.status, "activo");
});

test("applyStudentFilters: con el filtro por defecto, sólo devuelve activos (pausado/archivado nunca aparecen)", () => {
  const result = applyStudentFilters(ROSTER, DEFAULT_FILTER_STATE);
  assert.deepEqual(result.map((s) => s.id), ["2", "1"]); // Ana, Zulema — orden alfabético
});

test("applyStudentFilters: status 'todos' incluye los 4 estados", () => {
  const filters: StudentsFilterState = { ...DEFAULT_FILTER_STATE, status: "todos" };
  const result = applyStudentFilters(ROSTER, filters);
  assert.equal(result.length, 4);
});

test("applyStudentFilters: orden alfabético español, insensible a mayúsculas/acentos", () => {
  const result = applyStudentFilters(ROSTER, { ...DEFAULT_FILTER_STATE, status: "todos" });
  assert.deepEqual(result.map((s) => s.name), ["Ana Pérez", "Bruno Gómez", "Carla Ruiz", "Zulema Torres"]);
});

test("applyStudentFilters: filtro por nivel usa inclusión en el array de niveles", () => {
  const filters: StudentsFilterState = { ...DEFAULT_FILTER_STATE, status: "todos", level: "B1" };
  const result = applyStudentFilters(ROSTER, filters);
  assert.deepEqual(result.map((s) => s.id).sort(), ["1", "3"]);
});

test("applyStudentFilters: filtro por modalidad", () => {
  const filters: StudentsFilterState = { ...DEFAULT_FILTER_STATE, status: "todos", modality: "mixta" };
  const result = applyStudentFilters(ROSTER, filters);
  assert.deepEqual(result.map((s) => s.id), ["4"]);
});

test("applyStudentFilters: combinación de filtros (estado + nivel + búsqueda) — AND, nunca OR", () => {
  const filters: StudentsFilterState = { ...DEFAULT_FILTER_STATE, status: "activo", level: "B1", search: "zul" };
  const result = applyStudentFilters(ROSTER, filters);
  assert.deepEqual(result.map((s) => s.id), ["1"]);
});

test("applyStudentFilters: búsqueda que no coincide con el estado filtrado devuelve vacío, nunca ignora el filtro de estado", () => {
  const filters: StudentsFilterState = { ...DEFAULT_FILTER_STATE, status: "activo", search: "gomez" };
  const result = applyStudentFilters(ROSTER, filters);
  assert.deepEqual(result, []); // Bruno Gómez es 'pausado', no 'activo'
});

test("paginate: divide en páginas del tamaño pedido", () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  const page1 = paginate(items, 1, 10);
  assert.deepEqual(page1.items, Array.from({ length: 10 }, (_, i) => i));
  assert.equal(page1.totalPages, 3);
  assert.equal(page1.totalItems, 25);

  const page3 = paginate(items, 3, 10);
  assert.deepEqual(page3.items, [20, 21, 22, 23, 24]);
});

test("paginate: una página pedida fuera de rango se recorta al rango real, nunca lanza ni devuelve vacío por error", () => {
  const items = [1, 2, 3];
  const tooHigh = paginate(items, 99, 10);
  assert.equal(tooHigh.page, 1);
  assert.deepEqual(tooHigh.items, [1, 2, 3]);

  const tooLow = paginate(items, 0, 10);
  assert.equal(tooLow.page, 1);
});

test("paginate: lista vacía nunca lanza, totalPages mínimo es 1", () => {
  const result = paginate([], 1, 10);
  assert.deepEqual(result.items, []);
  assert.equal(result.totalPages, 1);
  assert.equal(result.totalItems, 0);
});
