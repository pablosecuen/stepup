// Alta y edición del alumno: nombre y apellido, edad, objetivos y situación del primer mes. Se EJECUTAN las dos implementaciones (el original en el núcleo de referencia y la web) con los mismos datos.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mapEditedStudentForm, mapNewStudentForm, mapStudentToEditableForm } from "../../original-core/features/new-student/utils/studentMapper.ts";
import { validateNewStudentForm } from "../../original-core/features/new-student/utils/studentValidation.ts";
import { calculateAge } from "../../original-core/features/student-profile/utils/format.ts";
import { PENDING_CONFIRMATION_MESSAGE, buildFirstMonthInput } from "../first-month.ts";
import { ageFromBirthDate, estimatedBirthDateForAge, isValidAge, joinFullName, joinGoals, resolveBirthDateOnEdit, splitFullName, splitGoals } from "../student-form-fields.ts";
import { validateNewStudentInput, studentInputToRpcPayload, type NewStudentInput } from "../../repositories/students-mapping.ts";

const form = (overrides: Record<string, unknown> = {}) =>
  ({ firstName: "Ana", lastName: "Gómez", age: "", phone: "", whatsapp: "", email: "", levels: ["B1"], modality: "presencial", category: "otro", billingType: "por_clase", firstMonthSituation: "starts_next_month", paidAt: "", price: 36000, weeklyFrequency: "1", usualDurationMinutes: "60", goals: "", notes: "", status: "activo", usualDays: [], usualTime: "", ...overrides }) as never;

test("nombre y apellido: la web guarda el mismo nombre completo que el original y lo vuelve a separar igual", () => {
  for (const [first, last] of [["Ana", "Gómez"], ["  Ana ", " Gómez  "], ["María José", "Pérez"], ["Ana", "De La Fuente"]]) {
    const original = mapNewStudentForm(form({ firstName: first, lastName: last })).profile.name;
    assert.equal(joinFullName(first, last), original, `${first}|${last}`);
  }
  for (const name of ["Ana Gómez", "Ana", "Ana María De La Fuente", "  Ana   Gómez  "]) {
    const editable = mapStudentToEditableForm({ ...mapNewStudentForm(form()).profile, name } as never);
    const web = splitFullName(name);
    assert.deepEqual({ firstName: web.firstName, lastName: web.lastName }, { firstName: editable.firstName, lastName: editable.lastName }, name);
  }
});

test("objetivos: se separan por línea o coma igual que el original y vuelven a mostrarse una por línea", () => {
  for (const goals of ["", "Preparar IELTS", "Preparar IELTS, mejorar speaking", "uno\ndos\n\n tres ,, cuatro", "  ,  \n "]) {
    assert.deepEqual(splitGoals(goals), mapNewStudentForm(form({ goals })).profile.currentGoals, JSON.stringify(goals));
  }
  assert.equal(joinGoals(["a", "b"]), "a\nb");
  const reopened = mapStudentToEditableForm(mapNewStudentForm(form({ goals: "a, b" })).profile).goals;
  assert.equal(reopened, joinGoals(splitGoals("a, b")));
});

test("edad: la validación coincide con la del original para cada valor", () => {
  for (const age of ["", "  ", "3", "25", "120", "2", "121", "0", "-5", "2.5", "abc", "1e2", "03"]) {
    const original = validateNewStudentForm(form({ age })).errors.some((e: string) => e.includes("edad"));
    assert.equal(!isValidAge(age), original, `edad «${age}»`);
  }
});

test("edad → fecha de nacimiento estimada → edad: vuelve a dar la misma edad, como en el original", () => {
  const today = "2026-10-28";
  for (let age = 3; age <= 120; age += 1) {
    const birth = estimatedBirthDateForAge(age, 2026);
    assert.equal(ageFromBirthDate(birth, today), age);
  }
  // Contra el original, con el reloj real: su fecha estimada (1 de enero local) da la misma edad que la de la web.
  const now = new Date();
  const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  for (const age of [3, 25, 60, 120]) {
    const originalBirth = new Date(now.getFullYear() - age, 0, 1).toISOString();
    assert.equal(ageFromBirthDate(estimatedBirthDateForAge(age, now.getFullYear()), localToday), calculateAge(originalBirth));
  }
  assert.equal(ageFromBirthDate(null, today), null);
  // Cumpleaños todavía no ocurrido este año: un año menos (misma regla que `calculateAge`).
  assert.equal(ageFromBirthDate("2000-12-31", "2026-10-28"), 25);
  assert.equal(ageFromBirthDate("2000-10-28", "2026-10-28"), 26);
});

