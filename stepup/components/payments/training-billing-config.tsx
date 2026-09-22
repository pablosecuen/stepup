"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewTrainingBillingConfigurationAction,
  confirmTrainingBillingConfigurationAction,
  editTrainingBillingFeeAction,
  type TrainingBillingConfigurationPlan,
} from "@/lib/actions/payments";
import { useDraftOperationId } from "@/lib/lessons/use-draft-operation-id";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(amount);
}

/**
 * Puerto de `TrainingBillingAgreementSheet.tsx` (móvil) — dos modos sobre el
 * mismo componente: `agreementId` ausente -> "Configurar cuota" (previsualiza
 * y confirma con `buildTrainingBillingConfigurationPlan`, misma función para
 * ambos pasos — cierra el bug real del commit móvil `2068b3a`); `agreementId`
 * presente -> "Editar cuota" (sólo precio nuevo, vigente desde el próximo
 * período).
 */
export function TrainingBillingConfigButton({ recurrenceRuleId, agreementId }: { recurrenceRuleId: string; agreementId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [monthlyFee, setMonthlyFee] = useState("");
  const [plan, setPlan] = useState<TrainingBillingConfigurationPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { operationId, clear: clearOperationId } = useDraftOperationId(`teacherflow:cuota-entrenamiento:${recurrenceRuleId}`);

  function preview() {
    setError(null);
    const fee = Number(monthlyFee);
    if (!fee || fee <= 0) {
      setError("La cuota tiene que ser mayor a 0.");
      return;
    }
    startTransition(async () => {
      const result = await previewTrainingBillingConfigurationAction({ recurrenceRuleId, monthlyFee: fee });
      if (result.error) {
        setError(result.error);
        return;
      }
      setPlan(result.data!);
    });
  }

  function confirm() {
    setError(null);
    if (!plan || !operationId) return;
    startTransition(async () => {
      const result = await confirmTrainingBillingConfigurationAction({ operationId, recurrenceRuleId, monthlyFee: plan.monthlyFee });
      if (result.error) {
        setError(result.error);
        return;
      }
      clearOperationId();
      setOpen(false);
      setPlan(null);
      router.refresh();
    });
  }

  function confirmFeeChange() {
    setError(null);
    const fee = Number(monthlyFee);
    if (!fee || fee <= 0 || !agreementId) {
      setError("La cuota tiene que ser mayor a 0.");
      return;
    }
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const effectiveFrom = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;
    startTransition(async () => {
      const result = await editTrainingBillingFeeAction({ agreementId, pendingMonthlyFee: fee, pendingMonthlyFeeEffectiveFrom: effectiveFrom });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-textSecondary hover:border-brandBlue/40 hover:text-brandBlue">
        {agreementId ? "Editar cuota" : "Configurar cuota"}
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-border bg-background p-3">
      {error && <p className="mb-2 text-xs font-medium text-statusRojo">{error}</p>}
      <label className="text-xs font-medium text-textSecondary">
        {agreementId ? "Nueva cuota mensual (vigente desde el próximo período)" : "Cuota mensual"}
        <input
          type="number"
          min={1}
          value={monthlyFee}
          onChange={(e) => {
            setMonthlyFee(e.target.value);
            setPlan(null);
          }}
          className="mt-1 w-full rounded-md border border-border px-2.5 py-2 text-sm"
        />
      </label>

      {!agreementId && !plan && (
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={pending} onClick={preview} className="rounded-md bg-brandBlue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            Previsualizar
          </button>
          <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-border px-3 py-1.5 text-xs text-textSecondary">
            Cancelar
          </button>
        </div>
      )}

      {!agreementId && plan && (
        <div className="mt-2">
          <p className="text-xs font-semibold text-textSecondary">Se van a generar estas obligaciones del período vigente:</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {plan.charges.map((c) => (
              <li key={c.studentId} className="text-xs text-textSecondary">
                {c.studentName}: <span className="font-semibold text-textPrimary">{formatCurrency(c.amount)}</span> · vence {c.dueDate}
                {c.classesRemaining < 3 && <span className="text-textMuted"> (primer período proporcional — {c.classesRemaining} clase{c.classesRemaining === 1 ? "" : "s"} real{c.classesRemaining === 1 ? "" : "es"})</span>}
              </li>
            ))}
          </ul>
          {plan.charges.length === 0 && <p className="text-xs text-textMuted">Ningún participante activo elegible todavía.</p>}
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={pending || !operationId} onClick={confirm} className="rounded-md bg-brandBlue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {pending ? "Confirmando…" : "Confirmar"}
            </button>
            <button type="button" onClick={() => setPlan(null)} className="rounded-md border border-border px-3 py-1.5 text-xs text-textSecondary">
              Volver
            </button>
          </div>
        </div>
      )}

      {agreementId && (
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={pending} onClick={confirmFeeChange} className="rounded-md bg-brandBlue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            {pending ? "Guardando…" : "Guardar (desde el próximo mes)"}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-border px-3 py-1.5 text-xs text-textSecondary">
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}
