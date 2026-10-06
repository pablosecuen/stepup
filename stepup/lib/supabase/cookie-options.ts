/**
 * Atributos de la cookie de sesión de Supabase — UNA sola definición, usada por `lib/supabase/server.ts` (Server
 * Components/Actions) y por `proxy.ts`, para que ambos escriban exactamente la misma cookie.
 *
 * - `httpOnly`: ningún código del navegador la lee. La web nunca usa el cliente de Supabase en el navegador (toda la
 *   comunicación con Supabase pasa por el servidor), así que JavaScript no la necesita: un XSS futuro no puede robar la
 *   sesión. (Una prueba estructural vigila que nadie vuelva a importar un cliente de Supabase en código de navegador.)
 * - `secure`: sólo en Production (HTTPS). En desarrollo (`next dev`, http://localhost) se omite para no romper el login local.
 *   Es el mismo criterio que la cookie de recuperación (`lib/auth/recovery-cookie.ts`).
 * - `sameSite: "lax"`: la sesión viaja en las navegaciones normales y no en subpeticiones de otros sitios.
 * - `maxAge`: ventana de INACTIVIDAD de 30 días. `@supabase/ssr` vuelve a escribir la cookie (con este mismo `maxAge`)
 *   cada vez que el token de acceso se renueva (cada hora de uso, vía `proxy.ts`), así que una persona activa nunca la ve
 *   vencer y una inactiva más de 30 días vuelve a Login. El valor anterior era el de la librería (400 días). Esta ventana
 *   es sólo del navegador: la validez real de la sesión (vencimiento y rotación del refresh token) la decide Supabase Auth.
 *   OJO: `@supabase/ssr` 0.12 IGNORA `cookieOptions.maxAge` al escribir la sesión (siempre usa su valor por defecto, 400 días), así
 *   que el `maxAge` se impone en `withSessionCookieAttributes`, que se aplica a TODA cookie antes de escribirla.
 *   Las cookies emitidas antes de este cambio (sin HttpOnly/Secure) se reescriben con estos atributos en la siguiente
 *   renovación del token (≤ 1 hora de uso); mientras tanto siguen funcionando.
 */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface SupabaseCookieOptions {
  path: "/";
  sameSite: "lax";
  httpOnly: true;
  secure: boolean;
  maxAge: number;
}

export function getSupabaseCookieOptions(env: { NODE_ENV?: string } = process.env): SupabaseCookieOptions {
  return {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  };
}

/** Cookie tal como la entrega `@supabase/ssr` a `setAll`. */
export interface SessionCookie {
  name: string;
  value: string;
  options: Record<string, unknown>;
}

/**
 * Impone los atributos de sesión a CADA cookie que `@supabase/ssr` pide escribir, sin depender de sus valores por defecto:
 * un borrado (`maxAge: 0`) conserva `maxAge: 0` (con los mismos atributos, para que el navegador lo reconozca) y toda
 * escritura recibe la ventana de 30 días. Se usa idéntico en `lib/supabase/server.ts` y `proxy.ts`.
 */
export function withSessionCookieAttributes<T extends { options?: unknown }>(cookies: T[], env: { NODE_ENV?: string } = process.env): Array<T & { options: Record<string, unknown> }> {
  const attributes = getSupabaseCookieOptions(env);
  return cookies.map((cookie) => {
    const original = (cookie.options ?? {}) as Record<string, unknown>;
    const removal = original.maxAge === 0;
    return { ...cookie, options: { ...original, ...attributes, maxAge: removal ? 0 : attributes.maxAge } };
  });
}
