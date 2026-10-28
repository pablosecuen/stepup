// Puerto VERBATIM del original (`src/features/payments/utils/paymentFormat.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PaymentDueStage, PaymentMethod } from '../types/index.ts';

/** Formato de moneda ARS consistente en toda la UI de Cobros. */
export function formatCurrencyARS(amount: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(
    amount
  );
}

/** Date key YYYY-MM-DD -> DD/MM/YYYY. Todas las fechas de Cobros se muestran así, nunca abreviadas. */
export function formatDateKeyDMY(dateKey: string): string {
  const [year, month, day] = dateKey.split('-');
  if (!year || !month || !day) return '—';
  return `${day}/${month}/${year}`;
}

/**
 * Corrección 2026-08-10 (a pedido de Joaquín — badges financieros
 * contradictorios): date key YYYY-MM-DD -> "DD/MM" (sin año — para nombrar
 * una obligación por clase vencida en el badge corto de la lista de
 * Alumnos, ej. "Clase del 07/08 vencida"). A diferencia de
 * `formatDateKeyDMY`, nunca incluye el año: ese badge es siempre sobre una
 * deuda reciente, el año sobraría.
 */
export function formatDateKeyDayMonth(dateKey: string): string {
  const [, month, day] = dateKey.split('-');
  if (!month || !day) return '—';
  return `${day}/${month}`;
}

/** Período de facturación 'YYYY-MM' -> "MM/AA" (sin día: es un mes completo, no una fecha puntual). */
export function formatBillingPeriodShort(period: string): string {
  const [year, month] = period.split('-');
  if (!year || !month) return '—';
  return `${month}/${year.slice(2)}`;
}

const MONTH_ABBR_ES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

/**
 * Período de facturación 'YYYY-MM' -> etiqueta de dos líneas controlada para
 * columnas angostas (ej. gráfico de comportamiento de pago): { top: "AGO",
 * bottom: "25" }. A diferencia de `formatBillingPeriodShort` ("08/25"), nunca
 * depende de que el texto quepa en una sola línea — cada mitad es corta y
 * fija (3 letras / 2 dígitos), así que nunca se parte a la mitad de una
 * palabra ni salta de forma arbitraria en columnas chicas.
 */
export function formatBillingPeriodChartLabel(period: string): { top: string; bottom: string } {
  const [year, month] = period.split('-');
  const monthIndex = Number(month) - 1;
  if (!year || !month || monthIndex < 0 || monthIndex > 11) return { top: '—', bottom: '' };
  return { top: MONTH_ABBR_ES[monthIndex], bottom: year.slice(2) };
}

const MONTH_NAMES_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** Período de facturación 'YYYY-MM' -> "julio 2026" (para el "concepto" del Centro de cobros, más legible que MM/AA). */
export function formatBillingPeriodLong(period: string): string {
  const [year, month] = period.split('-');
  const monthIndex = Number(month) - 1;
  if (!year || !month || monthIndex < 0 || monthIndex > 11) return '—';
  return `${MONTH_NAMES_ES[monthIndex]} ${year}`;
}

/**
 * Corrección 2026-08-03 (a pedido de Joaquín — generación mensual y
 * tarjetas de Alumnos): Período de facturación 'YYYY-MM' -> "Agosto" (mes
 * solo, capitalizado, SIN año) — para los textos exactos pedidos de la
 * tarjeta de Alumnos ("Agosto pagado", "Agosto pendiente", "Comienza en
 * septiembre"). Distinto de `formatBillingPeriodLong` a propósito: ese
 * incluye el año y está en minúscula, pensado para un "concepto" de
 * comprobante, no para un rótulo corto de estado.
 */
export function formatBillingPeriodMonthOnly(period: string): string {
  const [year, month] = period.split('-');
  const monthIndex = Number(month) - 1;
  if (!year || !month || monthIndex < 0 || monthIndex > 11) return '—';
  const name = MONTH_NAMES_ES[monthIndex];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Instante ISO -> DD/MM/YYYY, en la hora local del dispositivo (para `recordedAt`, que sí tiene hora real de carga). */
export function formatIsoDMY(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  otro: 'Otro',
};

export const PAYMENT_STAGE_LABEL: Record<PaymentDueStage, string> = {
  on_time: 'En término',
  first_late: 'Primer vencimiento',
  second_late: 'Segundo vencimiento',
  last_late: 'Último vencimiento',
};
