import Link from "@/components/nav/private-link";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { createSupabaseAuthAdapter } from "@/lib/auth/supabase-auth-adapter";
import { signOutAction } from "@/lib/auth/actions";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getTeacherProfile } from "@/lib/repositories/teacher-profile";
import { getBudgetDistributionSettings } from "@/lib/repositories/budget-distribution";
import { getActiveSession } from "@/lib/repositories/active-sessions";
import { TeacherProfileForm } from "@/components/account/teacher-profile-form";
import { BudgetDistributionForm } from "@/components/account/budget-distribution-form";
import { ActiveSessionCard, type ActiveSessionInfo } from "@/components/account/active-session-card";
import { ChangePasswordButton } from "@/components/account/change-password-button";
import { DeleteAccountButton } from "@/components/account/delete-account-button";
import { DEFAULT_BUDGET_DISTRIBUTION } from "@/lib/payments/budget-distribution";
import type { ActiveSessionRow } from "@/lib/db/database.types";
import { formatInstantDateTime } from "@/lib/format/date-format";

export const dynamic = "force-dynamic";
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

function SectionCard({
  title,
  description,
  children,
  wide = false,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <li className={`rounded-lg border border-border bg-surface px-4 py-3.5 shadow-card ${wide ? "sm:col-span-2" : ""}`}>
      <p className="text-sm font-semibold text-textPrimary">{title}</p>
      {description && <p className="mt-0.5 text-xs text-textMuted">{description}</p>}
      {children}
    </li>
  );
}

export default async function ConfiguracionPage() {
  const configured = isSupabaseConfigured();
  const user = configured ? await createSupabaseAuthAdapter().getUser() : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
      <h1 className="text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Configuración</h1>
      <p className="mt-1.5 text-sm text-textMuted">
        {user ? "Tu cuenta, preferencias y datos." : "Vista previa — sin conexión a tu cuenta real todavía."}
      </p>

      {user ? <ConfiguredSections email={user.email} /> : <UnauthenticatedSections />}
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

  return (
    <ul className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <SectionCard title="Cuenta" description={email ?? undefined} wide>
        <div className="mt-3 flex flex-col gap-3">
          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded-md border border-border px-3.5 py-2 text-sm font-semibold text-textSecondary transition-all duration-150 ease-premium hover:bg-background active:scale-[0.98]"
            >
              Cerrar sesión
            </button>
          </form>
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <ChangePasswordButton />
            <DeleteAccountButton />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Perfil de la profesora" description="Nombre visible en la app.">
        <TeacherProfileForm displayName={profile.displayName} />
      </SectionCard>

      <SectionCard title="Distribución 50/30/20" description="Presupuesto sugerido sobre lo cobrado.">
        <BudgetDistributionForm initial={budget} />
      </SectionCard>

      <SectionCard title="Disponibilidad" description="Bloqueos semanales, vacaciones y feriados.">
        <Link href="/calendario/disponibilidad" className="mt-3 inline-block text-sm font-semibold text-brandBlue hover:underline">
          Gestionar disponibilidad →
        </Link>
      </SectionCard>

      <SectionCard title="Niveles personalizados" description="Crear y renombrar niveles propios de tus alumnos.">
        <Link href="/alumnos" className="mt-3 inline-block text-sm font-semibold text-brandBlue hover:underline">
          Gestionar desde Alumnos →
        </Link>
      </SectionCard>

      <SectionCard
        title="Políticas de cobro"
        description="Los recargos automáticos están desactivados — decisión de negocio confirmada. El semáforo de mora usa umbrales fijos, no configurables todavía."
      />

      <SectionCard title="Sesiones" description="Dispositivo autorizado actualmente para tu cuenta.">
        <ActiveSessionCard session={session} />
      </SectionCard>

      <SectionCard title="Respaldo" description="Copias de seguridad de tus datos.">
        <Link href="/configuracion/respaldo" className="mt-3 inline-block text-sm font-semibold text-brandBlue hover:underline">
          Recuperar datos del respaldo →
        </Link>
      </SectionCard>
    </ul>
  );
}

function UnauthenticatedSections() {
  return (
    <ul className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <SectionCard title="Cuenta" description="Correo, contraseña y sesión activa." />
      <SectionCard title="Perfil de la profesora" description="Nombre y datos visibles en la app." />
      <SectionCard title="Respaldo" description="Copias de seguridad de tus datos." />
    </ul>
  );
}
