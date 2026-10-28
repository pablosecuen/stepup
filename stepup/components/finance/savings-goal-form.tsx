"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyBudgetPresetAction, saveSavingsGoalAction, type FormState } from "@/lib/actions/account";
import { guardNetwork } from "@/lib/actions/network-guard";
import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { todayInArgentina } from "@/lib/format/date-format";
import { formatMoneyForInput } from "@/lib/format/money-input";
import { formatMoney } from "@/lib/format/number-format";
import type { SavingsGoalProgress } from "@/lib/payments/savings-goal";
import type { SavingsGoal } from "@/lib/payments/budget-distribution";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

const INITIAL_STATE: FormState = {};

/**
 * «Definir objetivo de ahorro» (opcional, desactivado por defecto): monto objetivo y fecha objetivo. Con los dos completos muestra el progreso del ahorro teórico, la reserva mensual
 * sugerida y el porcentaje de ahorro sugerido; «Aplicar sugerencia» lo aplica a las barras 50/30/20 sólo si la profesora lo pide. Guardar el objetivo no cambia los porcentajes ni al revés.
 */
export function SavingsGoalForm({ goal, cumulativeRealTheoreticalSavings, progress, currentSavingsPercent }: { goal: SavingsGoal; cumulativeRealTheoreticalSavings: number; progress: SavingsGoalProgress; currentSavingsPercent: number }) {
  const uid = useId();
  const router = useRouter();
  const [state, formAction, pending] = useGuardedActionState(saveSavingsGoalAction, INITIAL_STATE);
  const [enabled, setEnabled] = useState(goal.enabled);
  const [applyPending, startApply] = useTransition();
  const applying = useRef(false);
  const [applyMessage, setApplyMessage] = useState<{ error?: string; ok?: string } | null>(null);
  const today = todayInArgentina();

  function applySuggestion() {
    if (applying.current || applyPending) return;
    applying.current = true;
    setApplyMessage(null);
    startApply(async () => {
      try {
        const result = await guardNetwork(() => applyBudgetPresetAction({ kind: "savings", percent: progress.suggestedSavingsPercent }));
        if (result.error) setApplyMessage({ error: result.error });
        else {
          setApplyMessage({ ok: `Listo: el ahorro quedó en ${progress.suggestedSavingsPercent} % en las barras.` });
          router.refresh();
        }
      } finally {
        applying.current = false;
      }
    });
  }

  return (
    <form action={formAction} aria-labelledby={`${uid}-titulo`} className="mt-5 flex flex-col gap-3.5 rounded-lg border-[1.5px] border-border bg-surface2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h3 id={`${uid}-titulo`} className="min-w-0 font-display text-[18px] font-semibold leading-tight">
          Definir objetivo de ahorro
        </h3>
        <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 text-[14.5px] font-[650] text-textPrimary">
          <input type="checkbox" name="enabled" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="h-5 w-5 accent-ink" disabled={pending} />
          Activar objetivo de ahorro
        </label>
      </div>

      {enabled && (
        <>
          <Field label="Monto objetivo" htmlFor={`${uid}-monto`} hint="En pesos. Usá solo números: 600000 o 600.000.">
            <TextInput id={`${uid}-monto`} name="targetAmount" type="text" inputMode="decimal" autoComplete="off" defaultValue={formatMoneyForInput(goal.targetAmount)} disabled={pending} />
          </Field>
          <Field label="Fecha objetivo" htmlFor={`${uid}-fecha`} hint="La fecha en que querés alcanzar el objetivo (desde hoy en adelante).">
            <TextInput id={`${uid}-fecha`} name="targetDate" type="date" min={today} defaultValue={goal.targetDate ?? ""} disabled={pending} />
          </Field>
        </>
      )}
      {!enabled && (
        // Con el objetivo desactivado se conservan el monto y la fecha ya guardados.
        <>
          <input type="hidden" name="targetAmount" value={formatMoneyForInput(goal.targetAmount)} />
          <input type="hidden" name="targetDate" value={goal.targetDate ?? ""} />
        </>
      )}

      {state.error && <FormErrorBox message={state.error} />}
      {state.saved && !state.error && <p role="status" className="text-[14px] font-[650] text-ok">Objetivo guardado.</p>}

      <div>
        <Button type="submit" variant="primary" busy={pending}>
          {pending ? "Guardando…" : "Guardar objetivo"}
        </Button>
      </div>

      {goal.enabled &&
        (progress.complete ? (
          <div className="flex flex-col gap-2 border-t-[1.5px] border-border pt-3.5">
            <div role="progressbar" aria-label="Progreso del objetivo de ahorro" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.progressPercent} className="h-2.5 w-full overflow-hidden rounded-pill bg-paperDeep">
              <div className="h-full rounded-pill bg-pastelSageText" style={{ width: `${progress.progressPercent}%` }} />
            </div>
            <p className="text-[14.5px] text-textPrimary tf-num">
              <strong>{progress.progressPercent} % del objetivo</strong> — {formatMoney(cumulativeRealTheoreticalSavings)} de {formatMoney(goal.targetAmount ?? 0)} (ahorro teórico)
            </p>
            <p className="text-[14px] text-textSecondary tf-num">Reserva mensual sugerida: {formatMoney(progress.monthlyReserveNeeded)}</p>
            <p className="text-[14px] text-textSecondary tf-num">Porcentaje de ahorro sugerido: {progress.suggestedSavingsPercent} % (ahora: {currentSavingsPercent} %)</p>
            {applyMessage?.error && <Notice tone="bad">{applyMessage.error}</Notice>}
            {applyMessage?.ok && <p role="status" className="text-[14px] font-[650] text-ok">{applyMessage.ok}</p>}
            <div>
              <Button variant="secondary" onClick={applySuggestion} busy={applyPending} disabled={progress.suggestedSavingsPercent === currentSavingsPercent}>
                Aplicar sugerencia
              </Button>
            </div>
          </div>
        ) : (
          <p className="border-t-[1.5px] border-border pt-3.5 text-[14px] text-textMuted">Completá el monto y la fecha para ver el progreso.</p>
        ))}
    </form>
  );
}
