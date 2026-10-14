import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { AuthShell } from "./auth-shell";
import { FormInfoBox } from "./form-boxes";

// Pantalla que ve la persona si la conexión con las cuentas no está disponible en este entorno. Texto en lenguaje simple:
// nunca nombra proveedores ni configuración interna.
// `inShell`: las pantallas privadas ya están dentro del `<main id="contenido">` del shell; no se anida otro.
export function AuthNotConfigured({ inShell = false }: { inShell?: boolean } = {}) {
  return (
    <AuthShell layout="card" inShell={inShell} status={{ tone: "warn", icon: ExclamationTriangleIcon }} title="Cuenta no disponible" subtitle="No pudimos conectar con tu cuenta en este momento.">
      <FormInfoBox>Volvé a intentarlo en unos minutos. No hace falta hacer nada más.</FormInfoBox>
    </AuthShell>
  );
}
