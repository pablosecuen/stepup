import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseRuntimeConfig } from "@/lib/auth/config";
import { resolvePrivateAreaAccess } from "@/lib/auth/route-protection";
import { isPrivatePath } from "@/lib/auth/safe-redirect";

// Next.js 16: `proxy.ts` reemplaza a `middleware.ts`. Su único trabajo acá
// — igual que documenta el patrón oficial de Supabase SSR — es refrescar
// el token de auth en cada navegación y hacer el encaminamiento INICIAL.
// La autorización DEFINITIVA se vuelve a verificar en el servidor dentro
// del layout privado (`app/(app)/layout.tsx`), que nunca asume que este
// proxy ya corrió — ver lib/auth/route-protection.ts, la misma función
// pura que usan los dos.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const config = getSupabaseRuntimeConfig();
  const pathname = request.nextUrl.pathname;

  if (!config) {
    // Igual que móvil (AuthGate): sin Supabase configurado, nunca se
    // bloquea nada acá — el área privada sigue en modo vista previa.
    return response;
  }

  if (!isPrivatePath(pathname)) {
    return response;
  }

  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Verificación local del JWT (rápida, sin round-trip al servidor de Auth
  // cuando el proyecto usa claves de firma asimétricas) — nunca
  // `getSession()`, que no está verificada.
  const { data } = await supabase.auth.getClaims();

  const decision = resolvePrivateAreaAccess({
    configured: true,
    hasSession: !!data?.claims,
    pathname,
    search: request.nextUrl.search,
  });

  if (decision.kind === "redirect") {
    const url = request.nextUrl.clone();
    const [redirectPathname, redirectSearch] = decision.to.split("?");
    url.pathname = redirectPathname;
    url.search = redirectSearch ? `?${redirectSearch}` : "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Corre en toda ruta salvo assets estáticos/imágenes — el propio proxy
  // decide arriba si la ruta es privada antes de tocar Supabase.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|manifest.webmanifest).*)"],
};
