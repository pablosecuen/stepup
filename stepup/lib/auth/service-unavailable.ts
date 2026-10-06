/**
 * Respuesta controlada cuando Production NO tiene una configuración válida de Supabase (variables ausentes o inválidas).
 * Reemplaza al antiguo «modo local» (que dejaba abierta el área privada) por un 503 sin detalles internos: nunca nombra
 * variables, proveedores ni valores.
 */
export const SERVICE_UNAVAILABLE_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>TeacherFlow no está disponible por ahora</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#080808;color:#f5f5f5;font-family:system-ui,sans-serif}main{max-width:26rem;padding:2rem;text-align:center}h1{font-size:1.25rem}p{color:#b5b5b5;line-height:1.5}</style>
</head>
<body>
<main>
<h1>TeacherFlow no está disponible por ahora</h1>
<p>Volvé a intentarlo en unos minutos. No hace falta hacer nada más.</p>
</main>
</body>
</html>
`;

export function serviceUnavailableResponse(): Response {
  return new Response(SERVICE_UNAVAILABLE_HTML, {
    status: 503,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "60" },
  });
}

let reported = false;

/** Una sola línea de log por instancia, sin valores: sólo el estado ("missing" o "invalid"). */
export function reportConfigUnavailable(state: string): void {
  if (reported) return;
  reported = true;
  console.error(`[config] ${JSON.stringify({ scope: "supabase", state, failClosed: true })}`);
}
