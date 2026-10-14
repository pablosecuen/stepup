import { addDaysToDateKey } from "../calendar/timezone.ts";
import { formatCivilDate, formatInstantDate } from "../format/date-format.ts";
import { formatMoney } from "../format/number-format.ts";
import { cancelAccessEnd, projectStatus, type BillingSnapshot } from "./ledger.ts";
import { civilDayOf, GRACE_DAYS } from "./periods.ts";
import { getPlan, listActivePlans, MINOR_UNITS_PER_PESO, type BillingPlan, type PlanCode } from "./plans.ts";
import type { ProviderCapabilities } from "./provider.ts";
import type { BillingHistory } from "./store.ts";

/**
 * Modelo de vista de la facturación — PURO. Convierte el estado guardado (más el reloj) en lo que muestran las pantallas: etiqueta,
 * titular, texto, datos, avisos y acciones disponibles. Reglas:
 *  - todo texto está en español, sin códigos internos, identificadores ni importes del proveedor; nunca se muestra el neto de Mobbex;
 *  - un estado importante nunca se comunica sólo por color: cada etiqueta lleva texto;
 *  - una acción sólo aparece si funciona: un botón cuyo respaldo no está validado (`capabilities`) no se ofrece;
 *  - las acciones salen del servidor; el navegador nunca decide qué puede hacer la cuenta.
 */
export type BillingViewState =
  | "unavailable"
  | "grandfathered"
  | "none"
  | "processing"
  | "active"
  | "renewing"
  | "grace"
  | "limited"
  | "ending"
  | "canceled"
  | "expired";

export type ViewTone = "ok" | "warn" | "bad" | "info" | "neutral";

export interface ViewFact {
  readonly label: string;
  readonly value: string;
}

export interface ViewNotice {
  readonly tone: ViewTone;
  readonly title: string;
  readonly text: string;
}

export interface ViewActions {
  readonly subscribe: boolean;
  readonly cancel: boolean;
  readonly reactivate: boolean;
  readonly changePlan: boolean;
  readonly updatePaymentMethod: boolean;
}

export interface HistoryRowView {
  readonly key: string;
  readonly kind: "period" | "charge";
  readonly title: string;
  readonly detail: string;
  readonly amount: string;
  readonly tag: { readonly tone: ViewTone; readonly label: string } | null;
}

export interface BillingView {
  readonly state: BillingViewState;
  readonly badge: { readonly tone: ViewTone; readonly label: string };
  readonly headline: string;
  readonly body: string;
  readonly plan: { readonly code: PlanCode; readonly name: string; readonly price: string; readonly cadence: string } | null;
  readonly facts: readonly ViewFact[];
  readonly notices: readonly ViewNotice[];
  readonly pendingChange: { readonly planName: string; readonly price: string; readonly effective: string } | null;
  readonly actions: ViewActions;
  /** Hasta cuándo conserva el acceso completo si cancela ahora (texto de la confirmación), o `null` si no corresponde. */
  readonly cancelAccessUntil: string | null;
  readonly history: readonly HistoryRowView[];
}

const NO_ACTIONS: ViewActions = { subscribe: false, cancel: false, reactivate: false, changePlan: false, updatePaymentMethod: false };

export function pesos(amountMinor: number): string {
  return formatMoney(amountMinor / MINOR_UNITS_PER_PESO);
}

export function cadenceLabel(plan: Pick<BillingPlan, "monthsOfAccess">): string {
  switch (plan.monthsOfAccess) {
    case 1:
      return "por mes";
    case 12:
      return "por año";
    default:
      return `cada ${plan.monthsOfAccess} meses`;
  }
}

function planSummary(code: PlanCode | null): BillingView["plan"] {
  const plan = getPlan(code);
  return plan ? { code: plan.code, name: plan.name, price: pesos(plan.amountMinor), cadence: cadenceLabel(plan) } : null;
}

/** Último día completo de una vigencia que termina a las 00:00 de otro día (el instante de fin es exclusivo). */
function lastDay(instantIso: string | null): string {
  if (!instantIso) return "—";
  return formatCivilDate(addDaysToDateKey(civilDayOf(instantIso), -1));
}

