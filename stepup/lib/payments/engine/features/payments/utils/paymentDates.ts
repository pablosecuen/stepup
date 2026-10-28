// Puerto VERBATIM del original (`src/features/payments/utils/paymentDates.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
// Utilidades de fecha mínimas y autocontenidas para el dominio de pagos.
// Deliberadamente no reutiliza src/features/calendar/utils/calendarTimezone.ts:
// el motor de cobros debe poder evolucionar sin depender de decisiones
// internas del módulo de calendario. Todo acá opera sobre "date keys"
// YYYY-MM-DD ya resueltos — ninguna función hace conversión de zona horaria.

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function assertDateKey(value: string, label: string): void {
  if (!isValidDateKey(value)) {
    throw new RangeError(`${label} debe tener el formato YYYY-MM-DD (recibido: formato inválido).`);
  }
}

/** Días transcurridos de `from` a `to` (positivo si `to` es posterior). */
export function daysBetweenDateKeys(from: string, to: string): number {
  assertDateKey(from, 'from');
  assertDateKey(to, 'to');
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);
  const fromMs = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const toMs = Date.UTC(toYear, toMonth - 1, toDay);
  return Math.round((toMs - fromMs) / 86_400_000);
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  assertDateKey(dateKey, 'dateKey');
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate()
  ).padStart(2, '0')}`;
}

const BILLING_PERIOD_PATTERN = /^(\d{4})-(\d{2})$/;

/**
 * Validación central de un período de facturación 'YYYY-MM': exige el
 * formato exacto Y un mes real (01 a 12). `/^\d{4}-\d{2}$/` sólo, sin este
 * chequeo de rango, deja pasar valores imposibles como "2026-13". Cualquier
 * lugar del dominio de pagos (o de la validación/análisis de respaldos) que
 * necesite decidir si un `billingPeriod` es válido debe reutilizar esta
 * función en vez de repetir su propio regex.
 */
export function isValidBillingPeriod(value: string): boolean {
  const match = BILLING_PERIOD_PATTERN.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

/**
 * Corrección 2026-08-11 (a pedido de Joaquín — recargos automáticos
 * configurables): último día REAL de un período de facturación 'YYYY-MM'
 * (28/29 en febrero, 30 en meses cortos, 31 en los largos) — nunca asumir
 * 31 a secas. `Date.UTC(year, month, 0)` es "el día 0 del mes siguiente",
 * que el motor de fechas de JS resuelve como el último día del mes actual.
 */
export function lastDayOfBillingPeriod(billingPeriod: string): number {
  if (!isValidBillingPeriod(billingPeriod)) {
    throw new RangeError('billingPeriod debe tener el formato YYYY-MM con un mes entre 01 y 12.');
  }
  const [year, month] = billingPeriod.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Un día de mes (1-31) configurado por la profesora puede no existir en
 * TODOS los meses (ej. 31 en febrero) — se resuelve de forma segura al
 * último día REAL de ese período específico, nunca a un error ni a un
 * "mes siguiente" accidental.
 */
export function clampDayToBillingPeriod(day: number, billingPeriod: string): number {
  return Math.min(day, lastDayOfBillingPeriod(billingPeriod));
}

/** Primer día (date key) de un período de facturación 'YYYY-MM' con un mes real (01 a 12). */
export function firstDayOfBillingPeriod(billingPeriod: string): string {
  if (!isValidBillingPeriod(billingPeriod)) {
    throw new RangeError('billingPeriod debe tener el formato YYYY-MM con un mes entre 01 y 12.');
  }
  return `${billingPeriod}-01`;
}

/**
 * Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO: mensualidades
 * "Mes vencido" al comenzar el mes): `true` si `dateKey` cae sábado o domingo.
 * Sin dependencias externas ni calendario de feriados — sólo día de la semana,
 * calculado en UTC puro (mismo criterio que el resto de este archivo).
 */
export function isWeekendDateKey(dateKey: string): boolean {
  assertDateKey(dateKey, 'dateKey');
  const [year, month, day] = dateKey.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=domingo, 6=sábado
  return weekday === 0 || weekday === 6;
}

/**
 * El primer día HÁBIL (lunes a viernes) a partir de `dateKey`, inclusive —
 * si `dateKey` ya es hábil, se devuelve tal cual. Nunca retrocede, nunca
 * salta más de 2 días (el máximo real entre un sábado y el lunes
 * siguiente). Sin calendario de feriados (no existe ninguno en el
 * proyecto): sólo fin de semana.
 */
export function nextBusinessDay(dateKey: string): string {
  let candidate = dateKey;
  while (isWeekendDateKey(candidate)) {
    candidate = addDaysToDateKey(candidate, 1);
  }
  return candidate;
}

/**
 * Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO: mensualidad
 * generada con vencimiento el día 1 en vez del día configurado por la
 * profesora): ÚNICA fuente que resuelve el vencimiento REAL de una
 * mensualidad a partir de `dueDay` (1-28, `MonthlyBillingPlan.dueDay`) y el
 * período — nunca `firstDayOfBillingPeriod` para esto. `dueDay` se recorta
 * al último día real del período (`clampDayToBillingPeriod`, aunque con
 * 1-28 nunca hace falta en la práctica) y, si cae sábado o domingo, se
 * corre al lunes siguiente (`nextBusinessDay`) — nunca a un feriado
 * externo, no existe ese concepto en el proyecto. Usada tanto para generar
 * cargos nuevos como para la vista previa de "cargo todavía no generado".
 * Pura.
 */
export function resolveMonthlyDueDate(billingPeriod: string, dueDay: number): string {
  const clampedDay = clampDayToBillingPeriod(dueDay, billingPeriod);
  const rawDueDate = `${billingPeriod}-${String(clampedDay).padStart(2, '0')}`;
  return nextBusinessDay(rawDueDate);
}

/** Período de facturación 'YYYY-MM' al que pertenece una fecha. */
export function billingPeriodOfDateKey(dateKey: string): string {
  assertDateKey(dateKey, 'dateKey');
  return dateKey.slice(0, 7);
}

/**
 * El período de facturación 'YYYY-MM' siguiente a `billingPeriod` — cruza
 * diciembre→enero correctamente. Comparar dos períodos 'YYYY-MM' con `<`/`>`
 * de string ya da el orden cronológico correcto (ancho fijo), así que no
 * hace falta una función `isBillingPeriodBefore`: `a < b` alcanza.
 */
export function nextBillingPeriod(billingPeriod: string): string {
  if (!isValidBillingPeriod(billingPeriod)) {
    throw new RangeError('billingPeriod debe tener el formato YYYY-MM con un mes entre 01 y 12.');
  }
  const [year, month] = billingPeriod.split('-').map(Number);
  const totalMonths = year * 12 + (month - 1) + 1;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = (totalMonths % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

/**
 * Los últimos `n` períodos 'YYYY-MM', en orden cronológico ascendente
 * (el más viejo primero), terminando en el mes de `evaluationDate`
 * (inclusive). Pensado para los gráficos de historial de pagos (Fase Pagos
 * 4C.1): siempre devuelve exactamente `n` períodos, incluso si algunos no
 * tienen ninguna obligación — el zero-fill de esos huecos es
 * responsabilidad de quien arma las estadísticas, no de esta función.
 */
export function lastNBillingPeriods(evaluationDate: string, n: number): string[] {
  if (!Number.isInteger(n) || n <= 0) {
    throw new RangeError('n debe ser un entero positivo.');
  }
  const currentPeriod = billingPeriodOfDateKey(evaluationDate);
  const [year, month] = currentPeriod.split('-').map(Number);
  const periods: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const totalMonths = year * 12 + (month - 1) - i;
    const periodYear = Math.floor(totalMonths / 12);
    const periodMonth = (totalMonths % 12) + 1;
    periods.push(`${periodYear}-${String(periodMonth).padStart(2, '0')}`);
  }
  return periods;
}

/** Convierte un instante ISO (o date key) a date key YYYY-MM-DD, sin ajuste de huso horario. */
export function toDateKey(isoOrDateKey: string): string {
  if (isValidDateKey(isoOrDateKey)) return isoOrDateKey;
  return isoOrDateKey.slice(0, 10);
}

export function isDateKeyBeforeOrEqual(a: string, b: string): boolean {
  return daysBetweenDateKeys(a, b) >= 0;
}

/**
 * Zona horaria de referencia del negocio (Fase 4B.1): generar la mensualidad
 * automática y evaluar deuda "hoy" siempre usa la fecha/mes de Buenos
 * Aires, sin importar en qué huso esté configurado el dispositivo.
 */
export const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires';

/**
 * Date key (YYYY-MM-DD) de un instante en una zona horaria dada. Réplica
 * mínima e independiente de la técnica que ya usa
 * `calendar/utils/calendarTimezone.ts` (Intl.DateTimeFormat +
 * formatToParts): se implementa acá mismo a propósito, sin importarla, para
 * que el dominio de pagos siga sin depender de decisiones internas del
 * módulo de calendario (mismo criterio que el resto de este archivo).
 */
/**
 * Corrección 2026-07-19 (a pedido de Joaquín — clases pendientes y centro
 * de cobros): clave de semana ISO-8601 ('YYYY-Www') de un date key —
 * semana 1 es la que contiene el primer jueves del año (regla ISO
 * estándar). Se usa como `billingPeriod` de los cargos `'semanal'`.
 */
export function isoWeekKey(dateKey: string): string {
  assertDateKey(dateKey, 'dateKey');
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // Día ISO (1=lunes..7=domingo) — mover al jueves de esa misma semana ISO.
  const isoDay = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + 4 - isoDay);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNumber = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(weekNumber).padStart(2, '0')}`;
}

