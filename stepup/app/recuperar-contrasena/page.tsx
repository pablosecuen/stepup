import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { ForgotPasswordForm } from "./forgot-password-form";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { createSupabaseAuthAdapter } from "@/lib/auth/supabase-auth-adapter";
import { DEFAULT_AUTH_REDIRECT } from "@/lib/auth/safe-redirect";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recuperar contraseña · TeacherFlow" };

// Mismos título/subtítulo que ForgotPasswordScreen.tsx en móvil.
export default async function RecuperarContrasenaPage() {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  const user = await createSupabaseAuthAdapter().getUser();
  if (user) redirect(DEFAULT_AUTH_REDIRECT);

  return (
    <AuthShell
      title="Recuperar contraseña"
      subtitle="Te enviamos un enlace a tu correo para elegir una contraseña nueva."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
