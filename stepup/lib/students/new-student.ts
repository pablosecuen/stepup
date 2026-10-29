/**
 * Regla ÚNICA de la etiqueta «Nuevo» de un alumno (29/10/2026). Antes se leía una marca guardada (`is_new`) que nace en «verdadero», que la importación también completaba en «verdadero» y que nada
 * la apagaba nunca: todos los alumnos quedaban «Nuevos» para siempre. Ahora la etiqueta se DERIVA de la fecha de alta real y vence sola.
 *
 * - Fecha: `dateJoined` (la fecha de alta del alumno, día civil). Nunca la de creación o actualización de la fila, la de importación, la de reactivación ni una marca guardada: importar, editar,
 *   reactivar o registrar una clase no reinicia el plazo.
 * - Desde el día del alta hasta el día en que se cumplen 10 días hábiles POSTERIORES al alta (lunes a viernes; ese día la etiqueta ya no se muestra). Los feriados no se inventan: un feriado
 *   cuenta como día hábil.
 * - «Hoy» es la fecha local de Argentina, la misma en el servidor y en el navegador (no depende de la zona del equipo).
 * - Sin fecha, con fecha inválida o con fecha futura (todavía no se dio de alta) no se marca como nuevo.
 */
import { localDateKeyInTimeZone } from "../payments/dates.ts";

/** Días hábiles posteriores al alta que la etiqueta permanece visible: al cumplirse el décimo, desaparece. */
export const NEW_STUDENT_BUSINESS_DAYS = 10;

const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Días desde 1970-01-01 de un día civil `AAAA-MM-DD`, o `null` si no existe (mes 13, 31 de febrero, texto cualquiera). Aritmética en UTC: sin zona horaria ni horario de verano. */
function civilDayNumber(dateKey: string | null | undefined): number | null {
  if (typeof dateKey !== "string") return null;
  const match = CIVIL_DATE_PATTERN.exec(dateKey.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return ms / 86_400_000;
}

/** Lunes a viernes. El 1/1/1970 fue jueves. */
function isWeekday(dayNumber: number): boolean {
  const weekday = (((dayNumber + 4) % 7) + 7) % 7; // 0 = domingo … 6 = sábado
  return weekday >= 1 && weekday <= 5;
}

/** Días hábiles (lunes a viernes) estrictamente posteriores a `from` y hasta `to` inclusive. Corta apenas supera `cap`. */
function businessDaysAfter(from: number, to: number, cap: number): number {
  let count = 0;
  for (let day = from + 1; day <= to && count < cap; day += 1) if (isWeekday(day)) count += 1;
  return count;
}

/**
 * ¿Se muestra «Nuevo» a un alumno dado de alta en `dateJoined` en el día `todayDateKey` (fecha civil de Argentina)? Pura y determinista. Para usar «ahora» ver `isNewStudent`.
 */
export function isNewStudentOn(dateJoined: string | null | undefined, todayDateKey: string): boolean {
  const joined = civilDayNumber(dateJoined);
  const today = civilDayNumber(todayDateKey);
  if (joined === null || today === null) return false;
  if (joined > today) return false;
  return businessDaysAfter(joined, today, NEW_STUDENT_BUSINESS_DAYS) < NEW_STUDENT_BUSINESS_DAYS;
}

/** La misma regla con el reloj: «hoy» es el día civil de Argentina de `now`. */
export function isNewStudent(dateJoined: string | null | undefined, now: Date = new Date()): boolean {
  return isNewStudentOn(dateJoined, localDateKeyInTimeZone(now));
}
