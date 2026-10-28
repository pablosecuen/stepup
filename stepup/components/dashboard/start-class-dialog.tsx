"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startLiveClassAction } from "@/lib/actions/live-class";
import { guardNetwork } from "@/lib/actions/network-guard";
import { arrivalFromChoice } from "@/lib/live-class/live-class";
import type { CalendarViewItem } from "@/lib/calendar/occurrences";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { requestLiveClassNotificationPermission } from "@/components/dashboard/live-class-notifier";

/** Inicia el reloj con un toque. La llegada se completa en el registro;
 * nunca se deduce de cuándo la profesora inicia el contador. */
export function StartClassButton({ item }: { item: CalendarViewItem }) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [pending, run] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function start() {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    void requestLiveClassNotificationPermission();
    run(async () => {
      try {
        sessionStorage.setItem("tf-live-start-requested", String(Date.now()));
        const result = await guardNetwork(() => startLiveClassAction({
          calendarLessonId: item.materializedLessonId, recurrenceId: item.recurrenceId,
          occurrenceKey: item.occurrenceKey, recurrenceIndex: null,
          arrival: arrivalFromChoice("unknown"),
        }));
        if (result.error) setError(result.error);
        else router.refresh();
      } finally { inFlight.current = false; }
    });
  }
  return <div className="min-w-0 flex-1">
    <Button variant="primary" size="lg" block busy={pending} onClick={start}>Comenzar clase</Button>
    {error && <Notice tone="bad">{error}</Notice>}
  </div>;
}
