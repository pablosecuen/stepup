/**
 * Redirecciones y resultados de acciones del lado del cliente — PURO. Una redirección hacia el sitio de pago sólo se sigue si el
 * destino es HTTPS de `mobbex.com` (o una ruta interna del propio sitio): cualquier otro valor —un redirect manipulado, un dominio
 * parecido, un esquema `javascript:`— se descarta y la persona se queda donde está.
 */
export function safeProviderRedirect(value: unknown, siteOrigin: string): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  if (/[\u0000-\u001f\u007f-\u009f\\]/.test(value)) return null;
  // Ruta interna: una sola barra inicial (nunca «//host»), sin esquema.
  if (value.startsWith("/")) {
    if (value.startsWith("//")) return null;
    try {
      const url = new URL(value, siteOrigin);
      return url.origin === new URL(siteOrigin).origin ? `${url.pathname}${url.search}` : null;
    } catch {
      return null;
    }
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (url.hostname === "mobbex.com" || url.hostname.endsWith(".mobbex.com")) return url.toString();
    return null;
  } catch {
    return null;
  }
}

/** Mensaje de error de un resultado de acción (incluida una falla de red, que no trae `ok`), o `null` si salió bien. */
export function actionError(result: unknown): string | null {
  if (typeof result !== "object" || result === null) return "No pudimos completar la acción. Probá de nuevo.";
  const record = result as { ok?: unknown; error?: unknown };
  if (record.ok === true) return null;
  return typeof record.error === "string" && record.error.length > 0 ? record.error : "No pudimos completar la acción. Probá de nuevo.";
}
