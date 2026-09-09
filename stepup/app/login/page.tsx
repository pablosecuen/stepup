import Image from "next/image";
import Link from "next/link";

// Fase A: pantalla visual únicamente — todavía sin autenticación real.
// "Ingresar" navega directo al área privada simulada (datos ficticios), sin
// validar nada. La conexión real con Supabase Auth llega en una fase
// posterior, todavía no autorizada.
export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <Image src="/icon.png" alt="TeacherFlow" width={56} height={56} className="rounded-xl" />
          <h1 className="text-xl font-bold text-textPrimary">Ingresá a TeacherFlow</h1>
        </div>

        <form className="flex flex-col gap-4" aria-label="Formulario de inicio de sesión (vista previa)">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium text-textSecondary">
              Correo electrónico
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="profesora@ejemplo.com"
              className="rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium text-textSecondary">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              className="rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
            />
          </div>

          <Link
            href="/inicio"
            className="mt-2 rounded-md bg-brandBlue px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-brandBlueDark focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
          >
            Ingresar
          </Link>
        </form>

        <p className="mt-6 text-center text-xs text-textMuted">
          Vista previa sin autenticación real — la conexión con la cuenta real llega en una fase
          posterior.
        </p>

        <Link
          href="/"
          className="mt-4 block text-center text-sm font-medium text-brandBlue hover:underline"
        >
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