/**
 * Fecha (date key) del lunes de la semana ISO que contiene `dateKey` — el
 * vencimiento base de un cargo `'semanal'` se calcula sobre este lunes,
 * nunca sobre `dueWeekday` directamente (eso sólo decide qué DÍA de esa
 * semana vence, no a qué semana pertenece el cargo).
 */
export function startOfIsoWeek(dateKey: string): string {
  assertDateKey(dateKey, 'dateKey');
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isoDay = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (isoDay - 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Clave de período quincenal: la fecha de inicio (date key) del bloque de
 * 14 días que contiene `dateKey`, contado desde `anchorDate` — nunca desde
 * el calendario ISO de semanas. Dos fechas dentro del mismo bloque de 14
 * días siempre producen la misma clave, así que identifican la misma
 * obligación (idempotencia, igual criterio que `billingPeriod` mensual).
 */
export function biweeklyPeriodKey(dateKey: string, anchorDate: string): string {
  assertDateKey(dateKey, 'dateKey');
  assertDateKey(anchorDate, 'anchorDate');
  const daysSinceAnchor = daysBetweenDateKeys(anchorDate, dateKey);
  const periodIndex = Math.floor(daysSinceAnchor / 14);
  return addDaysToDateKey(anchorDate, periodIndex * 14);
}

export function localDateKeyInTimeZone(instant: Date, timeZone: string): string {
  if (!Number.isFinite(instant.getTime())) {
    throw new RangeError('Instante inválido.');
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = new Map(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`;
}
