import { logBilling } from "./log.ts";
import { runProviderSweep, type ProcessorDeps } from "./processor.ts";

/**
 * Confirmación a pedido al volver del sitio de pago. Con un proveedor que crea el suscriptor DESPUÉS del primer cobro (Rebill) la cuenta todavía no tiene un suscriptor al que
 * sondear, y el aviso del cobro puede tardar: se consulta directamente al proveedor por los pagos recientes y se concilia lo que sea nuestro (por la referencia opaca que viaja
 * en el pago). No activa nada por sí misma: sólo un cobro aprobado y conciliado lo hace, con la misma lógica que el aviso y el barrido periódico (idempotente: repetirlo no duplica
 * nada). Está acotada por instancia (una consulta cada 20 s como mucho) y por páginas, y un fallo se ignora: el aviso y el barrido periódico lo cubren.
 */
const MIN_INTERVAL_MS = 20_000;
const WINDOW_MS = 48 * 3_600_000;
let lastRunAt = 0;

export type ConfirmOutcome = "done" | "skipped" | "failed";

/**
 * `skipped`: no hacía falta (otro proveedor, ya hay suscriptor, límite de frecuencia o el proveedor no está configurado); `done`: se consultó al proveedor; `failed`: hacía falta
 * y no se pudo (el proveedor no respondió). `force` salta el límite de frecuencia (lo usa la eliminación de cuenta, que necesita saber).
 */
export async function confirmOwnerPayment(deps: ProcessorDeps | null, ownerId: string, options: { readonly force?: boolean } = {}): Promise<ConfirmOutcome> {
  if (!deps || deps.provider.bindsSubscriberOnPayment !== true) return "skipped";
  const nowMs = deps.now().getTime();
  if (options.force !== true && nowMs - lastRunAt < MIN_INTERVAL_MS) return "skipped";
  try {
    const snapshot = (await deps.store.loadSubscriptions([ownerId])).get(ownerId);
    if (!snapshot || snapshot.providerSubscriberUid !== null) return "skipped"; // con suscriptor, el sondeo prioritario ya lo cubre
    lastRunAt = nowMs;
    const stats = await runProviderSweep(deps, { maxPages: 3, sinceMs: WINDOW_MS, advanceCursor: false });
    if (stats.skipped) return "skipped"; // proveedor sin credenciales: no puede haber ningún cobro nuestro
    return stats.pages > 0 ? "done" : "failed";
  } catch {
    logBilling("action", "confirm_failed", { provider: deps.provider.name }, "warn");
    return "failed";
  }
}

/** Sólo para pruebas: reinicia el límite de frecuencia. */
export function resetConfirmThrottleForTests(): void {
  lastRunAt = 0;
}
