import "server-only";
import { getBillingRuntime } from "./runtime";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { demoScenariosAllowed } from "./provider-selection";
import { DEMO_NOW, demoScenario } from "./demo-scenarios";
import { buildBillingView, buildPlanOptions, type BillingView, type PlanOptionView } from "./view";
import type { ProviderCapabilities } from "./provider";
import { resolveSupportContact, type SupportContact } from "./support";
import { isLegalReviewed } from "./legal";

/**
 * Datos de las pantallas de facturación. Con la facturación apagada devuelve `null` y la pantalla responde 404 (como si no existiera).
 * La cuenta sale de la sesión; si Supabase o el almacén no responden, la pantalla muestra «no disponible» sin bloquear nada más.
 * El parámetro `escenario` (estados de ejemplo para revisión visual) sólo se honra en el servidor de desarrollo local con el
 * adaptador falso: en cualquier otro entorno se ignora.
 */
export interface BillingPageData {
  readonly view: BillingView;
  readonly options: readonly PlanOptionView[];
  readonly capabilities: ProviderCapabilities;
  /** Pantalla de demostración local: nada de lo que se haga acá toca datos reales. */
  readonly demo: boolean;
  /** ¿Puede elegir un plan y pasar al pago? (alta o re-alta). */
  readonly canCheckout: boolean;
  /** Correo de soporte configurado (`BILLING_SUPPORT_EMAIL`); `null` si falta o es inválido: no se dibuja ningún enlace. */
  readonly support: SupportContact | null;
}

/**
 * Pide que se mire de nuevo (con prioridad) al suscriptor de la cuenta: lo usa la pantalla de resultado. NO cambia ningún estado.
 * Como mucho vence un sondeo cada 5 minutos por cuenta (arrendamiento de la base). Un fallo se ignora: el sondeo normal lo cubre.
 */
export async function requestPriorityPoll(): Promise<void> {
  const runtime = getBillingRuntime();
  if (!runtime.flags.enabled || !runtime.store) return;
  try {
    const { ownerId } = await requireAuthenticatedDbContext();
    await runtime.store.prioritizePolls([ownerId]);
  } catch {
    // sin detalles: el sondeo periódico recupera igual
  }
}

export async function loadBillingPageData(searchParams?: { escenario?: string | string[] }): Promise<BillingPageData | null> {
  const runtime = getBillingRuntime();
  if (!runtime.flags.enabled) return null;
  const options = buildPlanOptions();
  const capabilities = runtime.provider.capabilities;

  const requested = Array.isArray(searchParams?.escenario) ? searchParams?.escenario[0] : searchParams?.escenario;
  const scenario = demoScenariosAllowed(process.env) ? demoScenario(requested) : null;
  if (scenario) {
    const view = buildBillingView({ snapshot: scenario.snapshot, history: scenario.history, now: DEMO_NOW, capabilities, available: scenario.available });
    return { view, options, capabilities, demo: true, canCheckout: view.actions.subscribe, support: resolveSupportContact(process.env) };
  }

  const unavailable = (): BillingPageData => ({ view: buildBillingView({ snapshot: null, history: null, now: runtime.now(), capabilities, available: false }), options, capabilities, demo: false, canCheckout: false, support: resolveSupportContact(process.env) });
  if (!runtime.store) return unavailable();
  try {
    const { ownerId } = await requireAuthenticatedDbContext();
    const snapshot = await runtime.store.ensureAccount(ownerId);
    const history = await runtime.store.getHistory(ownerId, 24);
    const view = buildBillingView({ snapshot, history, now: runtime.now(), capabilities, available: true });
    return { view, options, capabilities, demo: false, canCheckout: view.actions.subscribe, support: resolveSupportContact(process.env) };
  } catch {
    return unavailable();
  }
}

/** Datos de la página de condiciones: nulos con la facturación apagada (404). */
export function loadLegalPageData(): { readonly support: SupportContact | null; readonly reviewed: boolean } | null {
  if (!getBillingRuntime().flags.enabled) return null;
  return { support: resolveSupportContact(process.env), reviewed: isLegalReviewed(process.env) };
}
