import { PUBLIC_BUSINESS } from "../business/public-profile.ts";

/**
 * Contacto de soporte de la facturación. FUENTE ÚNICA: el correo del titular de `lib/business/public-profile.ts` (el mismo que muestran Contacto,
 * Términos y Privacidad), una vez confirmado (`contactConfirmed`). La variable `BILLING_SUPPORT_EMAIL` (sólo servidor) existe únicamente para
 * REEMPLAZARLO si algún día soporte tiene otra casilla: si falta o no es válida, vale el del titular (nunca queda sin contacto ni con dos
 * correos distintos). Función PURA: recibe el entorno inyectado. El valor se valida estrictamente para que no pueda colar parámetros ni
 * encabezados en el enlace `mailto:`; cualquier valor inválido se descarta (jamás un enlace roto ni inventado).
 */
export interface SupportContact {
  readonly address: string;
  readonly href: string;
}

const LOCAL = /^[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9])?$/;
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

function validContact(raw: unknown): SupportContact | null {
  if (typeof raw !== "string") return null;
  const address = raw.trim();
  if (address.length < 6 || address.length > 254) return null;
  const parts = address.split("@");
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (!LOCAL.test(local) || local.includes("..")) return null;
  const labels = domain.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
  if (!/^[A-Za-z]{2,24}$/.test(labels[labels.length - 1])) return null;
  return { address, href: `mailto:${address}?subject=${encodeURIComponent("Consulta de facturación — TeacherFlow")}` };
}

export function resolveSupportContact(env: Readonly<Record<string, string | undefined>>): SupportContact | null {
  return validContact(env.BILLING_SUPPORT_EMAIL) ?? (PUBLIC_BUSINESS.contactConfirmed ? validContact(PUBLIC_BUSINESS.email) : null);
}
