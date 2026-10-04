import Image from "next/image";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { createSupabaseAuthAdapter } from "@/lib/auth/supabase-auth-adapter";
import { signOutAction } from "@/lib/auth/actions";
import { SessionRecovery } from "./session-recovery";

export const dynamic = "force-dynamic";
export const metadata = { title: "Iniciando sesión · TeacherFlow", robots: { index: false, follow: false } };

/**
 * Pantalla transitoria de la recuperación de sesión (ver lib/auth/session-recovery.ts). Está FUERA del grupo `(app)` a
 * propósito: no hereda la navegación privada y, como no tiene ningún `<Link>`, no dispara precargas de otras rutas.
 * Requiere una sesión: sin ella manda a Login.
 */
export default async function IniciandoSesionPage() {
  if (!isSupabaseConfigured()) redirect("/login");
  const user = await createSupabaseAuthAdapter().getUser();
  if (!user) redirect("/login");

  const signOutForm = (
    <form action={signOutAction}>
      <button type="submit" className="w-full text-center text-sm font-medium text-textMuted hover:text-textSecondary hover:underline">
        Cerrar sesión
      </button>
    </form>
  );

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Image src="/icon.png" alt="TeacherFlow" width={56} height={56} className="rounded-xl" />
        </div>
        <div className="rounded-xl border border-border bg-surface p-6 shadow-card">
          <SessionRecovery signOutForm={signOutForm} />
        </div>
      </div>
    </main>
  );
}
