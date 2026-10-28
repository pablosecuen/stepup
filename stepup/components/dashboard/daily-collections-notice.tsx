"use client";

import { useEffect, useState } from "react";
import { ExclamationCircleIcon } from "@heroicons/react/24/outline";
import PrivateLink from "@/components/nav/private-link";
import { Button, linkClass } from "@/components/ui/button";
import { buildDismissedNoticeState, shouldShowDailyCollectionsNotice, type DailyCollectionsNoticeState } from "@/lib/payments/engine/features/payments/utils/dailyCollectionsNotice";
import { DAILY_NOTICE_STORAGE_KEY, parseStoredNotice, worstNoticeRank } from "@/lib/dashboard/daily-collections-notice";
import type { CollectionsUrgencySummary } from "@/lib/payments/collections-urgency";

/**
 * Aviso diario «Cobros que requieren atención» (puerto de `DailyCollectionsNoticeBanner`). Aparece si hay cobros que vencen hoy o ya vencidos; «Recordarme mañana» lo oculta por hoy en este
 * dispositivo y sólo vuelve antes si la situación empeora (de «vence hoy» a vencido). Sin nombres ni importes: el detalle está en Cobros. Si el navegador no deja guardar, el aviso simplemente se
 * sigue mostrando (nunca se pierde un aviso por no poder recordarlo).
 */
export function DailyCollectionsNotice({ summary, todayDateKey }: { summary: CollectionsUrgencySummary; todayDateKey: string }) {
  const [persisted, setPersisted] = useState<DailyCollectionsNoticeState | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setPersisted(parseStoredNotice(window.localStorage.getItem(DAILY_NOTICE_STORAGE_KEY)));
    } catch {
      setPersisted(null);
    }
    setReady(true);
  }, []);

  const rank = worstNoticeRank(summary);
  if (!ready || rank === null || !shouldShowDailyCollectionsNotice({ today: todayDateKey, worstUrgencyRank: rank, persisted })) return null;

  function remindTomorrow() {
    if (rank === null) return;
    const next = buildDismissedNoticeState({ today: todayDateKey, worstUrgencyRank: rank });
    setPersisted(next);
    try {
      window.localStorage.setItem(DAILY_NOTICE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Sin almacenamiento: se oculta mientras la pantalla esté abierta y vuelve a mostrarse en la próxima visita.
    }
  }

  return (
    <section role="alert" aria-label="Cobros que requieren atención" className="mt-4 rounded-xl border-[1.5px] border-badLine bg-badSoft p-4 nav:p-5">
      <h2 className="flex items-center gap-2 font-display text-[18px] font-semibold leading-tight text-bad">
        <ExclamationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
        Cobros que requieren atención
      </h2>
      <p className="mt-2 text-[14.5px] text-textPrimary">
        {summary.dueToday} {summary.dueToday === 1 ? "vence hoy" : "vencen hoy"} · {summary.overdueCount} {summary.overdueCount === 1 ? "obligación vencida" : "obligaciones vencidas"}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <PrivateLink href="/cobros" className={`${linkClass()} min-h-11 inline-flex items-center`}>
          Ver cobros
        </PrivateLink>
        <Button variant="secondary" onClick={remindTomorrow}>
          Recordarme mañana
        </Button>
      </div>
    </section>
  );
}
