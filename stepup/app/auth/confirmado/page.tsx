import { CheckCircleIcon } from "@heroicons/react/24/outline";
import { AuthShell } from "@/components/auth/auth-shell";
import { ButtonLink } from "@/components/auth/public-links";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cuenta confirmada · TeacherFlow", robots: { index: false, follow: false } };

/**
 * Pantalla final de una alta confirmada (enlace o código de 6 dígitos). Es pública y estática a propósito: no
 * consulta datos ni depende de que Inicio cargue, y no confirma nada por sí sola (la verificación ya ocurrió en
 * `confirmAuthLinkAction`/`verifyEmailCodeAction`). Antes la alta redirigía directo a Inicio, sin ninguna señal de que
 * la confirmación había funcionado.
 */
export default function AccountConfirmedPage() {
  return (
    <AuthShell layout="card" status={{ tone: "ok", icon: CheckCircleIcon }} title="Cuenta confirmada" subtitle="Tu correo fue verificado correctamente.">
      <ButtonLink href="/login" size="lg" block>
        Iniciar sesión
      </ButtonLink>
    </AuthShell>
  );
}
