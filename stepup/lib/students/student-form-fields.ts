/**
 * Lógica PURA del formulario de alumno que el original resuelve en `studentMapper.ts` / `studentValidation.ts` (comparada contra él en `student-form-fields.test.ts`):
 * nombre y apellido por separado, edad ↔ fecha de nacimiento estimada, objetivos como lista y situación del primer mes.
 */

export type FirstMonthSituation = "paid" | "pending" | "starts_next_month";

export const FIRST_MONTH_SITUATIONS: ReadonlyArray<{ value: FirstMonthSituation; label: string; description: string }> = [
  { value: "starts_next_month", label: "Desde el próximo mes", description: "No se generará deuda por el mes actual. El primer cargo se creará el próximo mes." },
  { value: "paid", label: "Este mes ya está pago", description: "El mes actual quedará registrado como pagado, sin deuda, recargo ni penalización." },
  { value: "pending", label: "Este mes está pendiente", description: "Se generará el cargo correspondiente al mes actual y se aplicarán las reglas normales de vencimiento." },
];

export const DEFAULT_FIRST_MONTH_SITUATION: FirstMonthSituation = "starts_next_month";

export function isFirstMonthSituation(value: string): value is FirstMonthSituation {
  return value === "paid" || value === "pending" || value === "starts_next_month";
}

/** Igual que `splitName` del original: la primera palabra es el nombre y el resto el apellido. */
export function splitFullName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

/** El nombre guardado es «nombre apellido», con los espacios internos de cada parte tal como se escribieron. */
export function joinFullName(firstName: string, lastName: string): string {
  return `${firstName.trim()} ${lastName.trim()}`.trim();
}

/** Igual que `splitTextIntoItems` del original: un objetivo por línea o separado por comas. */
export function splitGoals(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function joinGoals(goals: readonly string[]): string {
  return goals.join("\n");
}

/** Igual que `isValidAge` del original: vacío es válido; si hay un valor tiene que ser un entero entre 3 y 120. */
export function isValidAge(age: string): boolean {
  if (!age.trim()) return true;
  const value = Number(age);
  return Number.isInteger(value) && value >= 3 && value <= 120;
}

/** Fecha de nacimiento estimada (1 de enero del año que corresponde a esa edad), como el original `createEstimatedBirthDate`. `currentYear` se inyecta para poder probarla. */
export function estimatedBirthDateForAge(age: number, currentYear: number): string {
  return `${String(currentYear - age).padStart(4, "0")}-01-01`;
}

/** Igual que `calculateAge` del original, con la fecha de hoy en Argentina como `YYYY-MM-DD`. */
export function ageFromBirthDate(birthDate: string | null | undefined, todayDateKey: string): number | null {
  if (!birthDate) return null;
  const [birthYear, birthMonth, birthDay] = birthDate.slice(0, 10).split("-").map(Number);
  const [year, month, day] = todayDateKey.split("-").map(Number);
  if (![birthYear, birthMonth, birthDay, year, month, day].every(Number.isFinite)) return null;
  let age = year - birthYear;
  if (month < birthMonth || (month === birthMonth && day < birthDay)) age -= 1;
  return age;
}

/**
 * Qué fecha de nacimiento guardar al editar: igual que `mapEditedStudentForm`, si la edad escrita coincide con la que ya surge de la fecha guardada se CONSERVA esa fecha (no se pisa una fecha
 * exacta por una estimada). `undefined` = no tocar la columna (el campo no vino); `null` = la profesora borró la edad.
 */
export function resolveBirthDateOnEdit(input: { ageText: string | undefined; currentBirthDate: string | null; todayDateKey: string }): string | null | undefined {
  if (input.ageText === undefined) return undefined;
  const trimmed = input.ageText.trim();
  if (!trimmed) return null;
  const requested = Number(trimmed);
  const current = ageFromBirthDate(input.currentBirthDate, input.todayDateKey);
  if (current !== null && requested === current) return input.currentBirthDate;
  return estimatedBirthDateForAge(requested, Number(input.todayDateKey.slice(0, 4)));
}
