"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startRegistrationAction } from "@/lib/actions/lesson-registrations";
import { guardNetwork } from "@/lib/actions/network-guard";

export function StartRegistrationButton({
  calendarLessonId,
  recurrenceId,
  occurrenceKey,
  recurrenceIndex,
  label,
}: {
  calendarLessonId: string | null;
  recurrenceId: string | null;
  occurrenceKey: string | null;
  recurrenceIndex: number | null;
  label: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await guardNetwork(() => startRegistrationAction({ calendarLessonId, recurrenceId, occurrenceKey, recurrenceIndex }));
      if (result.error || !result.data) {
        setError(result.error ?? "No se pudo empezar el registro.");
        return;
      }
      router.push(`/registro/${result.data.calendarLessonId}`);
    });
  }

  return (
    <div className="flex flex-col gap-1.5 sm:items-start">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-md bg-brandBlue px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brandBlueDark disabled:opacity-60"
      >
        {pending ? "Abriendo..." : label}
      </button>
      {error && <p className="text-xs font-medium text-statusRojo">{error}</p>}
    </div>
  );
}
