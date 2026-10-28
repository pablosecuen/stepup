"use client";

import { useCallback, useSyncExternalStore } from "react";
import { ExclamationCircleIcon } from "@heroicons/react/24/outline";
import PrivateLink from "@/components/nav/private-link";
import { Button, linkClass } from "@/components/ui/button";
import { buildDismissedNoticeState, shouldShowDailyCollectionsNotice } from "@/lib/payments/engine/features/payments/utils/dailyCollectionsNotice";
import { DAILY_NOTICE_STORAGE_KEY, parseStoredNotice, worstNoticeRank } from "@/lib/dashboard/daily-collections-notice";
import type { CollectionsUrgencySummary } from "@/lib/payments/collections-urgency";

const CHANGE_EVENT = "teacherflow:daily-notice-changed";
/** En el servidor (y antes de hidratar) todavía no se sabe qué recuerda este dispositivo: no se dibuja nada, así no parpadea. */
const NOT_READY = "__not-ready__";
// Si el navegador no deja guardar, lo descartado se recuerda mientras la pantalla esté abierta.
let memoryFallback: string | null = null;

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(DAILY_NOTICE_STORAGE_KEY) ?? memoryFallback;
  } catch {
    return memoryFallback;
  }
}

/**
 * Aviso diario «Cobros que requieren atención» (puerto de `DailyCollectionsNoticeBanner`). Aparece si hay cobros que vencen hoy o ya vencidos; «Recordarme mañana» lo oculta por hoy en este
 * dispositivo y sólo vuelve antes si la situación empeora (de «vence hoy» a vencido). Sin nombres ni importes: el detalle está en Cobros. Si el navegador no deja guardar, el aviso simplemente se
 * oculta mientras la pantalla esté abierta y vuelve en la próxima visita (nunca se pierde un aviso por no poder recordarlo).
 */
export function DailyCollectionsNotice({ summary, todayDateKey }: { summary: CollectionsUrgencySummary; todayDateKey: string }) {
  const raw = useSyncExternalStore(subscribe, readStored, () => NOT_READY);
  const rank = worstNoticeRank(summary);

  const remindTomorrow = useCallback(() => {
    if (rank === null) return;
    const serialized = JSON.stringify(buildDismissedNoticeState({ today: todayDateKey, worstUrgencyRank: rank }));
    memoryFallback = serialized;
    try {
      window.localStorage.setItem(DAILY_NOTICE_STORAGE_KEY, serialized);
    } catch {
      // Sin almacenamiento: queda sólo en memoria.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, [rank, todayDateKey]);

  if (raw === NOT_READY || rank === null) return null;
  if (!shouldShowDailyCollectionsNotice({ today: todayDateKey, worstUrgencyRank: rank, persisted: parseStoredNotice(raw) })) return null;

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
