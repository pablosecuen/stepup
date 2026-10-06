import PrivateLink from "@/components/nav/private-link";

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
      <h1 className="text-xl font-semibold text-textPrimary">{title}</h1>
      <p className="text-sm text-textSecondary">{message}</p>
      <PrivateLink
        href={actionHref}
        className="inline-flex min-h-11 items-center rounded-md bg-brandBlue px-5 text-sm font-semibold text-white shadow-card transition-colors hover:bg-brandBlueDark focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
      >
        {actionLabel}
      </PrivateLink>
    </>
  );
  const className = "mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center";
  return inShell ? <div className={className}>{content}</div> : <main id="contenido" tabIndex={-1} className={`${className} focus:outline-none`}>{content}</main>;
}
