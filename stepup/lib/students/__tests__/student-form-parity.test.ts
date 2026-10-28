// Comparación campo por campo de la validación del alta/edición de alumno: la web contra el original (`validateNewStudentForm`, ejecutado en el núcleo de referencia).
// Sólo se comparan las reglas que la web comparte con el original; las que la web NO tiene (edad, apellido obligatorio, precio > 0, horario habitual) se documentan en la matriz.
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateNewStudentForm } from "../../original-core/features/new-student/utils/studentValidation.ts";
import { validateNewStudentInput, validateUpdateStudentInput, validateStudentLimits, type NewStudentInput } from "../../repositories/students-mapping.ts";

const baseForm = { firstName: "Ana", lastName: "Gómez", age: "", phone: "", whatsapp: "", email: "", levels: [], modality: "presencial", category: "otro", billingType: "por_clase", firstMonthSituation: "pending", paidAt: "", price: 36000, weeklyFrequency: "1", usualDurationMinutes: "60", goals: "", notes: "", status: "activo", usualDays: [], usualTime: "" } as never;
const baseInput: NewStudentInput = { name: "Ana Gómez", modality: "presencial", category: "otro", billingType: "por_clase", dateJoined: "2026-10-28", price: 36000, weeklyFrequency: 1, usualDurationMinutes: 60 };

const cases: Array<{ name: string; frequency: number; minutes: number; email: string }> = [
  { name: "valores normales", frequency: 2, minutes: 60, email: "ana@ejemplo.com" },
  { name: "14 clases por semana (el máximo)", frequency: 14, minutes: 60, email: "" },
  { name: "15 clases por semana", frequency: 15, minutes: 60, email: "" },
  { name: "480 minutos (el máximo)", frequency: 1, minutes: 480, email: "" },
  { name: "481 minutos", frequency: 1, minutes: 481, email: "" },
  { name: "correo sin arroba", frequency: 1, minutes: 60, email: "ana.ejemplo.com" },
  { name: "correo sin punto", frequency: 1, minutes: 60, email: "ana@ejemplo" },
  { name: "correo con espacios alrededor", frequency: 1, minutes: 60, email: "  ana@ejemplo.com  " },
  { name: "correo con espacio adentro", frequency: 1, minutes: 60, email: "a na@ejemplo.com" },
];

test("límites de frecuencia, duración y correo: la web y el original aceptan y rechazan lo mismo", () => {
  for (const c of cases) {
    const original = validateNewStudentForm({ ...(baseForm as object), weeklyFrequency: String(c.frequency), usualDurationMinutes: String(c.minutes), email: c.email } as never);
    const web = validateNewStudentInput({ ...baseInput, weeklyFrequency: c.frequency, usualDurationMinutes: c.minutes, email: c.email });
    const originalSays = (fragment: string) => original.errors.some((message) => message.includes(fragment));
    const webSays = (field: string) => web.some((error) => error.field === field);
    assert.equal(webSays("weeklyFrequency"), originalSays("frecuencia semanal") || originalSays("cantidad habitual"), `${c.name}: frecuencia`);
    assert.equal(webSays("usualDurationMinutes"), originalSays("duración habitual"), `${c.name}: duración`);
    assert.equal(webSays("email"), originalSays("email"), `${c.name}: correo`);
  }
});

test("la edición aplica los mismos límites que el alta; un campo ausente no se valida", () => {
  assert.deepEqual(validateUpdateStudentInput({ weeklyFrequency: 15 }).map((e) => e.field), ["weeklyFrequency"]);
  assert.deepEqual(validateUpdateStudentInput({ usualDurationMinutes: 481 }).map((e) => e.field), ["usualDurationMinutes"]);
  assert.deepEqual(validateUpdateStudentInput({ email: "mal" }).map((e) => e.field), ["email"]);
  assert.deepEqual(validateUpdateStudentInput({}), []);
  assert.deepEqual(validateUpdateStudentInput({ email: "" , weeklyFrequency: 14, usualDurationMinutes: 480 }), []);
  assert.deepEqual(validateStudentLimits({ email: null }), []);
});
