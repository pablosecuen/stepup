// Decisión de acceso al área privada — función PURA, sin dependencias de
// Next ni de Supabase, para que tanto `proxy.ts` (enrutamiento inicial)
// como el layout privado (verificación definitiva en el servidor, "no
// dependas exclusivamente de proxy.ts") apliquen EXACTAMENTE la misma
// regla. Cubre el caso "Supabase no configurado" replicando la regla de
// móvil (`AuthGate.tsx`): si no está configurado, el área nunca se
// bloquea — sigue funcionando en modo local/vista previa, igual que hoy.
import { sanitizeNextPath } from "./safe-redirect.ts";

export type PrivateAreaDecision =
  | { kind: "allow" }
  | { kind: "local-only" }
  | { kind: "redirect"; to: string };

export interface PrivateAreaAccessInput {
  configured: boolean;
  hasSession: boolean;
  pathname: string;
  search?: string;
}

export function resolvePrivateAreaAccess(input: PrivateAreaAccessInput): PrivateAreaDecision {
  if (!input.configured) return { kind: "local-only" };
  if (input.hasSession) return { kind: "allow" };

  const rawNext = `${input.pathname}${input.search ?? ""}`;
  const next = sanitizeNextPath(rawNext, input.pathname);
  return { kind: "redirect", to: `/login?next=${encodeURIComponent(next)}` };
}
