import { readBillingFlags } from "./flags.ts";

/**
 * Piloto de la facturación: mientras `BILLING_PILOT_OWNER_IDS` esté definida, la contratación y las pantallas de facturación
 * sólo existen para las cuentas listadas (ids de usuario separados por coma). Sirve para validar el circuito real (una compra de
 * la titular acreditada de punta a punta) ANTES de abrirlo a todo el público.
 *
 *  - Sin la variable (o con la facturación apagada): el comportamiento es el de siempre (`BILLING_ENABLED` decide).
 *  - Con la variable definida: SÓLO las cuentas de la lista ven «Facturación» y pueden contratar; para el resto todo se comporta
 *    como si la facturación estuviera apagada (la página pública de planes sigue mostrando «Crear cuenta»).
 *  - Falla cerrado: una variable definida pero vacía o mal escrita no habilita a nadie.
 *  - NO afecta a los avisos de Rebill ni a los trabajos programados: los cobros ya hechos siempre se procesan y se concilian.
 *  - Quitar la variable (y volver a desplegar la página pública de planes) abre la contratación a todos.
 */
export const PILOT_VARIABLE = "BILLING_PILOT_OWNER_IDS";

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `null` = no hay piloto (abierto a todos); un conjunto (posiblemente vacío) = sólo esas cuentas. */
export function readPilotOwnerIds(env: Readonly<Record<string, string | undefined>> = process.env): ReadonlySet<string> | null {
  const raw = env[PILOT_VARIABLE];
  if (typeof raw !== "string") return null;
  return new Set(raw.split(",").map((part) => part.trim().toLowerCase()).filter((part) => USER_ID.test(part)));
}

/** ¿Esta cuenta puede ver «Facturación» y contratar? */
export function isBillingOpenFor(ownerId: string | null | undefined, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (!readBillingFlags(env).enabled) return false;
  const pilot = readPilotOwnerIds(env);
  if (pilot === null) return true;
  return typeof ownerId === "string" && pilot.has(ownerId.trim().toLowerCase());
}

/** ¿La contratación está abierta a cualquier visitante (página pública de planes)? Con piloto activo, no. */
export function isBillingPublic(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return readBillingFlags(env).enabled && readPilotOwnerIds(env) === null;
}
