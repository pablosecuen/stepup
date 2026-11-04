import { ButtonLink } from "@/components/auth/public-links";
import { formatMoney } from "@/lib/format/number-format";
import { ListCascade } from "@/components/ui/list-cascade";

interface PlanPresentation {
  code: string;
  name: string;
  monthsOfAccess: number;
  amountPesos: number;
  monthlyEquivalentPesos: number;
  savingPesos: number;
  savingPercent: number;
  referenceMonthlyPesos: number;
}

export function PlanComparison({ plans }: { plans: readonly PlanPresentation[] }) {
  return <section aria-label="Comparar planes">
    <div className="grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <ListCascade>
      {plans.map(plan => {
        const annual = plan.monthsOfAccess === 12;
        return <article key={plan.code} data-tf-cascade-row aria-label={`Plan ${plan.name}`} className={`flex min-w-0 flex-col rounded-2xl border p-5 sm:p-6 ${annual ? "border-[#80639f] bg-[#eee6f7] shadow-card" : "border-border bg-surface"}`}>
          <div className="mb-4 flex min-h-7 items-center justify-between gap-2">
            <h2 className="font-display text-2xl">{plan.name}</h2>
            {annual && <span className="rounded-full bg-[#4d356b] px-3 py-1 text-xs font-semibold text-white">Mejor precio</span>}
          </div>
          <p className="min-h-6 text-sm text-textSecondary">{annual ? <><span className="sr-only">Precio mensual de referencia: </span><s>{formatMoney(plan.referenceMonthlyPesos)}</s></> : plan.monthsOfAccess === 1 ? "Mes a mes, a tu ritmo" : `${plan.monthsOfAccess} meses de organización`}</p>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-1 tabular-nums"><span className="font-display text-[clamp(2rem,3vw,2.625rem)] leading-tight">{formatMoney(plan.monthlyEquivalentPesos)}</span><span className="text-base text-textSecondary">/mes</span></p>
          <p className="mt-4 text-sm leading-relaxed text-textSecondary sm:min-h-12">{plan.monthsOfAccess === 1 ? <>Cobro mensual de <strong className="text-textPrimary">{formatMoney(plan.amountPesos)}</strong>.</> : <>Un pago de <strong className="text-textPrimary">{formatMoney(plan.amountPesos)}</strong> cada {plan.monthsOfAccess} meses.</>}</p>
          <div className="mt-4 border-t border-border pt-4 sm:min-h-[92px]">
            {plan.savingPesos > 0 ? <><p className={`font-semibold ${annual ? "text-[#4d356b]" : "text-textPrimary"}`}>Ahorrás {formatMoney(plan.savingPesos)} · {plan.savingPercent} %</p><p className="mt-2 text-sm text-textSecondary">{annual ? "12 meses por menos de lo que cuestan 10." : "Frente a pagar mes a mes."}</p></> : <p className="text-sm text-textSecondary">Elegí el período que mejor acompañe tu forma de trabajar.</p>}
          </div>
          <ButtonLink href="/crear-cuenta" variant={annual ? "primary" : "secondary"} className="mt-6 self-start">Crear cuenta</ButtonLink>
        </article>;
      })}
      </ListCascade>
    </div>
    <p className="mt-4 text-sm leading-relaxed text-textSecondary">Precios en pesos argentinos. El precio por mes permite comparar los planes; el cobro se realiza por el período completo indicado. Los porcentajes de ahorro están redondeados y se comparan con el plan mensual vigente.</p>
    <section aria-labelledby="included-features" className="mt-9 rounded-2xl border border-border bg-surface p-5 sm:p-7">
      <h2 id="included-features" className="font-display text-2xl">Todo TeacherFlow, en todos los planes.</h2>
      <ul className="mt-5 grid gap-x-8 gap-y-3 text-textSecondary sm:grid-cols-2 lg:grid-cols-3">
        {["Gestión de alumnos", "Calendario y series", "Registro de clases y tareas", "Control de cobros", "Reportes y evidencias", "Resumen financiero"].map(feature => <li key={feature} className="flex items-center gap-2"><span aria-hidden="true" className="text-[#4d356b]">✓</span>{feature}</li>)}
      </ul>
    </section>
    <p className="mt-5 text-sm text-textSecondary">La contratación online está en preparación. Crear una cuenta no inicia una suscripción ni realiza cobros.</p>
    <section aria-label="Preguntas sobre los planes" className="mt-8 grid gap-3 sm:grid-cols-2">
      <details className="self-start rounded-xl border border-border bg-surface p-4"><summary className="min-h-11 cursor-pointer content-center font-semibold">¿Cambia lo que incluye cada plan?</summary><p className="mt-3 text-sm leading-relaxed text-textSecondary">Todos incluyen las mismas funciones. Cambian la duración del período y el precio.</p></details>
      <details className="self-start rounded-xl border border-border bg-surface p-4"><summary className="min-h-11 cursor-pointer content-center font-semibold">¿Se cobra el precio mensual o el total?</summary><p className="mt-3 text-sm leading-relaxed text-textSecondary">El total indicado en la tarjeta, en un pago por el período elegido. El plan anual de {formatMoney(plans.find(p => p.monthsOfAccess === 12)!.amountPesos)} cubre 12 meses y no se divide en cuotas mensuales.</p></details>
    </section>
  </section>;
}
