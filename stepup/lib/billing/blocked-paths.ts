/**
 * Rutas del área privada que una cuenta BLOQUEADA (terminó la prueba o el período pagado sin un pago aprobado) puede abrir. Sólo lo necesario para regularizar y salir:
 *  - `/suscripcion-pendiente`: la pantalla de «Suscripción pendiente» (importe y botón para pagar o actualizar el medio de pago);
 *  - `/facturacion` y todo lo que cuelga de ahí: la suscripción, los planes, las condiciones y el resultado de un pago;
 *  - `/configuracion` EXACTA: perfil, cambio de clave, privacidad y eliminar la cuenta. Sus subpáginas (respaldo, consistencia, datos de prueba, tutorial) son de datos operativos: bloqueadas.
 * Todo lo demás del área privada redirige a «Suscripción pendiente». Soporte vive dentro de Facturación; autenticación (ingresar, salir) está fuera del área privada.
 * Lista cerrada (falla cerrado): una ruta nueva queda bloqueada hasta que alguien la agregue acá a propósito.
 */
export const BLOCKED_ACCOUNT_HOME = "/suscripcion-pendiente";

export function isAllowedWhenBlocked(pathname: string): boolean {
  if (pathname === BLOCKED_ACCOUNT_HOME || pathname.startsWith(`${BLOCKED_ACCOUNT_HOME}/`)) return true;
  if (pathname === "/facturacion" || pathname.startsWith("/facturacion/")) return true;
  if (pathname === "/configuracion" || pathname === "/configuracion/") return true;
  return false;
}
