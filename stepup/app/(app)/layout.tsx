import type { Viewport } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { PrimaryNav } from "@/components/nav/primary-nav";
import { NavigationProgress } from "@/components/nav/navigation-progress";
import { ScreenReveal } from "@/components/nav/screen-reveal";
import { ScreenSlot } from "@/components/nav/screen-slot";
import { SoftKeyboardSync } from "@/components/nav/soft-keyboard-sync";
import { SignOutButton } from "@/components/nav/sign-out-button";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { isSupabaseConfigured, shouldFailClosed } from "@/lib/auth/config";
import { getRenderUser } from "@/lib/auth/render-user";
import { resolvePrivateAreaAccess } from "@/lib/auth/route-protection";
import type { AuthUser } from "@/lib/auth/auth-adapter";
import { readBillingFlags } from "@/lib/billing/flags";
import { readDeviceAccess } from "@/lib/auth/device-session/server";
import { DeviceSessionWatcher } from "@/components/nav/device-session-watcher";
import { StudentFileCleanup } from "@/components/nav/student-file-cleanup";

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
  // Production sin configuración válida: pantalla controlada, nunca el área privada en «modo vista previa».
  if (!configured && shouldFailClosed()) return <AuthNotConfigured />;
  let hasSession = false;
  let user: AuthUser | null = null;

  if (configured) {
    // Misma verificación que hará la página (`requireAuthenticatedDbContext`): una sola ida y vuelta a Auth por navegación.
    user = await getRenderUser();
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

  // Un solo dispositivo activo: si este navegador no es el autorizado se lo lleva a «Usar TeacherFlow en este dispositivo» / «Tu cuenta se abrió en otro dispositivo».
  if (configured && user) {
    const access = await readDeviceAccess(user.id);
    if (access.kind === "taken-elsewhere") redirect("/dispositivo?motivo=otro");
    if (access.kind !== "authorized") redirect("/dispositivo");
  }

  return (
    <div data-tf-navigation={(await cookies()).get("tf-navigation")?.value === "menu" ? "menu" : "barra"} className="min-h-screen nav:pl-[236px]">
      <DeviceSessionWatcher />
      <NavigationProgress />
      <ScreenReveal />
      <SoftKeyboardSync />
      {configured && user && <StudentFileCleanup />}
      <PrimaryNav billingEnabled={readBillingFlags(process.env).enabled} navigationLocation={(await cookies()).get("tf-navigation")?.value === "menu" ? "menu" : "barra"} />
      {/* «Cerrar sesión»: arriba a la derecha del área principal en TODAS las pantallas privadas (en móvil vive en el encabezado). Una
          fila propia de `--tf-shell-top` de alto: nunca se superpone con el título ni con las acciones de cada pantalla. */}
      <div data-session-bar className="hidden h-[var(--tf-shell-top)] items-center justify-end px-10 nav:flex">
        <SignOutButton />
      </div>
      <main id="contenido" tabIndex={-1} className="tf-page-main focus:outline-none pb-[calc(var(--tf-m-nav)+var(--tf-safe-bottom))] nav:pb-0"><ScreenSlot />{children}</main>
    </div>
  );
}
