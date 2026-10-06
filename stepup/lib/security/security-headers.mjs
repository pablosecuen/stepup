// Cabeceras de seguridad de TeacherFlow (R1). JavaScript plano (.mjs) a propósito: lo importan `next.config.mjs` (que Node
// carga sin transpilar) y las pruebas. Nada acá depende de Next ni de Supabase.
//
// Estado de cada control:
//  - X-Content-Type-Options, Referrer-Policy, Permissions-Policy, X-Frame-Options y `frame-ancestors 'none'`: ACTIVOS (bloquean).
//  - Content-Security-Policy completa: SÓLO `Content-Security-Policy-Report-Only` (no bloquea nada) hasta comprobar todas las
//    rutas sin violaciones legítimas. No se activa en bloqueo sin una verificación posterior explícita.
//  - HSTS: lo sigue poniendo Vercel (max-age=63072000). A propósito NO se agrega `includeSubDomains` ni `preload` sin auditar
//    antes todos los subdominios de teacherflowapp.com.
//
// Por qué `frame-ancestors` va en una CSP APARTE y bloqueante: el navegador IGNORA `frame-ancestors` en una política
// Report-Only, así que si sólo estuviera dentro de la política de prueba no protegería contra el enmarcado. `X-Frame-Options:
// DENY` repite la protección para navegadores antiguos.
//
// CSP Report-Only — decisiones documentadas:
//  - `script-src 'self' 'unsafe-inline'`: TEMPORAL. Next.js (App Router) inserta scripts en línea para hidratar la página y sus
//    datos (`self.__next_f.push(...)`) con contenido distinto en cada respuesta, así que no se pueden fijar con hashes. El paso
//    siguiente es un *nonce* por solicitud desde `proxy.ts` (implica renderizado dinámico de las páginas hoy estáticas) y
//    entonces se QUITA `'unsafe-inline'`. Nunca `'unsafe-eval'`: la versión de producción de Next no lo necesita.
//  - `style-src 'self' 'unsafe-inline'`: TEMPORAL. React/Next y los estilos dinámicos de Tailwind usan atributos `style` y
//    <style> en línea; se revisará junto con el nonce.
//  - `img-src 'self' data: blob:`: íconos propios y SVG/imágenes embebidas. `font-src 'self'`: no hay fuentes externas (se usa
//    la fuente del sistema). `connect-src 'self'`: el navegador NUNCA habla con Supabase (todo pasa por el servidor de
//    TeacherFlow), sólo con su propio origen (Server Actions y datos RSC).
//  - Los PDF de informes se abren con una URL firmada de Supabase Storage en una pestaña nueva (`window.open`): es una
//    NAVEGACIÓN de nivel superior, no un recurso de la página, así que ninguna directiva la afecta.
//  - Previews de Vercel: la barra de comentarios de Vercel carga scripts de vercel.live y producirá avisos de la política (sólo
//    en Preview, no en Production).

const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

// Funciones del navegador que TeacherFlow no usa (ni cámara, ni micrófono, ni ubicación, ni pagos del navegador, etc.):
// quedan deshabilitadas para la página y para cualquier recurso incrustado. Sólo directivas ampliamente soportadas, para no
// llenar la consola de avisos de «feature desconocida».
const PERMISSIONS_POLICY = [
  "accelerometer",
  "autoplay",
  "camera",
  "display-capture",
  "encrypted-media",
  "geolocation",
  "gyroscope",
  "magnetometer",
  "microphone",
  "midi",
  "payment",
  "picture-in-picture",
  "publickey-credentials-get",
  "usb",
  "xr-spatial-tracking",
]
  .map((feature) => `${feature}=()`)
  .join(", ");

/**
 * @param {{ production?: boolean }} [options] La CSP Report-Only sólo se envía en Production (`next dev` necesita `eval` para el
 * recambio en caliente y llenaría la consola de avisos que no existen en el build real).
 * @returns {{ key: string; value: string }[]}
 */
export function buildSecurityHeaders({ production = process.env.NODE_ENV === "production" } = {}) {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    { key: "X-Frame-Options", value: "DENY" },
    // Bloqueante, y sólo esta directiva: protege contra el enmarcado sin tocar ningún otro recurso.
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  ];
  if (production) headers.push({ key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY });
  return headers;
}

export { CSP_REPORT_ONLY, PERMISSIONS_POLICY };
