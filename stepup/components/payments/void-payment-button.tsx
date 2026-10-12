"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { voidPaymentAction } from "@/lib/actions/payments";
import { guardNetwork } from "@/lib/actions/network-guard";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { DialogContext, paymentContextLines, type PaymentContext } from "@/components/payments/dialog-context";

/** Puerto de `VoidPaymentDialog.tsx` (móvil) — anula un pago puntual, nunca lo borra. Acción de poco peso que abre un diálogo. */
export function VoidPaymentButton({ paymentId, context }: { paymentId: string; context?: PaymentContext }) {
  const router = useRouter();
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setError(null);
    setOpen(false);
  }

  function confirm() {
    startTransition(async () => {
      setError(null);
      const result = await guardNetwork(() => voidPaymentAction({ paymentId, voidReason: reason }));
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="dangerGhost" onClick={() => setOpen(true)} aria-haspopup="dialog" className="shrink-0">
        Anular
      </Button>
      {open && (
        <Dialog
          title="Anular pago"
          size="sm"
          onClose={close}
          footer={
            <>
              <Button variant="secondary" onClick={close}>
                Cancelar
              </Button>
              <Button variant="danger" busy={pending} disabled={!reason.trim()} onClick={confirm}>
                {pending ? "Anulando…" : "Confirmar"}
              </Button>
            </>
          }
        >
          <DialogContext title={context?.studentName} lines={paymentContextLines(context)} />
          {error && <Notice tone="bad">{error}</Notice>}
          <Field label="Motivo de la anulación" htmlFor={reasonId}>
            <TextInput id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo de la anulación" />
          </Field>
        </Dialog>
      )}
    </>
  );
}
