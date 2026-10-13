"use client";

import { useState } from "react";
import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { useFormStatus } from "react-dom";
import { saveBudgetDistributionAction, type FormState } from "@/lib/actions/account";
import { adjustNeeds, adjustSavings, adjustWants, type BudgetDistribution } from "@/lib/payments/budget-distribution";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { Button } from "@/components/ui/button";
import { LiveMessage } from "@/components/account/settings-ui";

const INITIAL_STATE: FormState = {};

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" busy={pending} className="self-start">
      {pending ? "Guardando..." : "Guardar distribución"}
    </Button>
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
      <span className="flex items-center justify-between text-[14.5px] font-[650] text-textSecondary">
        <span>{label}</span>
        <span className={`font-bold tf-num ${colorClass}`}>{value}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-11 w-full accent-accent"
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
 *
 * Presentación: la barra apilada de arriba es decorativa (los porcentajes ya están escritos en cada control); Necesidades,
 * Gustos y Ahorro conservan sus colores reservados del plan 50/30/20.
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
    <form action={formAction} className="flex flex-col gap-3">
      <div aria-hidden className="flex h-3 w-full gap-1 overflow-hidden rounded-pill">
        <div className="min-w-[4px] rounded-pill bg-dataNeeds" style={{ flexGrow: distribution.needs }} />
        <div className="min-w-[4px] rounded-pill bg-pastelLavenderText" style={{ flexGrow: distribution.wants }} />
        <div className="min-w-[4px] rounded-pill bg-pastelSageText" style={{ flexGrow: distribution.savings }} />
      </div>

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

      <p className="text-[14px] text-textMuted tf-num">Suma: {distribution.needs + distribution.wants + distribution.savings}%</p>

      <input type="hidden" name="needs" value={distribution.needs} />
      <input type="hidden" name="wants" value={distribution.wants} />
      <input type="hidden" name="savings" value={distribution.savings} />

      {state.error && <FormErrorBox message={state.error} />}
      <SaveButton />
      <LiveMessage>{showSaved ? "Distribución guardada." : null}</LiveMessage>
    </form>
  );
}
