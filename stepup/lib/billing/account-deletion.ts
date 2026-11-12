import { cancelSubscription, providerPlanOf, type CommandDeps } from "./commands.ts";
import { logBilling } from "./log.ts";
import { billingErrorMessage, type BillingFailure } from "./safe-errors.ts";

/**
 * Eliminación de cuenta con suscripción (decisión cerrada 5). Orden obligatorio, ANTES de borrar nada:
 *
 *   1. cancelar el cobro en el proveedor (idempotente, «proveedor primero») y registrar la cancelación en la base;
 *   2. CONFIRMAR con una consulta autenticada que el suscriptor quedó suspendido o terminado (si el proveedor sigue «activo» se
 *      vuelve a cancelar y se vuelve a consultar; si no se puede confirmar, NO se elimina);
 *   3. recién entonces el flujo de eliminación continúa (PDF y cuenta). La eliminación borra los datos operativos en cascada; el
 *      registro fiscal mínimo y seudonimizado (referencia de operación, fecha, importe, moneda, estado, comprobante y huella de
 *      conciliación) ya se guardó al registrarse cada cobro y SOBREVIVE 10 años: no tiene clave foránea ni datos personales.
 *
 * Sin suscriptor en el proveedor (cuenta nunca suscripta, grandfathered) no hay nada que cancelar. Con la facturación apagada ni
 * siquiera se llama (el flujo de eliminación actual no cambia).
 */
export type DeletionPrepared = { readonly ok: true } | { readonly ok: false; readonly failure: BillingFailure; readonly message: string };

export async function prepareAccountDeletion(deps: CommandDeps, ownerId: string): Promise<DeletionPrepared> {
  const blocked = (failure: BillingFailure): DeletionPrepared => ({ ok: false, failure, message: billingErrorMessage(failure) });
  if (!deps.flags.enabled) return { ok: true };

  let snapshot;
  try {
    snapshot = (await deps.store.loadSubscriptions([ownerId])).get(ownerId);
  } catch {
    return blocked("billing_unavailable"); // sin poder ver la suscripción no se puede garantizar que no se vuelva a cobrar
  }
  // Rebill crea el suscriptor con el primer cobro: una cuenta que pagó hace instantes puede no tenerlo vinculado todavía. Antes de dar por «nada que cancelar» se concilia a pedido;
  // si hacía falta y el proveedor no respondió, NO se elimina (podría quedar una suscripción cobrando sin dueña).
  if (snapshot && !snapshot.providerSubscriberUid && deps.provider.bindsSubscriberOnPayment === true && deps.reconcileOwner) {
    const outcome = await deps.reconcileOwner(ownerId).catch(() => "failed" as const);
    if (outcome === "failed") return blocked("deletion_unconfirmed");
    try {
      snapshot = (await deps.store.loadSubscriptions([ownerId])).get(ownerId);
    } catch {
      return blocked("billing_unavailable");
    }
  }
  if (!snapshot?.providerSubscriberUid) return { ok: true };

  const first = await cancelSubscription(deps, ownerId);
  if (!first.ok && first.failure !== "not_allowed") return blocked(first.failure);

  const planCode = providerPlanOf(snapshot);
  if (!planCode) return blocked("deletion_unconfirmed"); // hay suscriptor pero se ignora su plan: no se puede confirmar que no cobre

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const state = await deps.provider.getSubscriber({ subscriberUid: snapshot.providerSubscriberUid, planCode });
    if (!state.ok) return blocked("deletion_unconfirmed");
    if (state.data.status === "suspended" || state.data.status === "finished") return { ok: true };
    if (state.data.status === "active") {
      const again = await deps.provider.cancelSubscriber({ subscriberUid: snapshot.providerSubscriberUid, planCode });
      if (!again.ok) return blocked("deletion_unconfirmed");
      continue;
    }
    break; // «unknown»: el proveedor devolvió algo que no se interpreta → no se puede confirmar
  }
  logBilling("deletion", "unconfirmed", { provider: deps.provider.name }, "warn");
  return blocked("deletion_unconfirmed");
}
