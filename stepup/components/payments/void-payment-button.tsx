"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { voidPaymentAction } from "@/lib/actions/payments";
import { guardNetwork } from "@/lib/actions/network-guard";

/** Puerto de `VoidPaymentDialog.tsx` (móvil) — anula un pago puntual, nunca lo borra. */
export function VoidPaymentButton({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-statusRojo hover:underline">
        Anular
      </button>
    );
  }

  return (
    <div className="mt-1 rounded-md border border-statusRojo/30 bg-statusRojo/5 p-2">
      {error && <p className="mb-1 text-xs font-medium text-statusRojo">{error}</p>}
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Motivo de la anulación"
        className="w-full rounded-md border border-borderStrong px-2 py-1 text-xs"
      />
      <div className="mt-1.5 flex gap-1.5">
        <button
          type="button"
          disabled={pending || !reason.trim()}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await guardNetwork(() => voidPaymentAction({ paymentId, voidReason: reason }));
              if (result.error) {
                setError(result.error);
                return;
              }
              setOpen(false);
              router.refresh();
            })
          }
          className="rounded-md bg-statusRojo px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Anulando…" : "Confirmar"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-border px-2 py-1 text-xs text-textSecondary">
          Cancelar
        </button>
      </div>
    </div>
  );
}
