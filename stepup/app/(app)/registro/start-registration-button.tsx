"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startRegistrationAction } from "@/lib/actions/lesson-registrations";
import { guardNetwork } from "@/lib/actions/network-guard";
import { Button, type ButtonVariant } from "@/components/ui/button";

export function StartRegistrationButton({
  calendarLessonId,
  recurrenceId,
  occurrenceKey,
  recurrenceIndex,
  label,
  variant = "secondary",
}: {
  calendarLessonId: string | null;
  recurrenceId: string | null;
  occurrenceKey: string | null;
  recurrenceIndex: number | null;
  label: string;
  variant?: ButtonVariant;
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
    <div className="flex flex-col gap-1.5 sm:items-end">
      <Button variant={variant} onClick={handleClick} busy={pending}>
        {pending ? "Abriendo..." : label}
      </Button>
      {error && (
        <p role="alert" className="text-[13px] font-semibold text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
