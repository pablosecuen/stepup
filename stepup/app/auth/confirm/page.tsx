import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { ConfirmSubmitButton } from "@/components/auth/confirm-submit-button";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { planAuthLinkConfirmation } from "@/lib/auth/recovery-flow";
import { confirmAuthLinkAction } from "@/lib/auth/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirmá tu enlace · TeacherFlow", robots: { index: false, follow: false } };

interface ConfirmSearchParams {
  token_hash?: string;
  type?: string;
  code?: string;
  error_code?: string;
}

const COPY = {
  recovery: {
    title: "Elegí una contraseña nueva",
    subtitle: "Confirmá para continuar. Este enlace funciona una sola vez.",
    button: "Continuar",
  },
  signup: {
    title: "Confirmá tu correo",
    subtitle: "Confirmá para activar tu cuenta. Este enlace funciona una sola vez.",
    button: "Confirmar mi correo",
  },
} as const;

/**
 * Destino de los enlaces de correo (recuperación de contraseña y confirmación
 * de alta). Abrir esta página (GET) NO consume el token: sólo lo muestra detrás
 * de un botón. El token se verifica recién en `confirmAuthLinkAction` (POST),
 * así un escáner/prefetch del correo que únicamente hace GET no lo quema, y como
 * no usa PKCE funciona abierto desde otro dispositivo o navegador. Sólo se
 * aceptan los `type` oficiales (recovery, signup, email). Nunca se loguea ni se
 * muestra el token.
 */
export default async function AuthConfirmPage({ searchParams }: { searchParams: Promise<ConfirmSearchParams> }) {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  const params = await searchParams;
  const plan = planAuthLinkConfirmation({
    tokenHash: params.token_hash,
    type: params.type,
    code: params.code,
    urlErrorCode: params.error_code,
  });

  if (plan.kind === "error") redirect(`/auth/error?type=${plan.category}`);

  // Enlace antiguo (PKCE): el canje necesita escribir cookies, algo que sólo puede hacer un Route Handler,
  // y es ahí donde se decide el destino (recuperación o alta) según cómo se pidió el correo.
  if (plan.kind === "exchange-code") {
    redirect(`/auth/callback?code=${encodeURIComponent(plan.code)}`);
  }

  const copy = COPY[plan.flow];

  return (
    <AuthShell title={copy.title} subtitle={copy.subtitle}>
      <form action={confirmAuthLinkAction} className="flex flex-col gap-4" aria-label="Confirmar el enlace del correo">
        <input type="hidden" name="tokenHash" value={plan.tokenHash} />
        <input type="hidden" name="type" value={plan.type} />
        <ConfirmSubmitButton label={copy.button} />
      </form>
    </AuthShell>
  );
}
