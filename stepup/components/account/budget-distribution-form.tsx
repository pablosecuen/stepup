"use client";

import { useState } from "react";
import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { useFormStatus } from "react-dom";
import { saveBudgetDistributionAction, type FormState } from "@/lib/actions/account";
import { adjustNeeds, adjustSavings, adjustWants, type BudgetDistribution } from "@/lib/payments/budget-distribution";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { BUTTON_PRIMARY, LiveMessage } from "@/components/account/settings-ui";

const INITIAL_STATE: FormState = {};

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={`self-start ${BUTTON_PRIMARY}`}>
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
      <span className="flex items-center justify-between text-sm font-medium text-textSecondary">
        <span>{label}</span>
        <span className={`font-semibold tabular-nums ${colorClass}`}>{value}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-dataNeeds"
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
 * nunca una afirmación de gasto/ahorro real (el aviso vive en la fila que
 * contiene este formulario, en la página de Configuración).
 */
export function BudgetDistributionForm({ initial }: { initial: BudgetDistribution }) {
  const [distribution, setDistribution] = useState<BudgetDistribution>(initial);
  const [state, formAction] = useGuardedActionState(saveBudgetDistributionAction, INITIAL_STATE);
  // El «guardado» se anuncia hasta que la persona vuelve a mover una barra.
  const [editedAfter, setEditedAfter] = useState<FormState | null>(null);
  const showSaved = state.saved === true && !state.error && editedAfter !== state;

  function change(next: BudgetDistribution) {
    setDistribution(next);
    setEditedAfter(state);
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Slider
        label="Necesidades"
        value={distribution.needs}
        onChange={(v) => change(adjustNeeds(distribution, v))}
        colorClass="text-dataNeeds"
      />
      <Slider
        label="Gustos"
        value={distribution.wants}
        onChange={(v) => change(adjustWants(distribution, v))}
        colorClass="text-pastelLavenderText"
      />
      <Slider
        label="Ahorro"
        value={distribution.savings}
        onChange={(v) => change(adjustSavings(distribution, v))}
        colorClass="text-pastelSageText"
      />

      <p className="text-sm text-textMuted">Suma: {distribution.needs + distribution.wants + distribution.savings}%</p>

      <input type="hidden" name="needs" value={distribution.needs} />
      <input type="hidden" name="wants" value={distribution.wants} />
      <input type="hidden" name="savings" value={distribution.savings} />

      {state.error && <FormErrorBox message={state.error} />}
      <SaveButton />
      <LiveMessage>{showSaved ? "Distribución guardada." : null}</LiveMessage>
    </form>
  );
}
