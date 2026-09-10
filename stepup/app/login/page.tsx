import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { LoginForm } from "./login-form";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { createSupabaseAuthAdapter } from "@/lib/auth/supabase-auth-adapter";
import { sanitizeNextPath } from "@/lib/auth/safe-redirect";

export const dynamic = "force-dynamic";
export const metadata = { title: "Iniciar sesión · TeacherFlow" };

// Mismos título/subtítulo que SignInScreen.tsx en móvil.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next: rawNext } = await searchParams;
  const next = sanitizeNextPath(rawNext);

  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  const user = await createSupabaseAuthAdapter().getUser();
  if (user) redirect(next);

  return (
    <AuthShell title="Iniciar sesión" subtitle="Usá tu cuenta de TeacherFlow para sincronizar en el futuro.">
      <LoginForm next={next} />
    </AuthShell>
  );
}
