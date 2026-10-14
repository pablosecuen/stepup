/**
 * Máquina de estados de la suscripción (M1) — explícita, pura y sin dependencias. Es la ÚNICA definición de qué estado puede
 * seguir a cuál; el resto del módulo (resolución de acceso, procesamiento, comandos) la consulta y nunca la duplica.
 *
 * Estados:
 *   grandfathered         cuenta existente antes de la facturación: acceso completo, sin cobro
 *   pending               cuenta nueva (o que vuelve) que todavía no tiene un cobro confirmado
 *   active                período pagado vigente
 *   past_due              venció el período y todavía no hay resultado confirmado del cobro (demora del proveedor/avisos)
 *   grace_period          el cobro de renovación fue RECHAZADO: 5 días corridos de gracia con acceso y aviso
 *   limited               terminó la gracia sin pago: modo limitado (la cuenta nunca pierde datos)
 *   cancel_at_period_end  la persona canceló: conserva el acceso hasta terminar lo ya pagado
 *   canceled              cancelación efectiva (terminó el período pagado) o cancelación de una cuenta sin período vigente
 *   expired               el proveedor dio por terminada la suscripción sin que la persona la cancelara
 *
 * Los disparadores (`BillingTrigger`) tienen nombre propio. Los AUTOMÁTICOS salen de hechos verificados del proveedor o del reloj;
 * los COMANDOS salen de una acción de la persona, ejecutada en el servidor. Un disparador que no figura para un estado es una
 * transición IMPOSIBLE y se rechaza (`applyTrigger` devuelve `impossible_transition`); un disparador que mapea al mismo estado es
 * una repetición válida (idempotente, no cambia nada).
 */
export const BILLING_STATUSES = [
  "grandfathered",
  "pending",
  "active",
  "past_due",
  "grace_period",
  "limited",
  "cancel_at_period_end",
  "canceled",
  "expired",
] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

export const AUTOMATIC_TRIGGERS = ["payment_confirmed", "renewal_due", "payment_rejected", "grace_elapsed", "period_elapsed", "provider_ended", "chargeback_confirmed", "payment_voided"] as const;
export const COMMAND_TRIGGERS = ["checkout_started", "cancel_requested", "reactivate_requested", "plan_change_requested", "grandfather_ended"] as const;
export type AutomaticTrigger = (typeof AUTOMATIC_TRIGGERS)[number];
export type CommandTrigger = (typeof COMMAND_TRIGGERS)[number];
export type BillingTrigger = AutomaticTrigger | CommandTrigger;

type Table = { readonly [S in BillingStatus]: { readonly [T in BillingTrigger]?: readonly BillingStatus[] } };

/**
 * Transiciones permitidas. La lista de destinos de un disparador tiene más de un elemento sólo cuando el destino se resuelve con
 * datos (p. ej. al reactivar, vuelve al estado que corresponda a lo pagado: `active`, `past_due` o `grace_period`).
 */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

