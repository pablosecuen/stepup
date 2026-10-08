import { ExclamationTriangleIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import { AuthShell } from "@/components/auth/auth-shell";
import { ButtonLink, TextLink } from "@/components/auth/public-links";
import { describeAuthErrorScreen } from "@/lib/auth/error-messages";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verificación de tu cuenta · TeacherFlow", robots: { index: false, follow: false } };

// Mismo título que AuthErrorScreen.tsx en móvil ("No pudimos verificar tu
// cuenta") para los fallos reales. Un enlace ya usado o vencido (lo más común
// tras un segundo toque) se presenta como aviso con "Iniciar sesión" primero:
// ver `describeAuthErrorScreen`.
export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  const screen = describeAuthErrorScreen(type);
  const isError = screen.tone === "error";

  return (
    <AuthShell
      layout="card"
      status={isError ? { tone: "bad", icon: ExclamationTriangleIcon } : { tone: "info", icon: InformationCircleIcon }}
      title={screen.title}
      footer={
        <TextLink href={screen.secondary.href} block className="mt-2">
          {screen.secondary.label}
        </TextLink>
      }
    >
      <p role={isError ? "alert" : "status"} className="text-center text-[15px] text-textSecondary">
        {screen.message}
      </p>
      <ButtonLink href={screen.primary.href} size="lg" block>
        {screen.primary.label}
      </ButtonLink>
    </AuthShell>
  );
}
