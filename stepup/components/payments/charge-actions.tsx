"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registerPaymentAction, voidChargeAction } from "@/lib/actions/payments";
import { guardNetwork } from "@/lib/actions/network-guard";
import { useDraftOperationId } from "@/lib/lessons/use-draft-operation-id";
import { todayInArgentina } from "@/lib/format/date-format";
import { formatMoney } from "@/lib/format/number-format";

const METHOD_LABEL: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", otro: "Otro" };

/**
 * Acciones reales de un cobro puntual — puerto de `RegisterPaymentSheet.tsx`/
 * `VoidChargeDialog` (móvil), acotado a un cargo específico (nunca reparte
 * hacia otra deuda del alumno — `chargeId` fijo). Reutilizado tanto en
 * Centro de cobros como en la pestaña Cobros del alumno.
 */
export function ChargeActions({ chargeId, studentId, balance }: { chargeId: string; studentId: string; balance: number }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "pay" | "void">("idle");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState("efectivo");
  const [paidAt, setPaidAt] = useState(() => todayInArgentina());
  const [notes, setNotes] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const { operationId, clear: clearOperationId } = useDraftOperationId(`teacherflow:cobros:pago:${chargeId}`);

  function submitPayment() {
    setError(null);
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
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

  if (mode === "idle") {
    return (
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => setMode("pay")}
          className="rounded-md bg-brandBlue px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brandBlue/90"
        >
          Registrar pago
        </button>
        <button
          type="button"
          onClick={() => setMode("void")}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-textSecondary transition-colors hover:border-statusRojo/40 hover:text-statusRojo"
        >
          Anular cobro
        </button>
      </div>
    );
  }

  if (mode === "pay") {
    return (
      <div className="mt-2 rounded-md border border-border bg-background p-3">
        {error && <p className="mb-2 text-xs font-medium text-statusRojo">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-textSecondary">
            Importe
            <input
              type="number"
              min={1}
              max={balance}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-md border border-borderStrong px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-textSecondary">
            Método
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="mt-1 w-full rounded-md border border-borderStrong px-2 py-1.5 text-sm">
              {Object.entries(METHOD_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-textSecondary">
            Fecha de pago
            <input
              type="date"
              value={paidAt}
              max={todayInArgentina()}
              onChange={(e) => setPaidAt(e.target.value)}
              className="mt-1 w-full rounded-md border border-borderStrong px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-textSecondary">
            Observación (opcional)
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full rounded-md border border-borderStrong px-2 py-1.5 text-sm" />
          </label>
        </div>
        <p className="mt-2 text-xs text-textMuted">Saldo pendiente de este cobro: {formatMoney(balance)}.</p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={pending || !operationId}
            onClick={submitPayment}
            className="rounded-md bg-brandBlue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Guardando…" : "Confirmar pago"}
          </button>
          <button type="button" onClick={() => setMode("idle")} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-textSecondary">
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-statusRojo/30 bg-statusRojo/5 p-3">
      {error && <p className="mb-2 text-xs font-medium text-statusRojo">{error}</p>}
      <p className="text-xs text-textSecondary">
        Se va a anular este cobro. Queda visible en el historial como anulado — nunca se borra. Si tiene un pago asignado, primero tenés que anular ese pago.
      </p>
      <label className="mt-2 block text-xs text-textSecondary">
        Motivo (obligatorio)
        <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} className="mt-1 w-full rounded-md border border-borderStrong px-2 py-1.5 text-sm" />
      </label>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending || !voidReason.trim()}
          onClick={submitVoid}
          className="rounded-md bg-statusRojo px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Anulando…" : "Confirmar anulación"}
        </button>
        <button type="button" onClick={() => setMode("idle")} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-textSecondary">
          Cancelar
        </button>
      </div>
    </div>
  );
}