test("editar la edad: si coincide con la guardada se conserva la fecha exacta; si cambia se estima; vacío la borra", () => {
  const today = "2026-10-28";
  // Misma regla que `mapEditedStudentForm`: con la misma edad se conserva `currentProfile.birthDate`.
  const exact = "2000-03-15";
  const profile = { ...mapNewStudentForm(form()).profile, birthDate: exact };
  const keptByOriginal = mapEditedStudentForm(form({ age: String(ageFromBirthDate(exact, today)) }), { id: "x", name: "a", levels: [], modality: "presencial", status: "activo" } as never, profile).profile.birthDate;
  assert.equal(keptByOriginal, exact);
  assert.equal(resolveBirthDateOnEdit({ ageText: String(ageFromBirthDate(exact, today)), currentBirthDate: exact, todayDateKey: today }), exact);
  assert.equal(resolveBirthDateOnEdit({ ageText: "30", currentBirthDate: exact, todayDateKey: today }), "1996-01-01");
  assert.equal(resolveBirthDateOnEdit({ ageText: "", currentBirthDate: exact, todayDateKey: today }), null);
  assert.equal(resolveBirthDateOnEdit({ ageText: undefined, currentBirthDate: exact, todayDateKey: today }), undefined);
  assert.equal(resolveBirthDateOnEdit({ ageText: "30", currentBirthDate: null, todayDateKey: today }), "1996-01-01");
});

test("precio del alta: tiene que ser mayor que cero, como el original", () => {
  const input = (price: number): NewStudentInput => ({ name: "Ana Gómez", modality: "presencial", category: "otro", billingType: "por_clase", dateJoined: "2026-10-28", price });
  for (const price of [0, -1, Number.NaN, 0.5, 36000]) {
    const originalRejects = validateNewStudentForm(form({ price })).errors.some((e: string) => e.includes("precio"));
    const webRejects = validateNewStudentInput(input(price)).some((e) => e.field === "price");
    // El original sólo admite enteros positivos (sin decimales); la web admite centavos exactos (decisión previa) pero rechaza igual cero, negativos y NaN.
    if (price === 0.5) assert.equal(webRejects, false);
    else assert.equal(webRejects, originalRejects, `precio ${price}`);
  }
});

test("el payload del alta lleva edad, objetivos y la situación del primer mes sólo si es mensual", () => {
  const base: NewStudentInput = { name: "Ana Gómez", modality: "presencial", category: "otro", billingType: "mensual", dateJoined: "2026-10-28", price: 36000, birthDate: "2000-01-01", currentGoals: ["IELTS"], firstMonth: { situation: "pending", currentPeriod: "2026-10", dueDate: "2026-10-12" } };
  const monthly = studentInputToRpcPayload(base);
  assert.equal(monthly.birthDate, "2000-01-01");
  assert.deepEqual(monthly.currentGoals, ["IELTS"]);
  assert.deepEqual(monthly.firstMonth, base.firstMonth);
  assert.equal(studentInputToRpcPayload({ ...base, billingType: "por_clase" }).firstMonth, undefined);
});

test("situación del primer mes: valores por defecto, confirmación de «pendiente» y fecha del pago", () => {
  const today = "2026-10-28";
  const call = (extra: Partial<Parameters<typeof buildFirstMonthInput>[0]> = {}) => buildFirstMonthInput({ billingType: "mensual", situationText: "", paidAtText: "", confirmPending: false, todayDateKey: today, ...extra });
  assert.deepEqual(call({ billingType: "por_clase", situationText: "paid" }), {}, "por clase nunca tiene situación del primer mes");
  assert.deepEqual(call(), { firstMonth: { situation: "starts_next_month", currentPeriod: "2026-10" } }, "sin elegir vale lo mismo que el original: desde el próximo mes");
  assert.equal(call({ situationText: "ayer" }).error, "Elegí desde cuándo querés comenzar a controlar sus pagos.");
  assert.equal(call({ situationText: "pending" }).error, PENDING_CONFIRMATION_MESSAGE);
  const pending = call({ situationText: "pending", confirmPending: true });
  assert.equal(pending.firstMonth?.situation, "pending");
  assert.match(pending.firstMonth?.dueDate ?? "", /^2026-10-\d{2}$/);
  const paid = call({ situationText: "paid" });
  assert.equal(paid.firstMonth?.paidAt, today, "la fecha real del pago arranca en hoy");
  assert.equal(call({ situationText: "paid", paidAtText: "2026-10-05" }).firstMonth?.paidAt, "2026-10-05");
  assert.equal(call({ situationText: "paid", paidAtText: "2026-11-01" }).error, "La fecha del pago no puede ser futura.");
  assert.equal(call({ situationText: "paid", paidAtText: "05/10/2026" }).error, "La fecha real del pago no es válida.");
});
