import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAuthAdapter } from "@/lib/auth/supabase-auth-adapter";
import { authCallback } from "@/lib/auth/recovery-session";
import { clearRecoveryMarker, hasValidRecoveryMarker, setRecoveryMarker } from "@/lib/auth/recovery-cookie";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { DEFAULT_AUTH_REDIRECT } from "@/lib/auth/safe-redirect";
import { PLAN_INTENT_COOKIE, parsePlanIntent, planIntentDestination } from "@/lib/plan-intent";

export const dynamic = "force-dynamic";

/**
 * Intercambio de código PKCE — equivalente web del deep link
 * `teacherflow://auth-confirmed` / `teacherflow://reset-password` de
 * móvil. `next` se sanea siempre (nunca puede salir del sitio, ver
 * lib/auth/safe-redirect.ts). Nunca se loguea el código ni el resultado.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(`${origin}/login`);
  }

  // Toda la decisión (error de Supabase en la URL, canje del código, `next` saneado y marcador de
  // recuperación) vive en lib/auth/recovery-session.ts, que es lo que cubren las pruebas. Antes un
  // `next=/nueva-contrasena` válido se reemplazaba por /inicio y nunca se llegaba a "Nueva contraseña".
  const outcome = await authCallback(
    { code: searchParams.get("code"), next: searchParams.get("next"), urlErrorCode: searchParams.get("error_code") },
    {
      adapter: createSupabaseAuthAdapter(),
      markers: { set: setRecoveryMarker, isValid: hasValidRecoveryMarker, clear: clearRecoveryMarker },
    }
  );

  // Confirmó su correo después de elegir un plan en la página pública: si el destino es el inicio por defecto, sigue a la contratación (la cookie se usa una sola vez).
  const intent = outcome.redirectTo === DEFAULT_AUTH_REDIRECT ? parsePlanIntent(request.cookies.get(PLAN_INTENT_COOKIE)?.value) : null;
  if (intent) {
    const response = NextResponse.redirect(`${origin}${planIntentDestination(intent)}`);
    response.cookies.delete(PLAN_INTENT_COOKIE);
    return response;
  }
  return NextResponse.redirect(`${origin}${outcome.redirectTo}`);
}
