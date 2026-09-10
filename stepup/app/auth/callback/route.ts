import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAuthAdapter } from "@/lib/auth/supabase-auth-adapter";
import { sanitizeNextPath } from "@/lib/auth/safe-redirect";
import { classifyCallbackUrlError } from "@/lib/auth/error-messages";
import { isSupabaseConfigured } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

/**
 * Intercambio de código PKCE — equivalente web del deep link
 * `teacherflow://auth-confirmed` / `teacherflow://reset-password` de
 * móvil. `next` se sanea siempre (nunca puede salir del sitio, ver
 * lib/auth/safe-redirect.ts). Nunca se loguea el código ni el resultado.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = sanitizeNextPath(searchParams.get("next"));
  const urlErrorCode = searchParams.get("error_code");

  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(`${origin}/login`);
  }

  // Supabase ya adjuntó su propio error a la URL de retorno (el enlace
  // falló antes de llegar a nuestro código) — mismo criterio que
  // extractAuthErrorFromUrl/classifyDeepLinkErrorDescription en móvil.
  if (urlErrorCode) {
    return NextResponse.redirect(`${origin}/auth/error?type=${classifyCallbackUrlError(urlErrorCode)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/error?type=link_invalid`);
  }

  const result = await createSupabaseAuthAdapter().exchangeCodeForSession(code);
  if (!result.ok) {
    return NextResponse.redirect(`${origin}/auth/error?type=${result.error.code ?? "unknown"}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
