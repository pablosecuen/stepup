"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { LimitedModeFollowUp } from "@/components/billing/limited-mode-action";
import { guardNetwork } from "@/lib/actions/network-guard";
import { resolveRegistrationBillingAction } from "@/lib/actions/lesson-registrations";
import { rowsNeedingDecision, type BillingRow } from "@/lib/registro/billing-rows";

/** Una fila por participante, calculada en el servidor (`buildBillingRows`). */
export type RegistrationBillingRow = BillingRow;

/**
 * Decisión de cobro de una sesión de ENTRENAMIENTO que la profesora todavía debe tomar: un alumno aparece sólo cuando «falta indicar a qué entrenamiento pertenece» (sin cobro hasta
 * resolverlo). Resolverlo guarda la decisión para ese alumno y esa sesión: guardar, finalizar, editar o reintentar nunca la vuelven a inferir. Lo que el sistema ya resuelve solo
 * (cubierto por la cuota de su acuerdo, o cobrado como clase suelta) no se explica ni deja hueco: sin nada pendiente no se dibuja nada. Una clase común tampoco muestra nada.
 */
export function RegistrationBillingPanel({ registrationId, rows }: { registrationId: string; rows: RegistrationBillingRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<string[]>([]);
  // Sólo se muestra lo que exige una decisión (`rowsNeedingDecision`): sin nada pendiente, el bloque completo desaparece (sin título, borde ni hueco).
  const pendingRows = rowsNeedingDecision(rows);
  if (pendingRows.length === 0 && notes.length === 0) return null;

  function resolve(row: RegistrationBillingRow, agreementId: string | null) {
    const key = `${row.studentId}:${agreementId ?? "propio"}`;
    setBusyKey(key);
    setErrors((current) => ({ ...current, [row.studentId]: "" }));
    startTransition(async () => {
      const result = await guardNetwork(() => resolveRegistrationBillingAction({ registrationId, studentId: row.studentId, agreementId }));
      if (result.error) setErrors((current) => ({ ...current, [row.studentId]: result.error as string }));
      else {
        if (result.data?.note) setNotes((current) => [...current, result.data?.note as string]);
        router.refresh();
      }
      setBusyKey(null);
    });
  }

  return (
    <section aria-label="Cobro de este entrenamiento" className="mb-5 rounded-lg border-[1.5px] border-border bg-surface2 p-4">
      {pendingRows.length > 0 && (
        <Notice tone="warn" title="Falta indicar a qué entrenamiento pertenece">
          Todavía no se generó ningún cobro por esta sesión. Elegí, para cada alumno, a qué entrenamiento corresponde o si se cobra como clase suelta.
        </Notice>
      )}
      {pendingRows.length > 0 && (
        <ul className="mt-3 flex flex-col gap-3">
          {pendingRows.map((row) => (
            <li key={row.studentId} className="text-[15px] text-textSecondary">
              <p className="[overflow-wrap:anywhere]">
                <strong className="text-textPrimary">{row.studentName}</strong>
              </p>
              {row.kind === "needs_association" && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {row.options.map((option) => (
                    <Button key={option.agreementId} variant={option.agreementId === row.suggestedAgreementId ? "primary" : "secondary"} busy={pending && busyKey === `${row.studentId}:${option.agreementId}`} disabled={pending} onClick={() => resolve(row, option.agreementId)}>
                      Es parte de «{option.label}»
                    </Button>
                  ))}
                  <Button variant="secondary" busy={pending && busyKey === `${row.studentId}:propio`} disabled={pending} onClick={() => resolve(row, null)}>
                    Cobrar como clase suelta
                  </Button>
                </div>
              )}
              {errors[row.studentId] ? (
                <p role="alert" className="mt-1 text-[14px] text-bad">
                  {errors[row.studentId]}
                  <LimitedModeFollowUp message={errors[row.studentId]} />
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {notes.map((note) => (
        <div key={note} className="mt-3">
          <Notice tone="info">{note}</Notice>
        </div>
      ))}
    </section>
  );
}
