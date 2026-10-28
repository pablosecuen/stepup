"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markCurrentMonthPaidAction, resumeMonthlyBillingAction } from "@/lib/actions/payments";
import { guardNetwork } from "@/lib/actions/network-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { formatMoney } from "@/lib/format/number-format";
import type { MonthlyPeriodStatusLabel } from "@/lib/payments/engine/features/payments/utils/monthlyPeriodStatus";

const STATUS_LABEL: Record<MonthlyPeriodStatusLabel, string> = {
  pagado: "Pagado",
  parcial: "Pago parcial",
  pendiente: "Pendiente",
  vencido: "Vencido",
  comienza_proximo_mes: "Comienza el próximo mes",
};

const STATUS_TONE: Record<MonthlyPeriodStatusLabel, "ok" | "warn" | "bad" | "info" | undefined> = {
  pagado: "ok",
  parcial: "warn",
  pendiente: undefined,
  vencido: "bad",
  comienza_proximo_mes: "info",
};

const RADIO_OPTION =
  "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border-[1.5px] border-border bg-surface px-3 py-2.5 text-[15px] text-textPrimary has-[:checked]:border-ink has-[:checked]:bg-surface2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink has-[:focus-visible]:ring-offset-2";

/**
 * Mes actual de un alumno MENSUAL: estado (siempre en texto), «Situación inicial declarada» cuando el pago del mes fue una declaración, «Marcar mes actual como pagado» y «Cambiar desde cuándo se cobra».
 * Ambas acciones son atómicas en la base: nunca crean una segunda mensualidad ni un segundo pago, y repetir un intento devuelve el mismo resultado.
 */
export function MonthlyStatusCard({
  studentId,
  monthLabel,
  status,
  amount,
  declaredInitial,
  canMarkPaid,
  suggestedAmount,
}: {
  studentId: string;
  monthLabel: string;
  status: MonthlyPeriodStatusLabel;
  amount: number | null;
  declaredInitial: boolean;
  canMarkPaid: boolean;
  suggestedAmount: number;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<null | "paid" | "start">(null);
  const [choice, setChoice] = useState<"this_month" | "next_month">("this_month");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Una clave por intento: un doble toque o un reintento tras perder la respuesta reenvía LA MISMA, y la base devuelve el mismo pago.
  const operationId = useRef<string | null>(null);

  function open(next: "paid" | "start") {
    setError(null);
    setDone(null);
    if (next === "paid") operationId.current = operationId.current ?? crypto.randomUUID();
    setDialog(next);
  }
  function close() {
    setDialog(null);
    setError(null);
  }

  function confirmPaid() {
    startTransition(async () => {
      setError(null);
      const key = operationId.current ?? crypto.randomUUID();
      operationId.current = key;
      const result = await guardNetwork(() => markCurrentMonthPaidAction({ operationId: key, studentId }));
      if (result.error) {
        setError(result.error);
        return;
      }
      operationId.current = null;
      setDialog(null);
      setDone(result.data?.replayed ? "Ese pago ya estaba registrado." : "Mes registrado como pagado.");
      router.refresh();
    });
  }

  function confirmStart() {
    startTransition(async () => {
      setError(null);
      const result = await guardNetwork(() => resumeMonthlyBillingAction({ studentId, choice }));
      if (result.error) {
        setError(result.error);
        return;
      }
      setDialog(null);
      setDone(choice === "this_month" ? (result.data?.chargeCreated ? "Se generó la mensualidad de este mes." : "La mensualidad de este mes ya estaba generada.") : "La mensualidad empieza el mes próximo.");
      router.refresh();
    });
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className="font-display text-[19px] font-semibold leading-tight tracking-tight text-textPrimary [overflow-wrap:anywhere]">Mensualidad de {monthLabel}</p>
          {amount !== null && <p className="mt-0.5 text-[14px] text-textMuted">Importe del período: <span className="font-bold tf-num text-textPrimary">{formatMoney(amount)}</span></p>}
        </div>
        <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
      </div>
      {declaredInitial && <p className="text-[14px] text-textSecondary">Situación inicial declarada al registrar al alumno. Si no estaba pago, anulá ese pago desde «Pagos registrados»: el mes vuelve a quedar pendiente y el historial se conserva.</p>}
      {done && <Notice tone="ok">{done}</Notice>}
      <div className="flex flex-col gap-2 sm:flex-row">
        {canMarkPaid && (
          <Button variant="secondary" onClick={() => open("paid")} aria-haspopup="dialog">
            Marcar mes actual como pagado
          </Button>
        )}
        <Button variant="ghost" onClick={() => open("start")} aria-haspopup="dialog">
          Cambiar desde cuándo se cobra
        </Button>
      </div>

      {dialog === "paid" && (
        <Dialog
          title="Marcar mes actual como pagado"
          size="sm"
          onClose={close}
          footer={
            <>
              <Button variant="secondary" onClick={close}>
                Cancelar
              </Button>
              <Button variant="primary" busy={pending} onClick={confirmPaid}>
                {pending ? "Registrando…" : "Confirmar"}
              </Button>
            </>
          }
        >
          {error && <Notice tone="bad">{error}</Notice>}
          <p className="text-[15px] text-textPrimary">
            Se va a registrar el pago completo de <span className="font-bold tf-num">{formatMoney(suggestedAmount)}</span> para {monthLabel}, con la fecha de hoy.
          </p>
          <p className="mt-2 text-[13.5px] text-textSecondary">Si el mes todavía no tenía cargo, se genera. No cambia pagos anteriores ni otros meses.</p>
        </Dialog>
      )}

      {dialog === "start" && (
        <Dialog
          title="Cambiar desde cuándo se cobra"
          size="sm"
          onClose={close}
          footer={
            <>
              <Button variant="secondary" onClick={close}>
                Cancelar
              </Button>
              <Button variant="primary" busy={pending} onClick={confirmStart}>
                {pending ? "Guardando…" : "Guardar"}
              </Button>
            </>
          }
        >
          {error && <Notice tone="bad">{error}</Notice>}
          <fieldset className="flex min-w-0 flex-col gap-2.5">
            <legend className="mb-1 text-[15px] text-textPrimary">¿Desde cuándo corresponde cobrarle la mensualidad?</legend>
            <label className={RADIO_OPTION}>
              <input type="radio" name="resumeChoice" value="this_month" checked={choice === "this_month"} onChange={() => setChoice("this_month")} className="mt-0.5 h-5 w-5 shrink-0 accent-ink" />
              <span className="flex flex-col gap-0.5">
                <span className="font-[650]">Cobrar desde este mes</span>
                <span className="text-[13.5px] text-textSecondary">Se genera la mensualidad de {monthLabel} si todavía no existe. Nunca se duplica.</span>
              </span>
            </label>
            <label className={RADIO_OPTION}>
              <input type="radio" name="resumeChoice" value="next_month" checked={choice === "next_month"} onChange={() => setChoice("next_month")} className="mt-0.5 h-5 w-5 shrink-0 accent-ink" />
              <span className="flex flex-col gap-0.5">
                <span className="font-[650]">Comenzar el próximo mes</span>
                <span className="text-[13.5px] text-textSecondary">No se genera deuda nueva este mes. Si ya existe la de este mes, se conserva tal cual.</span>
              </span>
            </label>
          </fieldset>
        </Dialog>
      )}
    </Card>
  );
}