function firstDayOf(instantIso: string | null): string {
  return instantIso ? formatInstantDate(instantIso) : "—";
}

export interface ViewInput {
  readonly snapshot: BillingSnapshot | null;
  readonly history: BillingHistory | null;
  readonly now: Date;
  readonly capabilities: ProviderCapabilities;
  /** `false` si la pantalla ya sabe que no pudo leer el estado (base caída). */
  readonly available: boolean;
}

const UNAVAILABLE: BillingView = {
  state: "unavailable",
  badge: { tone: "neutral", label: "No disponible" },
  headline: "No pudimos consultar tu suscripción",
  body: "Probá de nuevo en unos minutos. No se hizo ningún cambio ni ningún cobro y podés seguir usando TeacherFlow con normalidad.",
  plan: null,
  facts: [],
  notices: [],
  pendingChange: null,
  actions: NO_ACTIONS,
  cancelAccessUntil: null,
  history: [],
};

export function buildBillingView(input: ViewInput): BillingView {
  const { snapshot, now, capabilities } = input;
  if (!input.available || !snapshot) return UNAVAILABLE;
  const status = projectStatus(snapshot, now);
  const history = buildHistory(input.history);
  const plan = planSummary(snapshot.planCode);
  const hasSubscriber = snapshot.providerSubscriberUid !== null;
  const pending = getPlan(snapshot.pendingPlanCode);
  const pendingChange = pending && snapshot.currentPeriodEnd ? { planName: pending.name, price: pesos(pending.amountMinor), effective: firstDayOf(snapshot.currentPeriodEnd) } : null;
  const paymentAction = capabilities.paymentMethodUpdate && hasSubscriber;
  const chargeback = snapshot.chargebackAt !== null && now.toISOString() >= snapshot.chargebackAt;
  const accessUntil = status === "active" ? lastDay(snapshot.currentPeriodEnd) : status === "past_due" || status === "grace_period" ? lastDay(snapshot.graceEndsAt) : null;
  const base = { history, pendingChange, plan, cancelAccessUntil: accessUntil };

  const chargebackNotice: ViewNotice | null = chargeback
    ? { tone: "bad", title: "Detectamos una disputa de pago", text: "Tu banco o la tarjeta informó una disputa por un cobro. Mientras la revisamos tu acceso está limitado; escribinos para resolverla. Tus datos siguen intactos." }
    : null;

  switch (status) {
    case "grandfathered":
      return {
        ...base,
        state: "grandfathered",
        badge: { tone: "ok", label: "Acceso sin cargo" },
        headline: "Tu cuenta tiene acceso sin cargo",
        body: "Tu cuenta ya existía cuando lanzamos las suscripciones, así que no tenés que pagar nada por ahora. Si querés suscribirte igual, podés elegir un plan cuando quieras.",
        facts: [],
        notices: [],
        actions: { ...NO_ACTIONS, subscribe: true },
      };
    case "pending":
      if (hasSubscriber) {
        return {
          ...base,
          state: "processing",
          badge: { tone: "info", label: "Confirmando pago" },
          headline: "Estamos confirmando tu pago",
          body: "Cuando el servicio de cobro nos confirme el pago, tu suscripción se activa sola. El primer cobro está programado para el día siguiente a la contratación y puede demorar unos minutos en reflejarse acá.",
          facts: [],
          notices: chargebackNotice ? [chargebackNotice] : [],
          actions: { ...NO_ACTIONS, subscribe: true, cancel: true },
        };
      }
      return {
        ...base,
        state: "none",
        badge: { tone: "neutral", label: "Sin suscripción" },
        headline: "Todavía no tenés una suscripción",
        body: "Elegí un plan para usar TeacherFlow sin límites. Se renueva solo y la cancelás cuando quieras, conservando el acceso hasta el final del período pagado.",
        facts: [],
        notices: chargebackNotice ? [chargebackNotice] : [],
        actions: { ...NO_ACTIONS, subscribe: true },
      };
    case "active": {
      return {
        ...base,
        state: "active",
        badge: { tone: "ok", label: "Activa" },
        headline: "Tu suscripción está activa",
        body: plan ? `Plan ${plan.name}: ${plan.price} ${plan.cadence}. Se renueva automáticamente hasta que la canceles.` : "Se renueva automáticamente hasta que la canceles.",
        facts: [
          { label: "Período actual", value: `${firstDayOf(snapshot.currentPeriodStart)} al ${lastDay(snapshot.currentPeriodEnd)}` },
          { label: "Próxima renovación", value: firstDayOf(snapshot.currentPeriodEnd) },
        ],
        notices: [],
        actions: { ...NO_ACTIONS, cancel: true, changePlan: capabilities.changePlan, updatePaymentMethod: paymentAction },
      };
    }
    case "past_due":
      return {
        ...base,
        state: "renewing",
        badge: { tone: "info", label: "Renovando" },
        headline: "Estamos procesando tu renovación",
        body: `Tu período venció el ${lastDay(snapshot.currentPeriodEnd)} y estamos esperando la confirmación del cobro. No tenés que hacer nada: si el cobro no se confirma, te lo vamos a avisar acá.`,
        facts: [{ label: "Período vencido", value: `${firstDayOf(snapshot.currentPeriodStart)} al ${lastDay(snapshot.currentPeriodEnd)}` }],
        notices: [],
        actions: { ...NO_ACTIONS, cancel: true, updatePaymentMethod: paymentAction },
      };
    case "grace_period":
      return {
        ...base,
        state: "grace",
        badge: { tone: "warn", label: "Pago rechazado" },
        headline: "No pudimos cobrar tu renovación",
        body: `Tenés ${GRACE_DAYS} días para actualizar tu medio de pago, hasta el ${lastDay(snapshot.graceEndsAt)} inclusive. Hasta entonces seguís con acceso completo y tus datos no se tocan.`,
        facts: [
          { label: "Período vencido", value: `${firstDayOf(snapshot.currentPeriodStart)} al ${lastDay(snapshot.currentPeriodEnd)}` },
          { label: "Acceso completo hasta", value: lastDay(snapshot.graceEndsAt) },
        ],
        notices: paymentAction ? [] : [{ tone: "info", title: "Medio de pago", text: "Estamos terminando de habilitar el cambio de medio de pago desde acá. Mientras tanto, el servicio de cobro vuelve a intentar el cobro por su cuenta." }],
        actions: { ...NO_ACTIONS, cancel: true, updatePaymentMethod: paymentAction },
      };
    case "limited":
      return {
        ...base,
        state: "limited",
        badge: { tone: "bad", label: "Acceso limitado" },
        headline: "Tu acceso está limitado",
        body: "Podés ingresar, ver y exportar todos tus datos, ver tu facturación y actualizar tu medio de pago, pero no crear ni modificar información hasta regularizar el pago. No borramos nada.",
        facts: snapshot.currentPeriodEnd ? [{ label: "Último período pagado", value: `${firstDayOf(snapshot.currentPeriodStart)} al ${lastDay(snapshot.currentPeriodEnd)}` }] : [],
        notices: chargebackNotice ? [chargebackNotice] : [],
        actions: { ...NO_ACTIONS, cancel: true, subscribe: false, updatePaymentMethod: paymentAction },
      };
    case "cancel_at_period_end": {
      const endsAt = cancelAccessEnd(snapshot);
      return {
        ...base,
        state: "ending",
        badge: { tone: "warn", label: "Se cancela al final del período" },
        headline: `Tu suscripción termina el ${lastDay(endsAt)}`,
        body: "Seguís con acceso completo hasta esa fecha y no se te vuelve a cobrar. Podés reactivarla antes de que termine.",
        facts: [{ label: "Acceso completo hasta", value: lastDay(endsAt) }],
        notices: [],
        actions: { ...NO_ACTIONS, reactivate: true, updatePaymentMethod: false },
      };
    }
    case "canceled":
      return {
        ...base,
        state: "canceled",
        badge: { tone: "neutral", label: "Cancelada" },
        headline: "Tu suscripción está cancelada",
        body: "No se te va a cobrar más. Tus datos están a salvo: podés ingresar, verlos y exportarlos. Si querés volver, elegí un plan.",
        facts: snapshot.currentPeriodEnd ? [{ label: "Último período pagado", value: `${firstDayOf(snapshot.currentPeriodStart)} al ${lastDay(snapshot.currentPeriodEnd)}` }] : [],
        notices: [],
        actions: { ...NO_ACTIONS, subscribe: true },
      };
    case "expired":
      return {
        ...base,
        state: "expired",
        badge: { tone: "warn", label: "Finalizada" },
        headline: "Tu suscripción finalizó",
        body: "El servicio de cobro dio por terminada la suscripción. Tus datos están a salvo y podés volver a suscribirte cuando quieras.",
        facts: [],
        notices: [],
        actions: { ...NO_ACTIONS, subscribe: true },
      };
  }
}

