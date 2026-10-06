import Link from "@/components/nav/private-link";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { logLoadFailure } from "@/lib/errors/load-failure";
import { loadHomeData } from "@/lib/dashboard/load-home-data";
import { loadHomeWelcome } from "@/lib/dashboard/load-home-welcome";
import { HomeView } from "@/components/dashboard/home-view";
import { ErrorState } from "@/components/ui/states";
import type { HomeData } from "@/lib/dashboard/load-home-data";
import type { HomeWelcome } from "@/lib/dashboard/home-welcome";
import { SESSION_RECOVERY_PATH, isIssuedAtFutureFailure } from "@/lib/auth/session-recovery";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inicio · TeacherFlow" };

export default async function InicioPage({ searchParams }: { searchParams: Promise<{ recuperada?: string }> }) {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  let data: HomeData;
  let welcome: HomeWelcome;
  try {
    const ctx = await requireAuthenticatedDbContext();
    data = await loadHomeData(ctx);
    welcome = await loadHomeWelcome(ctx, data);
  } catch (error) {
    // Ya no se oculta la causa: queda registrada (tipo/código, nunca datos) y la sesión vencida se distingue.
    const failure = logLoadFailure("inicio", error);
    const { recuperada } = await searchParams;
    const sessionNotRecognizedYet = isIssuedAtFutureFailure(failure);
    // PGRST303 con el motivo EXACTO "JWT issued at future": pantalla transitoria de recuperación (sin navegación ni precargas).
    // Sólo se entra una vez: si ya se volvió desde allí (`recuperada=1`) se muestra el error normal, nunca un bucle.
    if (sessionNotRecognizedYet && recuperada !== "1") redirect(SESSION_RECOVERY_PATH);
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
        <ErrorState
          message={
            failure.kind === "unauthenticated"
              ? "Tu sesión expiró. Volvé a iniciar sesión."
              : sessionNotRecognizedYet
                ? "No pudimos cargar Inicio. Tu sesión se inició, pero el servidor todavía no la reconoce: probá de nuevo en unos segundos."
                : "No pudimos cargar Inicio."
          }
        />
        <Link href="/inicio" className="mt-3 inline-block text-sm font-semibold text-brandBlue hover:underline">
          Reintentar
        </Link>
      </div>
    );
  }

  return <HomeView data={data} welcome={welcome} />;
}
