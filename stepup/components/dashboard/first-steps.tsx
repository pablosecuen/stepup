import { CheckIcon } from "@heroicons/react/24/solid";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { PrivateButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { FirstStep } from "@/lib/dashboard/home-welcome";

/**
 * "Primeros pasos" de Inicio: sólo los pasos reales (ver `buildFirstSteps`). El estado de cada paso se dice con texto
 * ("Listo" / "Paso N") y con ícono, nunca sólo con color; un paso bloqueado explica por qué en vez de ser un botón muerto.
 */
export function FirstSteps({ steps }: { steps: FirstStep[] }) {
  const doneCount = steps.filter((step) => step.done).length;
  const percent = steps.length === 0 ? 0 : Math.round((doneCount / steps.length) * 100);
  return (
    <section aria-labelledby="first-steps-title" className="mt-6 max-w-[960px] rounded-lg border-[1.5px] border-border bg-surface p-4 shadow-card nav:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="first-steps-title" className="font-display text-[24px] font-semibold tracking-tight text-textPrimary">
          Primeros pasos
        </h2>
        <Badge tone={doneCount > 0 ? "ok" : "neutral"}>
          {doneCount} de {steps.length} listos
        </Badge>
      </div>
      <p className="mt-1 text-[15px] text-textSecondary">Así vas a ver tu agenda y tus cobros acá.</p>
      <div aria-hidden className="mt-3 h-2 max-w-[420px] overflow-hidden rounded-pill bg-paperDeep">
        <div className="h-full rounded-pill bg-accent" style={{ width: `${percent}%` }} />
      </div>
      <ol className="mt-4 flex flex-col gap-3">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className={`flex items-start gap-3.5 rounded-lg border-[1.5px] border-border p-4 ${step.done || !step.href ? "bg-surface2" : "bg-surface"}`}
          >
            {step.done ? (
              <span aria-hidden className="mt-0.5 flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-pill border-2 border-okLine bg-okSoft text-ok">
                <CheckIcon className="h-4 w-4" />
              </span>
            ) : (
              <span
                aria-hidden
                className="mt-0.5 flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-pill border-2 border-borderMid font-display font-bold text-textSecondary"
              >
                {index + 1}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-display text-[19px] font-semibold leading-snug text-textPrimary">
                <span className="sr-only">{step.done ? "Listo: " : `Paso ${index + 1}: `}</span>
                {step.title}
              </p>
              <p className="mt-0.5 text-[14.5px] text-textSecondary">{step.description}</p>
              {step.done ? (
                <p className="mt-2 flex items-center gap-1.5 text-[13.5px] font-bold text-textSecondary">
                  <CheckCircleIcon className="h-4 w-4 text-ok" aria-hidden />
                  Listo
                </p>
              ) : step.href ? (
                <PrivateButtonLink href={step.href} variant="accent" className="mt-3 w-full nav:w-auto">
                  {step.actionLabel}
                </PrivateButtonLink>
              ) : (
                <p className="mt-2 text-[13.5px] font-[650] text-textSecondary">{step.blockedReason}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
