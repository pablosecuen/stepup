import { AuthShell } from "./auth-shell";
import { FormInfoBox } from "./form-boxes";

// Pantalla que ve la persona si la conexión con las cuentas no está disponible en este entorno. Texto en lenguaje simple:
// nunca nombra proveedores ni configuración interna.
export function AuthNotConfigured() {
  return (
    <AuthShell title="Cuenta no disponible" subtitle="No pudimos conectar con tu cuenta en este momento.">
      <FormInfoBox>Volvé a intentarlo en unos minutos. No hace falta hacer nada más.</FormInfoBox>
    </AuthShell>
  );
}
