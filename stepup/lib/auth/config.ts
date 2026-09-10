// Validación central de la configuración de Supabase. Nunca lanza si faltan
// las variables — la app debe mostrar un estado controlado de "entorno de
// autenticación no configurado", nunca romper ni intentar conectarse sin
// credenciales reales. Sólo lee variables públicas (NEXT_PUBLIC_*): nunca
// service_role ni ninguna clave secreta.

export interface SupabaseRuntimeConfig {
  url: string;
  publishableKey: string;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

// Detecta los valores de ejemplo del propio .env.example (u otros
// placeholders obvios) para que copiar ese archivo tal cual a .env.local
// siga mostrando "no configurado" en vez de intentar conectar con una URL
// inexistente.
function looksLikePlaceholder(value: string): boolean {
  return /example|placeholder|your-project|changeme|xxxx/i.test(value);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/** null si la configuración está ausente, es un placeholder, o es inválida. */
export function getSupabaseRuntimeConfig(): SupabaseRuntimeConfig | null {
  const url = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = readEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

  if (!url || !publishableKey) return null;
  if (looksLikePlaceholder(url) || looksLikePlaceholder(publishableKey)) return null;
  if (!isValidHttpUrl(url)) return null;

  return { url, publishableKey };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseRuntimeConfig() !== null;
}
