import { FIXTURE_CHARGES } from "@/lib/fixtures";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/states";

export const metadata = { title: "Cobros · TeacherFlow" };

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(amount);
}

export default function CobrosPage() {
  const hasCharges = FIXTURE_CHARGES.length > 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <h1 className="text-2xl font-bold tracking-tight text-textPrimary">Cobros</h1>
      <p className="mt-1 text-sm text-textMuted">Datos de ejemplo — vista previa sin conexión real.</p>

      {hasCharges ? (
        <ul className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {FIXTURE_CHARGES.map((charge) => (
            <li
              key={charge.id}
              className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 shadow-sm transition hover:border-brandBlue/40"
            >
              <div>
                <p className="text-sm font-semibold text-textPrimary">{charge.studentName}</p>
                <p className="text-xs text-textMuted">{formatCurrency(charge.amount)}</p>
              </div>
              <StatusPill status={charge.status} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6">
          <EmptyState message="No hay cobros pendientes." />
        </div>
      )}
    </div>
  );
}
