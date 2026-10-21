"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { guardNetwork } from "@/lib/actions/network-guard";
import { openLessonFileAction } from "@/lib/actions/lesson-files";

/** Abre un adjunto o un material en una pestaña nueva con una dirección firmada y temporal. Muestra el motivo si no se puede. */
export function OpenLessonFileButton({ kind, id, label }: { kind: "attachment" | "material"; id: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    const result = await guardNetwork(() => openLessonFileAction(kind, id));
    setBusy(false);
    if (result.error || !result.data) {
      setError(result.error ?? "No pudimos abrir el archivo.");
      return;
    }
    window.open(result.data.url, "_blank", "noopener,noreferrer");
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button variant="secondary" busy={busy} onClick={open} aria-label={label}>
        Abrir
      </Button>
      {error && (
        <span role="alert" className="text-[13px] text-bad">
          {error}
        </span>
      )}
    </span>
  );
}
