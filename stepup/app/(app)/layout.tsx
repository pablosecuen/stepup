import Link from "next/link";
import { PrimaryNav } from "@/components/nav/primary-nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen md:pl-56">
      {/* Fase A: área privada simulada, sin autenticación real todavía —
          este aviso deja claro que lo mostrado es una vista previa. */}
      <div className="border-b border-border bg-brandBlue/5 px-4 py-2 text-center text-xs font-medium text-brandBlueDark">
        Vista previa con datos ficticios — todavía sin conexión a tu cuenta real.{" "}
        <Link href="/" className="underline decoration-brandBlueDark/40 underline-offset-2 transition hover:decoration-brandBlueDark">
          Volver al inicio
        </Link>
      </div>
      <PrimaryNav />
      <main className="pb-20 md:pb-0">{children}</main>
    </div>
  );
}
