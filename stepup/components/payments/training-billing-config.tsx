"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewTrainingBillingConfigurationAction,
  confirmTrainingBillingConfigurationAction,
  editTrainingBillingFeeAction,
  type TrainingBillingConfigurationPlan,
} from "@/lib/actions/payments";
import { guardNetwork } from "@/lib/actions/network-guard";
import { useDraftOperationId } from "@/lib/lessons/use-draft-operation-id";
import { billingPeriodOfDateKey, nextBillingPeriod } from "@/lib/payments/dates";
import { formatMoney } from "@/lib/format/number-format";
import { formatCivilDate, todayInArgentina } from "@/lib/format/date-format";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { DialogContext } from "@/components/payments/dialog-context";

/**
 * Puerto de `TrainingBillingAgreementSheet.tsx` (móvil) — dos modos sobre el
 * mismo componente: `agreementId` ausente -> "Configurar cuota" (previsualiza
 * y confirma con `buildTrainingBillingConfigurationPlan`, misma función para
 * ambos pasos — cierra el bug real del commit móvil `2068b3a`); `agreementId`
 * presente -> "Editar cuota" (sólo precio nuevo, vigente desde el próximo
 * período).
 *
 * Presentación: un diálogo (hoja inferior en móvil) que nombra la serie (`seriesLabel`, que ya tiene la lista de Series);
 * la lógica (previsualizar → confirmar, clave de operación, mes de vigencia) no cambió.
 */
export function TrainingBillingConfigButton({ recurrenceRuleId, agreementId, seriesLabel }: { recurrenceRuleId: string; agreementId: string | null; seriesLabel?: string }) {
  const router = useRouter();
  const feeId = useId();
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
      const result = await guardNetwork(() => previewTrainingBillingConfigurationAction({ recurrenceRuleId, monthlyFee: fee }));
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
      const result = await guardNetwork(() => confirmTrainingBillingConfigurationAction({ operationId, recurrenceRuleId, monthlyFee: plan.monthlyFee }));
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
    // Mes siguiente de Argentina (no el del navegador ni el del servidor en UTC).
    const effectiveFrom = nextBillingPeriod(billingPeriodOfDateKey(todayInArgentina()));
    startTransition(async () => {
      const result = await guardNetwork(() => editTrainingBillingFeeAction({ agreementId, pendingMonthlyFee: fee, pendingMonthlyFeeEffectiveFrom: effectiveFrom }));
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  function close() {
    setError(null);
    setOpen(false);
  }

  const title = agreementId ? "Editar cuota" : plan ? "Cuota: vista previa de obligaciones" : "Configurar cuota";

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {agreementId ? "Editar cuota" : "Configurar cuota"}
      </Button>

      {open && (
        <Dialog
          title={title}
          size="md"
          onClose={close}
          busy={pending}
          footer={
            agreementId ? (
              <>
                <Button variant="secondary" onClick={close}>
                  Cancelar
                </Button>
                <Button variant="primary" busy={pending} onClick={confirmFeeChange}>
                  {pending ? "Guardando…" : "Guardar (desde el próximo mes)"}
                </Button>
              </>
            ) : plan ? (
              <>
                <Button variant="secondary" onClick={() => setPlan(null)}>
                  Volver
                </Button>
                <Button variant="primary" busy={pending} disabled={!operationId} onClick={confirm}>
                  {pending ? "Confirmando…" : "Confirmar"}
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={close}>
                  Cancelar
                </Button>
                <Button variant="primary" busy={pending} onClick={preview}>
                  Previsualizar
                </Button>
              </>
            )
          }
        >
          <DialogContext title={seriesLabel} lines={[]} />
          {error && <Notice tone="bad">{error}</Notice>}
          <Field label={agreementId ? "Nueva cuota mensual (vigente desde el próximo período)" : "Cuota mensual"} htmlFor={feeId}>
            <TextInput
              id={feeId}
              type="number"
              min={1}
              value={monthlyFee}
              onChange={(e) => {
                setMonthlyFee(e.target.value);
                setPlan(null);
              }}
            />
          </Field>

          {!agreementId && plan && (
            <div>
              <p className="text-[14px] font-[650] text-textSecondary">Se van a generar estas obligaciones del período vigente:</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {plan.charges.map((c) => (
                  <li key={c.studentId} className="rounded-md border border-border bg-surface2 px-3 py-2 text-[14px] text-textSecondary [overflow-wrap:anywhere]">
                    {c.studentName}: <span className="font-bold tf-num text-textPrimary">{formatMoney(c.amount)}</span> · vence {formatCivilDate(c.dueDate)}
                    {c.classesRemaining < 3 && <span className="text-textMuted"> (primer período proporcional — {c.classesRemaining} clase{c.classesRemaining === 1 ? "" : "s"} real{c.classesRemaining === 1 ? "" : "es"})</span>}
                  </li>
                ))}
              </ul>
              {plan.charges.length === 0 && <p className="text-[14px] text-textMuted">Ningún participante activo elegible todavía.</p>}
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