export const TRANSITIONS: Table = deepFreeze({
  grandfathered: {
    payment_confirmed: ["active"], // se suscribe por decisión propia
    checkout_started: ["grandfathered"], // abre un intento de pago; el estado no cambia hasta que el cobro se confirme
    grandfather_ended: ["pending"], // sólo por decisión explícita futura; ningún camino automático
  },
  pending: {
    payment_confirmed: ["active"],
    payment_rejected: ["pending"], // el primer cobro falló: se registra, sigue sin período
    checkout_started: ["pending"],
    cancel_requested: ["canceled"],
    provider_ended: ["expired"],
  },
  active: {
    renewal_due: ["past_due"],
    payment_confirmed: ["active"], // renovación (o repetición del mismo aviso)
    payment_rejected: ["grace_period"],
    cancel_requested: ["cancel_at_period_end"],
    plan_change_requested: ["active"], // cambio de plan programado para el próximo período; no duplica la suscripción
    provider_ended: ["active"], // al final del período pasa a `expired` por `renewal_due` → ver `projectStatus`
    chargeback_confirmed: ["limited"], // contracargo conciliado: modo limitado inmediato (y revisión)
    payment_voided: ["pending"], // devolución total del único período pagado: la cuenta vuelve a no tener período
  },
  past_due: {
    payment_confirmed: ["active"],
    payment_rejected: ["grace_period"],
    grace_elapsed: ["limited"],
    cancel_requested: ["cancel_at_period_end"],
    provider_ended: ["expired"],
    chargeback_confirmed: ["limited"],
    payment_voided: ["pending"],
  },
  grace_period: {
    payment_confirmed: ["active"],
    payment_rejected: ["grace_period"], // otro intento rechazado del mismo vencimiento
    grace_elapsed: ["limited"],
    cancel_requested: ["cancel_at_period_end"],
    provider_ended: ["expired"],
    chargeback_confirmed: ["limited"],
    payment_voided: ["pending"],
  },
  limited: {
    payment_confirmed: ["active"],
    payment_rejected: ["limited"],
    cancel_requested: ["canceled"],
    provider_ended: ["expired"],
    chargeback_confirmed: ["limited"], // repetición
    payment_voided: ["pending"],
  },
  cancel_at_period_end: {
    period_elapsed: ["canceled"],
    reactivate_requested: ["active", "past_due", "grace_period"],
    cancel_requested: ["cancel_at_period_end"], // cancelar de nuevo no hace nada
    payment_confirmed: ["cancel_at_period_end"], // un cobro aprobado después de cancelar se registra, no revive la suscripción
    payment_rejected: ["cancel_at_period_end"],
    provider_ended: ["cancel_at_period_end"],
    chargeback_confirmed: ["limited"],
  },
  canceled: {
    checkout_started: ["pending"], // volver a suscribirse crea un intento nuevo
    cancel_requested: ["canceled"],
    payment_rejected: ["canceled"],
    provider_ended: ["canceled"],
  },
  expired: {
    payment_confirmed: ["active"],
    checkout_started: ["pending"],
    cancel_requested: ["canceled"],
    payment_rejected: ["expired"],
    provider_ended: ["expired"],
  },
});

export type TriggerResult =
  | { ok: true; status: BillingStatus; changed: boolean }
  | { ok: false; code: "impossible_transition" | "invalid_target" };

/** Aplica un disparador. `target` se exige sólo cuando el disparador admite más de un destino. */
export function applyTrigger(from: BillingStatus, trigger: BillingTrigger, target?: BillingStatus): TriggerResult {
  const targets = TRANSITIONS[from]?.[trigger];
  if (!targets || targets.length === 0) return { ok: false, code: "impossible_transition" };
  const status = targets.length === 1 ? targets[0] : target;
  if (!status || !targets.includes(status)) return { ok: false, code: "invalid_target" };
  return { ok: true, status, changed: status !== from };
}

export function canApplyTrigger(from: BillingStatus, trigger: BillingTrigger): boolean {
  return (TRANSITIONS[from]?.[trigger]?.length ?? 0) > 0;
}

/** Todos los destinos posibles en UN paso, con el disparador que lleva a cada uno. */
export function edgesFrom(from: BillingStatus): ReadonlyArray<{ trigger: BillingTrigger; to: BillingStatus }> {
  const edges: Array<{ trigger: BillingTrigger; to: BillingStatus }> = [];
  for (const trigger of [...AUTOMATIC_TRIGGERS, ...COMMAND_TRIGGERS]) {
    for (const to of TRANSITIONS[from][trigger] ?? []) edges.push({ trigger, to });
  }
  return edges;
}

/**
 * ¿Se llega de `from` a `to` encadenando disparadores permitidos del conjunto `through`? Una cuenta cuyos avisos se demoraron
 * puede haber recorrido varios estados antes de que el sistema lo note (active → past_due → grace_period → limited): eso es
 * válido. Pasar de `canceled` a `active` sin un intento de pago nuevo, no.
 */
export function isReachable(from: BillingStatus, to: BillingStatus, through: readonly BillingTrigger[]): boolean {
  if (from === to) return true;
  const seen = new Set<BillingStatus>([from]);
  const queue: BillingStatus[] = [from];
  while (queue.length > 0) {
    const current = queue.shift() as BillingStatus;
    for (const edge of edgesFrom(current)) {
      if (!through.includes(edge.trigger) || seen.has(edge.to)) continue;
      if (edge.to === to) return true;
      seen.add(edge.to);
      queue.push(edge.to);
    }
  }
  return false;
}

/** Disparadores con los que el sistema puede mover una cuenta por hechos verificados, por el reloj o por comandos ya aplicados. */
export const DERIVATION_TRIGGERS: readonly BillingTrigger[] = [...AUTOMATIC_TRIGGERS, "cancel_requested", "reactivate_requested"];