const OUTCOME_TAGS = {
  approved: { tone: "ok", label: "Pago aprobado" },
  rejected: { tone: "warn", label: "Pago rechazado" },
  refunded: { tone: "info", label: "Devuelto" },
  chargeback: { tone: "bad", label: "Contracargo" },
} as const;

export function buildHistory(history: BillingHistory | null): HistoryRowView[] {
  if (!history) return [];
  const rows: Array<HistoryRowView & { sort: string }> = [];
  for (const [index, period] of history.periods.entries()) {
    const plan = getPlan(period.planCode);
    rows.push({
      key: `p${index}`,
      kind: "period",
      title: `Acceso ${plan?.name.toLowerCase() ?? ""}`.trim(),
      detail: `Del ${firstDayOf(period.periodStart)} al ${lastDay(period.periodEnd)}`,
      amount: pesos(period.amountMinor),
      tag: period.voidedAt ? { tone: "info", label: "Anulado" } : null,
      sort: period.periodEnd,
    });
  }
  for (const [index, charge] of history.charges.entries()) {
    const plan = getPlan(charge.planCode);
    rows.push({
      key: `c${index}`,
      kind: "charge",
      title: `Cobro ${plan?.name.toLowerCase() ?? ""}`.trim(),
      detail: `Vencimiento ${firstDayOf(charge.dueAt)}`,
      amount: pesos(charge.amountMinor),
      tag: OUTCOME_TAGS[charge.outcome],
      sort: charge.dueAt,
    });
  }
  return rows.sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : a.key < b.key ? -1 : 1)).map(({ sort: _sort, ...row }) => row);
}

