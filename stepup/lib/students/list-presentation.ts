import type { MonthlyCardDisplayKind } from "../payments/engine/features/payments/utils/monthlyPeriodStatus.ts";
import { formatGrade, formatMoney } from "../format/number-format.ts";
import { formatInstantDayShort, formatInstantTime } from "../format/date-format.ts";
import { localDateKeyInTimeZone } from "../payments/dates.ts";
import type { StudentStatus } from "../db/database.types.ts";
import type { StudentStatusProjection } from "./list-status.ts";
import { isNewStudent } from "./new-student.ts";

export type StatusTone = "ok" | "info" | "warn" | "bad" | "neutral";
export type StatusIcon = "check" | "clock" | "alert" | "warning" | "cross" | "none";

/**
 * Texto corto fijo de la pastilla de pago en la lista (puerto de `COMPACT_MONTHLY_STATUS_LABEL` del original): nunca el nombre del mes. `sin_plan_mensual` no está a propósito: cae al texto
 * completo del plan («Por clase», «Semanal», …), que ya es corto.
 */
const COMPACT_MONTHLY_STATUS_LABEL: Partial<Record<MonthlyCardDisplayKind, string>> = {
  no_aplica: "No aplica",
  comienza_proximo_mes: "Comienza pronto",
  pendiente_en_termino: "Pago pendiente",
  cargo_pendiente_generar: "Pago pendiente",
  vence_pronto: "Vence pronto",
  vence_hoy: "Vence hoy",
  pago_parcial: "Pago parcial",
  pagado: "Pagado",
  primer_vencimiento: "Pago vencido",
  segundo_vencimiento: "Pago vencido",
  ultimo_vencimiento: "Pago vencido",
  vencido_sin_recargo: "Pago vencido",
};

const COLOR_TONE: Record<string, StatusTone> = {
  statusVerde: "ok",
  statusPendiente: "info",
  statusAmarillo: "warn",
  statusNaranja: "warn",
  statusRojo: "bad",
  statusSinDatos: "neutral",
};
const COLOR_ICON: Record<string, StatusIcon> = {
  statusVerde: "check",
  statusPendiente: "clock",
  statusAmarillo: "alert",
  statusNaranja: "warning",
  statusRojo: "cross",
  statusSinDatos: "none",
};

export interface PaymentChip {
  text: string;
  tone: StatusTone;
  icon: StatusIcon;
}

/** Pastilla de estado de pago de la tarjeta. Sólo «Pago parcial» suma el saldo pendiente. El color siempre va acompañado de texto e ícono. */
export function paymentChip(payment: StudentStatusProjection): PaymentChip {
  const colorKey = payment.monthlyStatusColorKey ?? "statusSinDatos";
  const compact = payment.monthlyStatusKind ? COMPACT_MONTHLY_STATUS_LABEL[payment.monthlyStatusKind] : undefined;
  const label = compact ?? payment.monthlyStatusLabel ?? "Sin datos";
  const text = label === "Pago parcial" && payment.monthlyStatusBalance ? `${label} · ${formatMoney(payment.monthlyStatusBalance)}` : label;
  return { text, tone: COLOR_TONE[colorKey] ?? "neutral", icon: COLOR_ICON[colorKey] ?? "none" };
}

export type StudentBadgeKind = "pausado" | "inactivo" | "archivado" | "destacado" | "nuevo" | "pago_vencido" | "tarea_pendiente";

export interface StudentBadgeView {
  kind: StudentBadgeKind;
  label: string;
}

/**
 * Insignias de la tarjeta, en el orden del original: estado (si no es activo), destacado, nuevo, pago vencido (con el texto específico de la deuda, p. ej. «Julio vencido»), tarea pendiente.
 * «Reporte pendiente» no se muestra: en el original ningún flujo real lo activa (siempre `false`).
 */
export function studentBadges(input: { status: StudentStatus; isFeatured: boolean; dateJoined: string | null; now?: Date; payment: StudentStatusProjection; hasPendingHomework: boolean }): StudentBadgeView[] {
  const badges: StudentBadgeView[] = [];
  if (input.status !== "activo") badges.push({ kind: input.status, label: input.status === "pausado" ? "Pausado" : input.status === "inactivo" ? "Inactivo" : "Archivado" });
  if (input.isFeatured) badges.push({ kind: "destacado", label: "Destacado" });
  // «Nuevo» se deriva de la fecha de alta y vence solo (`new-student.ts`); la marca `is_new` guardada ya no se consulta.
  if (isNewStudent(input.dateJoined, input.now)) badges.push({ kind: "nuevo", label: "Nuevo" });
  if (input.payment.hasOverduePayment) badges.push({ kind: "pago_vencido", label: input.payment.overdueDebtLabel ?? "Pago vencido" });
  if (input.hasPendingHomework) badges.push({ kind: "tarea_pendiente", label: "Tarea pendiente" });
  return badges;
}

/** «Clase en curso» / «Hoy 18:00» / «Mañana 09:30» / «mié 5 18:00» / «Sin próxima clase programada». Las horas y los días son los de Argentina. */
export function nextClassLabel(start: string | null, end: string | null, now: Date = new Date()): string {
  if (!start) return "Sin próxima clase programada";
  const startMs = new Date(start).getTime();
  if (!Number.isFinite(startMs)) return "Sin próxima clase programada";
  if (startMs <= now.getTime()) {
    return end && new Date(end).getTime() > now.getTime() ? "Clase en curso" : "Sin próxima clase programada";
  }
  const time = formatInstantTime(start);
  const today = localDateKeyInTimeZone(now);
  const day = localDateKeyInTimeZone(new Date(start));
  const tomorrow = localDateKeyInTimeZone(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  if (day === today) return `Hoy ${time}`;
  if (day === tomorrow) return `Mañana ${time}`;
  return `${formatInstantDayShort(start)} ${time}`;
}

export function averageGradeLabel(averageGrade: number | null): string {
  return averageGrade === null ? "Sin calificaciones" : formatGrade(averageGrade);
}
