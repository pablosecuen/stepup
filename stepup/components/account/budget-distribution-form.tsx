"use client";

import { useState } from "react";
import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { useFormStatus } from "react-dom";
import { saveBudgetDistributionAction, type FormState } from "@/lib/actions/account";
import { adjustNeeds, adjustSavings, adjustWants, type BudgetDistribution } from "@/lib/payments/budget-distribution";
import { FormErrorBox, FormInfoBox } from "@/components/auth/form-boxes";

const INITIAL_STATE: FormState = {};

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="mt-3 rounded-md bg-brandBlue px-3.5 py-2 text-sm font-semibold text-white transition-all duration-150 ease-premium hover:bg-brandBlueDark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
    >
      {pending ? "Guardando..." : "Guardar distribución"}
    </button>
  );
}

function Slider({
  label,
  value,
  onChange,
  colorClass,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  colorClass: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between text-xs font-medium text-textSecondary">
        <span>{label}</span>
        <span className={`font-semibold ${colorClass}`}>{value}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-brandBlue"
      />
    </label>
  );
}

/**
 * Puerto web del planificador 50/30/20 (móvil). Las 3 barras se reconcilian
 * en vivo en el cliente con el mismo motor puro (`adjustNeeds`/
 * `adjustWants`/`adjustSavings`) — nunca lógica reescrita acá — y sólo al
 * guardar se envía el valor final al servidor, que lo vuelve a normalizar
 * antes de persistir. Lenguaje siempre orientativo: "presupuesto sugerido",
 * nunca una afirmación de gasto/ahorro real.
 */
export function BudgetDistributionForm({ initial }: { initial: BudgetDistribution }) {
  const [distribution, setDistribution] = useState<BudgetDistribution>(initial);
  const [state, formAction] = useGuardedActionState(saveBudgetDistributionAction, INITIAL_STATE);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-4">
      <FormInfoBox>
        Presupuesto sugerido sobre lo que ya cobraste — nunca conoce tus gastos ni tu ahorro bancario real.
      </FormInfoBox>

      <Slider
        label="Necesidades"
        value={distribution.needs}
        onChange={(v) => setDistribution(adjustNeeds(distribution, v))}
        colorClass="text-brandBlue"
      />
      <Slider
        label="Gustos"
        value={distribution.wants}
        onChange={(v) => setDistribution(adjustWants(distribution, v))}
        colorClass="text-pastelLavenderText"
      />
      <Slider
        label="Ahorro"
        value={distribution.savings}
        onChange={(v) => setDistribution(adjustSavings(distribution, v))}
        colorClass="text-pastelSageText"
      />

      <p className="text-xs text-textMuted">Suma: {distribution.needs + distribution.wants + distribution.savings}%</p>

      <input type="hidden" name="needs" value={distribution.needs} />
      <input type="hidden" name="wants" value={distribution.wants} />
      <input type="hidden" name="savings" value={distribution.savings} />

      {state.error && <FormErrorBox message={state.error} />}
      <SaveButton />
    </form>
  );
}
