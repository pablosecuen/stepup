import { isSupabaseConfigured } from "@/lib/auth/config";
import { createSupabaseAuthAdapter } from "@/lib/auth/supabase-auth-adapter";
import { signOutAction } from "@/lib/auth/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Configuración · TeacherFlow" };

const OTHER_SECTIONS = [
  { title: "Perfil de la profesora", description: "Nombre y datos visibles en la app." },
  { title: "Respaldo", description: "Copias de seguridad de tus datos." },
];

export default async function ConfiguracionPage() {
  const configured = isSupabaseConfigured();
  const user = configured ? await createSupabaseAuthAdapter().getUser() : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
      <h1 className="text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Configuración</h1>
      <p className="mt-1.5 text-sm text-textMuted">Vista previa — sin conexión a tu cuenta real todavía.</p>

      <ul className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {user ? (
          <li className="rounded-lg border border-border bg-surface px-4 py-3.5 shadow-card sm:col-span-2">
            <p className="text-sm font-semibold text-textPrimary">Cuenta</p>
            <p className="mt-0.5 text-xs text-textMuted">{user.email}</p>
            {/* Igual que móvil: "Cerrar sesión" no pide confirmación. */}
            <form action={signOutAction} className="mt-3">
              <button
                type="submit"
                className="rounded-md border border-border px-3.5 py-2 text-sm font-semibold text-textSecondary transition-all duration-150 ease-premium hover:bg-background active:scale-[0.98]"
              >
                Cerrar sesión
              </button>
            </form>
          </li>
        ) : (
          <li className="rounded-lg border border-border bg-surface px-4 py-3.5 shadow-card transition-all duration-200 ease-premium hover:-translate-y-0.5 hover:border-brandBlue/30 hover:shadow-cardHover">
            <p className="text-sm font-semibold text-textPrimary">Cuenta</p>
            <p className="mt-0.5 text-xs text-textMuted">Correo, contraseña y sesión activa.</p>
          </li>
        )}

        {OTHER_SECTIONS.map((section) => (
          <li
            key={section.title}
            className="rounded-lg border border-border bg-surface px-4 py-3.5 shadow-card transition-all duration-200 ease-premium hover:-translate-y-0.5 hover:border-brandBlue/30 hover:shadow-cardHover"
          >
            <p className="text-sm font-semibold text-textPrimary">{section.title}</p>
            <p className="mt-0.5 text-xs text-textMuted">{section.description}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
