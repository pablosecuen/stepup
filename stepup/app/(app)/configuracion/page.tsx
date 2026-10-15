import { isSupabaseConfigured } from "@/lib/auth/config";
import { createSupabaseAuthAdapter } from "@/lib/auth/supabase-auth-adapter";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getTeacherProfile } from "@/lib/repositories/teacher-profile";
import { ConfigurationView } from "@/components/account/configuration-view";
import { EmptyState } from "@/components/ui/states";
import { PageHeader, PAGE_WIDTH } from "@/components/ui/page-header";
import { CloudIcon } from "@heroicons/react/24/outline";
import { readBillingFlags } from "@/lib/billing/flags";

export const dynamic = "force-dynamic";
// R4: eliminar la cuenta borra antes todos los PDF de reportes de Storage (puede llevar un rato en cuentas con muchos): tiempo máximo explícito.
export const maxDuration = 60;
export const metadata = { title: "Configuración · TeacherFlow" };

export default async function ConfiguracionPage() {
  const configured = isSupabaseConfigured();
  const user = configured ? await createSupabaseAuthAdapter().getUser() : null;

  return (
    <div className={PAGE_WIDTH.wide}>
      <PageHeader title="Configuración" subtitle={user ? "Tu cuenta, preferencias y datos." : "No pudimos conectar con tu cuenta en este momento."} />

      {user ? <ConfiguredSections email={user.email} /> : <UnavailableState />}
    </div>
  );
}

async function ConfiguredSections({ email }: { email: string | null }) {
  const ctx = await requireAuthenticatedDbContext();

  // Sólo el perfil: la distribución 50/30/20 vive en Resumen financiero y la pantalla ya no muestra dispositivos ni copias de seguridad.
  const [profileResult] = await Promise.allSettled([getTeacherProfile(ctx)]);
  const profile = profileResult.status === "fulfilled" ? profileResult.value : { displayName: "" };

  return <ConfigurationView email={email} displayName={profile.displayName} billingEnabled={readBillingFlags(process.env).enabled} />;
}

function UnavailableState() {
  return (
    <div className="mt-7">
      <EmptyState icon={CloudIcon} message="Tus ajustes aparecen cuando tu cuenta responde. Probá de nuevo en unos minutos." action={{ label: "Reintentar", href: "/configuracion" }} />
    </div>
  );
}
