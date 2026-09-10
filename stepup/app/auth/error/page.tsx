import Link from "next/link";
import Image from "next/image";
import { CALLBACK_ERROR_MESSAGES, type CallbackErrorCategory } from "@/lib/auth/error-messages";

export const dynamic = "force-dynamic";
export const metadata = { title: "No pudimos verificar tu cuenta · TeacherFlow" };

function resolveMessage(type: string | undefined): string {
  const categories = Object.keys(CALLBACK_ERROR_MESSAGES) as CallbackErrorCategory[];
  const category = categories.find((candidate) => candidate === type) ?? "unknown";
  return CALLBACK_ERROR_MESSAGES[category];
}

// Mismo título que AuthErrorScreen.tsx en móvil ("No pudimos verificar tu
// cuenta"), usado ahí para los mismos casos de enlace de confirmación o
// recuperación vencido/inválido/ya usado.
export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  const message = resolveMessage(type);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Image src="/icon.png" alt="TeacherFlow" width={56} height={56} className="rounded-xl" />
          <h1 className="text-xl font-bold text-textPrimary">No pudimos verificar tu cuenta</h1>
        </div>

        <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-card">
          <p role="alert" className="text-center text-sm text-textSecondary">
            {message}
          </p>
          <Link
            href="/login"
            className="mt-2 rounded-md bg-brandBlue px-4 py-2.5 text-center text-sm font-semibold text-white shadow-card transition-all duration-150 ease-premium hover:bg-brandBlueDark active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
          >
            Reintentar
          </Link>
        </div>

        <Link href="/" className="mt-4 block text-center text-sm font-medium text-brandBlue hover:underline">
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
