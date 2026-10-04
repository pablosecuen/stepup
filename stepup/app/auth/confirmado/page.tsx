import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";

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
    <AuthShell title="Cuenta confirmada" subtitle="Tu correo fue verificado correctamente.">
      <Link
        href="/login"
        className="rounded-md bg-brandBlue px-4 py-2.5 text-center text-sm font-semibold text-white shadow-card transition-all duration-150 ease-premium hover:bg-brandBlueDark active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
      >
        Iniciar sesión
      </Link>
    </AuthShell>
  );
}
