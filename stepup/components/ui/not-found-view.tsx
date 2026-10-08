import PrivateLink from "@/components/nav/private-link";
import { buttonClass } from "@/components/ui/button";

/**
 * Vista de "no encontrado" (la usan los `not-found.tsx` de la app). Mensaje simple y UN camino claro de vuelta.
 * `inShell`: dentro del shell privado (que ya tiene <main>) o como página completa (URL desconocida).
 */
export function NotFoundView({
  title,
  message,
  actionLabel,
  actionHref,
  inShell,
}: {
  title: string;
  message: string;
  actionLabel: string;
  actionHref: string;
  inShell: boolean;
}) {
  const content = (
    <>
      <p aria-hidden className="font-display text-[72px] font-normal leading-none text-accent">
        404
      </p>
      <h1 className="font-display text-section font-medium text-textPrimary">{title}</h1>
      <p className="text-[15px] text-textSecondary">{message}</p>
      <PrivateLink href={actionHref} className={`min-h-11 ${buttonClass({ variant: "primary" })}`}>
        {actionLabel}
      </PrivateLink>
    </>
  );
  const className = "mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center";
  return inShell ? <div className={className}>{content}</div> : <main id="contenido" tabIndex={-1} className={`${className} focus:outline-none`}>{content}</main>;
}
