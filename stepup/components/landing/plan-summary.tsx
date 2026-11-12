import { ButtonLink } from "@/components/auth/public-links";
import { publicPricing } from "@/lib/billing/public-pricing";
import { formatMoney } from "@/lib/format/number-format";

/** La portada y /planes leen el mismo catálogo; el cobro es por el período completo. */
export function PlanSummary() {
  return (
    <section id="planes" aria-labelledby="planes-title" className="tf-s-lav scroll-mt-20 border-t border-border px-5 py-16 nav:px-10 nav:py-24">
      <div className="mx-auto max-w-[1240px]">
        <h2 id="planes-title" className="font-display text-4xl nav:text-5xl">Un plan para tu forma de trabajar.</h2>
        <p className="mt-4 max-w-2xl text-textSecondary">Todas las funciones de TeacherFlow. Elegí el período que mejor te acompañe.</p>
        <div className="mt-8 grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {publicPricing().map(plan => {
            const annual = plan.monthsOfAccess === 12;
            return (
              <article key={plan.code} aria-label={`Plan ${plan.name}`} className={`flex min-w-0 flex-col rounded-2xl border p-5 ${annual ? "border-[#80639f] bg-[#e8e4ef]" : "border-border bg-surface"}`}>
                <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-2xl">{plan.name}</h3>
                  {annual && <span className="rounded-full bg-[#4d356b] px-3 py-1 text-xs font-semibold text-white">Recomendado</span>}
                </div>
                <p className="mt-5 flex flex-wrap items-baseline gap-x-1 tabular-nums">
                  <strong className="font-display text-4xl font-normal">{formatMoney(plan.monthlyEquivalentPesos)}</strong>
                  <span className="text-textSecondary">/mes</span>
                </p>
                <p className="mt-3 text-sm leading-relaxed text-textSecondary">
                  {plan.monthsOfAccess === 1 ? `${formatMoney(plan.amountPesos)} por mes.` : `${formatMoney(plan.amountPesos)} cada ${plan.monthsOfAccess} meses, en un pago.`}
                </p>
                {plan.savingPercent > 0 && <p className="mt-3 font-semibold">{plan.savingPercent} % de ahorro</p>}
                {annual && <p className="mt-3 text-sm text-textSecondary">12 meses por menos de lo que cuestan 10.</p>}
                <div className="mt-auto pt-6">
                  <ButtonLink href="/planes" variant={annual ? "primary" : "secondary"}>Elegir plan</ButtonLink>
                </div>
              </article>
            );
          })}
        </div>
        <p className="mt-5 text-sm text-textSecondary">Precios en pesos argentinos. El importe mensual permite comparar; se cobra el total del período indicado. Ahorros redondeados frente al plan mensual.</p>
      </div>
    </section>
  );
}
