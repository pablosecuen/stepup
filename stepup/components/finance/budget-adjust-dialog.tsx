"use client";

import { useEffect, useId, useState } from "react";
import { saveBudgetDistributionAction, type FormState } from "@/lib/actions/account";
import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { adjustNeeds, adjustSavings, adjustWants, resetBudgetDistribution, type BudgetDistribution } from "@/lib/payments/budget-distribution";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

const INITIAL_STATE: FormState = {};

function Slider({ label, value, onChange, colorClass }: { label: string; value: number; onChange: (value: number) => void; colorClass: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between text-[14.5px] font-[650] text-textSecondary">
        <span>{label}</span>
        <span className={`font-bold tf-num ${colorClass}`}>{value} %</span>
      </span>
      <input type="range" min={0} max={100} step={1} value={value} onChange={(event) => onChange(Number(event.target.value))} className="h-11 w-full accent-accent" />
    </label>
  );
}

/**
 * «Ajustar porcentajes»: diálogo compacto con los tres controles (los sliders no ocupan la pantalla de forma permanente). Los tres
 * se reconcilian EN VIVO con el motor puro de siempre (`adjustNeeds`/`adjustWants`/`adjustSavings`: la suma es siempre 100) y se
 * muestra la suma mientras se edita; al guardar se usa la acción existente (`saveBudgetDistributionAction`), que valida en el
 * servidor y guarda de forma atómica e idempotente. Escape o «Cancelar» cierran sin guardar; el foco queda atrapado adentro y
 * vuelve al botón que lo abrió (`Dialog`).
 */
export function BudgetAdjustDialog({ initial, onClose, onSaved }: { initial: BudgetDistribution; onClose: () => void; onSaved: () => void }) {
  const formId = useId();
  const [draft, setDraft] = useState<BudgetDistribution>(initial);
  const [state, formAction, pending] = useGuardedActionState(saveBudgetDistributionAction, INITIAL_STATE);
  const sum = draft.needs + draft.wants + draft.savings;

  useEffect(() => {
    if (state.saved === true && !state.error) onSaved();
  }, [state, onSaved]);

  return (
    <Dialog
      title="Ajustar porcentajes"
      size="sm"
      onClose={onClose}
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} variant="primary" busy={pending}>
            {pending ? "Guardando..." : "Guardar"}
          </Button>
        </>
      }
    >
      <p className="text-[14px] text-textMuted">Es una guía para organizar lo cobrado. No representa tus gastos ni tu ahorro real.</p>
      <form id={formId} action={formAction} className="flex flex-col gap-2.5">
        <Slider label="Necesidades" value={draft.needs} onChange={(value) => setDraft(adjustNeeds(draft, value))} colorClass="text-dataNeeds" />
        <Slider label="Gustos" value={draft.wants} onChange={(value) => setDraft(adjustWants(draft, value))} colorClass="text-pastelLavenderText" />
        <Slider label="Ahorro" value={draft.savings} onChange={(value) => setDraft(adjustSavings(draft, value))} colorClass="text-pastelSageText" />
        <p role="status" aria-live="polite" className="text-[14.5px] font-[650] text-textPrimary tf-num">
          Suma: {sum} %
        </p>
        <div>
          <Button variant="ghost" onClick={() => setDraft(resetBudgetDistribution())} disabled={pending}>
            Restablecer 50/30/20
          </Button>
        </div>
        <input type="hidden" name="needs" value={draft.needs} />
        <input type="hidden" name="wants" value={draft.wants} />
        <input type="hidden" name="savings" value={draft.savings} />
        {state.error && <FormErrorBox message={state.error} />}
      </form>
    </Dialog>
  );
}
