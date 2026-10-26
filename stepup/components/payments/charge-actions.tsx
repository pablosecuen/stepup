"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registerPaymentAction, voidChargeAction } from "@/lib/actions/payments";
import { guardNetwork } from "@/lib/actions/network-guard";
import { useDraftOperationId } from "@/lib/lessons/use-draft-operation-id";
import { todayInArgentina } from "@/lib/format/date-format";
import { formatMoneyForInput, parseMoneyInput } from "@/lib/format/money-input";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { DialogContext, chargeContextLines, joinContextTitle, type ChargeContext } from "@/components/payments/dialog-context";

const METHOD_LABEL: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", otro: "Otro" };

/**
 * Acciones reales de un cobro puntual — puerto de `RegisterPaymentSheet.tsx`/
 * `VoidChargeDialog` (móvil), acotado a un cargo específico (nunca reparte
 * hacia otra deuda del alumno — `chargeId` fijo). Reutilizado tanto en
 * Centro de cobros como en la pestaña Cobros del alumno.
 *
 * Presentación: «Registrar pago» es la acción normal (secundaria) y «Anular cobro» queda al otro extremo, con menos peso; cada
 * una abre un diálogo (hoja inferior en móvil). La lógica (estado, clave de operación, validaciones, acciones) no cambió.
 */
export function ChargeActions({ chargeId, studentId, balance, context, compact = false, allowVoid = true }: { chargeId: string; studentId: string; balance: number; context?: ChargeContext; /** `false` en el Registro de clase: allí sólo se registra el pago de ESE cobro, no se anula. */ allowVoid?: boolean; /** Dentro de una fila de tabla (Cobros): sin margen superior y las dos acciones juntas, alineadas a la derecha. */ compact?: boolean }) {
  const router = useRouter();
  const uid = useId();
  const [mode, setMode] = useState<"idle" | "pay" | "void">("idle");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(formatMoneyForInput(balance));
  const [method, setMethod] = useState("efectivo");
  const [paidAt, setPaidAt] = useState(() => todayInArgentina());
  const [notes, setNotes] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const { operationId, clear: clearOperationId } = useDraftOperationId(`teacherflow:cobros:pago:${chargeId}`);

  function close() {
    setError(null);
    setMode("idle");
  }

  function submitPayment() {
    setError(null);
    const parsed = parseMoneyInput(amount);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    const parsedAmount = parsed.amount;
    if (parsedAmount <= 0) {
      setError("El importe tiene que ser mayor a 0.");
      return;
    }
    if (!operationId) return;
    startTransition(async () => {
      const result = await guardNetwork(() => registerPaymentAction({
        operationId,
        studentId,
        amount: parsedAmount,
        method: method as "efectivo" | "transferencia" | "otro",
        paidAt,
        notes: notes || null,
        chargeId,
      }));
      if (result.error) {
        setError(result.error);
        return;
      }
      clearOperationId();
      setMode("idle");
      router.refresh();
    });
  }

  function submitVoid() {
    setError(null);
    if (!voidReason.trim()) {
      setError("Indicá el motivo de la anulación.");
      return;
    }
    startTransition(async () => {
      const result = await guardNetwork(() => voidChargeAction({ chargeId, voidReason }));
      if (result.error) {
        setError(result.error);
        return;
      }
      setMode("idle");
      router.refresh();
    });
  }

  return (
    <>
      <div className={compact ? "flex flex-wrap items-center gap-2 nav:flex-nowrap nav:justify-end" : "mt-4 flex flex-wrap items-center gap-2"}>
        <Button variant="secondary" onClick={() => setMode("pay")}>
          Registrar pago
        </Button>
        {allowVoid && (
          <Button variant="dangerGhost" onClick={() => setMode("void")} className={compact ? undefined : "sm:ml-auto"}>
            Anular cobro
          </Button>
        )}
      </div>

      {mode === "pay" && (
        <Dialog
          title="Registrar pago"
          size="sm"
          onClose={close}
          footer={
            <>
              <Button variant="secondary" onClick={close}>
                Cancelar
              </Button>
              <Button variant="primary" busy={pending} disabled={!operationId} onClick={submitPayment}>
                {pending ? "Guardando…" : "Confirmar pago"}
              </Button>
            </>
          }
        >
          <DialogContext title={joinContextTitle(context?.studentName, context?.concept)} lines={chargeContextLines(context, balance)} />
          {error && <Notice tone="bad">{error}</Notice>}
          <Field label="Importe" htmlFor={`${uid}-amount`}>
            <TextInput id={`${uid}-amount`} type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Método" htmlFor={`${uid}-method`}>
            <SelectInput id={`${uid}-method`} value={method} onChange={(e) => setMethod(e.target.value)}>
              {Object.entries(METHOD_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Fecha de pago" htmlFor={`${uid}-paidAt`}>
            <TextInput id={`${uid}-paidAt`} type="date" value={paidAt} max={todayInArgentina()} onChange={(e) => setPaidAt(e.target.value)} />
          </Field>
          <Field label="Observación (opcional)" htmlFor={`${uid}-notes`}>
            <TextInput id={`${uid}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </Dialog>
      )}

      {allowVoid && mode === "void" && (
        <Dialog
          title="Anular cobro"
          size="sm"
          onClose={close}
          footer={
            <>
              <Button variant="secondary" onClick={close}>
                Cancelar
              </Button>
              <Button variant="danger" busy={pending} disabled={!voidReason.trim()} onClick={submitVoid}>
                {pending ? "Anulando…" : "Confirmar anulación"}
              </Button>
            </>
          }
        >
          <DialogContext title={joinContextTitle(context?.studentName, context?.concept)} lines={chargeContextLines(context, balance)} />
          {error && <Notice tone="bad">{error}</Notice>}
          <Notice tone="warn">
            Se va a anular este cobro. Queda visible en el historial como anulado — nunca se borra. Si tiene un pago asignado, primero tenés que anular ese pago.
          </Notice>
          <Field label="Motivo (obligatorio)" htmlFor={`${uid}-reason`}>
            <TextInput id={`${uid}-reason`} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
          </Field>
        </Dialog>
      )}
    </>
  );
}
