"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/auth/public-links";
import { formatMoney } from "@/lib/format/number-format";

interface PlanPresentation {
  code: string;
  name: string;
  monthsOfAccess: number;
  amountPesos: number;
  dailyPesos: number;
  monthlyEquivalentPesos: number;
  annualSavingPesos: number;
}

export function PlanComparison({ plans }: { plans: readonly PlanPresentation[] }) {
  const [selected, setSelected] = useState(plans.find(p => p.monthsOfAccess === 12)!.code);
  const plan = plans.find(p => p.code === selected)!;
  const annual = plan.monthsOfAccess === 12;
  return (
    <section aria-label="Comparar planes" className="mx-auto max-w-3xl">
      <div role="group" aria-label="Período de suscripción" className="mb-6 flex flex-wrap justify-center gap-2">
        {plans.map(option => <Button key={option.code} variant={selected === option.code ? "primary" : "secondary"} aria-pressed={selected === option.code} onClick={() => setSelected(option.code)}>{option.name}</Button>)}
      </div>
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-card sm:p-9">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-3xl">Plan {plan.name.toLowerCase()}</h2>
          {annual && <span className="rounded-full bg-[#e9e1f4] px-4 py-2 text-sm font-semibold text-[#4d356b]">12 meses por el precio de 10</span>}
        </div>
        <p className="text-textSecondary">Precio total en pesos argentinos</p>
        <p className="mt-1 font-display text-[clamp(2rem,7vw,3.5rem)] leading-tight tabular-nums">{formatMoney(plan.amountPesos)}</p>
        <p className="mt-2 font-semibold">Un pago por {plan.monthsOfAccess === 1 ? "mes" : `${plan.monthsOfAccess} meses`} de acceso.</p>
        <div className="my-6 rounded-xl bg-surface2 p-4">
          <p className="text-lg font-semibold">Equivale a aprox. {formatMoney(plan.dailyPesos)} por día</p>
          {plan.monthsOfAccess > 1 && <p className="mt-1 text-sm text-textSecondary">{formatMoney(plan.monthlyEquivalentPesos)} por mes como referencia. El pago es por el período completo.</p>}
          {annual && <p className="mt-3 font-semibold text-[#4d356b]">Ahorrás {formatMoney(plan.annualSavingPesos)} frente a 12 pagos mensuales de {formatMoney(plans[0].amountPesos)}.</p>}
        </div>
        <ul className="mb-6 grid gap-2 text-textSecondary sm:grid-cols-2">
          {["Gestión de alumnos", "Calendario y series", "Registro de clases y tareas", "Control de cobros", "Reportes y evidencias", "Resumen financiero"].map(feature => <li key={feature}>✓ {feature}</li>)}
        </ul>
        <p className="mb-4 text-sm text-textSecondary">Todos los planes incluyen las mismas funciones. La contratación online está en preparación: esta página no inicia suscripciones ni realiza cobros.</p>
        <ButtonLink href="/crear-cuenta">Crear mi cuenta</ButtonLink>
      </div>
      <p className="mt-4 text-sm text-textSecondary">El equivalente diario es orientativo: usamos 30 días por mes y 365 para el anual. No es un cobro diario ni un pago en cuotas. El importe exigible es el total del período seleccionado.</p>
    </section>
  );
}
