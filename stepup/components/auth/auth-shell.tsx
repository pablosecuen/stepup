import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

interface AuthShellProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Envoltorio visual compartido por las pantallas de autenticación —
 * mismo espíritu que `accountStyles.ts` en móvil ("evita repetir el mismo
 * formulario 5 veces"): ícono, título, subtítulo centrados sobre una
 * tarjeta con el mismo lenguaje visual premium ya establecido en el resto
 * de la web.
 */
export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Image src="/icon.png" alt="TeacherFlow" width={56} height={56} className="rounded-xl" />
          <h1 className="text-xl font-bold text-textPrimary">{title}</h1>
          <p className="text-sm text-textSecondary">{subtitle}</p>
        </div>

        <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-card">{children}</div>

        {footer}

        <Link
          href="/"
          className="mt-4 block text-center text-sm font-medium text-brandBlue transition-colors hover:underline"
        >
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
