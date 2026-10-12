import { BanknotesIcon, CalendarDaysIcon, ClockIcon, ExclamationCircleIcon } from "@heroicons/react/24/outline";
import PrivateLink from "@/components/nav/private-link";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { PrivateButtonLink, linkClass } from "@/components/ui/button";
import { PageHeader, PAGE_WIDTH } from "@/components/ui/page-header";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { ChargeActions } from "@/components/payments/charge-actions";
import { avatarInitials, avatarToneFor } from "@/lib/ui/avatar-tone";
import { CHARGE_TYPE_LABEL } from "@/lib/payments/labels";
import type { CollectionsCenterEntry } from "@/lib/payments/collections-center";
import { formatCivilDate } from "@/lib/format/date-format";
import { formatMoney } from "@/lib/format/number-format";

/** Estado de una obligación: texto + ícono + tono (nunca sólo color). Los textos y el criterio no cambiaron. */
function collectionStatus(entry: CollectionsCenterEntry): { text: string; tone: BadgeTone; icon: typeof ClockIcon } {
  if (entry.urgency === "vence_pronto") return { text: "Vence pronto", tone: "warn", icon: CalendarDaysIcon };
  if (entry.urgency === "vence_hoy") return { text: "Vence hoy", tone: "warn", icon: ClockIcon };
  if (entry.urgency === "mes_vencido") return { text: "Pago vencido", tone: "bad", icon: ExclamationCircleIcon };
  if (entry.urgency === "pendiente_en_termino") return { text: "Pago pendiente", tone: "info", icon: ClockIcon };
  if (entry.isOverdue) return { text: "Pago vencido", tone: "bad", icon: ExclamationCircleIcon };
  return { text: "Pago pendiente", tone: "info", icon: ClockIcon };
}

// Columnas del escritorio (≥ 820 px): alumno · concepto · vence · estado · saldo · acciones. Debajo de 820 px cada fila es una tarjeta.
const ROW_COLUMNS = "nav:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_96px_140px_minmax(0,1.1fr)_auto]";

/**
 * Cobros (presentación). La página resuelve los datos; esta vista sólo muestra lo que ya carga: alumno, concepto, vencimiento,
 * importe original, saldo y estado. «Registrar pago» y «Anular cobro» son los diálogos reales de `ChargeActions`.
 */
export function CollectionsView({ entries }: { entries: CollectionsCenterEntry[] }) {
  return (
    <div className={PAGE_WIDTH.wide}>
      <PageHeader
        title="Cobros"
        subtitle={
          <>
            {entries.length} obligaci{entries.length === 1 ? "ón" : "ones"} pendiente{entries.length === 1 ? "" : "s"}.
          </>
        }
        action={
          <PrivateButtonLink href="/resumen-financiero" variant="secondary">
            Ver resumen financiero
          </PrivateButtonLink>
        }
      />

      {entries.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon={BanknotesIcon} message="No hay cobros pendientes." />
        </div>
      ) : (
        <div className="mt-6 nav:overflow-hidden nav:rounded-lg nav:border-[1.5px] nav:border-border nav:bg-surface nav:shadow-card">
          <div aria-hidden className={`hidden border-b-[1.5px] border-border bg-surface2 px-5 py-2.5 text-label font-bold uppercase text-textMuted nav:grid nav:items-center nav:gap-x-4 ${ROW_COLUMNS}`}>
            <span>Alumno</span>
            <span>Concepto</span>
            <span>Vence</span>
            <span>Estado</span>
            <span className="text-right">Saldo pendiente</span>
            <span className="w-[272px]" />
          </div>
          <ul className="flex flex-col gap-3 nav:gap-0">
            {entries.map((entry) => {
              const status = collectionStatus(entry);
              const concept = CHARGE_TYPE_LABEL[entry.chargeType] ?? entry.chargeType;
              const StatusIcon = status.icon;
              return (
                <li
                  key={entry.chargeId}
                  className={`flex flex-col gap-3 rounded-lg border-[1.5px] border-border bg-surface p-4 shadow-card nav:grid nav:items-center nav:gap-x-4 nav:gap-y-0 nav:rounded-none nav:border-0 nav:border-b nav:px-5 nav:py-3 nav:shadow-none nav:last:border-b-0 ${ROW_COLUMNS}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar initial={avatarInitials(entry.studentName)} tone={avatarToneFor(entry.studentId)} size="m" />
                    <PrivateLink
                      href={`/alumnos/${entry.studentId}`}
                      className="-my-1 inline-flex min-h-11 min-w-0 items-center font-display text-[18px] font-semibold leading-tight tracking-tight text-textPrimary [overflow-wrap:anywhere] hover:underline hover:decoration-borderMid hover:underline-offset-[3px] nav:font-sans nav:text-[14.5px] nav:font-[650] nav:tracking-normal"
                    >
                      {entry.studentName}
                    </PrivateLink>
                  </div>

                  <div className="flex flex-wrap items-baseline gap-x-1.5 text-[14px] text-textSecondary nav:contents">
                    <p className="min-w-0 [overflow-wrap:anywhere] nav:text-[14.5px] nav:text-textPrimary">{concept}</p>
                    <p className="tf-num nav:text-[14.5px] nav:text-textPrimary">
                      <span aria-hidden className="nav:hidden">
                        ·{" "}
                      </span>
                      <span className="nav:sr-only">vence </span>
                      {formatCivilDate(entry.dueDate)}
                    </p>
                  </div>

                  <div>
                    <Badge tone={status.tone} icon={<StatusIcon className="h-3.5 w-3.5" aria-hidden />}>
                      {status.text}
                    </Badge>
                  </div>

                  <div className="min-w-0 nav:text-right">
                    <p className="text-[13px] text-textMuted nav:sr-only">Saldo pendiente</p>
                    <p className="font-display text-[26px] font-semibold leading-none tracking-tight tf-num text-textPrimary [overflow-wrap:anywhere] nav:text-[20px]">{formatMoney(entry.balance)}</p>
                    {entry.paidAmount > 0 && (
                      <p className="mt-1 text-[12.5px] text-textMuted tf-num">
                        de {formatMoney(entry.originalAmount)} · ya pagó {formatMoney(entry.paidAmount)}
                      </p>
                    )}
                  </div>

                  <ChargeActions
                    chargeId={entry.chargeId}
                    studentId={entry.studentId}
                    balance={entry.balance}
                    compact
                    context={{
                      studentName: entry.studentName,
                      concept,
                      dueDate: entry.dueDate,
                      originalAmount: entry.originalAmount,
                    }}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Error al cargar Cobros: el mensaje de siempre y un reintento (recarga la misma pantalla). */
export function CollectionsErrorView() {
  return (
    <div className={PAGE_WIDTH.wide}>
      <PageHeader title="Cobros" />
      <div className="mt-6 flex flex-col items-start gap-2">
        <div className="w-full">
          <ErrorState message="No pudimos cargar Cobros." />
        </div>
        <PrivateLink href="/cobros" className={linkClass()}>
          Reintentar
        </PrivateLink>
      </div>
    </div>
  );
}
