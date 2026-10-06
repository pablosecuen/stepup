import PrivateLink from "@/components/nav/private-link";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import type { FirstStep } from "@/lib/dashboard/home-welcome";

/**
 * "Primeros pasos" de Inicio: sólo los pasos reales (ver `buildFirstSteps`). El estado de cada paso se dice con texto
 * ("Listo" / "Paso N") y con ícono, nunca sólo con color; un paso bloqueado explica por qué en vez de ser un botón muerto.
 */
export function FirstSteps({ steps }: { steps: FirstStep[] }) {
  const doneCount = steps.filter((step) => step.done).length;
  return (
    <section aria-labelledby="first-steps-title" className="mt-8 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="first-steps-title" className="text-base font-semibold text-textPrimary">
          Primeros pasos
        </h2>
        <p className="text-xs font-semibold text-textSecondary">
          {doneCount} de {steps.length} listos
        </p>
      </div>
      <p className="mt-1 text-sm text-textMuted">Así vas a ver tu agenda y tus cobros acá.</p>
      <ol className="mt-4 flex flex-col gap-3">
        {steps.map((step, index) => (
          <li key={step.id} className="flex items-start gap-3 rounded-md border border-border px-3.5 py-3">
            {step.done ? (
              <CheckCircleIcon className="mt-0.5 h-6 w-6 shrink-0 text-statusVerde" aria-hidden />
            ) : (
              <span
                aria-hidden
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-bold text-textSecondary"
              >
                {index + 1}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-textPrimary">
                <span className="sr-only">{step.done ? "Listo: " : `Paso ${index + 1}: `}</span>
                {step.title}
              </p>
              <p className="mt-0.5 text-sm text-textMuted">{step.description}</p>
              {step.done ? (
                <p className="mt-1.5 text-xs font-semibold text-textSecondary">Listo</p>
              ) : step.href ? (
                <PrivateLink
                  href={step.href}
                  className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md bg-brandBlue px-5 text-sm font-semibold text-white shadow-card transition-colors hover:bg-brandBlueDark focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
                >
                  {step.actionLabel}
                </PrivateLink>
              ) : (
                <p className="mt-1.5 text-xs font-medium text-textSecondary">{step.blockedReason}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
