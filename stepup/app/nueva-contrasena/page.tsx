import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { NewPasswordForm } from "./new-password-form";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { createSupabaseAuthAdapter } from "@/lib/auth/supabase-auth-adapter";

export const dynamic = "force-dynamic";
export const metadata = { title: "Elegí una contraseña nueva · TeacherFlow" };

// Mismos título/subtítulo que NewPasswordScreen.tsx en móvil. Móvil sólo
// permite llegar acá tras el evento PASSWORD_RECOVERY (nunca por
// navegación manual); acá el equivalente disponible en el servidor es
// exigir una sesión activa (la que /auth/callback ya dejó al procesar el
// enlace de recuperación) — sin sesión, nunca se muestra el formulario.
export default async function NuevaContrasenaPage() {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  const user = await createSupabaseAuthAdapter().getUser();
  if (!user) redirect("/login");

  return (
    <AuthShell title="Elegí una contraseña nueva" subtitle="Después de guardarla, vas a iniciar sesión de nuevo con ella.">
      <NewPasswordForm />
    </AuthShell>
  );
}
