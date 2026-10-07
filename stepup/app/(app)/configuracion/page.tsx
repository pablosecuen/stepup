import { isSupabaseConfigured } from "@/lib/auth/config";
import { createSupabaseAuthAdapter } from "@/lib/auth/supabase-auth-adapter";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getTeacherProfile } from "@/lib/repositories/teacher-profile";
import { getBudgetDistributionSettings } from "@/lib/repositories/budget-distribution";
import { getActiveSession } from "@/lib/repositories/active-sessions";
import type { ActiveSessionInfo } from "@/components/account/active-session-card";
import { ConfigurationView } from "@/components/account/configuration-view";
import { EmptyState } from "@/components/ui/states";
import { DEFAULT_BUDGET_DISTRIBUTION } from "@/lib/payments/budget-distribution";
import type { ActiveSessionRow } from "@/lib/db/database.types";
import { formatInstantDateTime } from "@/lib/format/date-format";

export const dynamic = "force-dynamic";
// R4: eliminar la cuenta borra antes todos los PDF de reportes de Storage (puede llevar un rato en cuentas con muchos): tiempo máximo explícito.
export const maxDuration = 60;
export const metadata = { title: "Configuración · TeacherFlow" };

function toSessionInfo(row: ActiveSessionRow): ActiveSessionInfo {
  return {
    deviceId: row.device_id,
    generation: row.generation,
    authorizedAtLabel: formatInstantDateTime(row.authorized_at),
    lastSeenAtLabel: formatInstantDateTime(row.last_seen_at),
    expiresAtLabel: formatInstantDateTime(row.expires_at),
  };
}

export default async function ConfiguracionPage() {
  const configured = isSupabaseConfigured();
  const user = configured ? await createSupabaseAuthAdapter().getUser() : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
      <h1 className="text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Configuración</h1>
      <p className="mt-1.5 text-sm text-textMuted">
        {user ? "Tu cuenta, preferencias y datos." : "No pudimos conectar con tu cuenta en este momento."}
      </p>

      {user ? <ConfiguredSections email={user.email} /> : <UnavailableState />}
    </div>
  );
}

async function ConfiguredSections({ email }: { email: string | null }) {
  const ctx = await requireAuthenticatedDbContext();

  const [profileResult, budgetResult, sessionResult] = await Promise.allSettled([
    getTeacherProfile(ctx),
    getBudgetDistributionSettings(ctx),
    getActiveSession(ctx),
  ]);

  const profile = profileResult.status === "fulfilled" ? profileResult.value : { displayName: "" };
  const budget = budgetResult.status === "fulfilled" ? budgetResult.value.distribution : DEFAULT_BUDGET_DISTRIBUTION;
  const session = sessionResult.status === "fulfilled" && sessionResult.value ? toSessionInfo(sessionResult.value) : null;

  return <ConfigurationView email={email} displayName={profile.displayName} budget={budget} session={session} />;
}

function UnavailableState() {
  return (
    <div className="mt-7">
      <EmptyState message="Tus ajustes aparecen cuando tu cuenta responde. Probá de nuevo en unos minutos." action={{ label: "Reintentar", href: "/configuracion" }} />
    </div>
  );
}
