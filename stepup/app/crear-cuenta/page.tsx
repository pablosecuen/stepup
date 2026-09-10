import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { SignUpForm } from "./signup-form";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { createSupabaseAuthAdapter } from "@/lib/auth/supabase-auth-adapter";
import { DEFAULT_AUTH_REDIRECT } from "@/lib/auth/safe-redirect";

export const dynamic = "force-dynamic";
export const metadata = { title: "Crear cuenta · TeacherFlow" };

// Mismos título/subtítulo que SignUpScreen.tsx en móvil.
export default async function CrearCuentaPage() {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  const user = await createSupabaseAuthAdapter().getUser();
  if (user) redirect(DEFAULT_AUTH_REDIRECT);

  return (
    <AuthShell title="Crear cuenta" subtitle="Esta cuenta todavía no sincroniza datos — sólo prepara el acceso.">
      <SignUpForm />
    </AuthShell>
  );
}
