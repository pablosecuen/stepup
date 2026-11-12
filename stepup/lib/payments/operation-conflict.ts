/**
 * `register_payment` (migración 20261112100000) rechaza una clave de operación reutilizada con OTROS datos (otro importe, cobro, método, fecha o notas): el pago anterior ya existe y devolverlo como «éxito»
 * lo haría pasar por el nuevo. El mensaje de la base empieza siempre con este texto. La pantalla, ante este rechazo, ROTA la clave (si no, ese envío quedaría trabado para siempre con la misma clave) y
 * recarga los datos para mostrar el pago que ya existe; NO reenvía sola: la persona revisa los pagos antes de decidir. Un error de red o de validación, en cambio, conserva la clave (reintento seguro).
 * PURO.
 */
export const OPERATION_CONFLICT_PREFIX = "Esta operación ya se registró con otros datos";

export function isOperationConflict(message: string | null | undefined): boolean {
  return typeof message === "string" && message.startsWith(OPERATION_CONFLICT_PREFIX);
}
