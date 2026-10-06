import Link from "@/components/nav/private-link";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { loadHomeData } from "@/lib/dashboard/load-home-data";
import { EmptyState, ErrorState } from "@/components/ui/states";
import type { RemindersCenterSummary } from "@/lib/dashboard/reminders-center";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recordatorios · TeacherFlow" };

export default async function RecordatoriosPage() {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  let summary: RemindersCenterSummary;
  try {
    const ctx = await requireAuthenticatedDbContext();
    const data = await loadHomeData(ctx);
    summary = data.remindersSummary;
  } catch {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
        <ErrorState message="No pudimos cargar los recordatorios." />
        <Link href="/recordatorios" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-brandBlue hover:underline">
          Reintentar
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
      <Link href="/inicio" className="inline-flex min-h-11 items-center text-sm font-semibold text-brandBlue hover:underline">
        ← Volver a Inicio
      </Link>
      <h1 className="mt-3 text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Recordatorios</h1>
      <p className="mt-1.5 text-sm text-textMuted">
        {summary.totalCount} recordatorio{summary.totalCount === 1 ? "" : "s"} pendiente{summary.totalCount === 1 ? "" : "s"}.
      </p>

      {summary.categories.length === 0 ? (
        <div className="mt-6">
          <EmptyState message="No hay recordatorios pendientes." />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {summary.categories.map((category) => (
            <section key={category.kind}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-textSecondary">
                {category.label} ({category.items.length})
              </h2>
              <ul className="mt-2 flex flex-col gap-2">
                {category.items.map((item) => (
                  <li key={item.id} className="rounded-lg border border-border bg-surface px-4 py-3 shadow-card">
                    <p className="text-sm font-semibold text-textPrimary">{item.title}</p>
                    <p className="mt-0.5 text-xs text-textMuted">{item.subtitle}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
