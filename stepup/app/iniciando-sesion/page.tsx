import Image from "next/image";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { createSupabaseAuthAdapter } from "@/lib/auth/supabase-auth-adapter";
import { signOutAction } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
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
      <Button type="submit" variant="ghost" block>
        Cerrar sesión
      </Button>
    </form>
  );

  return (
    <main id="contenido" tabIndex={-1} className="focus:outline-none flex min-h-screen flex-col items-center justify-center px-5 py-8">
      <div className="w-full max-w-[440px]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Image src="/icon.png" alt="TeacherFlow" width={60} height={60} className="rounded-2xl" />
        </div>
        <div className="rounded-lg border-[1.5px] border-border bg-surface p-5 shadow-card nav:p-6">
          <SessionRecovery signOutForm={signOutForm} />
        </div>
      </div>
    </main>
  );
}
