/**
 * Contacto de soporte de la facturación. El correo NO está escrito en el código: sale de la variable `BILLING_SUPPORT_EMAIL`
 * (sólo servidor; la decisión de cuál es la toma TeacherFlow). Función PURA: recibe el entorno inyectado.
 * Falla de forma segura: si falta o no tiene forma de correo, no hay contacto y las pantallas no dibujan ningún enlace (jamás uno roto
 * ni uno inventado). El valor se valida estrictamente para que no pueda colar parámetros ni encabezados en el enlace `mailto:`.
 */
export interface SupportContact {
  readonly address: string;
  readonly href: string;
}

const LOCAL = /^[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9])?$/;
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export function resolveSupportContact(env: Readonly<Record<string, string | undefined>>): SupportContact | null {
  const raw = env.BILLING_SUPPORT_EMAIL;
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
