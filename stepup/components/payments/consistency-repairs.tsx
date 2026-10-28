"use client";
import { guardNetwork } from "@/lib/actions/network-guard";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewFinancialRepairsAction, repairFinancialConsistencyAction } from "@/lib/actions/financial-reconciliation";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

export function ConsistencyRepairs() {
  const [preview, setPreview] = useState<{ count: number; needsReview: number } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, run] = useTransition();
  const router = useRouter();
  return <section className="mt-5 rounded-xl border border-border bg-surface p-4">
    <h2 className="font-display text-xl font-semibold">Correcciones seguras</h2>
    <p className="my-3 text-sm text-textSecondary">Revisa los casos demostrables: duplicados técnicos sin pagos, cuota actual desincronizada, mensualidades posteriores a la baja y vencimientos iniciales demostrables. Los entrenamientos conservan su acuerdo propio. Los pagos no se mueven ni se borran.</p>
    {preview && <p role="status" className="my-3">{preview.count} correcciones seguras disponibles. {preview.needsReview} casos requieren revisión y se conservarán.</p>}
    <div className="flex flex-wrap gap-3"><Button variant="secondary" busy={pending} onClick={() => run(async () => { try { const result = await guardNetwork(() => previewFinancialRepairsAction()); if (result.error) setError(result.error); else { setPreview({ count: result.count ?? 0, needsReview: result.needsReview ?? 0 }); setError(""); } } catch { setError("No pudimos revisar. Volvé a intentar."); } })}>Revisar correcciones</Button>
      {preview && preview.count > 0 && <Button disabled={pending} onClick={() => run(async () => { try { const result = await guardNetwork(() => repairFinancialConsistencyAction()); if (result.error) setError(result.error); else { setMessage(`${result.repaired} correcciones aplicadas. El historial de reparación quedó guardado.`); setPreview(null); setError(""); router.refresh(); } } catch { setError("No pudimos confirmar el resultado. Revisá de nuevo antes de reintentar."); } })}>Aplicar correcciones seguras</Button>}
    </div>
    {message && <Notice>{message}</Notice>}{error && <Notice tone="bad">{error}</Notice>}
  </section>;
}