// --- Planes ---------------------------------------------------------------------------------------------------------------------

export interface PlanOptionView {
  readonly code: PlanCode;
  readonly name: string;
  readonly price: string;
  readonly cadence: string;
  /** Equivalente por mes, sólo si el período es de más de un mes. */
  readonly perMonth: string | null;
  /** Ahorro frente a pagar el plan mensual durante el mismo tiempo, sólo si hay ahorro. */
  readonly saving: string | null;
  readonly months: number;
}

/** «$ 23.300 por mes» si es exacto; «unos $ 22.317 por mes» (redondeado al peso) si no. */
export function perMonthLabel(plan: Pick<BillingPlan, "amountMinor" | "monthsOfAccess">): string {
  const exact = plan.amountMinor % (plan.monthsOfAccess * MINOR_UNITS_PER_PESO) === 0;
  const wholePesos = Math.round(plan.amountMinor / plan.monthsOfAccess / MINOR_UNITS_PER_PESO) * MINOR_UNITS_PER_PESO;
  return `${exact ? "" : "unos "}${pesos(wholePesos)} por mes`;
}

/** Los cuatro planes del catálogo con su ahorro frente al mensual, calculado en centavos enteros (nunca con decimales flotantes). */
export function buildPlanOptions(): PlanOptionView[] {
  const plans = listActivePlans();
  const monthly = plans.find((plan) => plan.monthsOfAccess === 1);
  return plans.map((plan) => {
    const savingMinor = monthly && plan.monthsOfAccess > 1 ? monthly.amountMinor * plan.monthsOfAccess - plan.amountMinor : 0;
    return {
      code: plan.code,
      name: plan.name,
      price: pesos(plan.amountMinor),
      cadence: cadenceLabel(plan),
      perMonth: plan.monthsOfAccess > 1 ? perMonthLabel(plan) : null,
      saving: savingMinor > 0 ? `Ahorrás ${pesos(savingMinor)} frente al plan mensual` : null,
      months: plan.monthsOfAccess,
    };
  });
}
