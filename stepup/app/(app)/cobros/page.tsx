import Link from "@/components/nav/private-link";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { listAllCharges, listAllAllocations, listAllPayments, ensureCurrentMonthlyCharges, ensureTrainingCharges } from "@/lib/repositories/payments";
import { listStudents } from "@/lib/repositories/students";
import { buildCollectionsCenterEntries, type CollectionsCenterEntry } from "@/lib/payments/collections-center";
import { billingPeriodOfDateKey, localDateKeyInTimeZone } from "@/lib/payments/dates";
import { CHARGE_TYPE_LABEL } from "@/lib/payments/labels";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { ChargeActions } from "@/components/payments/charge-actions";
import { formatCivilDate } from "@/lib/format/date-format";
import { formatMoney } from "@/lib/format/number-format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cobros · TeacherFlow" };

function statusLabel(entry: CollectionsCenterEntry): { text: string; className: string } {
  if (entry.urgency === "vence_pronto") return { text: "Vence pronto", className: "bg-statusAmarillo/10 text-statusAmarillo" };
  if (entry.urgency === "vence_hoy") return { text: "Vence hoy", className: "bg-statusNaranja/10 text-statusNaranja" };
  if (entry.urgency === "mes_vencido") return { text: "Pago vencido", className: "bg-statusRojo/10 text-statusRojo" };
  if (entry.urgency === "pendiente_en_termino") return { text: "Pago pendiente", className: "bg-statusPendiente/10 text-statusPendiente" };
  if (entry.isOverdue) return { text: "Pago vencido", className: "bg-statusRojo/10 text-statusRojo" };
  return { text: "Pago pendiente", className: "bg-statusPendiente/10 text-statusPendiente" };
}


export default async function CobrosPage() {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  let entries: CollectionsCenterEntry[];
  try {
    const ctx = await requireAuthenticatedDbContext();
    const todayDateKey = localDateKeyInTimeZone(new Date());
    const currentPeriod = billingPeriodOfDateKey(todayDateKey);
    // Genera las mensualidades y cuotas de entrenamiento faltantes del
    // período ANTES de leer — mismo criterio automático que el móvil,
    // idempotente (nunca duplica), cierra huecos de cualquier tamaño.
    await Promise.all([ensureCurrentMonthlyCharges(ctx, currentPeriod), ensureTrainingCharges(ctx, currentPeriod)]);

    const [charges, allocations, payments, students] = await Promise.all([
      listAllCharges(ctx),
      listAllAllocations(ctx),
      listAllPayments(ctx),
      listStudents(ctx),
    ]);
    const voidedAtByPaymentId = new Map(payments.map((p) => [p.id, p.voidedAt]));
    const allocationsWithPaymentVoidedAt = allocations.map((a) => ({ ...a, paymentVoidedAt: voidedAtByPaymentId.get(a.paymentId) ?? null }));
    entries = buildCollectionsCenterEntries({ charges, allocations: allocationsWithPaymentVoidedAt, students, todayDateKey });
  } catch {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
        <ErrorState message="No pudimos cargar Cobros." />
        <Link href="/cobros" className="mt-3 inline-block text-sm font-semibold text-brandBlue hover:underline">
          Reintentar
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Cobros</h1>
          <p className="mt-1.5 text-sm text-textMuted">
            {entries.length} obligaci{entries.length === 1 ? "ón" : "ones"} pendiente{entries.length === 1 ? "" : "s"}.
          </p>
        </div>
        <Link href="/resumen-financiero" className="text-sm font-semibold text-brandBlue hover:underline">
          Ver resumen financiero →
        </Link>
      </div>

      {entries.length === 0 ? (
        <div className="mt-6">
          <EmptyState message="No hay cobros pendientes." />
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {entries.map((entry) => {
            const status = statusLabel(entry);
            return (
              <li key={entry.chargeId} className="rounded-lg border border-border bg-surface p-4 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/alumnos/${entry.studentId}`} className="text-sm font-semibold text-textPrimary [overflow-wrap:anywhere] hover:underline">
                      {entry.studentName}
                    </Link>
                    <p className="mt-0.5 text-xs text-textMuted">
                      {CHARGE_TYPE_LABEL[entry.chargeType] ?? entry.chargeType} · vence {formatCivilDate(entry.dueDate)}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-pill px-2.5 py-1 text-xs font-semibold tracking-tight ${status.className}`}>{status.text}</span>
                </div>
                <p className="mt-2 text-sm text-textSecondary">
                  Saldo pendiente: <span className="font-semibold text-textPrimary">{formatMoney(entry.balance)}</span>
                  {entry.paidAmount > 0 && <span className="text-xs text-textMuted"> (de {formatMoney(entry.originalAmount)}, ya pagó {formatMoney(entry.paidAmount)})</span>}
                </p>
                <ChargeActions chargeId={entry.chargeId} studentId={entry.studentId} balance={entry.balance} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
