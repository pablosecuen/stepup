import { formatCivilDate, formatDateValue } from "@/lib/format/date-format";
import { formatMoney } from "@/lib/format/number-format";

/**
 * Qué se está modificando, dentro de un diálogo de cobros: así la persona lo lee en el propio diálogo y no depende del contenido
 * oscurecido del fondo. Muestra SÓLO lo que el componente que lo abre ya tiene a mano; lo que falta se omite (nunca se inventa).
 */
export function DialogContext({ title, lines }: { title?: string | null; lines: Array<string | null | undefined | false> }) {
  const visible = lines.filter((line): line is string => typeof line === "string" && line.length > 0);
  if (!title && visible.length === 0) return null;
  return (
    <div className="rounded-md border-[1.5px] border-border bg-surface2 px-3.5 py-3" data-dialog-context>
      {title && <p className="text-[15px] font-bold text-textPrimary [overflow-wrap:anywhere]">{title}</p>}
      {visible.map((line) => (
        <p key={line} className="mt-0.5 text-[14px] text-textSecondary tf-num [overflow-wrap:anywhere]">
          {line}
        </p>
      ))}
    </div>
  );
}

/** «Martina Gómez · Mensualidad» — omite la parte que falte. */
export function joinContextTitle(...parts: Array<string | null | undefined>): string | null {
  const text = parts.filter((p): p is string => !!p && p.trim().length > 0).join(" · ");
  return text.length > 0 ? text : null;
}

export interface ChargeContext {
  studentName?: string | null;
  /** Tipo o concepto del cobro, ya en texto («Mensualidad», «Entrenamiento · Taller»). */
  concept?: string | null;
  /** Vencimiento (fecha civil AAAA-MM-DD). */
  dueDate?: string | null;
  originalAmount?: number | null;
}

export interface PaymentContext {
  studentName?: string | null;
  amount?: number | null;
  /** Método de pago ya en texto («Transferencia»). */
  method?: string | null;
  /** Fecha del pago tal como la guarda el registro. */
  paidAt?: string | null;
}

/** Líneas del contexto de un cobro. `balance` lo conoce siempre el componente de acciones. */
export function chargeContextLines(context: ChargeContext | undefined, balance: number | null): Array<string | null> {
  const first = [context?.dueDate ? `Vence ${formatCivilDate(context.dueDate)}` : null, typeof context?.originalAmount === "number" ? `Importe original: ${formatMoney(context.originalAmount)}` : null]
    .filter(Boolean)
    .join(" · ");
  return [first || null, typeof balance === "number" ? `Saldo pendiente: ${formatMoney(balance)}` : null];
}

export function paymentContextLines(context: PaymentContext | undefined): Array<string | null> {
  const parts = [typeof context?.amount === "number" ? formatMoney(context.amount) : null, context?.method ?? null, context?.paidAt ? formatDateValue(context.paidAt) : null].filter(Boolean).join(" · ");
  return [parts ? `Pago: ${parts}` : null];
}
