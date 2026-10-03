import { AuthShell } from "@/components/auth/auth-shell";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { ForgotPasswordForm } from "./forgot-password-form";
import { isSupabaseConfigured } from "@/lib/auth/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recuperar contraseña · TeacherFlow" };

// Mismos título/subtítulo que ForgotPasswordScreen.tsx en móvil.
export default async function RecuperarContrasenaPage() {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  // Ya no se redirige a Inicio si hay una sesión: en un dispositivo con una sesión vieja (otra cuenta)
  // la persona igual tiene que poder pedir/usar un enlace de recuperación.
  return (
    <AuthShell
      title="Recuperar contraseña"
      subtitle="Te enviamos un enlace a tu correo para elegir una contraseña nueva."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
