import type { Viewport } from "next";
import { redirect } from "next/navigation";
import { PrimaryNav } from "@/components/nav/primary-nav";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { createSupabaseAuthAdapter } from "@/lib/auth/supabase-auth-adapter";
import { resolvePrivateAreaAccess } from "@/lib/auth/route-protection";
import { loadAccountIdentity } from "@/lib/nav/load-account-identity";
import { resolveAccountIdentity } from "@/lib/nav/account-identity";
import type { AuthUser } from "@/lib/auth/auth-adapter";

// Área con datos privados: nunca cacheable, nunca ISR, nunca servida desde
// CDN — se recalcula en cada request.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// Safe areas: sin `viewport-fit=cover` los `env(safe-area-inset-*)` del shell valen 0 en iPhone. Sólo el área privada lo usa.
export const viewport: Viewport = { viewportFit: "cover" };

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
  let user: AuthUser | null = null;

  if (configured) {
    const adapter = createSupabaseAuthAdapter();
    user = await adapter.getUser();
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

  const account = resolveAccountIdentity(await loadAccountIdentity(user));

  return (
    <div className="min-h-screen md:pl-56">
      <PrimaryNav account={account} />
      <main id="contenido" tabIndex={-1} className="focus:outline-none pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">{children}</main>
    </div>
  );
}
