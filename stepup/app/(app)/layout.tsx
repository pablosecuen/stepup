import Link from "next/link";
import { redirect } from "next/navigation";
import { PrimaryNav } from "@/components/nav/primary-nav";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { createSupabaseAuthAdapter } from "@/lib/auth/supabase-auth-adapter";
import { resolvePrivateAreaAccess } from "@/lib/auth/route-protection";

// Área con datos privados: nunca cacheable, nunca ISR, nunca servida desde
// CDN — se recalcula en cada request.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Verificación DEFINITIVA en el servidor — nunca depende únicamente de
 * `proxy.ts`. Usa la misma función pura (`resolvePrivateAreaAccess`) con la
 * misma regla: si Supabase no está configurado, el área nunca se bloquea
 * (igual que `AuthGate` en móvil); si está configurado, exige sesión real.
 * Esto sigue protegiendo aunque alguien intente esquivar el proxy (una
 * request que no pase por `proxy.ts` por el motivo que sea) porque este
 * chequeo vuelve a correr acá, de forma independiente.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured();
  let hasSession = false;

  if (configured) {
    const adapter = createSupabaseAuthAdapter();
    const user = await adapter.getUser();
    hasSession = !!user;
  }

  if (configured && !hasSession) {
    // En el flujo normal, proxy.ts ya redirigió antes de que este layout
    // llegue a ejecutarse (preservando `next=` con la ruta exacta). Este
    // chequeo es la segunda capa: nunca confía en que el proxy haya
    // corrido — si de alguna forma se lo evita, redirige igual, aunque acá
    // (un Server Component compartido por todas las rutas privadas, sin
    // acceso directo a la URL de la request) no pueda reconstruir el
    // `next=` exacto de vuelta.
    const decision = resolvePrivateAreaAccess({ configured, hasSession, pathname: "/inicio" });
    if (decision.kind === "redirect") redirect(decision.to);
  }

  return (
    <div className="min-h-screen md:pl-56">
      <div className="border-b border-border bg-brandBlue/5 px-4 py-2 text-center text-xs font-medium text-brandBlueDark">
        {configured ? (
          <>Vista previa con datos ficticios — tu cuenta está conectada, pero los datos mostrados todavía son de ejemplo.</>
        ) : (
          <>
            Vista previa con datos ficticios — todavía sin conexión a tu cuenta real.{" "}
            <Link href="/" className="underline decoration-brandBlueDark/40 underline-offset-2 transition hover:decoration-brandBlueDark">
              Volver al inicio
            </Link>
          </>
        )}
      </div>
      <PrimaryNav />
      <main className="pb-20 md:pb-0">{children}</main>
    </div>
  );
}
